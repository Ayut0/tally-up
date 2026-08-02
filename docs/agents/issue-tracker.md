# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues on `Ayut0/tally-up`. Use the
`gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

The `wayfinder` skill charts a large effort as a **map** of **decision
tickets**. Both are GitHub issues here; this is how each of its concepts maps
onto this tracker.

| Wayfinder concept | Expressed as |
| --- | --- |
| Map | An issue labelled `wayfinder:map` |
| Ticket | A **sub-issue** of the map, labelled `wayfinder:<type>` |
| Ticket type | `wayfinder:research` / `:prototype` / `:grilling` / `:task` |
| Claim | Assign the ticket to the dev driving the map |
| Blocking | GitHub's native issue dependencies (`blocked_by`) |
| Frontier | Open + unassigned children with no open blockers |

Native sub-issues and dependencies are used deliberately over a body
convention: GitHub renders both in its own UI, so the frontier is visible
without opening the map.

### The database-id gotcha

Both relationship endpoints take the issue **number** in the path but the
issue's **database id** in the body. `gh issue view` shows only the number, so
every wiring call needs a lookup first:

```bash
gh api repos/Ayut0/tally-up/issues/<number> --jq .id
```

This is exactly why wayfinder says to create every ticket first and wire the
edges in a **second pass** — the ids do not exist until the issues do.

### Attach a ticket to its map

```bash
gh api repos/Ayut0/tally-up/issues/<map_number>/sub_issues \
  -F sub_issue_id=<ticket_database_id>
```

`-F` (not `-f`) sends the value as a JSON number; the endpoint rejects a string.

### Wire a blocking edge

Record that `<blocked_number>` cannot start until `<blocker>` is closed:

```bash
gh api repos/Ayut0/tally-up/issues/<blocked_number>/dependencies/blocked_by \
  -F issue_id=<blocker_database_id>
```

### List a map's tickets

```bash
gh api repos/Ayut0/tally-up/issues/<map_number>/sub_issues \
  --jq '.[] | "\(.number)\t\(.state)\t\(.assignee.login // "unclaimed")\t\(.title)"'
```

### Query the frontier

Open, unclaimed tickets whose every blocker is closed — the takeable set:

```bash
for n in $(gh api repos/Ayut0/tally-up/issues/<map_number>/sub_issues \
             --jq '.[] | select(.state == "open" and .assignee == null) | .number'); do
  open_blockers=$(gh api repos/Ayut0/tally-up/issues/"$n"/dependencies/blocked_by \
                    --jq '[.[] | select(.state == "open")] | length')
  [ "$open_blockers" -eq 0 ] &&
    gh issue view "$n" --json number,title --jq '"\(.number)\t\(.title)"'
done
```

### Resolve a ticket

Post the answer as a comment, then close — in that order, so the resolution is
never missing from a closed ticket:

```bash
gh issue comment <number> --body "..."
gh issue close <number>
```

Then append a one-line gist plus link to the map's **Decisions so far**.
