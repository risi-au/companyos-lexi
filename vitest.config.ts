import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/db",
      "packages/api",
      "packages/brain",
      "packages/mcp",
      {
        test: {
          name: "os-web",
          include: ["apps/os/src/**/*.test.ts"],
          environment: "jsdom",
          // globals etc handled by root if needed; jsdom for BlockNote md parse in tests (M3-02)
        },
      },
      {
        test: {
          name: "root",
          include: ["tests/**/*.test.ts"],
        },
      },
    ],
  },
});
