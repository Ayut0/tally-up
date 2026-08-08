-- name: InsertEntry :one
-- Appends one entry to the ledger, returning the seq assigned by the
-- append-only BIGSERIAL. Callers translate a 23505 unique_violation (a
-- reused client-generated id) into entry.ErrDuplicateID.
INSERT INTO entries (id, group_id, kind, payer_id, counterparty, total_amount,
                     split_rule, participants, memo, occurred_on, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING seq;

-- name: InsertPosting :exec
-- Appends one posting row for an entry. Callers must ensure a whole entry's
-- postings sum to zero before calling this query.
INSERT INTO postings (entry_id, member_id, amount)
VALUES ($1, $2, $3);

-- name: GetGroupBalances :many
-- Every group member's net position plus the max entry seq those balances
-- reflect, both from ONE statement (one MVCC snapshot) so as_of_seq is
-- exactly the ledger state the balances derive from.
SELECT gm.member_id,
       COALESCE(b.balance, 0)::bigint AS balance,
       (SELECT COALESCE(MAX(seq), 0) FROM entries e WHERE e.group_id = $1)::bigint AS as_of_seq
FROM group_members gm
LEFT JOIN balances b ON b.group_id = gm.group_id AND b.member_id = gm.member_id
WHERE gm.group_id = $1
ORDER BY gm.member_id;

-- name: GetPairwiseBalances :many
-- Derived pairwise "who owes whom": nets signed debtor/creditor
-- contributions per pair in one statement (one MVCC snapshot), then
-- resolves each pair to an unambiguous debtor_id/creditor_id with an
-- always-positive amount — no canonical-ordering convention for callers to
-- decode. Expense-shaped entries (counterparty IS NULL): each non-payer
-- participant's posting is what they owe the payer. Settlement-shaped
-- entries (counterparty IS NOT NULL) generalize across real settlements and
-- reversals of either shape, since a reversal copies its original's
-- payer/counterparty and negates postings — the same contribution rule
-- threads through unchanged (see docs/superpowers/specs/2026-07-06-group-
-- membership-privacy-pairwise-design.md §1).
WITH contributions AS (
    SELECT p.member_id AS debtor, e.payer_id AS creditor, -p.amount AS amount
    FROM postings p JOIN entries e ON e.id = p.entry_id
    WHERE e.group_id = $1 AND e.counterparty IS NULL AND p.member_id != e.payer_id
    UNION ALL
    SELECT e.payer_id AS debtor, e.counterparty AS creditor, -p.amount AS amount
    FROM postings p JOIN entries e ON e.id = p.entry_id
    WHERE e.group_id = $1 AND e.counterparty IS NOT NULL AND p.member_id = e.payer_id
),
-- lo/hi are an internal netting key only (never exposed): "net" is the
-- signed amount lo owes hi, summed across every contribution touching the
-- pair regardless of which side originated each one.
netted AS (
    SELECT LEAST(debtor, creditor) AS lo, GREATEST(debtor, creditor) AS hi,
           SUM(CASE WHEN debtor < creditor THEN amount ELSE -amount END) AS net
    FROM contributions
    GROUP BY LEAST(debtor, creditor), GREATEST(debtor, creditor)
    HAVING SUM(CASE WHEN debtor < creditor THEN amount ELSE -amount END) != 0
)
SELECT (CASE WHEN net > 0 THEN lo ELSE hi END)::uuid AS debtor_id,
       (CASE WHEN net > 0 THEN hi ELSE lo END)::uuid AS creditor_id,
       ABS(net)::bigint AS amount
FROM netted
ORDER BY lo, hi;

-- name: ListEntriesAfterSeq :many
-- Seq-ordered keyset page of entries. occurred_on stays a date column here;
-- callers format it to the wire "YYYY-MM-DD" string.
SELECT id, seq, kind, reverses_id, payer_id, counterparty, total_amount,
       split_rule, participants, memo, occurred_on, created_by, created_at
FROM entries
WHERE group_id = $1 AND seq > $2
ORDER BY seq
LIMIT $3;

-- name: ListPostingsForEntries :many
-- Second-load of postings for a page of entry ids from ListEntriesAfterSeq.
SELECT entry_id, member_id, amount FROM postings
WHERE entry_id = ANY(sqlc.arg(entry_ids)::uuid[])
ORDER BY entry_id, member_id;

-- name: LockEntryForUpdate :one
-- Locks the original entry against concurrent reversal attempts. FOR UPDATE
-- serializes racers: the loser re-checks after the winner commits (row locks
-- don't fire the append-only trigger — only real UPDATE/DELETE do).
SELECT kind, payer_id, counterparty, total_amount, participants, occurred_on, created_by
FROM entries WHERE id = $1 AND group_id = $2
FOR UPDATE;

-- name: IsAlreadyReversed :one
-- Reports whether any entry already reverses the given original.
SELECT EXISTS(SELECT 1 FROM entries WHERE reverses_id = $1);

-- name: InsertReversalEntry :one
-- Appends a kind='reversal' entry copying the original's payer/counterparty/
-- total/participants/occurred_on, returning the assigned seq.
INSERT INTO entries (id, group_id, kind, reverses_id, payer_id, counterparty,
                     total_amount, split_rule, participants, occurred_on, created_by)
VALUES ($1, $2, 'reversal', $3, $4, $5, $6, '{"type":"reversal"}', $7, $8, $9)
RETURNING seq;

-- name: CopyNegatedPostings :exec
-- Appends the reversal entry's postings as the exact negation of the
-- original's, so the pair sums to zero.
INSERT INTO postings (entry_id, member_id, amount)
SELECT sqlc.arg(reversal_entry_id), p.member_id, -p.amount
FROM postings p WHERE p.entry_id = sqlc.arg(original_entry_id);

-- name: SumAllPostings :one
-- Global zero-sum integrity check: the sum of every posting, across every
-- entry, must be zero.
SELECT COALESCE(SUM(amount), 0)::bigint FROM postings;

-- name: CountEntriesWithNonzeroPostingSum :one
-- Per-entry zero-sum integrity check: counts entries whose own postings
-- don't sum to zero.
SELECT count(*) FROM (
    SELECT entry_id FROM postings GROUP BY entry_id HAVING SUM(amount) <> 0
) bad;

-- name: CountDoublyReversedOriginals :one
-- Counts originals reversed more than once (should never happen given the
-- FOR UPDATE guard in Reverse/Edit).
SELECT count(*) FROM (
    SELECT reverses_id FROM entries WHERE reverses_id IS NOT NULL
    GROUP BY reverses_id HAVING count(*) > 1
) bad;
