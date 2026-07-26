DATABASE_URL ?= postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable
PORT ?= 8080

# CGO_ENABLED=0 works around a macOS/Go toolchain dyld quirk on some setups
# (missing LC_UUID load command). It is scoped to macOS deliberately: on Linux
# `go test -race` requires cgo and refuses to run without it, so leaking this
# to CI breaks the test job.
ifeq ($(shell uname -s),Darwin)
GO := CGO_ENABLED=0 go
else
GO := go
endif

SEED_MEMBER_ID  := 00000000-0000-0000-0000-00000000000a
SEED_GROUP_ID   := 00000000-0000-0000-0000-0000000000a1

# Pinned here and in .github/workflows/ci.yaml's Lint step so a new
# golangci-lint release can't turn CI red on an unrelated PR — see #98.
GOLANGCI_LINT_VERSION := v2.6.2

.PHONY: db-up db-down run seed smoke test test-nodb sqlc spec lint web-dev web-test web-build

db-up: ## Start the local Postgres container
	docker compose up -d db

db-down: ## Stop and remove the local Postgres container (add -v by hand to also drop data)
	docker compose down

run: ## Run the API server against the local Postgres container (migrations apply automatically)
	DATABASE_URL='$(DATABASE_URL)' PORT=$(PORT) $(GO) run ./cmd/api

seed: ## Insert one member/group/membership row so there's something to POST entries against
	docker compose exec -T db psql -U tallyup -d tallyup_test -c "\
		INSERT INTO members (id, name) VALUES ('$(SEED_MEMBER_ID)', 'yuto') ON CONFLICT DO NOTHING; \
		INSERT INTO groups (id, name) VALUES ('$(SEED_GROUP_ID)', 'trip') ON CONFLICT DO NOTHING; \
		INSERT INTO group_members (group_id, member_id) VALUES ('$(SEED_GROUP_ID)', '$(SEED_MEMBER_ID)') ON CONFLICT DO NOTHING; \
	"

smoke: ## POST one expense against a running `make run` server (run `make seed` first)
	curl -s -X POST http://localhost:$(PORT)/groups/$(SEED_GROUP_ID)/entries \
		-H "Idempotency-Key: $$(uuidgen)" \
		-d '{"id":"'$$(uuidgen)'","kind":"expense","payer_id":"$(SEED_MEMBER_ID)","total_amount":1000,"split_rule":{"type":"equal"},"participants":["$(SEED_MEMBER_ID)"],"memo":"test","occurred_on":"2026-07-17"}'
	@echo

test: ## Run the full test suite against the local Postgres container (race detector, sequential packages)
	TEST_DATABASE_URL='$(DATABASE_URL)' $(GO) test -p 1 ./... -race

test-nodb: ## Run only the tests that need no database — what CI runs today
	@# Blanks DATABASE_URL so TEST_DATABASE_URL is empty and the DB-backed
	@# tests skip. Without this they would target the local default (:5433)
	@# and fail with "connection refused" wherever no Postgres is running.
	$(MAKE) test DATABASE_URL=

sqlc: ## Regenerate the typed query layer from query/*.sql (install: brew install sqlc)
	sqlc generate

lint: ## Run golangci-lint (config: .golangci.yaml, linter choice recorded in #98)
	go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_LINT_VERSION) run

spec: ## Regenerate spec/openapi.yaml from spec/*.tsp (spec/ is self-contained; needs `cd spec && npm install` once first)
	cd spec && npm run build

web-dev: ## Run the Next.js dev server (web/ is a self-contained npm project; needs `cd web && npm install` once first)
	cd web && npm run dev

web-test: ## Run the web client's unit tests (vitest)
	cd web && npm test

web-build: ## Production build of the web client
	cd web && npm run build
