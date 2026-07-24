-- name: InsertIdempotencyKey :execrows
-- Claims the key with a pending row. ON CONFLICT DO NOTHING means a losing
-- racer inserts nothing; the caller reads the affected-row count (:execrows) to
-- learn whether it won (1) or must classify an existing row (0).
INSERT INTO idempotency_keys (key, request_hash, status)
VALUES ($1, $2, 'pending')
ON CONFLICT (key) DO NOTHING;

-- name: GetIdempotencyOutcome :one
-- Reads the row a conflicting Insert collided with, so the caller can classify
-- the acquisition (replay / mismatch / in-flight). COALESCE keeps the body
-- non-null for a not-yet-succeeded row.
SELECT request_hash, status, COALESCE(response_body, 'null'::jsonb) AS response_body
FROM idempotency_keys
WHERE key = $1;

-- name: DeletePendingIdempotencyKey :exec
-- Releases a pending key after a post-gate failure so the client can retry
-- immediately. Succeeded keys are never touched: their response is replay truth.
DELETE FROM idempotency_keys
WHERE key = $1 AND status = 'pending';

-- name: SweepStalePendingIdempotencyKeys :execrows
-- Janitor sweep: deletes pending rows older than the given age so crashed
-- requests can be retried cleanly. Returns the number of rows reclaimed.
DELETE FROM idempotency_keys
WHERE status = 'pending'
  AND created_at < now() - make_interval(secs => sqlc.arg(older_than_secs)::float8);
