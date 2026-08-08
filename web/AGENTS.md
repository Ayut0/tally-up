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
