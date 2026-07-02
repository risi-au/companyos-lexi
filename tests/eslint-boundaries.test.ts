import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("module boundary lint rule", () => {
  it("flags cross-module imports between sibling modules", async () => {
    const eslint = new ESLint({
      overrideConfigFile: "eslint.config.js",
    });
    const results = await eslint.lintFiles([
      "apps/os/modules/module-a/boundary-violation.fixture.ts",
    ]);

    const messages = results.flatMap((result) => result.messages);
    const boundaryViolations = messages.filter((message) =>
      message.ruleId?.startsWith("boundaries/"),
    );

    expect(boundaryViolations.length).toBeGreaterThan(0);
  });
});