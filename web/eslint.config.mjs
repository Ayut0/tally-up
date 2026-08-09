import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import oxlint from "eslint-plugin-oxlint";

// oxlint (.oxlintrc.json) is the primary lint pass and covers everything
// eslint-config-next used to, including all 21 @next/next rules. ESLint
// remains only for the React Compiler hooks rules oxlint has not ported —
// set-state-in-effect, purity, immutability and friends. The oxlint config
// below disables the two hooks rules oxlint *does* implement, so no rule
// ever runs in both linters; that boundary updates itself as oxlint ports
// more rules.
export default defineConfig([
  reactHooks.configs.flat["recommended-latest"],
  ...oxlint.configs["flat/react-hooks"],
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "lib/api-types.ts",
    "lib/api-schemas/**",
    "public/mockServiceWorker.js",
  ]),
]);
