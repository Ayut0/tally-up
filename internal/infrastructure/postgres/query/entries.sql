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
