import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pagePreviewBody, parseWikiQuestionView, plainAttentionKindLabel, plainAttentionTitle } from "./wiki-question";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const lintItem = { kind: "lint_finding" as const, title: "Wiki lint: contradiction", payload: {} };

describe("attention wiki question helpers", () => {
  it("maps current contradiction payloads to specific controls and copy", () => {
    const view = parseWikiQuestionView({
      title: "Wiki lint: contradiction",
      payload: {
        version: 2,
        type: "contradiction",
        relation: "exclusive-status",
        subject: { entity: "Launch", property: "status", timeframe: "current" },
        explanation: "Only one launch status can be current.",
        claims: [
          { slug: "alpha", title: "Alpha", quote: "Launch is live.", normalizedValue: "live" },
          { slug: "beta", title: "Beta", quote: "Launch is draft.", normalizedValue: "draft" },
        ],
        choices: [
          { id: "first", label: "Keep live", repair: { slug: "beta", title: "Beta", currentMd: "old", proposedMd: "new" } },
          { id: "second", label: "Keep draft", repair: { slug: "alpha", title: "Alpha", currentMd: "old", proposedMd: "new" } },
        ],
        scopePath: "project",
      },
    });

    expect(view).toMatchObject({
      state: "v2-contradiction",
      title: "Two wiki pages disagree",
      explanation: "Only one launch status can be current.",
    });
    expect(plainAttentionKindLabel(lintItem)).toBe("Wiki question");
    expect(plainAttentionTitle(lintItem)).toBe("This older check does not include enough evidence.");
  });

  it("maps stale and legacy payloads to safe actions", () => {
    expect(parseWikiQuestionView({
      title: "Wiki lint: stale",
      payload: { version: 2, type: "stale", slug: "page", title: "Page", currentMd: "body", reviewDueAt: "2026-01-01T00:00:00.000Z" },
    })).toMatchObject({ state: "v2-stale", title: "This page may be out of date", pageTitle: "Page" });

    expect(parseWikiQuestionView({
      title: "Wiki lint: stale",
      payload: { type: "stale", slug: "page", title: "Page" },
    })).toMatchObject({ state: "legacy", title: "This older check does not include enough evidence." });
  });

  it("routes malformed current payloads to the safe compatibility view", () => {
    const basePayload = {
      version: 2,
      type: "contradiction",
      relation: "exclusive-status",
      subject: { entity: "Launch", property: "status", timeframe: "current" },
      explanation: "Only one launch status can be current.",
      claims: [
        { slug: "alpha", title: "Alpha", quote: "Launch is live.", normalizedValue: "live" },
        { slug: "beta", title: "Beta", quote: "Launch is draft.", normalizedValue: "draft" },
      ],
      choices: [
        { id: "first", label: "Keep live", repair: { slug: "beta", title: "Beta", currentMd: "old", proposedMd: "new" } },
        { id: "second", repair: { slug: "alpha", title: "Alpha", currentMd: "old", proposedMd: "new" } },
      ],
      scopePath: "project",
    };
    expect(parseWikiQuestionView({ title: "Internal title", payload: basePayload })).toMatchObject({ state: "legacy" });
    expect(parseWikiQuestionView({
      title: "Internal title",
      payload: { ...basePayload, choices: [...basePayload.choices, { id: "third" }] },
    })).toMatchObject({ state: "legacy" });
  });

  it("removes frontmatter metadata from page previews", () => {
    expect(pagePreviewBody("---\ncategory: current-work\nverified_by: person-1\n---\n# Launch\n\nReadable text.")).toBe("# Launch\n\nReadable text.");
    expect(pagePreviewBody("# Plain page\n\nReadable text.")).toBe("# Plain page\n\nReadable text.");
  });

  it("keeps wiki question and proposal controls in plain language", () => {
    const source = fs.readFileSync(path.join(__dirname, "AttentionCard.tsx"), "utf8");
    expect(source).toContain("Apply this correction");
    expect(source).toContain("Choose what the wiki should say");
    expect(source).toContain('type="radio"');
    expect(source).toContain('name="choiceId"');
    expect(source).toContain("Open pages to compare");
    expect(source).toContain("Not a conflict");
    expect(source).toContain("Why these statements can both be correct");
    expect(source).toContain("Next review date");
    expect(source).toContain("Mark as current");
    expect(source).toContain("Close as unclear");
    expect(source).toContain("Apply update");
    expect(source).toContain("Keep current page");
    expect(source).not.toContain(">Approve<");
    expect(source).not.toContain(">Reject<");
    expect(source).not.toContain("lint finding");
    expect(source).not.toContain("font-mono text-[11px]");
  });
});
