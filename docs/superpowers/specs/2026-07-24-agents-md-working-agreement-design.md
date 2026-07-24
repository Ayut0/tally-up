# AGENTS.md working agreement for tally-up — Design

**Date:** 2026-07-24
**Issue:** #68
**Status:** Approved (design), pending implementation plan
**Inspired by:** [axross/claude-loop-template](https://github.com/axross/claude-loop-template)

## Motivation

tally-up's working discipline currently lives entirely *outside* the repo: in
the maintainer's global `~/.claude/CLAUDE.md` and in the `superpowers` plugin.
A fresh clone — for a teammate, a CI runner, or an agent without the plugin —
carries none of it. The repo has no committed working agreement.

The `claude-loop-template` project solves exactly this with an in-repo
`AGENTS.md`: a committed, agent-agnostic working agreement that binds every
session to a `plan → implement → self-review → verify → report` cycle.

We adopt **only** that piece, adapted to tally-up, as a **thin index that
defers to superpowers** rather than re-describing workflow already owned by the
plugin. No duplication, no competing instructions.

## Decision

Create an in-repo working agreement that is a *router*, not a rulebook:

- The cycle and skill routing point to existing `superpowers` skills.
- The only substantive in-repo content is tally-up-specific facts: the DDD
  layout, the sqlc workflow, the concrete verify commands, and the git
  conventions.
- An agent *with* superpowers gets routed to the right skill. An agent
  *without* it still reads a legible cycle + the project's verify commands and
  conventions.

## Files

### `AGENTS.md` (repo root)

Agent-agnostic working agreement. Sections:

1. **The cycle** — a 5-line checklist, each line naming the superpowers skill
   that owns it:
   - plan → `brainstorming` then `writing-plans`
   - implement → `test-driven-development`
   - self-review → `requesting-code-review`
   - verify → `verification-before-completion`
   - report → summarize outcome, verification evidence, follow-ups
2. **Skill routing table** — task type → skill, one line each (feature →
   brainstorming; bug → systematic-debugging; plan execution →
   executing-plans; before merge → requesting-code-review; suspend work →
   handoff).
3. **Project facts (tally-up):**
   - DDD layer map: `internal/{domain,application,infrastructure,interfaces}`,
     `cmd/api`, `migrations/`, sqlc via `query/*.sql` + `sqlc.yaml`.
   - sqlc workflow: edit `query/*.sql` → `make sqlc` to regenerate.
4. **Verify commands** (the genuinely repo-specific, load-bearing part):
   - `make db-up` — start local Postgres (tests need it).
   - `make test` — `TEST_DATABASE_URL=... CGO_ENABLED=0 go test -p 1 ./...
     -race`.
   - `go vet ./...`
   - `make sqlc` / `sqlc generate` — after query changes.
5. **Conventions:** branch naming `<prefix>/issue-N-desc`; one issue per
   branch; worktree-per-issue; sync via `git rebase origin/main` (never
   `merge`/`pull`).
6. **Escalation:** migrations, data-loss, and auth changes warrant extra
   review and an ADR in `docs/adr/`.

### `CLAUDE.md` (repo root, ~3 lines)

Binding shim so Claude Code auto-loads the agreement:

```markdown
# tally-up

@AGENTS.md
```

Substance stays in `AGENTS.md` (which Cursor, Codex, etc. also read); `CLAUDE.md`
only guarantees Claude Code picks it up.

## Out of scope (deferred to follow-up issues)

These are wanted but not part of this change:

1. **`/address` + `/handoff` commands** (issue #69) — the template's two
   entry-point commands. Deferred: superpowers already provides `handoff`, and
   `/address` overlaps `brainstorming`. Follow-up to evaluate a thin tally-up
   wrapper vs. relying on superpowers.
2. **CI independent-review workflow** (issue #70) — the template's GitHub
   Action that posts an independent review on PRs. Deferred: the repo has no
   `.github/workflows/` yet, so this is a separate infrastructure decision.

Also not ported: `INIT.md` / `init.sh` / `tokens.json` (one-time scaffolding
machinery — we author the adapted files directly).

## Success criteria

- A fresh agent with **no** superpowers plugin and **no** global CLAUDE.md can
  clone tally-up, read `AGENTS.md`, and know the cycle, the exact verify
  commands, and the git conventions.
- An agent **with** superpowers is routed to the correct skill for each task
  type instead of reading a duplicated instruction.
- `AGENTS.md` contradicts neither the global CLAUDE.md nor any superpowers
  skill; it points to them.
- Two follow-up issues exist for the deferred commands and CI workflow.
