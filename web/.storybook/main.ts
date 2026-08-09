import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  stories: ["../app/**/*.stories.@(ts|tsx)"],
  addons: ["msw-storybook-addon"],
  framework: "@storybook/nextjs-vite",
  staticDirs: ["../public"],
};

export default config;
