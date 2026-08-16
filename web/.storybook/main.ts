import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: ["../{app,components}/**/*.stories.@(ts|tsx)"],
  addons: ["msw-storybook-addon", "@storybook/addon-vitest"],
  framework: "@storybook/nextjs-vite",
  staticDirs: ["../public"],
};

export default config;
