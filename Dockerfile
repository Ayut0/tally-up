# syntax=docker/dockerfile:1

# Build stage: compile a static binary. CGO_ENABLED=0 is unconditional here
# (unlike the Makefile, which scopes it to macOS only to avoid breaking
# `go test -race` on Linux CI) because this is a non-test build.
#
# Base images are pinned to digest, not a mutable tag, same reasoning as the
# commit-SHA pins in ci.yaml — update the digest and the comment above it
# together when bumping.
# golang:1.25.0-alpine
FROM golang:1.25.0-alpine@sha256:f18a072054848d87a8077455f0ac8a25886f2397f88bfdd222d6fafbb5bba440 AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ cmd/
COPY internal/ internal/

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /out/tallyup ./cmd/api

# Runtime stage: distroless, no shell, no package manager. The migrations
# under internal/infrastructure/postgres/migrations are go:embed'ed into the
# binary (store.go), so nothing besides the binary itself needs to ship.
#
# gcr.io/distroless/static-debian12:nonroot
FROM gcr.io/distroless/static-debian12:nonroot@sha256:afa5c872c891853ca7fcf1f12c3edb23f7eeef36189728842dd51042ff57f7ab

COPY --from=build /out/tallyup /tallyup

EXPOSE 8080

ENTRYPOINT ["/tallyup"]
