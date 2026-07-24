DATABASE_URL ?= postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable
PORT ?= 8080

# CGO_ENABLED=0 works around a macOS/Go toolchain dyld quirk on some setups
# (missing LC_UUID load command); harmless elsewhere since this repo has no cgo deps.
GO := CGO_ENABLED=0 go

SEED_MEMBER_ID  := 00000000-0000-0000-0000-00000000000a
SEED_GROUP_ID   := 00000000-0000-0000-0000-0000000000a1

.PHONY: db-up db-down run seed smoke test sqlc

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

sqlc: ## Regenerate the typed query layer from query/*.sql (install: brew install sqlc)
	sqlc generate
