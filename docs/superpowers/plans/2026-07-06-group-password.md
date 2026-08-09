# Group Password Protection Implementation Plan

> **Status (2026-08-09):** Refreshed against the current architecture — sqlc +
> repository (#62-66), the DDD restructure (domain/application/infrastructure/
> interfaces), and TypeSpec-as-contract (#93) all landed after this plan was
> first written, and the original plan targeted a `Store`/`api.Server` shape
> that no longer exists. The **Goal**, **Global Constraints**, and each task's
> behavior/spec prose (status codes, error semantics, token TTL, exemption
> rules) are unchanged and still correct — that part of the original plan
> survived the migration (see #37's closing comment for precedent). What's
> been rewritten below: **Architecture**, **File Structure**, and each task's
> **Files/Interfaces** lists and code samples, to match the current tree.
> Code samples here are illustrative, not copy-paste-ready — cross-check
> against the pointed-to current file before implementing, since more
> architectural churn can land after this refresh too (e.g. #194 retired the
> top-level `migrations/` dir the same week this was refreshed). See #179.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional, server-enforced shared password per group (spec §3 of `docs/superpowers/specs/2026-07-06-group-membership-privacy-pairwise-design.md`) that gates every group-scoped read and write, with no user accounts anywhere.

**Architecture:** A group gets a nullable `password_hash` + monotonic `password_version`. Unlocking exchanges a correct password for a compact, stateless HMAC-signed token (`group_id` + `password_version` + expiry) — no session table, no JWT library. One shared middleware wraps every group-scoped route: if a group has no password, it's a no-op (fully backward compatible); if it does, it requires a valid, current-version token. The client gates its entire `/g/[groupId]/*` route tree with one new layout, so none of the already-shipped pages (balances, add-expense, settle-up, who-owes-whom) need to change.

This lands across the same four layers as every other feature in this repo (`docs/mapping.md`): a `domain/group` port + errors, an `application/*` service orchestrating the idempotency gate where one applies, an `infrastructure/postgres` repository backed by sqlc-generated queries, and `interfaces/rest` handlers. **New relative to every prior plan in this repo: the API contract is TypeSpec-first (`spec/main.tsp`, #93)** — every new route and model MUST be added there and regenerated (`make spec`) before the Go handler is written, because `internal/interfaces/rest/openapi_spec_test.go` validates every response against `spec/openapi.yaml` and will fail a handler that returns something the contract doesn't describe. The web client's types (`web/lib/api-types.ts`) and runtime Zod validators (`web/lib/api-schemas/zod.gen.ts`) are also generated from that same spec.

**Tech Stack:** Go 1.25, `pgx/v5` + sqlc, `golang.org/x/crypto/bcrypt`, stdlib `crypto/hmac`/`crypto/sha256` (no JWT dependency), TypeSpec (`spec/main.tsp`) → OpenAPI → generated Go-side validation + web-side types/schemas, Next.js/TypeScript client.

**Prerequisites:** The four original ledger-core plans plus `docs/superpowers/plans/2026-07-06-pairwise-and-member-management.md` are executed — all of #37-#41 are closed, so this plan's middleware wraps real, shipped routes (`pairwise-balances`, `members`). Note: the pairwise plan's client task (member-management UI) was split out to a separate, still-open effort (#185) with its own web/ conventions — if that lands first, this plan's middleware still applies uniformly regardless of which UI patterns #185 settles on.

## Global Constraints

- No user registration or accounts anywhere. The password is one shared secret per group, not per-person credentials — unlocking proves knowledge of the secret, not identity. Identity remains picking a name from the member list, unchanged.
- The password gates **everything** — every group-scoped read and write — except the two endpoints needed to bootstrap unlocking itself (`password-required`, `unlock`) and group creation (no group exists yet to have a password).
- `password_hash IS NULL` means the group is fully open — today's behavior, unchanged. Every already-shipped endpoint must keep working exactly as before for groups with no password.
- Changing or clearing a password bumps `password_version`, which invalidates every previously issued token immediately — no explicit revocation list needed.
- Lost password = permanently locked out. No recovery path exists or is planned. The client states this plainly when a password is set.
- Money/ledger invariants from prior plans are untouched by this plan.
- Branch: `feat/issue-<n>-group-password` (per-task issue numbers TBD when this plan is broken into issues — see `to-issues`).

## File Structure

```
internal/infrastructure/postgres/migrations/0003_group_password.up.sql   — next free migration number; 0001 and 0002 (drop_plan_seq, #193) are taken. Confirm 0003 is still free before writing this (ls internal/infrastructure/postgres/migrations/) — embedded-only now, no top-level migrations/ dir to keep in sync (#194 retired it)
internal/infrastructure/postgres/migrations/0003_group_password.down.sql
internal/domain/group/group.go                          — modify: PasswordState, ErrWrongPassword, ErrNoPasswordSet, and the port interfaces below
internal/infrastructure/postgres/query/groups.sql        — modify: new sqlc queries (or a new query/password.sql — either is fine, groups.sql already owns the groups table)
internal/infrastructure/postgres/sqlc/                   — regenerated by `make sqlc` (docs/development.md), not hand-edited; `make sqlc-check` is what CI enforces
internal/infrastructure/postgres/group_repository.go     — modify: GetPasswordState, SetPassword, VerifyPassword (or a new password_repository.go on the same *GroupRepository receiver — see Task 1)
internal/infrastructure/postgres/password_repository_test.go
internal/infrastructure/token/token.go                   — Sign, Verify, Token (pure, no DB dependency — relocated from this plan's original `internal/auth` to fit the domain/application/infrastructure/interfaces convention; confirm this placement still makes sense when you pick this up, it's a recommendation not a settled fact)
internal/infrastructure/token/token_test.go
internal/application/setpassword/setpassword.go          — Service.SetPassword, following addmember.Service's Command/Result/ValidationError/GateError shape
internal/application/unlockgroup/unlockgroup.go          — Service.Unlock (see Task 4 for whether this needs the idempotency gate at all — open question, unlike every other mutating service in this codebase)
internal/interfaces/rest/password.go                     — PUT password, POST unlock, GET password-required handlers
internal/interfaces/rest/password_test.go
internal/interfaces/rest/middleware.go                   — passwordMiddleware
internal/interfaces/rest/middleware_test.go
internal/interfaces/rest/server.go                       — modify: NewServer grows a passwordReader/setPassword/unlock/tokenSecret parameter, same pattern as every prior feature's constructor growth
cmd/api/main.go                                          — modify: TOKEN_SIGNING_SECRET env var, wire the new services
spec/main.tsp                                            — modify: PasswordRequired/UnlockRequest/UnlockResponse/SetPasswordRequest models + passwordRequired/unlock/setPassword ops (Task 0, new — this plan predates TypeSpec-as-contract)
web/lib/groupAuth.ts                                     — token storage (localStorage)
web/lib/groupAuth.test.ts
web/lib/api.ts                                           — modify: isPasswordRequired, unlock, attach token + handle 401 (see Task 6 — current shape is getJSON/postIdempotent validated against generated Zod schemas, not the hand-rolled fetch this plan originally sketched)
web/app/g/[groupId]/layout.tsx                           — unlock gate for the whole group route tree (confirm it wraps the full current tree: add/, settle/, record-payment/, and whatever #185 lands)
```

---

### Task 0: TypeSpec contract additions (new — this plan predates #93)

**Files:**
- Modify: `spec/main.tsp` (add models + ops near the existing group ops, `spec/main.tsp:383-480`)
- Regenerate: `spec/openapi.yaml` (`make spec`), `web/lib/api-types.ts` (`cd web && npm run gen:api-types`), `web/lib/api-schemas/zod.gen.ts` (`npm run gen:api-schemas`)

**Why this has to be first:** `internal/interfaces/rest/openapi_spec_test.go` validates every handler's response against the committed `spec/openapi.yaml` — a handler for a route the spec doesn't describe fails that test regardless of how correct the handler logic is. Every following task's REST step assumes the contract already exists.

- [ ] **Step 1: Add models** — `PasswordRequired { required: boolean }`, `UnlockRequest { password: string }`, `UnlockResponse { token: string }`, `SetPasswordRequest { password: string | null }`, following the existing model style (e.g. `CreateGroupRequest`, `AddMemberRequest` near `spec/main.tsp:49-56`).
- [ ] **Step 2: Add ops** — `passwordRequired` (`GET /groups/{group_id}/password-required`), `unlock` (`POST /groups/{group_id}/unlock`), `setPassword` (`PUT /groups/{group_id}/password`), following the `@route`/`op` style of `getBalance`/`addMember` (`spec/main.tsp:401-467`). Reuse the existing `ReadErrors`/`WriteErrors`/`NoContent` aliases (`spec/main.tsp:359-365`) for the shared 404/validation shapes; add a 401 variant if one doesn't already exist for the locked-group case.
- [ ] **Step 3: Regenerate and commit** — `make spec && cd web && npm run gen:api-types && npm run gen:api-schemas`, commit `spec/main.tsp`, `spec/openapi.yaml`, `web/lib/api-types.ts`, `web/lib/api-schemas/zod.gen.ts` together.

---

### Task 1: Schema migration + `GetPasswordState`

**Files:**
- Create: `internal/infrastructure/postgres/migrations/0003_group_password.up.sql`, `.down.sql` (embedded-dir only — no top-level `migrations/` copy step; that pattern was retired in #194)
- Modify: `internal/domain/group/group.go` (add `PasswordState`, a `PasswordReader` port), `internal/infrastructure/postgres/query/groups.sql` (new sqlc query), `internal/infrastructure/postgres/group_repository.go` (add `GetPasswordState`)
- Test: `internal/infrastructure/postgres/password_repository_test.go`, following `group_repository_test.go`'s `TestStore(t)` + `NewGroupRepository(s.Pool)` pattern

**Interfaces:**
- Consumes: `group.ErrNotFound` (already defined in `internal/domain/group/group.go`).
- Produces:
  - `group.PasswordState{Required bool; Version int}` (domain type, not a postgres-package type — this repo's domain errors/shapes for `group` already live in `internal/domain/group/group.go`, e.g. `ErrNonzeroBalance`).
  - A `group.PasswordReader` port: `GetPasswordState(ctx context.Context, groupID uuid.UUID) (PasswordState, error)` — `ErrNotFound` if the group doesn't exist.
  - `(*GroupRepository) GetPasswordState(...)` implementing that port, same file/receiver as `GetGroup`.

- [ ] **Step 1: Confirm the migration number is free, then write it**

`ls internal/infrastructure/postgres/migrations/` — as of this refresh the highest is `0002_drop_plan_seq`, so this is `0003`. Confirm again before writing in case something else claimed it since.

```sql
-- 0003_group_password.up.sql
ALTER TABLE groups ADD COLUMN password_hash TEXT;
ALTER TABLE groups ADD COLUMN password_version INT NOT NULL DEFAULT 0;
```
```sql
-- 0003_group_password.down.sql
ALTER TABLE groups DROP COLUMN password_version;
ALTER TABLE groups DROP COLUMN password_hash;
```

- [ ] **Step 2: Add the domain port and type** in `internal/domain/group/group.go`, next to `Reader`/`MemberRemover`:

```go
type PasswordState struct {
	Required bool
	Version  int
}

// PasswordReader reports whether a group has a password set. NULL
// password_hash means open.
type PasswordReader interface {
	GetPasswordState(ctx context.Context, groupID uuid.UUID) (PasswordState, error)
}
```

- [ ] **Step 3: Write the failing sqlc query** in `internal/infrastructure/postgres/query/groups.sql`, following `SelectGroup`'s style:

```sql
-- name: SelectPasswordState :one
SELECT password_hash, password_version FROM groups WHERE id = $1;
```

Run `make sqlc` (docs/development.md) — this fails to compile against `GroupRepository` until Step 4 is also done, which is fine, sqlc generation itself doesn't depend on the repository.

- [ ] **Step 4: Implement**, in `internal/infrastructure/postgres/group_repository.go` next to `GetGroup`, following its `errors.Is(err, pgx.ErrNoRows)` → `group.ErrNotFound` translation:

```go
func (r *GroupRepository) GetPasswordState(ctx context.Context, groupID uuid.UUID) (group.PasswordState, error) {
	row, err := r.queries(ctx).SelectPasswordState(ctx, groupID)
	if errors.Is(err, pgx.ErrNoRows) {
		return group.PasswordState{}, group.ErrNotFound
	}
	if err != nil {
		return group.PasswordState{}, err
	}
	return group.PasswordState{Required: row.PasswordHash != nil, Version: int(row.PasswordVersion)}, nil
}
```

Add `var _ group.PasswordReader = (*GroupRepository)(nil)` near the file's other such assertions.

- [ ] **Step 5: Test, then run everything**

Follow `group_repository_test.go`'s existing pattern (`TestStore(t)`, `NewGroupRepository(s.Pool)`, a group created via `CreateGroup` first) rather than a bespoke seed helper — there's no `seedReadGroup`/`rGroup` in this package; check `internal/infrastructure/postgres/reads_test.go` if you want the read-path package's actual seed helper name instead.

Run: `go test ./internal/infrastructure/postgres/... -run PasswordState -v`, then `go test ./... -race`.

```bash
git add internal/infrastructure/postgres/migrations/0003_group_password.up.sql internal/infrastructure/postgres/migrations/0003_group_password.down.sql \
        internal/infrastructure/postgres/query/groups.sql internal/infrastructure/postgres/sqlc/ \
        internal/domain/group/group.go internal/infrastructure/postgres/group_repository.go internal/infrastructure/postgres/password_repository_test.go
git commit -m "feat: group password schema + password state read"
```

---

### Task 2: `internal/infrastructure/token` — stateless signed tokens

**Files:**
- Create: `internal/infrastructure/token/token.go`, `internal/infrastructure/token/token_test.go`

**Interfaces:**
- Produces:
  - `token.Token{GroupID uuid.UUID; PasswordVersion int; ExpiresAt int64}` (unix seconds).
  - `token.Sign(secret []byte, tok Token) (string, error)`.
  - `token.Verify(secret []byte, s string) (Token, error)` — `token.ErrInvalidToken` (bad format/signature) or `token.ErrExpiredToken` (valid signature, past expiry).

This package is pure crypto with no DB or domain dependency, so its logic doesn't drift with the rest of the migration — the only change from the original plan is the import path (`tallyup/internal/auth` → `tallyup/internal/infrastructure/token`) and package name, to fit this repo's `domain/application/infrastructure/interfaces` layering (`docs/mapping.md`). Confirm that placement still reads right when you pick this up; it's this refresh's one judgment call rather than a fact pulled from the current tree.

- [ ] **Step 1: Write the failing tests** — round-trip, wrong secret rejected, tampered payload rejected, expired token rejected, malformed string rejected. (Same five cases as the original plan; only the package name changes — `package token` instead of `package auth`.)

- [ ] **Step 2: Implement**

```go
// Package token signs and verifies compact, stateless tokens proving
// knowledge of a group's password. Not a login system: a token proves the
// secret was known, not who the caller is.
package token

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrExpiredToken = errors.New("token expired")
)

type Token struct {
	GroupID         uuid.UUID `json:"group_id"`
	PasswordVersion int       `json:"password_version"`
	ExpiresAt       int64     `json:"expires_at"`
}

// Sign produces "payload.signature", both base64url-encoded, HMAC-SHA256
// signed with secret.
func Sign(secret []byte, tok Token) (string, error) {
	payload, err := json.Marshal(tok)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

// Verify checks the signature and expiry, returning the decoded Token.
func Verify(secret []byte, s string) (Token, error) {
	dot := strings.IndexByte(s, '.')
	if dot < 0 {
		return Token{}, ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(s[:dot])
	if err != nil {
		return Token{}, ErrInvalidToken
	}
	sig, err := base64.RawURLEncoding.DecodeString(s[dot+1:])
	if err != nil {
		return Token{}, ErrInvalidToken
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return Token{}, ErrInvalidToken
	}
	var tok Token
	if err := json.Unmarshal(payload, &tok); err != nil {
		return Token{}, ErrInvalidToken
	}
	if time.Now().Unix() > tok.ExpiresAt {
		return Token{}, ErrExpiredToken
	}
	return tok, nil
}
```

- [ ] **Step 3: Run, commit**

```bash
git add internal/infrastructure/token/
git commit -m "feat: stateless HMAC-signed group unlock tokens"
```

---

### Task 3: `SetPassword` + `PUT /groups/{group_id}/password`

**Files:**
- Modify: `internal/domain/group/group.go` (a `PasswordSetter` port), `internal/infrastructure/postgres/query/groups.sql` + `group_repository.go` (`SetPassword`), `internal/interfaces/rest/server.go` (register route), `spec/main.tsp` (done in Task 0)
- Create: `internal/application/setpassword/setpassword.go`, `internal/interfaces/rest/password.go`
- Test: append to `password_repository_test.go`, create `internal/application/setpassword/setpassword_test.go`, `internal/interfaces/rest/password_test.go`

**Interfaces:**
- Produces:
  - `group.PasswordSetter`: `SetPassword(ctx, groupID uuid.UUID, password *string) error` — `nil` clears the password (reopens the group); a non-nil string bcrypt-hashes and sets it. Always increments `password_version`, even when clearing. `group.ErrNotFound` if the group doesn't exist.
  - `(*GroupRepository) SetPassword(...)` implementing it, using `bcrypt.GenerateFromPassword` — same shape as the original plan's implementation, just moved onto the sqlc query path: an `:execrows` query (`UPDATE groups SET password_hash = $2, password_version = password_version + 1 WHERE id = $1`) checked against 0 affected rows for `ErrNotFound`. There's no existing repository precedent for this exact affected-rows check to follow (`GetGroup`/`GetPasswordState` instead pre-check via a `SELECT` that returns `pgx.ErrNoRows`) — pick whichever reads cleaner when implementing.
  - `internal/application/setpassword.Service`, following `addmember.Service`'s shape (`ValidationError`/`GateError` wrappers, `Command`/`Result`) — *unlike* `addmember`, this is a PUT with no `Idempotency-Key`, so there's likely no idempotency gate here at all; `Service` may just be a thin validate-then-call wrapper. Decide this when implementing — don't assume `addmember`'s gate applies unmodified.
  - Route: `PUT /groups/{group_id}/password`, body `{"password": "<string>" | null}`. 204 on success, 404 unknown group. (Auth enforcement on this route itself is added uniformly by Task 5's middleware — this handler has no bespoke auth logic.)

- [ ] **Step 1-4: Store layer** — failing test in `password_repository_test.go` (set-then-verify-hash, clear-reopens-group bumping version, unknown-group), implement `SetPassword` on `GroupRepository`. `golang.org/x/crypto/bcrypt` is not yet a dependency as of this refresh (not in `go.mod`) — `go get golang.org/x/crypto/bcrypt` first.

- [ ] **Step 5: Application service** — `internal/application/setpassword/setpassword.go`, modeled on `addmember.Service.AddMember`'s structure but without assuming the idempotency gate; validate password length/policy if any (none specified by the spec — an empty string is presumably still a valid password, since `nil` is the distinct "clear" sentinel, not `""`).

- [ ] **Step 6: REST handler** — `internal/interfaces/rest/password.go`, `package rest`, following `groups.go`'s `handleCreateGroup` error-translation style (`errors.Is(err, group.ErrNotFound)` → 404, not `store.ErrGroupNotFound`). Register in `server.go`:

```go
mux.HandleFunc("PUT /groups/{group_id}/password", srv.handleSetPassword)
```

`Server`'s constructor grows a `setPassword *setpassword.Service` parameter, same pattern as every prior feature (`server.go`'s `NewServer` already takes ten-plus parameters — one more is consistent, not a smell here).

- [ ] **Step 7: Run everything, commit**

Run: `go test ./... -race`.

```bash
git add internal/domain/group/group.go internal/infrastructure/postgres/query/groups.sql internal/infrastructure/postgres/sqlc/ \
        internal/infrastructure/postgres/group_repository.go internal/infrastructure/postgres/password_repository_test.go \
        internal/application/setpassword/ internal/interfaces/rest/password.go internal/interfaces/rest/password_test.go internal/interfaces/rest/server.go go.mod go.sum
git commit -m "feat: set/clear group password"
```

---

### Task 4: `VerifyPassword` + unlock + password-required endpoints

**Files:**
- Modify: `internal/domain/group/group.go` (`ErrWrongPassword`, `ErrNoPasswordSet`, a `PasswordVerifier` port), `internal/infrastructure/postgres/group_repository.go` (`VerifyPassword`), `internal/interfaces/rest/password.go` (two more handlers), `internal/interfaces/rest/server.go`
- Create: `internal/application/unlockgroup/unlockgroup.go`
- Test: append to `password_repository_test.go`, `internal/interfaces/rest/password_test.go`

**Interfaces:**
- Produces:
  - `group.ErrWrongPassword`, `group.ErrNoPasswordSet` in `internal/domain/group/group.go`, next to `ErrNonzeroBalance`.
  - `group.PasswordVerifier`: `VerifyPassword(ctx, groupID uuid.UUID, password string) (version int, err error)`.
  - Route `GET /groups/{group_id}/password-required` → `{"required": bool}`, 404 if the group doesn't exist — this can call `group.PasswordReader.GetPasswordState` directly from the handler; it likely doesn't need its own application service, same as `handleGetGroup` calls `groupReader.GetGroup` directly.
  - Route `POST /groups/{group_id}/unlock`, body `{"password": "<string>"}` → 200 + `{"token": "<signed token>"}` on match; 401 wrong password; 400 no password set; 404 unknown group. Token expiry: 30 days from issuance, via `internal/infrastructure/token.Sign`.
  - `internal/application/unlockgroup.Service.Unlock(ctx, cmd) (token string, err error)` — orchestrates `PasswordVerifier.VerifyPassword` then `token.Sign`. No idempotency gate: unlocking is a pure verify-then-mint, safe to call any number of times with no side effect to replay-protect (unlike `AddMember`/`CreateGroup`, nothing is being created).

- [ ] **Step 1-3: Store layer** — failing tests (`VerifyPassword` correct/wrong, no-password-set), implement using `bcrypt.CompareHashAndPassword` against the hash read by the same query as `GetPasswordState` (reuse `SelectPasswordState` rather than adding a near-duplicate query).

- [ ] **Step 4: Application service** — `internal/application/unlockgroup/unlockgroup.go`:

```go
package unlockgroup

type Service struct {
	Passwords group.PasswordVerifier
	Secret    []byte
}

func (s *Service) Unlock(ctx context.Context, groupID uuid.UUID, password string) (string, error) {
	version, err := s.Passwords.VerifyPassword(ctx, groupID, password)
	if err != nil {
		return "", err // caller (REST handler) translates group.ErrWrongPassword/ErrNoPasswordSet/ErrNotFound
	}
	return token.Sign(s.Secret, token.Token{
		GroupID: groupID, PasswordVersion: version,
		ExpiresAt: time.Now().Add(30 * 24 * time.Hour).Unix(),
	})
}
```

- [ ] **Step 5: REST handlers** — `handlePasswordRequired`, `handleUnlock` in `password.go`, following `groups.go`'s error-translation switch style; register both routes in `server.go`. `Server` gains `unlock *unlockgroup.Service` and `passwordReader group.PasswordReader` (or reuse whatever port `handleGetGroup`-adjacent reads already use).

- [ ] **Step 6: Run everything, commit**

Run: `go test ./... -race`.

```bash
git add internal/domain/group/group.go internal/infrastructure/postgres/group_repository.go internal/infrastructure/postgres/password_repository_test.go \
        internal/application/unlockgroup/ internal/interfaces/rest/password.go internal/interfaces/rest/password_test.go internal/interfaces/rest/server.go cmd/
git commit -m "feat: password-required check and unlock token issuance"
```

---

### Task 5: Enforcement middleware

**Files:**
- Create: `internal/interfaces/rest/middleware.go`
- Modify: `internal/interfaces/rest/server.go`
- Test: `internal/interfaces/rest/middleware_test.go`

**Interfaces:**
- Consumes: `group.PasswordReader`, `internal/infrastructure/token.Verify`.
- Produces: `passwordMiddleware(reader group.PasswordReader, secret []byte, next http.Handler) http.Handler` — wraps every group-scoped route (extracted by path shape `/groups/<uuid>/...`) except `POST /groups` (exact), and any path ending in `/password-required` or `/unlock`. Passes through untouched when the group has no password. Otherwise requires `Authorization: Bearer <token>`, valid signature, matching `group_id`, matching **current** `password_version`, not expired — 401 on any failure.

The middleware's own logic is unchanged from the original plan (path-shape parsing since it runs before the mux populates `PathValue`, the exemption list, the version check) — what changes is where it gets its dependencies from:

```go
package rest

import (
	"net/http"
	"strings"

	"github.com/google/uuid"

	"tallyup/internal/domain/group"
	"tallyup/internal/infrastructure/token"
)

func passwordMiddleware(reader group.PasswordReader, secret []byte, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/groups" {
			next.ServeHTTP(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/password-required") || strings.HasSuffix(r.URL.Path, "/unlock") {
			next.ServeHTTP(w, r)
			return
		}

		groupID, ok := groupIDFromPath(r.URL.Path)
		if !ok {
			next.ServeHTTP(w, r) // not group-scoped; let the mux 404/handle it normally
			return
		}

		state, err := reader.GetPasswordState(r.Context(), groupID)
		if err != nil || !state.Required {
			next.ServeHTTP(w, r) // unknown group or open group: let the real handler produce its own error, or proceed
			return
		}

		const bearerPrefix = "Bearer "
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, bearerPrefix) {
			httpError(w, http.StatusUnauthorized, "password required")
			return
		}
		tok, err := token.Verify(secret, strings.TrimPrefix(authHeader, bearerPrefix))
		if err != nil || tok.GroupID != groupID || tok.PasswordVersion != state.Version {
			httpError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func groupIDFromPath(path string) (uuid.UUID, bool) {
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if len(parts) < 2 || parts[0] != "groups" {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(parts[1])
	return id, err == nil
}
```

Wire it into `NewServer`, between the mux and the CORS wrap — check `server.go`'s current `corsMiddleware(corsOrigin, mux)` return line and insert `passwordMiddleware` between them (CORS stays outermost, same rationale as the original plan: its `OPTIONS` short-circuit means preflight never reaches `passwordMiddleware`).

- [ ] **Step 1-3: Tests then implementation** — same seven test cases as the original plan (open group needs no token, locked rejects no token, locked accepts valid token, password change invalidates old token, foreign-group token rejected, exempt routes need no token). Adapt `setGroupPassword`/`unlockGroup`/`getWithToken` test helpers to call through whatever `password.go` handlers Task 3/4 actually produced.

- [ ] **Step 4: Run tests, commit**

Run: `go test ./internal/interfaces/rest/... -run Middleware -v`, then `go test ./... -race`.

```bash
git add internal/interfaces/rest/middleware.go internal/interfaces/rest/middleware_test.go internal/interfaces/rest/server.go
git commit -m "feat: enforce per-group password on every group-scoped route"
```

---

### Task 6: Client — unlock gate + token plumbing

**Files:**
- Create: `web/lib/groupAuth.ts`, `web/app/g/[groupId]/layout.tsx`
- Test: `web/lib/groupAuth.test.ts`
- Modify: `web/lib/api.ts` (add `isPasswordRequired`, `unlock`; attach the token and handle 401 on group-scoped calls)

**Before writing client code:** check current `web/` conventions, the same way #185 (the pairwise plan's own split-out client task) was scoped to do — the `useXForm` + thin-page pattern already used by `web/app/g/[groupId]/add/useAddExpenseForm.ts` and similar, rather than this plan's original hand-rolled sketch. `web/lib/api.ts` today validates every response against a generated Zod schema (`getJSON<T>(path, schema)`, `postIdempotent(path, body, key, schema)` — see `web/lib/api.ts`'s existing `getGroup`/`addEntry` for the current shape), not the plan's original `getJSON`/`ApiError` fetch wrapper. The new `isPasswordRequired`/`unlock` functions should follow that same schema-validated shape, using the `zPasswordRequired`/`zUnlockResponse` schemas Task 0's `gen:api-schemas` step produces.

**Interfaces:**
- `groupAuth.ts`: `getToken(groupId): string | null`, `setToken(groupId, token): void`, `clearToken(groupId): void` — localStorage key `tallyup:token:<groupId>`, SSR-guarded exactly like `web/lib/identity.ts`. This part is pure and has no dependency on anything that changed — keep as originally sketched.
- `api.ts`: `isPasswordRequired(groupId): Promise<boolean>`; `unlock(groupId, password): Promise<string>` (returns the token, throws `ApiError` on failure, validated via the generated schema); every group-scoped call attaches `Authorization: Bearer <token>` when one is stored for that group, and a `401` clears the stored token and throws an `ApiError` telling the user to refresh. Exactly which existing functions need this (`getJSON`, `postIdempotent`, and any DELETE helper #185 introduces for `removeMember`) depends on what's landed in `api.ts` by the time this task starts — audit the file fresh rather than assuming the original plan's function list.
- `web/app/g/[groupId]/layout.tsx` — a client-component layout wrapping every page under `/g/[groupId]/*`. On mount: checks `isPasswordRequired`; if required and no valid token is stored, renders an unlock form instead of `children`; once unlocked (or if never required), renders `children` unchanged. Confirm this wraps the *current* tree — `add/`, `settle/`, `record-payment/` all exist today, plus whatever `owes/` page #185 adds — a layout at `g/[groupId]/layout.tsx` wraps all child routes by construction, so this should need no per-page changes, but verify after #185 lands.

- [ ] **Step 1: Token storage (test-first)** — same as originally sketched: `getToken`/`setToken`/`clearToken` round-trip per group, SSR-guarded. No changes needed from the original plan's code here.

- [ ] **Step 2: Wire tokens into the API client** — extend `web/lib/api.ts` with `isPasswordRequired`/`unlock` (schema-validated, per the note above), and thread `Authorization` header attachment + 401 handling through whatever the current `getJSON`/`postIdempotent`/delete-helper shapes are at implementation time.

- [ ] **Step 3: The unlock gate layout** — same structure as originally sketched (`"checking" | "locked" | "unlocked"` state machine, form on lock, `use(params)` for the async `params` prop), calling the Task 2 client functions.

- [ ] **Step 4: Hand verification**

1. Create a group, open it, add an expense — unaffected (no password set).
2. Set a password via `PUT /groups/<id>/password`. Reload `/g/<id>` → unlock form appears.
3. Wrong password → inline error. Right password → renders normally, token persists in `localStorage`.
4. Change the password, then try an action in a still-open tab → `ApiError` "session expired"; reload → back to the unlock form (documented v1 trade-off, not a bug — see Deferred).
5. Clear the password → group reopens; a fresh tab needs no unlock.

Run: `cd web && npm test && npx tsc --noEmit && npm run build && cd .. && go test ./... -race`.

```bash
git add web/
git commit -m "feat: client-side unlock gate for password-protected groups"
```

---

## Deferred

- Live re-prompt on a mid-session password change (currently requires a manual reload) — acceptable v1 trade-off, stated plainly in this plan and to the end user via the error message.
- A "group settings" UI for setting/changing/clearing the password (this plan lands the API + the unlock gate; the settings form itself can follow, calling the already-built `PUT /groups/{id}/password`).
- Rate-limiting unlock attempts — not addressed; the threat model (spec §3) is "keep casual randoms out," not resisting sustained brute-force. Worth a note if that threat model ever changes.
