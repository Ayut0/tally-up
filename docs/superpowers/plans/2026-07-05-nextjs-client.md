# tally-up — Next.js Client Implementation Plan (Phase 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mobile-first web client from `docs/architecture.md` §2: create a group, share an invite link, pick who you are, add expenses (idempotency key minted at tap), see balances and history with `after_seq` polling — plus the two server endpoints (group create/get) and CORS the client needs.

**Architecture:** Next.js App Router under `web/`, talking to the Go API via a small typed client (`web/lib/api.ts`) that owns the idempotency contract: mint key on tap, reuse on retry, treat 409 in-flight as retry-later, treat 200-replay as success. Identity is v1-simple: the group URL is the capability (`/g/<group uuid>`), and "who am I" is a member picked once and stored in `localStorage` — documented trade-off, upgraded when real auth lands. Freshness is polling `GET /entries?after_seq=N` every 5s while the tab is visible.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Tailwind CSS v4, Vitest + Testing Library for unit tests of the API client and split-payload logic. Go server work reuses the existing stack.

**Prerequisites:** Phase 1–2 plan and the Reads + Reversals plan are executed (`POST/GET/PUT entries`, `GET balance` all exist).

## Global Constraints

- Money is integer yen everywhere — client state uses integer yen (`number` is safe: amounts ≤ ¥100B are exact in doubles), never decimals. All arithmetic that must be exact (split preview) mirrors the server's largest-remainder rule or defers to the server.
- Idempotency keys and entry IDs are minted client-side with `uuidv7()` (`web/lib/uuidv7.ts` — see Task 2; `crypto.randomUUID()` is v4-only and not used anywhere IDs are minted) **when the user commits an intent** (tap Add), never per HTTP attempt; keys are discarded on confirmed success (200 or 201).
- Mobile-first: layouts designed at 390px; every screen must be usable one-handed.
- API base URL from `NEXT_PUBLIC_API_URL` (dev default `http://localhost:8080`).
- Go API changes keep all Phase 1–2 idempotency and append-only constraints.
- The web app lives entirely under `web/`; the repo root stays a Go module.
- Branch: `feat/issue-3-nextjs-client`.
- When implementing UI tasks, load the `frontend-design` skill (and `modern-web-guidance` for any CSS/layout questions) before writing components.

## File Structure

```
internal/store/groups.go            — CreateGroup, GetGroup
internal/store/groups_test.go
internal/api/groups.go              — POST /groups, GET /groups/{group_id}
internal/api/groups_test.go
internal/api/server.go              — modify: routes + CORS middleware
web/package.json                    — Next.js app (create-next-app)
web/lib/types.ts                    — API mirror types
web/lib/api.ts                      — typed client + idempotent post with retry
web/lib/api.test.ts
web/lib/split.ts                    — split payload builder + client-side preview
web/lib/split.test.ts
web/lib/identity.ts                 — localStorage member identity
web/app/page.tsx                    — create-group screen
web/app/g/[groupId]/page.tsx        — balances + history + polling (home screen)
web/app/g/[groupId]/add/page.tsx    — add-expense form
web/app/g/[groupId]/join.tsx        — member picker (client component)
web/app/g/[groupId]/useGroupData.ts — polling hook
```

---

### Task 1: Server — group endpoints + CORS

**Files:**
- Create: `internal/store/groups.go`, `internal/api/groups.go`
- Modify: `internal/api/server.go`
- Test: `internal/store/groups_test.go`, `internal/api/groups_test.go`

**Interfaces:**
- Consumes: `AcquireIdempotencyKey` / `ReleaseIdempotencyKey`, `httpError` / `writeJSON`, test helpers.
- Produces:
  - `store.GroupRecord{ID uuid.UUID; Name string; Members []store.GroupMember}`; `store.GroupMember{ID uuid.UUID; Name string}` (JSON `id`, `name`, `members`).
  - `(*Store) CreateGroup(ctx context.Context, key uuid.UUID, id uuid.UUID, name string, memberNames []string) ([]byte, error)` — one txn: insert group, insert members, link them, mark key. Response is the full `GroupRecord` JSON (JSONB-normalized via `RETURNING response_body`). Member IDs are server-generated; members are returned sorted by UUID bytes.
  - `(*Store) GetGroup(ctx context.Context, id uuid.UUID) (GroupRecord, error)` — `store.ErrGroupNotFound` sentinel when missing.
  - Routes: `POST /groups` (Idempotency-Key required; body `{"id":"<client uuid>","name":"trip","member_names":["yuto","a","b"]}`; 201/200/409/422; name 1–100 chars, 1–20 members, each name 1–50 chars after trim) and `GET /groups/{group_id}` (200 / 404).
  - CORS middleware wrapping the whole mux: allows origin from `CORS_ORIGIN` env (empty → `*` for dev), methods `GET, POST, PUT, OPTIONS`, headers `Content-Type, Idempotency-Key`; answers `OPTIONS` preflight with 204. `NewServer(s *store.Store, corsOrigin string) http.Handler` — signature change; update `cmd/api/main.go` and test helpers (pass `"*"`).

- [ ] **Step 1: Write the failing store test**

`internal/store/groups_test.go`:

```go
package store

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestCreateGroupAndGetGroup(t *testing.T) {
	s := TestStore(t)
	ctx := context.Background()
	key, groupID := uuid.New(), uuid.New()
	if res, _, err := s.AcquireIdempotencyKey(ctx, key, key.String()); err != nil || res != GateProceed {
		t.Fatalf("gate: %v %v", res, err)
	}

	resp, err := s.CreateGroup(ctx, key, groupID, "kyoto trip", []string{"yuto", "a", "b"})
	if err != nil {
		t.Fatal(err)
	}
	var created GroupRecord
	if err := json.Unmarshal(resp, &created); err != nil {
		t.Fatalf("response %s: %v", resp, err)
	}
	if created.ID != groupID || created.Name != "kyoto trip" || len(created.Members) != 3 {
		t.Fatalf("bad create response: %+v", created)
	}

	got, err := s.GetGroup(ctx, groupID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "kyoto trip" || len(got.Members) != 3 {
		t.Fatalf("bad group: %+v", got)
	}
	names := map[string]bool{}
	for _, m := range got.Members {
		names[m.Name] = true
		if m.ID == uuid.Nil {
			t.Fatal("member id not generated")
		}
	}
	if !names["yuto"] || !names["a"] || !names["b"] {
		t.Fatalf("member names wrong: %+v", got.Members)
	}
}

func TestGetGroup_NotFound(t *testing.T) {
	s := TestStore(t)
	if _, err := s.GetGroup(context.Background(), uuid.New()); !errors.Is(err, ErrGroupNotFound) {
		t.Fatalf("got %v, want ErrGroupNotFound", err)
	}
}
```

- [ ] **Step 2: Run to verify failure**

Run: `go test ./internal/store/ -v -run Group`
Expected: compile FAIL — `undefined: GroupRecord`, `s.CreateGroup undefined`.

- [ ] **Step 3: Implement the store side**

`internal/store/groups.go`:

```go
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var ErrGroupNotFound = errors.New("group not found")

type GroupMember struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

type GroupRecord struct {
	ID      uuid.UUID     `json:"id"`
	Name    string        `json:"name"`
	Members []GroupMember `json:"members"`
}

// CreateGroup creates the group, its members, and the links in one txn and
// marks the idempotency key with the full GroupRecord as the response.
func (s *Store) CreateGroup(ctx context.Context, key uuid.UUID, id uuid.UUID, name string, memberNames []string) ([]byte, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx,
		`INSERT INTO groups (id, name) VALUES ($1, $2)`, id, name); err != nil {
		return nil, err
	}
	rec := GroupRecord{ID: id, Name: name, Members: make([]GroupMember, 0, len(memberNames))}
	for _, mn := range memberNames {
		// id columns have no DB default (see Global Constraints) — every
		// member ID is minted here, in application code, as UUIDv7.
		mid, err := uuid.NewV7()
		if err != nil {
			return nil, fmt.Errorf("generate member id: %w", err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO members (id, name) VALUES ($1, $2)`, mid, mn); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO group_members (group_id, member_id) VALUES ($1, $2)`, id, mid); err != nil {
			return nil, err
		}
		rec.Members = append(rec.Members, GroupMember{ID: mid, Name: mn})
	}

	snapshot, err := json.Marshal(rec)
	if err != nil {
		return nil, fmt.Errorf("marshal group: %w", err)
	}
	var resp []byte
	if err := tx.QueryRow(ctx,
		`UPDATE idempotency_keys SET status='succeeded', response_body=$2 WHERE key=$1
		 RETURNING response_body`, key, snapshot).Scan(&resp); err != nil {
		return nil, err
	}
	return resp, tx.Commit(ctx)
}

func (s *Store) GetGroup(ctx context.Context, id uuid.UUID) (GroupRecord, error) {
	rec := GroupRecord{Members: []GroupMember{}}
	err := s.Pool.QueryRow(ctx,
		`SELECT id, name FROM groups WHERE id = $1`, id).Scan(&rec.ID, &rec.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return rec, ErrGroupNotFound
	}
	if err != nil {
		return rec, err
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT m.id, m.name FROM group_members gm
		JOIN members m ON m.id = gm.member_id
		WHERE gm.group_id = $1
		ORDER BY m.id`, id)
	if err != nil {
		return rec, err
	}
	defer rows.Close()
	for rows.Next() {
		var gm GroupMember
		if err := rows.Scan(&gm.ID, &gm.Name); err != nil {
			return rec, err
		}
		rec.Members = append(rec.Members, gm)
	}
	return rec, rows.Err()
}
```

- [ ] **Step 4: Run store tests**

Run: `go test ./internal/store/ -v -run Group`
Expected: PASS.

- [ ] **Step 5: Write the failing API test**

`internal/api/groups_test.go`:

```go
package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestCreateAndFetchGroup(t *testing.T) {
	srv, _ := newTestServer(t)
	body, _ := json.Marshal(map[string]any{
		"id": uuid.New(), "name": "kyoto trip",
		"member_names": []string{"yuto", "a", "b"},
	})
	req, _ := http.NewRequest("POST", srv.URL+"/groups", bytes.NewReader(body))
	req.Header.Set("Idempotency-Key", uuid.New().String())
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	rb, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d, body %s", resp.StatusCode, rb)
	}
	var created struct {
		ID      uuid.UUID `json:"id"`
		Members []struct {
			ID   uuid.UUID `json:"id"`
			Name string    `json:"name"`
		} `json:"members"`
	}
	if err := json.Unmarshal(rb, &created); err != nil {
		t.Fatal(err)
	}

	got, err := http.Get(srv.URL + "/groups/" + created.ID.String())
	if err != nil {
		t.Fatal(err)
	}
	defer got.Body.Close()
	if got.StatusCode != http.StatusOK {
		t.Fatalf("GET status %d", got.StatusCode)
	}

	missing, _ := http.Get(srv.URL + "/groups/" + uuid.NewString())
	if missing.StatusCode != http.StatusNotFound {
		t.Fatalf("missing group: status %d, want 404", missing.StatusCode)
	}
}

func TestCreateGroup_Validation(t *testing.T) {
	srv, _ := newTestServer(t)
	for name, payload := range map[string]map[string]any{
		"no members":     {"id": uuid.New(), "name": "x", "member_names": []string{}},
		"blank name":     {"id": uuid.New(), "name": "  ", "member_names": []string{"a"}},
		"blank member":   {"id": uuid.New(), "name": "x", "member_names": []string{"a", " "}},
		"too many":       {"id": uuid.New(), "name": "x", "member_names": make([]string, 21)},
	} {
		t.Run(name, func(t *testing.T) {
			body, _ := json.Marshal(payload)
			req, _ := http.NewRequest("POST", srv.URL+"/groups", bytes.NewReader(body))
			req.Header.Set("Idempotency-Key", uuid.New().String())
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
			if resp.StatusCode != http.StatusUnprocessableEntity {
				t.Fatalf("status %d, want 422", resp.StatusCode)
			}
		})
	}
}

func TestCORSPreflight(t *testing.T) {
	srv, _ := newTestServer(t)
	req, _ := http.NewRequest("OPTIONS", srv.URL+"/groups", nil)
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", "POST")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("preflight status %d, want 204", resp.StatusCode)
	}
	if resp.Header.Get("Access-Control-Allow-Origin") == "" {
		t.Fatal("Access-Control-Allow-Origin missing")
	}
	if h := resp.Header.Get("Access-Control-Allow-Headers"); h == "" {
		t.Fatal("Access-Control-Allow-Headers missing")
	}
}
```

- [ ] **Step 6: Implement handlers + CORS**

`internal/api/groups.go`:

```go
package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"tallyup/internal/store"
)

type createGroupRequest struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	MemberNames []string  `json:"member_names"`
}

func (req *createGroupRequest) validate() string {
	req.Name = strings.TrimSpace(req.Name)
	if req.ID == uuid.Nil {
		return "id required (client-generated UUID)"
	}
	if req.Name == "" || len(req.Name) > 100 {
		return "name must be 1-100 characters"
	}
	if len(req.MemberNames) < 1 || len(req.MemberNames) > 20 {
		return "member_names must have 1-20 entries"
	}
	for i, mn := range req.MemberNames {
		req.MemberNames[i] = strings.TrimSpace(mn)
		if req.MemberNames[i] == "" || len(req.MemberNames[i]) > 50 {
			return "each member name must be 1-50 characters"
		}
	}
	return ""
}

func (s *Server) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	key, err := uuid.Parse(r.Header.Get("Idempotency-Key"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "Idempotency-Key header (UUID) required")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes))
	if err != nil {
		httpError(w, http.StatusBadRequest, "unreadable body")
		return
	}
	sum := sha256.Sum256(body)
	requestHash := hex.EncodeToString(sum[:])

	var req createGroupRequest
	if err := json.Unmarshal(body, &req); err != nil {
		httpError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if msg := req.validate(); msg != "" {
		httpError(w, http.StatusUnprocessableEntity, msg)
		return
	}

	gate, stored, err := s.store.AcquireIdempotencyKey(r.Context(), key, requestHash)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "idempotency gate failed")
		return
	}
	switch gate {
	case store.GateReplay:
		writeJSON(w, http.StatusOK, stored)
		return
	case store.GateInFlight:
		httpError(w, http.StatusConflict, "request in flight; retry shortly")
		return
	case store.GateMismatch:
		httpError(w, http.StatusUnprocessableEntity, "idempotency key reused with different payload")
		return
	}

	resp, err := s.store.CreateGroup(r.Context(), key, req.ID, req.Name, req.MemberNames)
	if err != nil {
		if relErr := s.store.ReleaseIdempotencyKey(r.Context(), key); relErr != nil {
			slog.Warn("release idempotency key", "key", key, "err", relErr)
		}
		httpError(w, http.StatusInternalServerError, "group creation failed")
		return
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (s *Server) handleGetGroup(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("group_id"))
	if err != nil {
		httpError(w, http.StatusBadRequest, "invalid group id")
		return
	}
	rec, err := s.store.GetGroup(r.Context(), id)
	if errors.Is(err, store.ErrGroupNotFound) {
		httpError(w, http.StatusNotFound, err.Error())
		return
	}
	if err != nil {
		httpError(w, http.StatusInternalServerError, "group read failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rec)
}
```

In `internal/api/server.go`, change `NewServer` and add CORS:

```go
func NewServer(s *store.Store, corsOrigin string) http.Handler {
	srv := &Server{store: s}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /groups", srv.handleCreateGroup)
	mux.HandleFunc("GET /groups/{group_id}", srv.handleGetGroup)
	// … existing routes unchanged …
	return corsMiddleware(corsOrigin, mux)
}

// corsMiddleware is deliberately minimal: one configured origin (or * in
// dev), the three methods the API serves, and the Idempotency-Key header.
func corsMiddleware(origin string, next http.Handler) http.Handler {
	if origin == "" {
		origin = "*"
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
```

Update callers: `cmd/api/main.go` → `api.NewServer(s, os.Getenv("CORS_ORIGIN"))`; the api test helper `newTestServer` → `NewServer(s, "*")`.

- [ ] **Step 7: Run everything, commit**

Run: `go test ./... -race`
Expected: PASS.

```bash
git add internal/store/groups.go internal/store/groups_test.go internal/api/ cmd/
git commit -m "feat: group create/get endpoints and CORS for the web client"
```

---

### Task 2: Web scaffold + typed API client with the idempotency contract

**Files:**
- Create: `web/` (create-next-app), `web/lib/types.ts`, `web/lib/api.ts`
- Test: `web/lib/api.test.ts`

**Interfaces:**
- Produces (consumed by every later task):
  - `types.ts`: `Member{id,name}`, `Group{id,name,members}`, `MemberBalance{member_id,balance}`, `BalanceSnapshot{balances,as_of_seq}`, `SplitRule` (discriminated union: `{type:'equal'} | {type:'exact',amounts:Record<string,number>} | {type:'shares',weights:Record<string,number>} | {type:'percent',weights:Record<string,number>}`), `EntryRecord` (mirror of the Go struct), `NewEntry{id,kind,payer_id,counterparty?,total_amount,split_rule,participants,memo?,occurred_on}`.
  - `api.ts`: `apiUrl(path: string): string`; `getGroup(groupId)`, `getBalance(groupId)`, `listEntries(groupId, afterSeq)` (plain GETs, throw `ApiError{status,message}` on non-2xx); `postIdempotent<T>(path: string, body: unknown, key: string): Promise<T>` — POSTs with the `Idempotency-Key` header; on network error or 5xx retries up to 3 times (300ms, 900ms, 2700ms backoff) with the SAME key; on 409 waits 500ms and retries (in-flight); treats both 200 and 201 as success; throws `ApiError` on 4xx (except 409). `createGroup(...)` and `addEntry(...)` wrap it.

- [ ] **Step 1: Scaffold**

```bash
cd /Users/yuto/Documents/Web_Development/projects/tally-up
npx create-next-app@latest web --typescript --app --tailwind --eslint --no-src-dir --import-alias "@/*" --use-npm --yes
cd web && npm install -D vitest jsdom @testing-library/react @testing-library/user-event
```

Add to `web/package.json` scripts: `"test": "vitest run"`. Create `web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom" },
  resolve: { alias: { "@": __dirname } },
});
```

- [ ] **Step 2: Write the failing API-client tests**

`web/lib/api.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postIdempotent, ApiError } from "./api";

const ok = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("postIdempotent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the Idempotency-Key header and returns the body on 201", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok(201, { id: "x", seq: 1 }));
    const res = await postIdempotent<{ seq: number }>("/groups/g/entries", { a: 1 }, "KEY-1");
    expect(res.seq).toBe(1);
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init!.headers as Record<string, string>)["Idempotency-Key"]).toBe("KEY-1");
  });

  it("retries network errors with the SAME key and accepts a 200 replay", async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(ok(200, { id: "x", seq: 1 }));
    const p = postIdempotent("/p", {}, "KEY-2");
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ id: "x", seq: 1 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    for (const [, init] of vi.mocked(fetch).mock.calls) {
      expect((init!.headers as Record<string, string>)["Idempotency-Key"]).toBe("KEY-2");
    }
  });

  it("waits and retries on 409 in-flight", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(ok(409, { error: "in flight" }))
      .mockResolvedValueOnce(ok(200, { id: "x", seq: 5 }));
    const p = postIdempotent("/p", {}, "KEY-3");
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ id: "x", seq: 5 });
  });

  it("gives up after 3 retries and surfaces the failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("network down"));
    const p = postIdempotent("/p", {}, "KEY-4");
    const assertion = expect(p).rejects.toBeInstanceOf(ApiError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it("does NOT retry a 422 — that is a client bug, not a flake", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(ok(422, { error: "bad split" }));
    await expect(postIdempotent("/p", {}, "KEY-5")).rejects.toMatchObject({ status: 422 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
```

Every ID minted in this codebase is UUIDv7 (see the Phase 1-2 plan's Global Constraints) — but browsers have no native v7 generator (`crypto.randomUUID()` is v4-only), so a small helper is needed. `web/lib/uuidv7.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "./uuidv7";

describe("uuidv7", () => {
  it("produces a well-formed UUID with version 7 and variant bits set", () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("never repeats across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });

  describe("with controlled time", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("is time-ordered: an ID minted later sorts after one minted earlier", () => {
      // Random bits within the same millisecond aren't ordered by generation
      // order — only the timestamp prefix guarantees ordering, so this test
      // controls time explicitly rather than firing calls back-to-back.
      vi.setSystemTime(1_000_000_000_000);
      const earlier = uuidv7();
      vi.setSystemTime(1_000_000_000_001);
      const later = uuidv7();
      expect(earlier < later).toBe(true);
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd web && npm test`
Expected: FAIL — `./api` has no exports, `./uuidv7` has no exports.

- [ ] **Step 4: Implement types + client**

`web/lib/uuidv7.ts`:

```ts
/**
 * A minimal RFC 9562 UUIDv7 generator. The browser's crypto.randomUUID() is
 * v4-only, and this codebase mints every ID as v7 (time-ordered — see the
 * Phase 1-2 plan's Global Constraints), so a small helper stands in for it.
 * Layout: 48-bit unix ms timestamp, 4-bit version, 12-bit random, 2-bit
 * variant, 62-bit random.
 */
export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const ts = Date.now();
  bytes[0] = Math.floor(ts / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(ts / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(ts / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(ts / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;

  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

`web/lib/types.ts`:

```ts
export type Member = { id: string; name: string };
export type Group = { id: string; name: string; members: Member[] };

export type MemberBalance = { member_id: string; balance: number };
export type BalanceSnapshot = { balances: MemberBalance[]; as_of_seq: number };

export type SplitRule =
  | { type: "equal" }
  | { type: "exact"; amounts: Record<string, number> }
  | { type: "shares"; weights: Record<string, number> }
  | { type: "percent"; weights: Record<string, number> };

export type Posting = { member_id: string; amount: number };

export type EntryRecord = {
  id: string;
  seq: number;
  kind: "expense" | "settlement" | "reversal";
  reverses_id?: string;
  payer_id: string;
  counterparty?: string;
  total_amount: number;
  split_rule: SplitRule | { type: "settlement" } | { type: "reversal" };
  participants: string[];
  memo?: string;
  occurred_on: string;
  created_by: string;
  created_at: string;
  postings: Posting[];
};

export type NewEntry = {
  id: string;
  kind: "expense" | "settlement";
  payer_id: string;
  counterparty?: string;
  total_amount: number;
  split_rule: SplitRule;
  participants: string[];
  memo?: string;
  occurred_on: string; // YYYY-MM-DD
};
```

`web/lib/api.ts`:

```ts
import type { BalanceSnapshot, EntryRecord, Group, NewEntry } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function apiUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  return base.replace(/\/$/, "") + path;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
  return body as T;
}

/**
 * The client half of the idempotency contract (architecture.md §4):
 * one key per user intent, reused verbatim across every retry. 200 is a
 * replay of our own earlier success — treat it exactly like 201.
 */
export async function postIdempotent<T>(path: string, body: unknown, key: string): Promise<T> {
  const backoff = [300, 900, 2700];
  let lastError = "request failed";
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(apiUrl(path), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body),
      });
    } catch {
      lastError = "network error";
      if (attempt >= backoff.length) throw new ApiError(0, lastError);
      await sleep(backoff[attempt]!);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 200 || res.status === 201) return data as T;
    if (res.status === 409) {
      // In flight (or our earlier attempt landed) — wait for it to settle,
      // then the retry replays the stored response.
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

export const getGroup = (groupId: string) => getJSON<Group>(`/groups/${groupId}`);
export const getBalance = (groupId: string) => getJSON<BalanceSnapshot>(`/groups/${groupId}/balance`);
export const listEntries = (groupId: string, afterSeq: number) =>
  getJSON<{ entries: EntryRecord[] }>(`/groups/${groupId}/entries?after_seq=${afterSeq}`);

export const createGroup = (id: string, name: string, memberNames: string[], key: string) =>
  postIdempotent<Group>("/groups", { id, name, member_names: memberNames }, key);
export const addEntry = (groupId: string, entry: NewEntry, key: string) =>
  postIdempotent<{ id: string; seq: number }>(`/groups/${groupId}/entries`, entry, key);
```

- [ ] **Step 5: Run tests, commit**

Run: `cd web && npm test`
Expected: 5/5 PASS.

```bash
git add web/
git commit -m "feat: web scaffold and typed api client with idempotent retry"
```

---

### Task 3: Split payload builder + client-side preview

**Files:**
- Create: `web/lib/split.ts`
- Test: `web/lib/split.test.ts`

**Interfaces:**
- Produces:
  - `buildSplitRule(mode, participants, inputs): SplitRule | string` — returns a `SplitRule` ready for the API, or a human-readable validation error string. Modes: `equal` (no inputs), `exact` (per-member yen; must sum to total), `shares` (per-member positive ints), `percent` (per-member ints summing to 100).
  - `previewShares(total: number, rule: SplitRule, participants: string[]): Record<string, number>` — client-side mirror of the server's largest-remainder rounding (ties by member id ascending) so the form can show exactly what the server will book. **Must match the Go implementation's output for identical inputs** — the test cases below are transcribed from the Go tests.

- [ ] **Step 1: Write the failing tests**

`web/lib/split.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSplitRule, previewShares } from "./split";

// Member ids chosen so lexicographic order is a < b < c (mirrors UUID byte order).
const A = "00000000-0000-0000-0000-00000000000b";
const B = "00000000-0000-0000-0000-00000000000c";
const C = "00000000-0000-0000-0000-00000000000d";

describe("previewShares — must mirror the Go largest-remainder engine", () => {
  it("equal 12000 / 3", () => {
    expect(previewShares(12000, { type: "equal" }, [A, B, C])).toEqual({
      [A]: 4000, [B]: 4000, [C]: 4000,
    });
  });

  it("equal 10000 / 3: remainder tie goes to smallest id (Go test parity)", () => {
    expect(previewShares(10000, { type: "equal" }, [A, B, C])).toEqual({
      [A]: 3334, [B]: 3333, [C]: 3333,
    });
  });

  it("shares 1:2 of 100: extra yen to the larger remainder (Go test parity)", () => {
    expect(
      previewShares(100, { type: "shares", weights: { [A]: 1, [B]: 2 } }, [A, B]),
    ).toEqual({ [A]: 33, [B]: 67 });
  });

  it("percent 50/30/20 of 10000", () => {
    expect(
      previewShares(10000, { type: "percent", weights: { [A]: 50, [B]: 30, [C]: 20 } }, [A, B, C]),
    ).toEqual({ [A]: 5000, [B]: 3000, [C]: 2000 });
  });

  it("exact passes through", () => {
    expect(
      previewShares(12000, { type: "exact", amounts: { [A]: 7000, [B]: 5000 } }, [A, B]),
    ).toEqual({ [A]: 7000, [B]: 5000 });
  });
});

describe("buildSplitRule validation", () => {
  it("exact must sum to total", () => {
    const r = buildSplitRule("exact", [A, B], { total: 12000, amounts: { [A]: 7000, [B]: 4999 } });
    expect(typeof r).toBe("string"); // error message
  });
  it("percent must sum to 100", () => {
    const r = buildSplitRule("percent", [A, B], { weights: { [A]: 60, [B]: 39 } });
    expect(typeof r).toBe("string");
  });
  it("shares must be positive", () => {
    const r = buildSplitRule("shares", [A, B], { weights: { [A]: 0, [B]: 2 } });
    expect(typeof r).toBe("string");
  });
  it("valid inputs return the rule object", () => {
    expect(buildSplitRule("equal", [A, B], {})).toEqual({ type: "equal" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd web && npm test -- split`
Expected: FAIL — module has no exports.

- [ ] **Step 3: Implement**

`web/lib/split.ts`:

```ts
import type { SplitRule } from "./types";

type BuildInputs = {
  total?: number;
  amounts?: Record<string, number>;
  weights?: Record<string, number>;
};

/** Builds a SplitRule from form state, or returns a validation error string. */
export function buildSplitRule(
  mode: SplitRule["type"],
  participants: string[],
  inputs: BuildInputs,
): SplitRule | string {
  if (participants.length === 0) return "pick at least one participant";
  switch (mode) {
    case "equal":
      return { type: "equal" };
    case "exact": {
      const amounts = pick(inputs.amounts, participants);
      if (typeof amounts === "string") return amounts;
      const sum = Object.values(amounts).reduce((a, b) => a + b, 0);
      if (Object.values(amounts).some((v) => v < 0 || !Number.isInteger(v)))
        return "amounts must be whole yen";
      if (sum !== inputs.total) return `amounts sum to ¥${sum}, total is ¥${inputs.total}`;
      return { type: "exact", amounts };
    }
    case "shares": {
      const weights = pick(inputs.weights, participants);
      if (typeof weights === "string") return weights;
      if (Object.values(weights).some((v) => v <= 0 || !Number.isInteger(v)))
        return "shares must be positive whole numbers";
      return { type: "shares", weights };
    }
    case "percent": {
      const weights = pick(inputs.weights, participants);
      if (typeof weights === "string") return weights;
      if (Object.values(weights).some((v) => v <= 0 || !Number.isInteger(v)))
        return "percentages must be positive whole numbers";
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      if (sum !== 100) return `percentages sum to ${sum}, must be 100`;
      return { type: "percent", weights };
    }
  }
}

function pick(
  values: Record<string, number> | undefined,
  participants: string[],
): Record<string, number> | string {
  const out: Record<string, number> = {};
  for (const p of participants) {
    const v = values?.[p];
    if (v === undefined || Number.isNaN(v)) return "fill in a value for every participant";
    out[p] = v;
  }
  return out;
}

/**
 * Mirror of the Go weightedShares engine (internal/ledger/split.go):
 * floor(total*w/W) each, remainder yen by largest remainder, ties broken by
 * ascending member id. Kept in lockstep by transcribed Go test cases.
 */
export function previewShares(
  total: number,
  rule: SplitRule,
  participants: string[],
): Record<string, number> {
  if (rule.type === "exact") {
    const out: Record<string, number> = {};
    for (const p of participants) out[p] = rule.amounts[p] ?? 0;
    return out;
  }
  const weights: Record<string, number> = {};
  for (const p of participants) {
    weights[p] = rule.type === "equal" ? 1 : (rule.weights[p] ?? 0);
  }
  const totalWeight = participants.reduce((a, p) => a + weights[p]!, 0);
  const shares: Record<string, number> = {};
  let assigned = 0;
  const remainders: { member: string; rem: number }[] = [];
  for (const p of participants) {
    const base = Math.floor((total * weights[p]!) / totalWeight);
    shares[p] = base;
    assigned += base;
    remainders.push({ member: p, rem: (total * weights[p]!) % totalWeight });
  }
  remainders.sort((x, y) => (y.rem - x.rem) || (x.member < y.member ? -1 : 1));
  for (let i = 0; i < total - assigned; i++) {
    shares[remainders[i]!.member]!++;
  }
  return shares;
}
```

- [ ] **Step 4: Run tests, commit**

Run: `cd web && npm test`
Expected: PASS (all api + split tests).

```bash
git add web/lib/split.ts web/lib/split.test.ts
git commit -m "feat: split rule builder with server-parity rounding preview"
```

---

### Task 4: Identity + create-group + join flow

**Files:**
- Create: `web/lib/identity.ts`, `web/app/page.tsx`, `web/app/g/[groupId]/join.tsx`
- Test: `web/lib/identity.test.ts`

**Interfaces:**
- Produces:
  - `identity.ts`: `getIdentity(groupId): string | null`, `setIdentity(groupId, memberId): void` — localStorage key `tallyup:member:<groupId>`. Guarded for SSR (`typeof window === "undefined"` → null/no-op).
  - `/` — create-group form (group name + dynamic member-name list, 1–20). On submit: mint `groupId` + idempotency key, `createGroup`, `setIdentity` to the first member (the creator), `router.push('/g/<id>')`.
  - `join.tsx` — client component `<JoinPicker group={group} onPicked={...}>`: "Who are you?" one button per member; tapping stores identity. Rendered by the group page (Task 5) whenever identity is unset. The invite link IS the group URL — joining is just opening it and picking yourself.

- [ ] **Step 1: Identity test (TDD for the logic; pages are verified by hand in Step 4)**

`web/lib/identity.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { getIdentity, setIdentity } from "./identity";

describe("identity storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips per group", () => {
    expect(getIdentity("g1")).toBeNull();
    setIdentity("g1", "member-a");
    setIdentity("g2", "member-b");
    expect(getIdentity("g1")).toBe("member-a");
    expect(getIdentity("g2")).toBe("member-b");
  });
});
```

Run: `cd web && npm test -- identity` → FAIL (no module). Implement `web/lib/identity.ts`:

```ts
const keyFor = (groupId: string) => `tallyup:member:${groupId}`;

export function getIdentity(groupId: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(keyFor(groupId));
}

export function setIdentity(groupId: string, memberId: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(keyFor(groupId), memberId);
}
```

Run again → PASS.

- [ ] **Step 2: Create-group page**

`web/app/page.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createGroup } from "@/lib/api";
import { setIdentity } from "@/lib/identity";
import { uuidv7 } from "@/lib/uuidv7";

export default function CreateGroupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const memberNames = members.map((m) => m.trim()).filter(Boolean);
    if (!name.trim() || memberNames.length === 0) {
      setError("group name and at least one member are required");
      return;
    }
    setBusy(true);
    setError("");
    // Intent minted once, here — retries inside createGroup reuse both ids.
    const groupId = uuidv7();
    try {
      const group = await createGroup(groupId, name.trim(), memberNames, uuidv7());
      setIdentity(group.id, group.members[0]!.id); // creator listed themselves first
      router.push(`/g/${group.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create group");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="mb-6 text-2xl font-bold">tally-up</h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          className="rounded-lg border p-3"
          placeholder="Group name (e.g. Kyoto trip)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <p className="text-sm text-gray-500">Members — put yourself first:</p>
        {members.map((m, i) => (
          <input
            key={i}
            className="rounded-lg border p-3"
            placeholder={i === 0 ? "Your name" : `Member ${i + 1}`}
            value={m}
            onChange={(e) => setMembers(members.map((v, j) => (j === i ? e.target.value : v)))}
          />
        ))}
        {members.length < 20 && (
          <button type="button" className="text-left text-sm text-blue-600"
            onClick={() => setMembers([...members, ""])}>
            + add member
          </button>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="rounded-lg bg-blue-600 p-3 font-semibold text-white disabled:opacity-50"
          disabled={busy}>
          {busy ? "Creating…" : "Create group"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Join picker**

`web/app/g/[groupId]/join.tsx`:

```tsx
"use client";

import type { Group } from "@/lib/types";
import { setIdentity } from "@/lib/identity";

export function JoinPicker({ group, onPicked }: { group: Group; onPicked: (memberId: string) => void }) {
  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="mb-2 text-2xl font-bold">{group.name}</h1>
      <p className="mb-6 text-gray-500">Who are you?</p>
      <div className="flex flex-col gap-2">
        {group.members.map((m) => (
          <button
            key={m.id}
            className="rounded-lg border p-4 text-left text-lg active:bg-gray-100"
            onClick={() => {
              setIdentity(group.id, m.id);
              onPicked(m.id);
            }}
          >
            {m.name}
          </button>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify by hand, commit**

```bash
docker compose up -d db
DATABASE_URL='postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable' go run ./cmd/api &
cd web && npm run dev
```

In a phone-sized viewport: create a group with 3 members → lands on `/g/<id>` (blank until Task 5 — a temporary `page.tsx` that renders `JoinPicker` unconditionally is acceptable scaffolding for this check); open the same URL in a private window → picker appears; pick a member → identity persists across reload (check `localStorage`).

Run: `cd web && npm test && npx tsc --noEmit`
Expected: PASS, no type errors.

```bash
git add web/
git commit -m "feat: create-group and invite-link join flows"
```

---

### Task 5: Group home — balances, history, polling — and add-expense form

**Files:**
- Create: `web/app/g/[groupId]/useGroupData.ts`, `web/app/g/[groupId]/page.tsx`, `web/app/g/[groupId]/add/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces:
  - `useGroupData(groupId)` hook: `{ group, balance, entries, error, refresh }`. Loads group once; then `getBalance` + incremental `listEntries` (cursor = max seen seq, entries accumulated in state); re-polls every 5s via `setInterval` **only while `document.visibilityState === "visible"`** (listen to `visibilitychange`); `refresh()` forces an immediate poll (used after adding an expense).
  - `/g/[groupId]` — shows `JoinPicker` when identity unset; otherwise: balance list (member name, ¥ amount, green positive / red negative), "Add expense" button → `/g/[groupId]/add`, history list (memo/kind, payer name, total, occurred_on; reversals rendered struck-through), share hint showing the page URL as the invite link.
  - `/g/[groupId]/add` — form: payer (defaults to identity), total (integer yen input), participants (checkboxes, all on by default), split mode tabs (equal/exact/shares/percent) with per-member inputs for non-equal modes, live preview via `previewShares`, memo, date (defaults today). Submit mints `entry id` + `idempotency key` once per intent (`useRef`), calls `addEntry`, disables the button while in flight, navigates back on success.

- [ ] **Step 1: Polling hook**

`web/app/g/[groupId]/useGroupData.ts`:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getBalance, getGroup, listEntries } from "@/lib/api";
import type { BalanceSnapshot, EntryRecord, Group } from "@/lib/types";

const POLL_MS = 5000;

export function useGroupData(groupId: string) {
  const [group, setGroup] = useState<Group | null>(null);
  const [balance, setBalance] = useState<BalanceSnapshot | null>(null);
  const [entries, setEntries] = useState<EntryRecord[]>([]);
  const [error, setError] = useState("");
  const cursor = useRef(0);

  const poll = useCallback(async () => {
    try {
      const [snap, page] = await Promise.all([
        getBalance(groupId),
        listEntries(groupId, cursor.current),
      ]);
      setBalance(snap);
      if (page.entries.length > 0) {
        cursor.current = page.entries[page.entries.length - 1]!.seq;
        setEntries((prev) => [...prev, ...page.entries]);
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load");
    }
  }, [groupId]);

  useEffect(() => {
    getGroup(groupId).then(setGroup).catch((err) => setError(String(err)));
    void poll();
    const tick = () => {
      if (document.visibilityState === "visible") void poll();
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [groupId, poll]);

  return { group, balance, entries, error, refresh: poll };
}
```

- [ ] **Step 2: Group home page**

`web/app/g/[groupId]/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { use, useState } from "react";
import { JoinPicker } from "./join";
import { useGroupData } from "./useGroupData";
import { getIdentity } from "@/lib/identity";

const yen = (n: number) => `${n < 0 ? "−" : ""}¥${Math.abs(n).toLocaleString("ja-JP")}`;

export default function GroupPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = use(params);
  const { group, balance, entries, error } = useGroupData(groupId);
  const [me, setMe] = useState<string | null>(() => getIdentity(groupId));

  if (error && !group) return <main className="p-4 text-red-600">{error}</main>;
  if (!group) return <main className="p-4 text-gray-500">Loading…</main>;
  if (!me) return <JoinPicker group={group} onPicked={setMe} />;

  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "?";
  const reversedIds = new Set(entries.filter((e) => e.reverses_id).map((e) => e.reverses_id));

  return (
    <main className="mx-auto max-w-md p-4 pb-24">
      <h1 className="mb-4 text-2xl font-bold">{group.name}</h1>

      <section className="mb-6 rounded-xl border p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Balances</h2>
        {balance?.balances.map((b) => (
          <div key={b.member_id} className="flex justify-between py-1">
            <span>{nameOf(b.member_id)}{b.member_id === me ? " (you)" : ""}</span>
            <span className={b.balance > 0 ? "text-green-600" : b.balance < 0 ? "text-red-600" : "text-gray-400"}>
              {yen(b.balance)}
            </span>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">History</h2>
        {[...entries].reverse().map((e) => (
          <div key={e.id}
            className={`border-b py-2 ${e.kind === "reversal" || reversedIds.has(e.id) ? "line-through opacity-50" : ""}`}>
            <div className="flex justify-between">
              <span>{e.kind === "reversal" ? "(deleted)" : (e.memo ?? e.kind)}</span>
              <span>{yen(e.total_amount)}</span>
            </div>
            <div className="text-sm text-gray-500">
              {nameOf(e.payer_id)} paid · {e.occurred_on}
            </div>
          </div>
        ))}
      </section>

      <p className="mt-6 text-xs text-gray-400">
        Invite friends: share this page&apos;s URL.
      </p>

      <Link href={`/g/${groupId}/add`}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-8 py-4 font-semibold text-white shadow-lg">
        Add expense
      </Link>
    </main>
  );
}
```

- [ ] **Step 3: Add-expense form**

`web/app/g/[groupId]/add/page.tsx`:

```tsx
"use client";

import { use, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addEntry } from "@/lib/api";
import { buildSplitRule, previewShares } from "@/lib/split";
import { getIdentity } from "@/lib/identity";
import type { SplitRule } from "@/lib/types";
import { uuidv7 } from "@/lib/uuidv7";
import useGroup from "./useGroup";

const modes: SplitRule["type"][] = ["equal", "exact", "shares", "percent"];

export default function AddExpensePage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = use(params);
  const router = useRouter();
  const group = useGroup(groupId);
  // The intent: minted once when this form mounts a submission, reused across retries.
  const intent = useRef<{ entryId: string; key: string } | null>(null);

  const me = getIdentity(groupId);
  const [payer, setPayer] = useState<string | null>(me);
  const [total, setTotal] = useState("");
  const [participants, setParticipants] = useState<Set<string> | null>(null);
  const [mode, setMode] = useState<SplitRule["type"]>("equal");
  const [values, setValues] = useState<Record<string, number>>({});
  const [memo, setMemo] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!group) return <main className="p-4 text-gray-500">Loading…</main>;
  const parts = participants ?? new Set(group.members.map((m) => m.id));
  const partList = group.members.filter((m) => parts.has(m.id)).map((m) => m.id);
  const totalYen = parseInt(total, 10);

  // Plain computation, not useMemo: it must not be a hook (it sits below the
  // early return) and it's cheap enough to run per render.
  const rule = buildSplitRule(mode, partList, {
    total: totalYen,
    amounts: mode === "exact" ? values : undefined,
    weights: mode !== "exact" && mode !== "equal" ? values : undefined,
  });
  const preview =
    typeof rule !== "string" && Number.isInteger(totalYen) && totalYen > 0
      ? previewShares(totalYen, rule, partList)
      : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!payer || !Number.isInteger(totalYen) || totalYen <= 0) {
      setError("payer and a positive whole-yen total are required");
      return;
    }
    if (typeof rule === "string") {
      setError(rule);
      return;
    }
    // Mint once per intent; a failed attempt retries with the SAME ids.
    intent.current ??= { entryId: uuidv7(), key: uuidv7() };
    setBusy(true);
    setError("");
    try {
      await addEntry(groupId, {
        id: intent.current.entryId,
        kind: "expense",
        payer_id: payer,
        total_amount: totalYen,
        split_rule: rule,
        participants: partList,
        memo: memo.trim() || undefined,
        occurred_on: date,
      }, intent.current.key);
      router.push(`/g/${groupId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to add");
      setBusy(false);
      // Keep intent.current: a manual retry of the SAME intent replays safely.
    }
  }

  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "?";

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="mb-4 text-xl font-bold">Add expense</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Total (¥)
          <input inputMode="numeric" pattern="[0-9]*" className="rounded-lg border p-3 text-lg"
            value={total} onChange={(e) => setTotal(e.target.value.replace(/\D/g, ""))} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Paid by
          <select className="rounded-lg border p-3" value={payer ?? ""}
            onChange={(e) => setPayer(e.target.value)}>
            {group.members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-1 text-sm">
          <legend>Who shared it?</legend>
          {group.members.map((m) => (
            <label key={m.id} className="flex items-center gap-2 py-1">
              <input type="checkbox" checked={parts.has(m.id)}
                onChange={(e) => {
                  const next = new Set(parts);
                  e.target.checked ? next.add(m.id) : next.delete(m.id);
                  setParticipants(next);
                }} />
              {m.name}
            </label>
          ))}
        </fieldset>

        <div className="flex gap-1">
          {modes.map((m) => (
            <button type="button" key={m}
              className={`flex-1 rounded-lg border p-2 text-sm ${mode === m ? "bg-blue-600 text-white" : ""}`}
              onClick={() => { setMode(m); setValues({}); }}>
              {m}
            </button>
          ))}
        </div>

        {mode !== "equal" &&
          partList.map((id) => (
            <label key={id} className="flex items-center justify-between gap-2 text-sm">
              {nameOf(id)}
              <input inputMode="numeric" className="w-28 rounded-lg border p-2 text-right"
                placeholder={mode === "exact" ? "¥" : mode === "percent" ? "%" : "shares"}
                value={values[id] ?? ""}
                onChange={(e) => setValues({ ...values, [id]: parseInt(e.target.value, 10) })} />
            </label>
          ))}

        {preview && (
          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
            {partList.map((id) => (
              <div key={id} className="flex justify-between">
                <span>{nameOf(id)}</span>
                <span>¥{preview[id]!.toLocaleString("ja-JP")}</span>
              </div>
            ))}
          </div>
        )}
        {typeof rule === "string" && total !== "" && (
          <p className="text-sm text-red-600">{rule}</p>
        )}

        <input className="rounded-lg border p-3" placeholder="Memo (dinner, taxi…)"
          value={memo} onChange={(e) => setMemo(e.target.value)} />
        <input type="date" className="rounded-lg border p-3"
          value={date} onChange={(e) => setDate(e.target.value)} />

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="rounded-lg bg-blue-600 p-4 font-semibold text-white disabled:opacity-50"
          disabled={busy}>
          {busy ? "Adding…" : "Add"}
        </button>
      </form>
    </main>
  );
}
```

`web/app/g/[groupId]/add/useGroup.ts` (tiny fetch-once hook the form uses):

```tsx
"use client";

import { useEffect, useState } from "react";
import { getGroup } from "@/lib/api";
import type { Group } from "@/lib/types";

export default function useGroup(groupId: string): Group | null {
  const [group, setGroup] = useState<Group | null>(null);
  useEffect(() => {
    getGroup(groupId).then(setGroup).catch(() => setGroup(null));
  }, [groupId]);
  return group;
}
```


- [ ] **Step 4: End-to-end hand verification**

With API + web dev server running (Task 4 Step 4 commands): two browser windows on the same group —
1. Window A adds "dinner ¥12,000, equal, 3 people" → A sees balances update.
2. Window B (different member picked) sees the entry appear within ~5s without reloading.
3. DevTools → Network → set **Offline**, tap Add, observe retries; go online → exactly ONE entry lands (check history and `SELECT count(*) FROM entries` if in doubt).
4. Split modes: exact with wrong sum shows the inline error; shares 1:2 of ¥100 previews 33/67.

Run: `cd web && npm test && npx tsc --noEmit && npm run build`
Expected: tests PASS, no type errors, production build succeeds.

```bash
git add web/
git commit -m "feat: group home with polling balances/history and add-expense form"
```

---

## Deferred

- Settle-up screen — Phase 6 plan (needs the settle-plan endpoint).
- Edit/delete UI — the API exists (reads/reversals plan); client UI can follow once the core flow is proven.
- SSE replacing polling — v1.1.
- Real auth (signed group tokens / magic links) replacing capability URLs + localStorage identity — explicitly a v1 trade-off, documented in architecture §2.
