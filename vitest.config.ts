import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/db",
      "packages/api",
      "packages/mcp",
      {
        test: {
          name: "root",
          include: ["tests/**/*.test.ts"],
        },
      },
    ],
  },
});