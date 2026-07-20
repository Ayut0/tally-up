# Group Password Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional, server-enforced shared password per group (spec §3 of `docs/superpowers/specs/2026-07-06-group-membership-privacy-pairwise-design.md`) that gates every group-scoped read and write, with no user accounts anywhere.

**Architecture:** A group gets a nullable `password_hash` + monotonic `password_version`. Unlocking exchanges a correct password for a compact, stateless HMAC-signed token (`group_id` + `password_version` + expiry) — no session table, no JWT library. One shared middleware wraps every group-scoped route: if a group has no password, it's a no-op (fully backward compatible); if it does, it requires a valid, current-version token. The client gates its entire `/g/[groupId]/*` route tree with one new layout, so none of the already-planned pages (balances, add-expense, settle-up, who-owes-whom) need to change.

**Tech Stack:** Go 1.23+, `pgx/v5`, `golang.org/x/crypto/bcrypt`, stdlib `crypto/hmac`/`crypto/sha256` (no JWT dependency), Next.js/TypeScript client.

**Prerequisites:** All four original plans plus `docs/superpowers/plans/2026-07-06-pairwise-and-member-management.md` are executed — this plan's middleware wraps routes those add too (`pairwise-balances`, `members`).

## Global Constraints

- No user registration or accounts anywhere. The password is one shared secret per group, not per-person credentials — unlocking proves knowledge of the secret, not identity. Identity remains picking a name from the member list, unchanged.
- The password gates **everything** — every group-scoped read and write — except the two endpoints needed to bootstrap unlocking itself (`password-required`, `unlock`) and group creation (no group exists yet to have a password).
- `password_hash IS NULL` means the group is fully open — today's behavior, unchanged. Every already-planned endpoint must keep working exactly as before for groups with no password.
- Changing or clearing a password bumps `password_version`, which invalidates every previously issued token immediately — no explicit revocation list needed.
- Lost password = permanently locked out. No recovery path exists or is planned. The client states this plainly when a password is set.
- Money/ledger invariants from prior plans are untouched by this plan.
- Branch: `feat/issue-9-group-password`.

## File Structure

```
migrations/0002_group_password.up.sql
migrations/0002_group_password.down.sql
internal/infrastructure/postgres/migrations/0002_group_password.up.sql   — embedded copy
internal/infrastructure/postgres/migrations/0002_group_password.down.sql
internal/auth/token.go              — Sign, Verify, Token
internal/auth/token_test.go
internal/infrastructure/postgres/password.go         — GetPasswordState, SetPassword, VerifyPassword
internal/infrastructure/postgres/password_test.go
internal/interfaces/rest/password.go           — PUT password, POST unlock, GET password-required
internal/interfaces/rest/password_test.go
internal/interfaces/rest/middleware.go         — passwordMiddleware
internal/interfaces/rest/middleware_test.go
internal/interfaces/rest/server.go             — modify: NewServer takes a token secret, wires middleware
cmd/api/main.go                    — modify: TOKEN_SIGNING_SECRET env var
web/lib/groupAuth.ts               — token storage (localStorage)
web/lib/groupAuth.test.ts
web/lib/api.ts                     — modify: attach token, handle 401, isPasswordRequired/unlock
web/app/g/[groupId]/layout.tsx     — unlock gate for the whole group route tree
```

---

### Task 1: Schema migration + `GetPasswordState`

**Files:**
- Create: `migrations/0002_group_password.up.sql`, `migrations/0002_group_password.down.sql`, and identical copies at `internal/infrastructure/postgres/migrations/0002_group_password.up.sql` / `.down.sql` (the embedded copy `go:embed` reads — same two-copy pattern as migration `0001`)
- Modify: `internal/infrastructure/postgres/groups.go` (add `GetPasswordState`)
- Test: `internal/infrastructure/postgres/password_test.go`

**Interfaces:**
- Consumes: `TestStore`, `ErrGroupNotFound` (already defined in `groups.go`).
- Produces:
  - `store.PasswordState{Required bool; Version int}`.
  - `(*Store) GetPasswordState(ctx context.Context, groupID uuid.UUID) (PasswordState, error)` — `ErrGroupNotFound` if the group doesn't exist.

- [ ] **Step 1: Write the migration**

`migrations/0002_group_password.up.sql`:

```sql
ALTER TABLE groups ADD COLUMN password_hash TEXT;
ALTER TABLE groups ADD COLUMN password_version INT NOT NULL DEFAULT 0;
```

`migrations/0002_group_password.down.sql`:

```sql
ALTER TABLE groups DROP COLUMN password_version;
ALTER TABLE groups DROP COLUMN password_hash;
```

Copy both into the embedded directory:

```bash
cp migrations/0002_group_password.up.sql migrations/0002_group_password.down.sql internal/infrastructure/postgres/migrations/
```

- [ ] **Step 2: Write the failing test**

`internal/infrastructure/postgres/password_test.go`:

```go
package store

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestGetPasswordState_DefaultsToNotRequired(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	state, err := s.GetPasswordState(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	if state.Required || state.Version != 0 {
		t.Fatalf("fresh group should be open at version 0, got %+v", state)
	}
}

func TestGetPasswordState_UnknownGroup(t *testing.T) {
	s := TestStore(t)
	if _, err := s.GetPasswordState(context.Background(), uuid.New()); !errors.Is(err, ErrGroupNotFound) {
		t.Fatalf("got %v, want ErrGroupNotFound", err)
	}
}
```

- [ ] **Step 3: Run to verify failure**

Run: `go test ./internal/infrastructure/postgres/ -v -run PasswordState`
Expected: compile FAIL — `s.GetPasswordState undefined`. (If migration 0002 isn't applied to a fresh `TestStore`, you'd instead see a "column password_hash does not exist" runtime error once the function compiles — the migration copy step above prevents that.)

- [ ] **Step 4: Implement**

Append to `internal/infrastructure/postgres/groups.go`:

```go
type PasswordState struct {
	Required bool
	Version  int
}

// GetPasswordState reports whether a group has a password set (and its
// current version, for token validation). NULL password_hash means open.
func (s *Store) GetPasswordState(ctx context.Context, groupID uuid.UUID) (PasswordState, error) {
	var hash *string
	var version int
	err := s.Pool.QueryRow(ctx,
		`SELECT password_hash, password_version FROM groups WHERE id = $1`,
		groupID).Scan(&hash, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return PasswordState{}, ErrGroupNotFound
	}
	if err != nil {
		return PasswordState{}, err
	}
	return PasswordState{Required: hash != nil, Version: version}, nil
}
```

- [ ] **Step 5: Run tests, commit**

Run: `go test ./internal/infrastructure/postgres/ -v -run PasswordState`
Expected: PASS.

```bash
git add migrations/0002_group_password.up.sql migrations/0002_group_password.down.sql \
        internal/infrastructure/postgres/migrations/0002_group_password.up.sql internal/infrastructure/postgres/migrations/0002_group_password.down.sql \
        internal/infrastructure/postgres/groups.go internal/infrastructure/postgres/password_test.go
git commit -m "feat: group password schema + password state read"
```

---

### Task 2: `internal/auth` — stateless signed tokens

**Files:**
- Create: `internal/auth/token.go`
- Test: `internal/auth/token_test.go`

**Interfaces:**
- Produces:
  - `auth.Token{GroupID uuid.UUID; PasswordVersion int; ExpiresAt int64}` (unix seconds).
  - `auth.Sign(secret []byte, tok Token) (string, error)`.
  - `auth.Verify(secret []byte, s string) (Token, error)` — `auth.ErrInvalidToken` (bad format/signature) or `auth.ErrExpiredToken` (valid signature, past expiry).

This package has no DB dependency — pure, fast, unit-testable in isolation.

- [ ] **Step 1: Write the failing tests**

`internal/auth/token_test.go`:

```go
package auth

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

var secretA = []byte("test-secret-a")
var secretB = []byte("test-secret-b")

func TestSignAndVerify_RoundTrips(t *testing.T) {
	tok := Token{GroupID: uuid.New(), PasswordVersion: 3, ExpiresAt: time.Now().Add(time.Hour).Unix()}
	s, err := Sign(secretA, tok)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Verify(secretA, s)
	if err != nil {
		t.Fatal(err)
	}
	if got != tok {
		t.Fatalf("got %+v, want %+v", got, tok)
	}
}

func TestVerify_WrongSecretRejected(t *testing.T) {
	tok := Token{GroupID: uuid.New(), PasswordVersion: 1, ExpiresAt: time.Now().Add(time.Hour).Unix()}
	s, err := Sign(secretA, tok)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Verify(secretB, s); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("got %v, want ErrInvalidToken", err)
	}
}

func TestVerify_TamperedPayloadRejected(t *testing.T) {
	tok := Token{GroupID: uuid.New(), PasswordVersion: 1, ExpiresAt: time.Now().Add(time.Hour).Unix()}
	s, err := Sign(secretA, tok)
	if err != nil {
		t.Fatal(err)
	}
	tampered := s[:len(s)-4] + "abcd" // corrupt the signature tail
	if _, err := Verify(secretA, tampered); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("got %v, want ErrInvalidToken", err)
	}
}

func TestVerify_ExpiredTokenRejected(t *testing.T) {
	tok := Token{GroupID: uuid.New(), PasswordVersion: 1, ExpiresAt: time.Now().Add(-time.Hour).Unix()}
	s, err := Sign(secretA, tok)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Verify(secretA, s); !errors.Is(err, ErrExpiredToken) {
		t.Fatalf("got %v, want ErrExpiredToken", err)
	}
}

func TestVerify_MalformedStringRejected(t *testing.T) {
	for _, bad := range []string{"", "no-dot-here", "..", "not-base64!.also-not-base64!"} {
		if _, err := Verify(secretA, bad); !errors.Is(err, ErrInvalidToken) {
			t.Fatalf("input %q: got %v, want ErrInvalidToken", bad, err)
		}
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/auth/ -v`
Expected: compile FAIL — package doesn't exist yet.

- [ ] **Step 3: Implement**

`internal/auth/token.go`:

```go
// Package auth signs and verifies compact, stateless tokens proving
// knowledge of a group's password. Not a login system: a token proves
// the secret was known, not who the caller is.
package auth

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
// signed with secret. A fixed, small shape — no JWT library needed.
func Sign(secret []byte, tok Token) (string, error) {
	payload, err := json.Marshal(tok)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write(payload)
	sig := mac.Sum(nil)
	return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(sig), nil
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
	want := mac.Sum(nil)
	if !hmac.Equal(sig, want) {
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

- [ ] **Step 4: Run tests, commit**

Run: `go test ./internal/auth/ -v`
Expected: PASS (5/5).

```bash
go get github.com/google/uuid@latest # already a dependency; ensures go.sum is current
git add internal/auth/
git commit -m "feat: stateless HMAC-signed group unlock tokens"
```

---

### Task 3: `SetPassword` + `PUT /groups/{group_id}/password`

**Files:**
- Create: `internal/interfaces/rest/password.go`
- Modify: `internal/infrastructure/postgres/groups.go` (add `SetPassword`)
- Test: append to `internal/infrastructure/postgres/password_test.go`, create `internal/interfaces/rest/password_test.go`

**Interfaces:**
- Produces:
  - `(*Store) SetPassword(ctx context.Context, groupID uuid.UUID, password *string) error` — `nil` clears the password (reopens the group); a non-nil string bcrypt-hashes and sets it. Always increments `password_version`, even when clearing. `ErrGroupNotFound` if the group doesn't exist.
  - Route: `PUT /groups/{group_id}/password`, body `{"password": "<string>" | null}`. 204 on success, 404 unknown group. (Auth enforcement on this route itself is added uniformly by Task 5's middleware — this task's handler has no bespoke auth logic.)

- [ ] **Step 1: Write the failing store tests**

Append to `internal/infrastructure/postgres/password_test.go`:

```go
func TestSetPassword_SetThenVerifyHash(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	pw := "correct horse battery staple"
	if err := s.SetPassword(context.Background(), rGroup, &pw); err != nil {
		t.Fatal(err)
	}
	state, err := s.GetPasswordState(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	if !state.Required || state.Version != 1 {
		t.Fatalf("got %+v, want Required=true Version=1", state)
	}
}

func TestSetPassword_ClearReopensGroup(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	pw := "secret"
	if err := s.SetPassword(context.Background(), rGroup, &pw); err != nil {
		t.Fatal(err)
	}
	if err := s.SetPassword(context.Background(), rGroup, nil); err != nil {
		t.Fatal(err)
	}
	state, err := s.GetPasswordState(context.Background(), rGroup)
	if err != nil {
		t.Fatal(err)
	}
	if state.Required || state.Version != 2 {
		t.Fatalf("got %+v, want Required=false Version=2 (both set and clear bump version)", state)
	}
}

func TestSetPassword_UnknownGroup(t *testing.T) {
	s := TestStore(t)
	pw := "x"
	if err := s.SetPassword(context.Background(), uuid.New(), &pw); !errors.Is(err, ErrGroupNotFound) {
		t.Fatalf("got %v, want ErrGroupNotFound", err)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/infrastructure/postgres/ -v -run SetPassword`
Expected: compile FAIL — `s.SetPassword undefined`.

- [ ] **Step 3: Implement**

```bash
go get golang.org/x/crypto/bcrypt@latest
```

Append to `internal/infrastructure/postgres/groups.go`:

```go
// SetPassword hashes and stores a new password, or clears it (password=nil,
// reopening the group). Always bumps password_version, invalidating every
// previously issued token — including on clear, so a token from before a
// clear can't be replayed if the same password is set again later.
func (s *Store) SetPassword(ctx context.Context, groupID uuid.UUID, password *string) error {
	var hash *string
	if password != nil {
		h, err := bcrypt.GenerateFromPassword([]byte(*password), bcrypt.DefaultCost)
		if err != nil {
			return err
		}
		hs := string(h)
		hash = &hs
	}
	ct, err := s.Pool.Exec(ctx,
		`UPDATE groups SET password_hash = $2, password_version = password_version + 1 WHERE id = $1`,
		groupID, hash)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrGroupNotFound
	}
	return nil
}
```

Add `"golang.org/x/crypto/bcrypt"` to `internal/infrastructure/postgres/groups.go`'s imports.

- [ ] **Step 4: Run store tests**

Run: `go test ./internal/infrastructure/postgres/ -v -run SetPassword`
Expected: PASS.

- [ ] **Step 5: API test, handler, route**

`internal/interfaces/rest/password_test.go`:

```go
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestSetPassword_Endpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	body, _ := json.Marshal(map[string]any{"password": "hunter2"})
	req, _ := http.NewRequest("PUT", srv.URL+fmt.Sprintf("/groups/%s/password", gID), bytes.NewReader(body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d, want 204", resp.StatusCode)
	}
}

func TestSetPassword_ClearWithNull(t *testing.T) {
	srv, _ := newTestServer(t)
	body, _ := json.Marshal(map[string]any{"password": nil})
	req, _ := http.NewRequest("PUT", srv.URL+fmt.Sprintf("/groups/%s/password", gID), bytes.NewReader(body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d, want 204", resp.StatusCode)
	}
}
```

`internal/interfaces/rest/password.go`:

```go
package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/google/uuid"

	"tallyup/internal/infrastructure/postgres"
)

type setPasswordRequest struct {
	Password *string `json:"password"`
}

func (s *Server) handleSetPassword(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if err != nil {
		httpError(w, http.StatusBadRequest, "unreadable body")
		return
	}
	var req setPasswordRequest
	if err := json.Unmarshal(body, &req); err != nil {
		httpError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	err = s.store.SetPassword(r.Context(), groupID, req.Password)
	switch {
	case errors.Is(err, store.ErrGroupNotFound):
		httpError(w, http.StatusNotFound, err.Error())
	case err != nil:
		httpError(w, http.StatusInternalServerError, "set password failed")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
```

In `internal/interfaces/rest/server.go`:

```go
	mux.HandleFunc("PUT /groups/{group_id}/password", srv.handleSetPassword)
```

- [ ] **Step 6: Run everything, commit**

Run: `go test ./... -race`
Expected: PASS.

```bash
git add internal/infrastructure/postgres/groups.go internal/infrastructure/postgres/password_test.go internal/interfaces/rest/password.go internal/interfaces/rest/password_test.go internal/interfaces/rest/server.go go.mod go.sum
git commit -m "feat: set/clear group password"
```

---

### Task 4: `VerifyPassword` + unlock + password-required endpoints

**Files:**
- Modify: `internal/infrastructure/postgres/groups.go` (add `VerifyPassword`), `internal/interfaces/rest/password.go` (add two handlers)
- Modify: `internal/interfaces/rest/server.go`
- Test: append to `internal/infrastructure/postgres/password_test.go`, `internal/interfaces/rest/password_test.go`

**Interfaces:**
- Produces:
  - `store.ErrWrongPassword`, `store.ErrNoPasswordSet`.
  - `(*Store) VerifyPassword(ctx context.Context, groupID uuid.UUID, password string) (version int, err error)`.
  - Route `GET /groups/{group_id}/password-required` → `{"required": bool}`, 404 if the group doesn't exist.
  - Route `POST /groups/{group_id}/unlock`, body `{"password": "<string>"}` → 200 + `{"token": "<signed token>"}` on match; 401 wrong password; 400 no password set; 404 unknown group. Token expiry: 30 days from issuance.

- [ ] **Step 1: Write the failing store tests**

Append to `internal/infrastructure/postgres/password_test.go`:

```go
func TestVerifyPassword_CorrectAndWrong(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	pw := "hunter2"
	if err := s.SetPassword(context.Background(), rGroup, &pw); err != nil {
		t.Fatal(err)
	}

	version, err := s.VerifyPassword(context.Background(), rGroup, pw)
	if err != nil || version != 1 {
		t.Fatalf("correct password: version=%d err=%v, want 1/nil", version, err)
	}

	if _, err := s.VerifyPassword(context.Background(), rGroup, "wrong"); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("got %v, want ErrWrongPassword", err)
	}
}

func TestVerifyPassword_NoPasswordSet(t *testing.T) {
	s := TestStore(t)
	seedReadGroup(t, s)
	if _, err := s.VerifyPassword(context.Background(), rGroup, "anything"); !errors.Is(err, ErrNoPasswordSet) {
		t.Fatalf("got %v, want ErrNoPasswordSet", err)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/infrastructure/postgres/ -v -run VerifyPassword`
Expected: compile FAIL — `s.VerifyPassword undefined`.

- [ ] **Step 3: Implement the store side**

Append to `internal/infrastructure/postgres/groups.go`:

```go
var (
	ErrWrongPassword = errors.New("incorrect password")
	ErrNoPasswordSet = errors.New("group has no password set")
)

// VerifyPassword checks a candidate password against the group's stored
// hash, returning the current password_version for the caller to embed in
// a freshly issued token.
func (s *Store) VerifyPassword(ctx context.Context, groupID uuid.UUID, password string) (int, error) {
	var hash *string
	var version int
	err := s.Pool.QueryRow(ctx,
		`SELECT password_hash, password_version FROM groups WHERE id = $1`,
		groupID).Scan(&hash, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrGroupNotFound
	}
	if err != nil {
		return 0, err
	}
	if hash == nil {
		return 0, ErrNoPasswordSet
	}
	if bcrypt.CompareHashAndPassword([]byte(*hash), []byte(password)) != nil {
		return 0, ErrWrongPassword
	}
	return version, nil
}
```

- [ ] **Step 4: Run store tests**

Run: `go test ./internal/infrastructure/postgres/ -v -run VerifyPassword`
Expected: PASS.

- [ ] **Step 5: API tests, handlers, routes**

Append to `internal/interfaces/rest/password_test.go`:

```go
func TestPasswordRequired_Endpoint(t *testing.T) {
	srv, _ := newTestServer(t)
	var body struct {
		Required bool `json:"required"`
	}
	resp := getJSON(t, srv.URL+fmt.Sprintf("/groups/%s/password-required", gID), &body)
	if resp.StatusCode != http.StatusOK || body.Required {
		t.Fatalf("status %d required %v, want 200/false", resp.StatusCode, body.Required)
	}

	setPw, _ := json.Marshal(map[string]any{"password": "hunter2"})
	req, _ := http.NewRequest("PUT", srv.URL+fmt.Sprintf("/groups/%s/password", gID), bytes.NewReader(setPw))
	http.DefaultClient.Do(req)

	resp = getJSON(t, srv.URL+fmt.Sprintf("/groups/%s/password-required", gID), &body)
	if resp.StatusCode != http.StatusOK || !body.Required {
		t.Fatalf("after set: status %d required %v, want 200/true", resp.StatusCode, body.Required)
	}
}

func TestPasswordRequired_UnknownGroupIs404(t *testing.T) {
	srv, _ := newTestServer(t)
	var body struct{ Required bool `json:"required"` }
	resp := getJSON(t, srv.URL+"/groups/"+uuid.NewString()+"/password-required", &body)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("status %d, want 404", resp.StatusCode)
	}
}

func TestUnlock_CorrectAndWrongPassword(t *testing.T) {
	srv, _ := newTestServer(t)
	setPw, _ := json.Marshal(map[string]any{"password": "hunter2"})
	req, _ := http.NewRequest("PUT", srv.URL+fmt.Sprintf("/groups/%s/password", gID), bytes.NewReader(setPw))
	http.DefaultClient.Do(req)

	ok, _ := json.Marshal(map[string]any{"password": "hunter2"})
	resp, err := http.Post(srv.URL+fmt.Sprintf("/groups/%s/unlock", gID), "application/json", bytes.NewReader(ok))
	if err != nil {
		t.Fatal(err)
	}
	var okBody struct {
		Token string `json:"token"`
	}
	json.NewDecoder(resp.Body).Decode(&okBody)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || okBody.Token == "" {
		t.Fatalf("status %d, token %q", resp.StatusCode, okBody.Token)
	}

	wrong, _ := json.Marshal(map[string]any{"password": "nope"})
	resp2, err := http.Post(srv.URL+fmt.Sprintf("/groups/%s/unlock", gID), "application/json", bytes.NewReader(wrong))
	if err != nil {
		t.Fatal(err)
	}
	resp2.Body.Close()
	if resp2.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", resp2.StatusCode)
	}
}

func TestUnlock_NoPasswordSetIs400(t *testing.T) {
	srv, _ := newTestServer(t)
	body, _ := json.Marshal(map[string]any{"password": "anything"})
	resp, err := http.Post(srv.URL+fmt.Sprintf("/groups/%s/unlock", gID), "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d, want 400", resp.StatusCode)
	}
}
```

(`uuid` is already imported at the top of this file, added in Task 3.)

Append to `internal/interfaces/rest/password.go`:

```go
const unlockTokenTTL = 30 * 24 * time.Hour

func (s *Server) handlePasswordRequired(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	state, err := s.store.GetPasswordState(r.Context(), groupID)
	if errors.Is(err, store.ErrGroupNotFound) {
		httpError(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		httpError(w, http.StatusInternalServerError, "password state read failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"required": state.Required})
}

type unlockRequest struct {
	Password string `json:"password"`
}

func (s *Server) handleUnlock(w http.ResponseWriter, r *http.Request) {
	groupID, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if err != nil {
		httpError(w, http.StatusBadRequest, "unreadable body")
		return
	}
	var req unlockRequest
	if err := json.Unmarshal(body, &req); err != nil {
		httpError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	version, err := s.store.VerifyPassword(r.Context(), groupID, req.Password)
	switch {
	case errors.Is(err, store.ErrGroupNotFound):
		httpError(w, http.StatusNotFound, err.Error())
		return
	case errors.Is(err, store.ErrNoPasswordSet):
		httpError(w, http.StatusBadRequest, err.Error())
		return
	case errors.Is(err, store.ErrWrongPassword):
		httpError(w, http.StatusUnauthorized, err.Error())
		return
	case err != nil:
		httpError(w, http.StatusInternalServerError, "unlock failed")
		return
	}
	tok, err := auth.Sign(s.tokenSecret, auth.Token{
		GroupID: groupID, PasswordVersion: version,
		ExpiresAt: time.Now().Add(unlockTokenTTL).Unix(),
	})
	if err != nil {
		httpError(w, http.StatusInternalServerError, "token signing failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": tok})
}
```

Add `"time"` and `"tallyup/internal/auth"` to `internal/interfaces/rest/password.go`'s imports.

`Server` needs the signing secret. In `internal/interfaces/rest/server.go`, modify:

```go
type Server struct {
	store       *store.Store
	tokenSecret []byte
}

func NewServer(s *store.Store, corsOrigin string, tokenSecret []byte) http.Handler {
	srv := &Server{store: s, tokenSecret: tokenSecret}
	mux := http.NewServeMux()
	// … all existing mux.HandleFunc registrations, plus:
	mux.HandleFunc("GET /groups/{group_id}/password-required", srv.handlePasswordRequired)
	mux.HandleFunc("POST /groups/{group_id}/unlock", srv.handleUnlock)
	return corsMiddleware(corsOrigin, mux)
}
```

Update every caller of `NewServer`: `cmd/api/main.go` → `api.NewServer(s, os.Getenv("CORS_ORIGIN"), []byte(os.Getenv("TOKEN_SIGNING_SECRET")))`; the test helper `newTestServer` in `internal/interfaces/rest/entries_test.go` → `NewServer(s, "*", []byte("test-signing-secret"))`.

- [ ] **Step 6: Run everything, commit**

Run: `go test ./... -race`
Expected: PASS.

```bash
git add internal/infrastructure/postgres/groups.go internal/infrastructure/postgres/password_test.go internal/interfaces/rest/password.go internal/interfaces/rest/password_test.go internal/interfaces/rest/server.go internal/interfaces/rest/entries_test.go cmd/
git commit -m "feat: password-required check and unlock token issuance"
```

---

### Task 5: Enforcement middleware

**Files:**
- Create: `internal/interfaces/rest/middleware.go`
- Modify: `internal/interfaces/rest/server.go`
- Test: `internal/interfaces/rest/middleware_test.go`

**Interfaces:**
- Consumes: `store.GetPasswordState`, `auth.Verify`.
- Produces: `passwordMiddleware(s *store.Store, secret []byte, next http.Handler) http.Handler` — wraps every group-scoped route (extracted by path shape `/groups/<uuid>/...`) except `POST /groups` (exact), and any path ending in `/password-required` or `/unlock`. Passes through untouched when the group has no password. Otherwise requires `Authorization: Bearer <token>`, valid signature, matching `group_id`, matching **current** `password_version`, not expired — 401 on any failure.

- [ ] **Step 1: Write the failing tests**

`internal/interfaces/rest/middleware_test.go`:

```go
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"tallyup/internal/auth"
)

func setGroupPassword(t *testing.T, srv *httptest.Server, password string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"password": password})
	req, _ := http.NewRequest("PUT", srv.URL+fmt.Sprintf("/groups/%s/password", gID), bytes.NewReader(body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
}

func unlockGroup(t *testing.T, srv *httptest.Server, password string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"password": password})
	resp, err := http.Post(srv.URL+fmt.Sprintf("/groups/%s/unlock", gID), "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		Token string `json:"token"`
	}
	json.NewDecoder(resp.Body).Decode(&out)
	return out.Token
}

func getWithToken(t *testing.T, url, token string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest("GET", url, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestMiddleware_OpenGroupNeedsNoToken(t *testing.T) {
	srv, _ := newTestServer(t)
	resp := getWithToken(t, srv.URL+fmt.Sprintf("/groups/%s/balance", gID), "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200 for an open group", resp.StatusCode)
	}
}

func TestMiddleware_LockedGroupRejectsNoToken(t *testing.T) {
	srv, _ := newTestServer(t)
	setGroupPassword(t, srv, "hunter2")
	resp := getWithToken(t, srv.URL+fmt.Sprintf("/groups/%s/balance", gID), "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401", resp.StatusCode)
	}
}

func TestMiddleware_LockedGroupAcceptsValidToken(t *testing.T) {
	srv, _ := newTestServer(t)
	setGroupPassword(t, srv, "hunter2")
	token := unlockGroup(t, srv, "hunter2")
	resp := getWithToken(t, srv.URL+fmt.Sprintf("/groups/%s/balance", gID), token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200 with a valid token", resp.StatusCode)
	}
}

func TestMiddleware_PasswordChangeInvalidatesOldToken(t *testing.T) {
	srv, _ := newTestServer(t)
	setGroupPassword(t, srv, "hunter2")
	oldToken := unlockGroup(t, srv, "hunter2")
	setGroupPassword(t, srv, "new-password") // bumps password_version

	resp := getWithToken(t, srv.URL+fmt.Sprintf("/groups/%s/balance", gID), oldToken)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401 for a pre-change token", resp.StatusCode)
	}
}

func TestMiddleware_TokenForDifferentGroupRejected(t *testing.T) {
	srv, _ := newTestServer(t)
	setGroupPassword(t, srv, "hunter2")

	foreignToken, err := auth.Sign([]byte("test-signing-secret"), auth.Token{
		GroupID: uuid.New(), PasswordVersion: 1, ExpiresAt: time.Now().Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	resp := getWithToken(t, srv.URL+fmt.Sprintf("/groups/%s/balance", gID), foreignToken)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d, want 401 for a foreign group's token", resp.StatusCode)
	}
}

func TestMiddleware_ExemptRoutesNeedNoToken(t *testing.T) {
	srv, _ := newTestServer(t)
	setGroupPassword(t, srv, "hunter2")

	resp := getWithToken(t, srv.URL+fmt.Sprintf("/groups/%s/password-required", gID), "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("password-required: status %d, want 200 even when locked", resp.StatusCode)
	}

	body, _ := json.Marshal(map[string]any{"password": "hunter2"})
	unlockResp, err := http.Post(srv.URL+fmt.Sprintf("/groups/%s/unlock", gID), "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	unlockResp.Body.Close()
	if unlockResp.StatusCode != http.StatusOK {
		t.Fatalf("unlock: status %d, want 200 even when locked", unlockResp.StatusCode)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/interfaces/rest/ -v -run Middleware`
Expected: FAIL — `TestMiddleware_LockedGroupRejectsNoToken` gets 200 instead of 401 (no enforcement wired yet).

- [ ] **Step 3: Implement**

`internal/interfaces/rest/middleware.go`:

```go
package api

import (
	"net/http"
	"strings"

	"github.com/google/uuid"

	"tallyup/internal/auth"
	"tallyup/internal/infrastructure/postgres"
)

// passwordMiddleware enforces the optional per-group password on every
// group-scoped route except the ones needed to bootstrap unlocking. It runs
// before the mux dispatches, so it parses group_id from the raw path rather
// than relying on http.Request.PathValue (populated only during routing).
func passwordMiddleware(s *store.Store, secret []byte, next http.Handler) http.Handler {
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

		state, err := s.GetPasswordState(r.Context(), groupID)
		if err != nil {
			// Unknown group (or a transient DB error) — let the real handler
			// produce its own, more specific error rather than masking it here.
			next.ServeHTTP(w, r)
			return
		}
		if !state.Required {
			next.ServeHTTP(w, r)
			return
		}

		const bearerPrefix = "Bearer "
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, bearerPrefix) {
			httpError(w, http.StatusUnauthorized, "password required")
			return
		}
		tok, err := auth.Verify(secret, strings.TrimPrefix(authHeader, bearerPrefix))
		if err != nil || tok.GroupID != groupID || tok.PasswordVersion != state.Version {
			httpError(w, http.StatusUnauthorized, "invalid or expired token")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// groupIDFromPath extracts the UUID from a "/groups/<id>/..." path. Group
// routes are always shaped this way, so a fixed-position parse is sufficient.
func groupIDFromPath(path string) (uuid.UUID, bool) {
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if len(parts) < 2 || parts[0] != "groups" {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}
```

Wire it into `NewServer` in `internal/interfaces/rest/server.go`, between the mux and the CORS wrap:

```go
	return corsMiddleware(corsOrigin, passwordMiddleware(s, tokenSecret, mux))
```

(CORS stays outermost — its existing `OPTIONS` short-circuit means preflight requests never reach `passwordMiddleware`, so no separate exemption for `OPTIONS` is needed.)

- [ ] **Step 4: Run tests, commit**

Run: `go test ./internal/interfaces/rest/ -v -run Middleware`
Expected: PASS (7/7). Then: `go test ./... -race` for the full suite.

```bash
git add internal/interfaces/rest/middleware.go internal/interfaces/rest/middleware_test.go internal/interfaces/rest/server.go
git commit -m "feat: enforce per-group password on every group-scoped route"
```

---

### Task 6: Client — unlock gate + token plumbing

**Files:**
- Create: `web/lib/groupAuth.ts`, `web/app/g/[groupId]/layout.tsx`
- Test: `web/lib/groupAuth.test.ts`
- Modify: `web/lib/api.ts` (attach token, handle 401, add `isPasswordRequired`/`unlock`; also fix `removeMember` from the pairwise/member-management plan to attach the token too, since it predates this plan)

**Interfaces:**
- Produces:
  - `groupAuth.ts`: `getToken(groupId): string | null`, `setToken(groupId, token): void`, `clearToken(groupId): void` — localStorage key `tallyup:token:<groupId>`, SSR-guarded exactly like `identity.ts`.
  - `api.ts`: `isPasswordRequired(groupId): Promise<boolean>`; `unlock(groupId, password): Promise<string>` (returns the token, throws `ApiError` on failure); every existing `getJSON`/`postIdempotent` call now attaches `Authorization: Bearer <token>` automatically when a token is stored for that path's group, and a `401` response clears the stored token and throws an `ApiError` whose message tells the user to refresh.
  - `web/app/g/[groupId]/layout.tsx` — a client-component layout wrapping every page under `/g/[groupId]/*`. On mount: checks `isPasswordRequired`; if required and no valid token is stored, renders an unlock form instead of `children`; once unlocked (or if never required), renders `children` unchanged. **No existing page file changes** — this is the one deliberate integration point.

- [ ] **Step 1: Token storage (test-first)**

`web/lib/groupAuth.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { clearToken, getToken, setToken } from "./groupAuth";

describe("group token storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips per group and clears independently", () => {
    expect(getToken("g1")).toBeNull();
    setToken("g1", "token-1");
    setToken("g2", "token-2");
    expect(getToken("g1")).toBe("token-1");
    expect(getToken("g2")).toBe("token-2");
    clearToken("g1");
    expect(getToken("g1")).toBeNull();
    expect(getToken("g2")).toBe("token-2");
  });
});
```

Run: `cd web && npm test -- groupAuth` → FAIL (no module).

`web/lib/groupAuth.ts`:

```ts
const keyFor = (groupId: string) => `tallyup:token:${groupId}`;

export function getToken(groupId: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(keyFor(groupId));
}

export function setToken(groupId: string, token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(keyFor(groupId), token);
}

export function clearToken(groupId: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(keyFor(groupId));
}
```

Run: `cd web && npm test -- groupAuth` → PASS.

- [ ] **Step 2: Wire tokens into the API client**

In `web/lib/api.ts`, add near the top (after the existing imports):

```ts
import { clearToken, getToken } from "./groupAuth";

/** Group-scoped routes are always "/groups/<uuid>/...". */
function groupIdFromPath(path: string): string | null {
  const m = path.match(/^\/groups\/([0-9a-fA-F-]{36})/);
  return m ? m[1]! : null;
}
```

Modify `getJSON` to attach the token and handle 401:

```ts
async function getJSON<T>(path: string): Promise<T> {
  const gid = groupIdFromPath(path);
  const headers: Record<string, string> = {};
  if (gid) {
    const token = getToken(gid);
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(apiUrl(path), { headers });
  if (res.status === 401) {
    if (gid) clearToken(gid);
    throw new ApiError(401, "session expired — refresh the page and re-enter the password");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
  return body as T;
}
```

Modify `postIdempotent` to attach the token on every attempt and handle 401. **This function already has a `PlanStaleError` check inside its 409 branch, added by the settle-up plan (`docs/superpowers/plans/2026-07-05-settle-up.md` Task 4) — preserve it exactly; only the header construction and the new 401 branch are additions:**

```ts
export async function postIdempotent<T>(path: string, body: unknown, key: string): Promise<T> {
  const backoff = [300, 900, 2700];
  const gid = groupIdFromPath(path);
  let lastError = "request failed";
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = { "Content-Type": "application/json", "Idempotency-Key": key };
    if (gid) {
      const token = getToken(gid);
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await fetch(apiUrl(path), { method: "POST", headers, body: JSON.stringify(body) });
    } catch {
      lastError = "network error";
      if (attempt >= backoff.length) throw new ApiError(0, lastError);
      await sleep(backoff[attempt]!);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 200 || res.status === 201) return data as T;
    if (res.status === 401) {
      if (gid) clearToken(gid);
      throw new ApiError(401, "session expired — refresh the page and re-enter the password");
    }
    if (res.status === 409) {
      if (typeof data.as_of_seq === "number") throw new PlanStaleError(data.as_of_seq);
      lastError = data.error ?? "in flight";
      if (attempt >= backoff.length) throw new ApiError(409, lastError);
      await sleep(500);
      continue;
    }
    if (res.status >= 500) {
      lastError = data.error ?? "server error";
      if (attempt >= backoff.length) throw new ApiError(res.status, lastError);
      await sleep(backoff[attempt]!);
      continue;
    }
    throw new ApiError(res.status, data.error ?? "request rejected");
  }
}
```

Add the new endpoints and fix `removeMember` (from the pairwise/member-management plan) to attach the token too:

```ts
export const isPasswordRequired = (groupId: string) =>
  getJSON<{ required: boolean }>(`/groups/${groupId}/password-required`).then((r) => r.required);

export async function unlock(groupId: string, password: string): Promise<string> {
  const res = await fetch(apiUrl(`/groups/${groupId}/unlock`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "unlock failed");
  return body.token as string;
}

export async function removeMember(groupId: string, memberId: string): Promise<void> {
  const headers: Record<string, string> = {};
  const token = getToken(groupId);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(apiUrl(`/groups/${groupId}/members/${memberId}`), { method: "DELETE", headers });
  if (res.status === 401) {
    clearToken(groupId);
    throw new ApiError(401, "session expired — refresh the page and re-enter the password");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? "failed to remove member");
  }
}
```

This last function replaces the `removeMember` defined in `docs/superpowers/plans/2026-07-06-pairwise-and-member-management.md` Task 5 — same signature, now token-aware.

- [ ] **Step 3: The unlock gate layout**

`web/app/g/[groupId]/layout.tsx`:

```tsx
"use client";

import { use, useEffect, useState } from "react";
import { isPasswordRequired, unlock } from "@/lib/api";
import { getToken, setToken } from "@/lib/groupAuth";

export default function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = use(params);
  const [status, setStatus] = useState<"checking" | "locked" | "unlocked">("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isPasswordRequired(groupId)
      .then((required) => {
        if (cancelled) return;
        setStatus(required && !getToken(groupId) ? "locked" : "unlocked");
      })
      .catch(() => {
        if (!cancelled) setStatus("unlocked"); // group not found yet — let the page's own fetch surface that
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const token = await unlock(groupId, password);
      setToken(groupId, token);
      setStatus("unlocked");
    } catch (err) {
      setError(err instanceof Error ? err.message : "wrong password");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking") return <main className="p-4 text-gray-500">Loading…</main>;

  if (status === "locked") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="mb-4 text-xl font-bold">This group is locked</h1>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="password"
            className="rounded-lg border p-3"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="rounded-lg bg-blue-600 p-3 font-semibold text-white disabled:opacity-50" disabled={busy}>
            {busy ? "Checking…" : "Unlock"}
          </button>
        </form>
      </main>
    );
  }

  return <>{children}</>;
}
```

- [ ] **Step 4: Hand verification**

With API + web dev server running:
1. Create a group, open it, add an expense — unaffected (no password set): the layout's check resolves `required: false` and renders children immediately.
2. On the server, set a password directly: `curl -X PUT localhost:8080/groups/<id>/password -d '{"password":"hunter2"}'`. Reload `/g/<id>` → unlock form appears instead of the balances page.
3. Enter the wrong password → inline error, form stays. Enter the right one → balances page renders normally, and the token persists across a reload (check `localStorage`).
4. Change the password (another `curl -X PUT .../password`), then try any action in the still-open tab (e.g. add an expense) → `ApiError` with the "session expired" message; reload the tab → back to the unlock form, as documented in the plan (no live re-prompt without reload — this is the explicit v1 trade-off, not a bug).
5. Clear the password (`{"password": null}`) → group opens back up; a fresh tab needs no unlock at all.

Run: `cd web && npm test && npx tsc --noEmit && npm run build && cd .. && go test ./... -race`
Expected: everything PASS.

```bash
git add web/
git commit -m "feat: client-side unlock gate for password-protected groups"
```

---

## Deferred

- Live re-prompt on a mid-session password change (currently requires a manual reload) — acceptable v1 trade-off, stated plainly in this plan and to the end user via the error message.
- A "group settings" UI for setting/changing/clearing the password (this plan lands the API + the unlock gate; the settings form itself can follow, calling the already-built `PUT /groups/{id}/password`).
- Rate-limiting unlock attempts — not addressed; the threat model (spec §3) is "keep casual randoms out," not resisting sustained brute-force. Worth a note if that threat model ever changes.
