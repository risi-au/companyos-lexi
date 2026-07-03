import { describe, expect, it } from "vitest";
import { matchesScope } from "./match";

describe("matchesScope", () => {
  it.each([
    ["**", "indya", true],
    ["**", "indya/marketing/seo", true],
    ["indya", "indya", true],
    ["indya", "indya/marketing/seo", true],
    ["indya", "indyafoo", false],
    ["indya/*", "indya/marketing", true],
    ["indya/*", "indya/marketing/seo", false],
    ["indya/*", "indya", false],
    ["indya/**", "indya", true],
    ["indya/**", "indya/marketing", true],
    ["indya/**", "indya/marketing/seo", true],
    ["airbuddy/**", "indya/marketing", false],
    ["*/marketing", "indya/marketing", true],
    ["*/marketing", "indya/marketing/seo", false],
  ])("%s against %s => %s", (pattern, scopePath, expected) => {
    expect(matchesScope(pattern, scopePath)).toBe(expected);
  });
});
