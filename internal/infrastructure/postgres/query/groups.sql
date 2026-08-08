-- name: InsertGroup :exec
-- Appends one group. Callers translate a 23505 unique_violation (a reused
-- client-generated id) into group.ErrDuplicateID.
INSERT INTO groups (id, name)
VALUES ($1, $2);

-- name: InsertMember :exec
-- Appends one member. The id is server-minted (uuid.NewV7 — the members
-- table has no DB-generated default), unlike a group or entry id.
INSERT INTO members (id, name)
VALUES ($1, $2);

-- name: InsertGroupMember :exec
-- Links a member into a group.
INSERT INTO group_members (group_id, member_id)
VALUES ($1, $2);

-- name: SelectGroup :one
-- Fetches a group by id. Callers translate pgx.ErrNoRows into group.ErrNotFound.
SELECT id, name FROM groups WHERE id = $1;

-- name: SelectGroupMembers :many
-- All members of a group, ordered by member id for a stable response shape.
SELECT m.id, m.name
FROM group_members gm
JOIN members m ON m.id = gm.member_id
WHERE gm.group_id = $1
ORDER BY m.id;

-- name: DeleteGroupMember :exec
-- Unlinks a member from a group. Idempotent: deleting an already-removed
-- link affects zero rows, not an error.
DELETE FROM group_members WHERE group_id = $1 AND member_id = $2;
