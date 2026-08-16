<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Storybook

Storybook (`@storybook/nextjs-vite`) is available for rendering a component
in isolation with mock data — `npm run storybook` for the dev server,
`npm run build-storybook` for the build CI runs. Writing a `.stories.tsx`
file is **opt-in per component**, not a blanket requirement: reserve it for
components with multiple visual states worth eyeballing in isolation (e.g.
`BalanceList`'s balance/settled/empty states), not routine props-driven
components with a single obvious rendering.

The same opt-in bar applies to pages — the route components under `app/`
(e.g. `app/g/[groupId]/page.tsx`), not just leaf/shared components. Reserve
a page story for pages with multiple visual states worth eyeballing
(loading/error/empty/populated), not a blanket requirement per route; the
dev-only `app/styleguide/page.tsx` is out of scope entirely, since it isn't
a product page. A page also needs routing mocked, not just API calls:

- **API** — MSW via `msw-storybook-addon`, already wired into
  `.storybook/preview.tsx` (`mswLoader`). Per-story handlers via
  `parameters.msw.handlers`, same as any component story (see
  `app/g/[groupId]/memberList.stories.tsx`).
- **Routing** — `@storybook/nextjs-vite`'s built-in App Router mock.
  Setting `parameters.nextjs = { appDirectory: true, navigation: {...} }`
  wraps the story in a real `AppRouterContext`; `navigation.pathname` sets
  `usePathname()`, `navigation.segments: [[key, value], ...]` sets
  `useParams()`'s params. No extra dependency needed.

See `app/g/[groupId]/page.stories.tsx` for a worked example of both.

## Storybook interaction tests

`play` functions are opt-in at the same bar as stories themselves — add one
when there's a multi-step interaction worth verifying (dialog confirm, form
submit, error path), not for every interactive story. They run via
`@storybook/addon-vitest` as a separate Vitest project
(`npm run test:storybook`), deliberately never part of `npm test` — see
`docs/adr/0005-storybook-interaction-tests.md` for why this doesn't reopen
#138's "the suite never renders JSX" rule.
