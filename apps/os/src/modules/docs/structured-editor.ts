export interface ParsedFrontmatter {
  body: string;
  metadata: Record<string, string>;
  raw: string | null;
}

export interface SplitSourcesResult {
  body: string;
  sources: string | null;
  count: number;
}

export type StructuredSection =
  | {
      id: string;
      kind: "section";
      title: string;
      content: string;
      headingPrefix: string;
      lineEnding: string;
    }
  | {
      id: string;
      kind: "markdown";
      content: string;
    };

export interface StructuredDocForm {
  title: string;
  aliases: string[];
  originalAliases: string[];
  definition: string;
  details: string;
  introPrefix: string;
  definitionDetailsSeparator: string;
  frontmatterRaw: string | null;
  sections: StructuredSection[];
  trailingNewline: boolean;
}

export interface MarkdownOutlineItem {
  level: 2 | 3;
  title: string;
  id: string;
}

export interface KnownWikiPage {
  scopePath: string;
  slug: string;
}

const WIKILINK_REGEX = /\[\[([^\]\n]+)\]\]/g;

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function splitFrontmatterContent(raw: string): string {
  return raw
    .replace(/^---\r?\n/, "")
    .replace(/\r?\n---(?:\r?\n|$)/, "");
}

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const normalized = markdown.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { body: markdown, metadata: {}, raw: null };
  }

  const metadata: Record<string, string> = {};
  const lines = match[1]!.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const pair = lines[i]!.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!pair) continue;
    const key = pair[1]!;
    const rawValue = pair[2]!;
    if (!rawValue) {
      const items: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const item = lines[j]!.match(/^\s*-\s+(.+?)\s*$/);
        if (!item) break;
        items.push(stripQuotes(item[1]!));
        i = j;
      }
      if (items.length > 0) metadata[key] = items.join(", ");
      continue;
    }
    const value = stripQuotes(rawValue);
    if (value) metadata[key] = value;
  }

  return { body: normalized.slice(match[0].length), metadata, raw: match[0] };
}

export function reattachFrontmatter(frontmatterRaw: string | null, body: string): string {
  if (!frontmatterRaw) return body;
  return frontmatterRaw + body;
}

export function parseAliasList(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  const unwrapped = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  return unwrapped
    .split(",")
    .map((part) => stripQuotes(part))
    .map((part) => part.trim())
    .filter(Boolean);
}

export function aliasesFromFrontmatter(markdown: string): string[] {
  const parsed = parseFrontmatter(markdown);
  if (!parsed.raw) return [];
  const content = splitFrontmatterContent(parsed.raw);
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const pair = lines[i]!.match(/^aliases:\s*(.*?)\s*$/);
    if (!pair) continue;
    if (pair[1]) return parseAliasList(pair[1]);
    const items: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const item = lines[j]!.match(/^\s*-\s+(.+?)\s*$/);
      if (!item) break;
      items.push(stripQuotes(item[1]!));
    }
    return items;
  }
  return [];
}

function yamlListItem(value: string): string {
  const safe = /^[A-Za-z0-9 _./:-]+$/.test(value);
  return safe ? value : JSON.stringify(value);
}

function removeFrontmatterKey(lines: string[], key: string): string[] {
  const next: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const pair = line.match(/^([A-Za-z0-9_-]+):/);
    if (pair?.[1] !== key) {
      next.push(line);
      continue;
    }

    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*-\s+/.test(lines[j]!)) {
        i = j;
        continue;
      }
      break;
    }
  }
  return next;
}

export function updateFrontmatterList(markdown: string, key: string, values: string[]): string {
  const parsed = parseFrontmatter(markdown);
  const existingLines = parsed.raw ? splitFrontmatterContent(parsed.raw).split(/\r?\n/) : [];
  const lines = removeFrontmatterKey(existingLines, key).filter((line, index, all) => {
    if (line.trim()) return true;
    return index > 0 && index < all.length - 1;
  });
  const cleanValues = values.map((value) => value.trim()).filter(Boolean);

  if (cleanValues.length > 0) {
    lines.push(`${key}:`);
    for (const value of cleanValues) {
      lines.push(`  - ${yamlListItem(value)}`);
    }
  }

  if (lines.length === 0) return parsed.body;
  return `---\n${lines.join("\n")}\n---\n${parsed.body}`;
}

export function splitTrailingSources(markdown: string): SplitSourcesResult {
  const matches = Array.from(markdown.matchAll(/^##\s+Sources\s*$/gim));
  const last = matches.at(-1);
  if (!last || last.index === undefined) {
    return { body: markdown, sources: null, count: 0 };
  }

  const before = markdown.slice(0, last.index).trimEnd();
  const sources = markdown.slice(last.index).replace(/^##\s+Sources\s*$/im, "").trim();
  if (!sources) {
    return { body: before, sources: null, count: 0 };
  }

  const listItems = sources
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^([-*]|\d+\.)\s+/.test(line));
  const count = listItems.length || sources.split(/\r?\n+/).filter((line) => line.trim()).length;

  return { body: before, sources, count };
}

function isFenceLine(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

function h2HeadingStarts(markdown: string): number[] {
  const starts: number[] = [];
  let offset = 0;
  let fenced = false;
  for (const line of markdown.matchAll(/.*(?:\r?\n|$)/g)) {
    const text = line[0];
    if (!text) break;
    if (isFenceLine(text)) fenced = !fenced;
    if (!fenced && /^##\s+.+/.test(text)) starts.push(offset);
    offset += text.length;
  }
  return starts;
}

function splitIntro(intro: string): {
  introPrefix: string;
  definition: string;
  details: string;
  definitionDetailsSeparator: string;
} {
  const prefix = intro.match(/^(?:[ \t]*(?:\r?\n|$))*/)?.[0] ?? "";
  const rest = intro.slice(prefix.length);
  if (!rest) {
    return { introPrefix: prefix, definition: "", details: "", definitionDetailsSeparator: "" };
  }

  const separator = rest.match(/\r?\n[ \t]*\r?\n/);
  if (!separator || separator.index === undefined) {
    return {
      introPrefix: prefix,
      definition: rest,
      details: "",
      definitionDetailsSeparator: "",
    };
  }

  const separatorStart = separator.index;
  const separatorText = separator[0];
  return {
    introPrefix: prefix,
    definition: rest.slice(0, separatorStart),
    details: rest.slice(separatorStart + separatorText.length),
    definitionDetailsSeparator: separatorText,
  };
}

function hasUnsupportedFormMarkdown(markdown: string): boolean {
  let fenced = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (isFenceLine(line)) fenced = !fenced;
    if (fenced) continue;
    if (/^###\s+/.test(line)) return true;
    if (/<[A-Za-z][\s\S]*?>/.test(line)) return true;
  }
  return fenced;
}

function parseSection(raw: string, index: number): StructuredSection {
  const heading = raw.match(/^(##[ \t]+)(.*?)(\r?\n|$)/);
  if (!heading || hasUnsupportedFormMarkdown(raw.slice(heading[0].length))) {
    return { id: `markdown-${index}`, kind: "markdown", content: raw };
  }
  return {
    id: `section-${index}`,
    kind: "section",
    title: heading[2]!,
    content: raw.slice(heading[0].length),
    headingPrefix: heading[1]!,
    lineEnding: heading[3] || "\n",
  };
}

export function parseStructuredMarkdown(title: string, markdown: string): StructuredDocForm {
  const parsed = parseFrontmatter(markdown);
  const body = parsed.body;
  const starts = h2HeadingStarts(body);
  const introEnd = starts[0] ?? body.length;
  const intro = splitIntro(body.slice(0, introEnd));
  const sections = starts.map((start, index) => {
    const end = starts[index + 1] ?? body.length;
    return parseSection(body.slice(start, end), index);
  });
  const aliases = aliasesFromFrontmatter(markdown);

  return {
    title,
    aliases,
    originalAliases: aliases,
    definition: intro.definition,
    details: intro.details,
    introPrefix: intro.introPrefix,
    definitionDetailsSeparator: intro.definitionDetailsSeparator,
    frontmatterRaw: parsed.raw,
    sections,
    trailingNewline: body.endsWith("\n"),
  };
}

function aliasesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function serializeStructuredMarkdown(form: StructuredDocForm): string {
  const introHasDetails = form.details.length > 0 || form.definitionDetailsSeparator.length > 0;
  let body = `${form.introPrefix}${form.definition}`;
  if (introHasDetails) {
    body += `${form.definitionDetailsSeparator || "\n\n"}${form.details}`;
  }

  for (const section of form.sections) {
    if (section.kind === "markdown") {
      if (body && !body.endsWith("\n\n") && !section.content.startsWith("\n")) body += "\n\n";
      body += section.content;
      continue;
    }
    if (body && !body.endsWith("\n\n")) body += body.endsWith("\n") ? "\n" : "\n\n";
    body += `${section.headingPrefix}${section.title}${section.lineEnding}${section.content}`;
  }

  if (form.trailingNewline && body && !body.endsWith("\n")) body += "\n";

  const withFrontmatter = reattachFrontmatter(form.frontmatterRaw, body);
  return aliasesEqual(form.aliases, form.originalAliases)
    ? withFrontmatter
    : updateFrontmatterList(withFrontmatter, "aliases", form.aliases);
}

export function slugifyHeading(input: string): string {
  return (input || "section")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

export function extractMarkdownOutline(markdown: string): MarkdownOutlineItem[] {
  const { body } = parseFrontmatter(markdown);
  const outline: MarkdownOutlineItem[] = [];
  let fenced = false;
  for (const line of body.split(/\r?\n/)) {
    if (isFenceLine(line)) fenced = !fenced;
    if (fenced) continue;
    const heading = line.match(/^(##|###)\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const title = heading[2]!.trim();
    outline.push({
      level: heading[1] === "###" ? 3 : 2,
      title,
      id: slugifyHeading(title),
    });
  }
  return outline;
}

export function normalizeWikiSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseWikilinkTarget(raw: string): { label: string | null; scopePath: string | null; slug: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const pipe = trimmed.lastIndexOf("|");
  const label = pipe > -1 ? trimmed.slice(0, pipe).trim() : null;
  const target = pipe > -1 ? trimmed.slice(pipe + 1).trim() : trimmed;
  const colon = target.lastIndexOf(":");
  const scopePath = colon > 0 ? target.slice(0, colon).trim() : null;
  const slug = normalizeWikiSlug(colon > 0 ? target.slice(colon + 1) : target);
  if (!slug) return null;
  return { label: label || null, scopePath: scopePath || null, slug };
}

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

function scopeHref(scopePath: string): string {
  return scopePath.split("/").map(encodeURIComponent).join("/");
}

export function wikilinksToMarkdown(markdown: string, currentScopePath: string, knownPages?: KnownWikiPage[]): string {
  const known = knownPages
    ? new Set(knownPages.map((page) => `${page.scopePath}:${page.slug}`))
    : null;

  let fenced = false;
  return markdown
    .split(/(\r?\n)/)
    .map((part) => {
      if (/^\r?\n$/.test(part)) return part;
      if (isFenceLine(part)) fenced = !fenced;
      if (fenced) return part;
      return part.replace(WIKILINK_REGEX, (_, raw: string) => {
        const parsed = parseWikilinkTarget(raw);
        if (!parsed) return `[[${raw}]]`;
        const targetScope = parsed.scopePath ?? currentScopePath;
        const href = `/s/${scopeHref(targetScope)}?tab=docs&doc=${encodeURIComponent(parsed.slug)}`;
        const rawTargetLabel = raw.lastIndexOf(":") > 0 ? raw.slice(raw.lastIndexOf(":") + 1).trim() : raw.trim();
        const label = parsed.label || rawTargetLabel || parsed.slug;
        const missing = known ? !known.has(`${targetScope}:${parsed.slug}`) : false;
        const title = missing ? ' "missing-wikilink"' : "";
        return `[${escapeMarkdownLinkText(label)}](${href}${title})`;
      });
    })
    .join("");
}
