import path from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Deliberately a separate config file from vitest.config.ts, not a merged
// `test.projects` array — so `npm test`'s default `vitest run` has no path
// to this browser project by construction. See
// docs/adr/0005-storybook-interaction-tests.md.
export default defineConfig({
  plugins: [
    storybookTest({
      configDir: path.join(dirname, ".storybook"),
      storybookScript: "npm run storybook -- --ci --no-open",
    }),
  ],
  test: {
    name: "storybook",
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
