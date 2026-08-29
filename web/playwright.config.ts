import { defineConfig, devices } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

/**
 * The E2E tier: Gherkin features driven through a real browser against the
 * real stack — Next.js client, Go API, Postgres. See `e2e/README.md` for the
 * three-layer structure (feature → steps → screens) and
 * `docs/adr/0006-gherkin-e2e-tier.md` for why this tier exists alongside the
 * vitest logic suite and the Storybook interaction tests.
 *
 * `bddgen` (the `e2e` npm script) compiles `e2e/features/*.feature` into
 * generated Playwright specs under `.features-gen/`, which is what `testDir`
 * below points at. That directory is committed (#273) and guarded by
 * `make features-gen-check` — never hand-edit it.
 */
const testDir = defineBddConfig({
  features: "e2e/features/**/*.feature",
  // Screens (page objects) deliberately aren't listed: they define no steps,
  // and listing them would make bddgen re-scan them on every run for nothing.
  steps: "e2e/steps/**/*.ts",
  outputDir: ".features-gen",
});

// Ports are overridable so a developer already running `make run` / `npm run
// dev` on the defaults can point the suite elsewhere instead of colliding.
const API_PORT = process.env.E2E_API_PORT ?? "8080";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "3000";
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

// Mirrors the Makefile's DATABASE_URL default (the docker-compose `db`
// service on :5433). CI overrides it to the service container on :5432, the
// same split ci.yaml's `test` job already makes.
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgres://tallyup:tallyup@localhost:5433/tallyup_test?sslmode=disable";

export default defineConfig({
  testDir,
  // Scenarios never share state — each one creates its own group, so they
  // are safe to run in parallel (see e2e/README.md, "Isolation"). This is
  // the one place the E2E tier is *less* constrained than the Go suite,
  // which needs `-p 1` because its helper truncates shared tables.
  fullyParallel: true,
  // A `.only` left in a generated spec would silently shrink the suite.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: WEB_URL,
    // Kept on failure only: a green run shouldn't spend CI time or disk on
    // artifacts nobody opens.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      // Mobile-first app (README: "open an invite link on any phone"), so the
      // default viewport is a phone — the fixed bottom "+ Add expense" bar and
      // the max-w-sm column are laid out for it.
      use: { ...devices["Pixel 7"] },
    },
  ],

  // Playwright boots the whole stack itself, so `npm run e2e` is one command.
  // Postgres is the one piece it does not start — `make db-up` (or CI's
  // service container) owns that, because a container's lifetime shouldn't be
  // tied to a single test run's.
  webServer: [
    {
      command: "go run ./cmd/api",
      // Relative to this config's directory (web/), so `..` is the repo root.
      cwd: "..",
      env: {
        DATABASE_URL,
        PORT: API_PORT,
        // Narrower than the server's `*` default — the E2E stack knows
        // exactly which origin the browser will use.
        CORS_ORIGIN: WEB_URL,
      },
      // The liveness endpoint added in #268. It deliberately doesn't touch
      // Postgres, so this waits for "the process is serving", not "the
      // database answered" — migrations still run before the listener opens,
      // so a served /healthz does imply the schema is applied.
      url: `${API_URL}/healthz`,
      // `go run` may compile from cold on a fresh checkout or CI cache miss.
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // Production build in CI (what users actually get, and faster per
      // navigation), dev server locally (no rebuild between iterations).
      command: process.env.CI ? "npm run build && npm run start" : "npm run dev",
      env: {
        // Inlined at build time for client components, so it must be set for
        // the `next build` above, not just at runtime.
        NEXT_PUBLIC_API_URL: API_URL,
        PORT: WEB_PORT,
      },
      url: WEB_URL,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      // Left on Playwright's defaults (stdout ignored, stderr piped). Note
      // that `next dev` relays browser console messages to stderr, so a run
      // is noisy with HeroUI/react-aria a11y warnings the app already emits;
      // that's kept rather than silenced, because a failing `next build` in
      // CI reports through the same stream.
    },
  ],
});
