import { describe, it, expect } from "vitest";

// Pure core conversion for md roundtrip guard (no React needed; works in jsdom / node)
import { BlockNoteEditor } from "@blocknote/core";
import {
  buildMetadataChips,
  markdownForSave,
  parseFrontmatter,
  splitTrailingSources,
} from "./DocEditor";

// Fixture covering required elements per brief: headings, lists, code, table, image link, bold/italic
const FIXTURE_MD = `# Heading 1

Paragraph with **bold** and *italic*.

## Heading 2

- List item one
- List item two

\`\`\`ts
const x = 1;
\`\`\`

| Col A | Col B |
|-------|-------|
| 1     | 2     |

![alt](https://example.com/img.png)

> Quote line
`;

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

describe("docs md roundtrip (BlockNote blocksToMarkdownLossy + tryParseMarkdownToBlocks)", () => {
  it("parses fixture md to blocks then back to md with semantic stability (whitespace normalized)", async () => {
    const editor = BlockNoteEditor.create();

    const blocks = await editor.tryParseMarkdownToBlocks(FIXTURE_MD);
    expect(blocks.length).toBeGreaterThan(0);

    const out = await editor.blocksToMarkdownLossy(blocks);
    expect(out).toBeDefined();

    const normOut = normalize(out);

    // Semantic presence assertions (allow lossy details like exact table fmt or quote style)
    expect(normOut).toContain("Heading 1");
    expect(normOut).toContain("bold");
    expect(normOut).toContain("italic");
    expect(normOut).toContain("List item one");
    expect(normOut).toContain("const x = 1");
    expect(normOut).toContain("Col A");
    expect(normOut).toContain("example.com/img.png");
  });

  it("handles empty and minimal docs without crash", async () => {
    const editor = BlockNoteEditor.create();
    const b1 = await editor.tryParseMarkdownToBlocks("");
    const o1 = await editor.blocksToMarkdownLossy(b1);
    expect(typeof o1).toBe("string");

    const b2 = await editor.tryParseMarkdownToBlocks("# Only title");
    const o2 = await editor.blocksToMarkdownLossy(b2);
    expect(normalize(o2)).toContain("Only title");
  });
});

describe("docs read-mode presentation helpers", () => {
  it("extracts YAML frontmatter without mutating the stored markdown", () => {
    const markdown = `---
learned_at: 2026-07-01
verified_at: 2026-07-07
stale_after: 2026-10-07
confidence: high
---
# Intake Process

Body text.`;

    const parsed = parseFrontmatter(markdown);

    expect(parsed.body).toBe("# Intake Process\n\nBody text.");
    expect(parsed.metadata).toMatchObject({
      learned_at: "2026-07-01",
      verified_at: "2026-07-07",
      stale_after: "2026-10-07",
      confidence: "high",
    });
    expect(markdown).toContain("learned_at: 2026-07-01");
  });

  it("builds compact metadata chips for known frontmatter keys", () => {
    expect(buildMetadataChips({
      learned_at: "2026-07-01",
      verified_at: "2026-07-07",
      stale_after: "2026-10-07",
      confidence: "high",
    })).toEqual([
      "Verified 7 Jul 2026",
      "Learned 1 Jul 2026",
      "Confidence: high",
      "Review by 7 Oct 2026",
    ]);
  });

  it("moves a trailing Sources section out of the read body", () => {
    const markdown = `# Doc

Body.

## Sources

- https://example.com/a
- https://example.com/b`;

    const split = splitTrailingSources(markdown);

    expect(split.body).toBe("# Doc\n\nBody.");
    expect(split.sources).toContain("https://example.com/a");
    expect(split.count).toBe(2);
  });

  it("keeps no-op edit saves byte-identical", () => {
    const initial = "---\nconfidence: high\n---\n# Doc\n\nBody.";
    const serialized = "# Doc\n\nBody.";

    expect(markdownForSave(initial, serialized, false)).toBe(initial);
    expect(markdownForSave(initial, serialized, true)).toBe(serialized);
  });
});
