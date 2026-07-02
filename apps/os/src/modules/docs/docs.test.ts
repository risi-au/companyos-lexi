import { describe, it, expect } from "vitest";

// Pure core conversion for md roundtrip guard (no React needed; works in jsdom / node)
import { BlockNoteEditor } from "@blocknote/core";

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
