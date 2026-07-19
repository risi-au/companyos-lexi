import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Pure core conversion for md roundtrip guard (no React needed; works in jsdom / node)
import { BlockNoteEditor } from "@blocknote/core";
import {
  buildMetadataChips,
  markdownForSave,
  parseFrontmatter,
  reattachFrontmatter,
  splitTrailingSources,
  parseStructuredMarkdown,
  pageDisplayCategory,
  parsePageCategory,
  serializeStructuredMarkdown,
  wikilinksToMarkdown,
} from "./DocEditor";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      "Checked 7 Jul 2026",
      "Kept up to date by CompanyOS 1 Jul 2026",
      "How sure CompanyOS is: high",
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
    const { raw } = parseFrontmatter(initial);

    expect(markdownForSave(initial, serialized, false, raw)).toBe(initial);
    expect(markdownForSave(initial, serialized, true, raw)).toBe(initial);
  });
});

describe("docs frontmatter-safe editing", () => {
  it("reattaches preserved raw frontmatter to an edited body", () => {
    const initial = `---
learned_at: 2026-07-01
confidence: high
---
# Intake Process

Body text.`;
    const { raw, body } = parseFrontmatter(initial);
    const editedBody = "# Intake Process\n\nUpdated body.";

    expect(reattachFrontmatter(raw, editedBody)).toBe(`---
learned_at: 2026-07-01
confidence: high
---
# Intake Process

Updated body.`);
    expect(markdownForSave(initial, body, false, raw)).toBe(initial);
    expect(markdownForSave(initial, editedBody, true, raw)).toBe(reattachFrontmatter(raw, editedBody));
  });

  it("leaves docs without frontmatter unchanged on save", () => {
    const initial = "# Plain Doc\n\nNo frontmatter here.";
    const { raw } = parseFrontmatter(initial);

    expect(raw).toBeNull();
    expect(markdownForSave(initial, initial, false, raw)).toBe(initial);
    expect(markdownForSave(initial, "# Plain Doc\n\nEdited.", true, raw)).toBe("# Plain Doc\n\nEdited.");
    expect(reattachFrontmatter(raw, "# Plain Doc\n\nEdited.")).toBe("# Plain Doc\n\nEdited.");
  });

  it("round-trips frontmatter through split and reattach without mutation", () => {
    const initial = "---\nverified_at: 2026-07-07\n---\n# Doc\n\nBody.";
    const { raw, body } = parseFrontmatter(initial);

    expect(markdownForSave(initial, body, false, raw)).toBe(initial);
    expect(reattachFrontmatter(raw, body)).toBe(initial);
  });
});

describe("structured wiki form mapping", () => {
  it("round-trips a form-shaped page byte-identically when unchanged", () => {
    const markdown = `---
learned_at: 2026-07-01
aliases:
  - intake
  - setup flow
---
Definition paragraph.

Details stay as markdown.

## First
First content.

## Second
- item
`;

    const form = parseStructuredMarkdown("Setup", markdown);

    expect(form.aliases).toEqual(["intake", "setup flow"]);
    expect(form.definition).toBe("Definition paragraph.");
    expect(form.sections).toHaveLength(2);
    expect(serializeStructuredMarkdown(form)).toBe(markdown);
  });

  it("round-trips Page type frontmatter and preserves unknown frontmatter", () => {
    const markdown = `---
category: current-work
confidence: high
unknown_key: keep-me
---
Definition.
`;

    const form = parseStructuredMarkdown("Setup", markdown);
    expect(form.category).toBe("current-work");
    expect(parsePageCategory(markdown)).toBe("current-work");
    expect(serializeStructuredMarkdown(form)).toBe(markdown);

    form.category = "decisions-policies";
    const serialized = serializeStructuredMarkdown(form);
    expect(serialized).toContain("category: decisions-policies");
    expect(serialized).toContain("confidence: high");
    expect(serialized).toContain("unknown_key: keep-me");
    expect(serialized).toContain("Definition.\n");
  });

  it("falls back legacy page types and maps reserved pages to purpose groups", () => {
    expect(pageDisplayCategory({ scopePath: "client", slug: "wiki", markdown: "" })).toBe("Start here");
    expect(pageDisplayCategory({ scopePath: "client", slug: "overview", markdown: "" })).toBe("Start here");
    expect(pageDisplayCategory({ scopePath: "root", slug: "scope-map", markdown: "" })).toBe("Start here");
    expect(pageDisplayCategory({ scopePath: "root", slug: "pattern-intake", markdown: "" })).toBe("Guides and processes");
    expect(pageDisplayCategory({ scopePath: "client", slug: "decision", markdown: "---\ncategory: decisions-policies\n---\nBody" })).toBe("Decisions and policies");
    expect(pageDisplayCategory({ scopePath: "client", slug: "legacy", markdown: "---\ncategory: old\n---\nBody" })).toBe("Other pages");
  });

  it("updates aliases as a YAML list without rewriting the markdown body", () => {
    const markdown = `---
confidence: high
aliases: old alias, legacy
---
Definition.

## Raw
<aside>unsupported html remains raw</aside>
`;
    const form = parseStructuredMarkdown("Page", markdown);
    form.aliases = ["new alias", "Legacy Two"];

    const serialized = serializeStructuredMarkdown(form);

    expect(serialized).toContain("confidence: high");
    expect(serialized).toContain("aliases:\n  - new alias\n  - Legacy Two");
    expect(serialized).toContain("## Raw\n<aside>unsupported html remains raw</aside>\n");
  });

  it("keeps unsupported section markdown opaque through unrelated form edits", () => {
    const markdown = `Definition.

## API
### Nested

\`\`\`ts
const x = 1;
\`\`\`
`;
    const form = parseStructuredMarkdown("API", markdown);
    form.definition = "Updated definition.";

    const serialized = serializeStructuredMarkdown(form);

    expect(form.sections[0]?.kind).toBe("markdown");
    expect(serialized).toContain("## API\n### Nested\n\n```ts\nconst x = 1;\n```\n");
  });

  it("renders wikilinks as scoped markdown links and marks unknown pages missing", () => {
    const markdown = "See [[Known|known-page]], [[Missing Page]], and [[client/ads:remote]].";
    const rendered = wikilinksToMarkdown(markdown, "client", [
      { scopePath: "client", slug: "known-page" },
      { scopePath: "client/ads", slug: "remote" },
    ]);

    expect(rendered).toContain("[Known](/s/client?tab=docs&doc=known-page)");
    expect(rendered).toContain('[Missing Page](/s/client?tab=docs&doc=missing-page "missing-wikilink")');
    expect(rendered).toContain("[remote](/s/client/ads?tab=docs&doc=remote)");
  });
});

describe("docs UI plain wording", () => {
  it("uses the approved plain labels in owned wiki surfaces", () => {
    const editorSource = fs.readFileSync(path.join(__dirname, "DocEditor.tsx"), "utf8");
    const viewSource = fs.readFileSync(path.join(__dirname, "DocsView.tsx"), "utf8");
    const combined = `${editorSource}\n${viewSource}`;

    for (const label of [
      "Kept up to date by CompanyOS",
      "Links from other pages",
      "Needs a quick check",
      "Mark as correct",
      "Notify me",
      "Notifications on",
      "Also known as",
      "What this is",
      "More detail",
      "Page sections",
      "Simple",
      "Advanced",
      "Past versions",
      "Advanced content",
    ]) {
      expect(combined).toContain(label);
    }

    expect(combined).not.toContain("AI-maintained");
    expect(combined).not.toContain(">Backlinks<");
    expect(combined).not.toContain(">Unreviewed<");
    expect(combined).not.toContain("Mark verified");
    expect(combined).not.toContain(">Follow<");
    expect(combined).not.toContain(">Following<");
    expect(combined).not.toContain(">Aliases<");
    expect(combined).not.toContain(">Definition<");
    expect(combined).not.toContain(">Details<");
    expect(combined).not.toContain(">Sections<");
    expect(combined).not.toContain(">Form<");
    expect(combined).not.toContain(">Markdown<");
  });
});
