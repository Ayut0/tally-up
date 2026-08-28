import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // The E2E tier is Playwright's, not Vitest's (ADR 0006).
    // `.features-gen/**` is the load-bearing half: bddgen emits `*.spec.js`
    // there, which matches Vitest's default glob, and those are real
    // `test.describe()` calls against @playwright/test — Vitest collecting
    // one fails the whole run rather than skipping it.
    // `e2e/**` is precautionary: nothing in it matches the default glob
    // today, but `e2e/foo.spec.ts` is the natural name for a plain Playwright
    // test someone adds later, and it would be collected here too.
    exclude: [...defaultExclude, "e2e/**", ".features-gen/**"],
  },
  resolve: { alias: { "@": __dirname } },
});
