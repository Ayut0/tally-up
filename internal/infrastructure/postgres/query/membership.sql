-- name: CountGroupMembers :one
-- Counts how many of the given member ids belong to the group. Callers compare
-- the count against the number of distinct ids they asked about.
SELECT count(*) FROM group_members
WHERE group_id = $1 AND member_id = ANY(sqlc.arg(member_ids)::uuid[]);
