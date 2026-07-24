# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase. tally-up is a **single-context** repo (one Go backend).

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, if it exists — the domain glossary. Not yet
  created; `/grill-with-docs` creates it lazily as terms get resolved.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in
  (e.g. `docs/adr/0001-ddd-tactical-scope.md`).
- **`docs/architecture.md`** and **`docs/mapping.md`** — until `CONTEXT.md`
  exists, these carry the design rationale and the DDD layer/code map.

If any of these files don't exist, **proceed silently**. Don't flag their
absence; don't suggest creating them upfront. The producer skill
(`/grill-with-docs`) creates `CONTEXT.md` lazily when terms or decisions actually
get resolved.

## File structure

Single-context repo:

```
/
├── CONTEXT.md                       ← domain glossary (created lazily)
├── docs/
│   ├── architecture.md              ← design rationale
│   ├── mapping.md                   ← DDD layer / code map
│   └── adr/
│       └── 0001-ddd-tactical-scope.md
└── internal/                        ← domain, application, infrastructure, interfaces
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal,
a hypothesis, a test name), use the term as defined in `CONTEXT.md` (or, until it
exists, `docs/architecture.md`). Don't drift to synonyms the glossary explicitly
avoids.

If the concept you need isn't in the glossary yet, that's a signal — either
you're inventing language the project doesn't use (reconsider) or there's a real
gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0001 (DDD tactical scope) — but worth reopening because…_
