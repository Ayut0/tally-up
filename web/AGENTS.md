<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Query keys

Every TanStack Query key lives in `lib/queries.ts`, as a `queryOptions()`
factory pairing the key with the `lib/api` call that fills it. Hooks under
`app/` MUST spread a factory rather than writing a `queryKey` literal, and
MUST invalidate through one too:

```ts
const groupQuery = useQuery(groupQueryOptions(groupId));

const balanceQuery = useQuery({
  ...balanceQueryOptions(groupId),   // per-call-site knobs go after the
  enabled: groupQuery.isSuccess,     // spread, or the factory clobbers them
  refetchInterval: POLL_INTERVAL_MS,
});

queryClient.invalidateQueries({ queryKey: groupQueryOptions(groupId).queryKey });
```

Two reasons this is a rule and not a preference. Invalidation relies on
prefix matching — `entriesKey(groupId)` reaches every entries query, live
window and paged-older alike — and a hand-written key that orders its
segments differently escapes that silently: nothing fails, the data just
goes stale. And where a key and its request both branch on the same value
(`entriesWindowQueryOptions`), splitting them across a call site lets them
drift, caching one window's data under another's name.

What does *not* belong in a factory: `enabled`, `refetchInterval`, and the
other per-screen knobs. Those legitimately differ between call sites — the
group home polls balance, the record-payment form doesn't — so the factory
carries key and fetcher only. Don't reconcile such a difference by adding a
knob for symmetry; check first whether the asymmetry is load-bearing.

Writes that navigate away on success don't invalidate at all; see the
comment at the top of `lib/api.ts` for why.

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
