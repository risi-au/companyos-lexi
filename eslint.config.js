import eslint from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/drizzle/**",
      ".claude/**",
      "legacy/**",
      "docs/**",
      "mcps/**",
      "**/next-env.d.ts",
    ],
  },
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["apps/os/**/*.{ts,tsx}"],
    plugins: {
      boundaries,
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: [
            "./apps/os/tsconfig.json",
            "./tsconfig.json",
          ],
        },
      },
      "boundaries/include": ["apps/os/**/*"],
      "boundaries/elements": [
        {
          type: "module",
          pattern: "apps/os/modules/*",
          mode: "folder",
          capture: ["moduleName"],
        },
        {
          type: "shared",
          pattern: "apps/os/src/**",
        },
        {
          type: "package",
          pattern: "packages/*",
        },
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            {
              from: ["module"],
              allow: [
                ["module", { moduleName: "${from.moduleName}" }],
                "shared",
                "package",
              ],
            },
            {
              from: ["shared"],
              allow: ["shared", "package", "module"],
            },
          ],
        },
      ],
    },
  },
);