import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/db",
      "packages/api",
      "packages/mcp",
      {
        test: {
          name: "os-web",
          include: ["apps/os/src/**/*.test.ts"],
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