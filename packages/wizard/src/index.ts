import { z } from "zod";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ])
);

const requiredCredentialSchema = z.object({
  name: z.string().default(""),
  whatFor: z.string().default(""),
  loginMethodNotes: z.string().default(""),
});

const externalSystemSchema = z.object({
  name: z.string().default(""),
  purpose: z.string().default(""),
  notes: z.string().default(""),
});

export const intakePacketSchema = z.object({
  packet_md: z.string().min(1, "packet_md is required"),
  research_sources: z.union([z.array(jsonValueSchema), z.record(jsonValueSchema)]).default([]),
  proposed_provision_spec: z.record(jsonValueSchema).default({}),
  proposed_docs: z.union([z.array(jsonValueSchema), z.record(jsonValueSchema)]).default([]),
  proposed_tasks: z.union([z.array(jsonValueSchema), z.record(jsonValueSchema)]).default([]),
  proposed_wiki_updates: z.union([z.array(jsonValueSchema), z.record(jsonValueSchema)]).default([]),
  required_credentials: z.array(requiredCredentialSchema).default([]),
  external_systems: z.array(externalSystemSchema).default([]),
  open_questions: z.union([z.array(jsonValueSchema), z.record(jsonValueSchema)]).default([]),
  risk_notes: z.union([z.array(jsonValueSchema), z.record(jsonValueSchema)]).default([]),
  source_engine: z.string().optional(),
  source_model: z.string().optional(),
}).passthrough();

export type IntakePacketPayload = z.infer<typeof intakePacketSchema>;

export type ParsedPastePacket =
  | { ok: true; markdownOnly: boolean; packet: IntakePacketPayload }
  | { ok: false; errors: string[] };

function lastJsonFence(markdown: string): string | null {
  const regex = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  let found: string | null = null;
  while ((match = regex.exec(markdown)) !== null) {
    found = match[1]?.trim() ?? "";
  }
  return found;
}

function zodErrors(error: z.ZodError): string[] {
  return error.issues.map((issue: z.ZodIssue) => {
    const path = issue.path.length ? issue.path.join(".") : "packet";
    return `${path}: ${issue.message}`;
  });
}

export function parsePastedIntakePacket(input: string): ParsedPastePacket {
  const text = input.trim();
  if (!text) {
    return { ok: false, errors: ["Paste is empty"] };
  }

  const fenced = lastJsonFence(text);
  if (fenced === null) {
    return {
      ok: true,
      markdownOnly: true,
      packet: {
        packet_md: text,
        research_sources: [],
        proposed_provision_spec: {},
        proposed_docs: [],
        proposed_tasks: [],
        proposed_wiki_updates: [],
        required_credentials: [],
        external_systems: [],
        open_questions: [],
        risk_notes: [],
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced);
  } catch (error) {
    return {
      ok: false,
      errors: [`json: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const result = intakePacketSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, errors: zodErrors(result.error) };
  }
  return { ok: true, markdownOnly: false, packet: result.data };
}

export interface WizardTemplate {
  slug: string;
  title: string;
  kind: "framing" | "interview";
  appliesTo: "project" | "sub-scope" | "any";
  version: string;
  domains: string[];
  sections: Record<string, string>;
  body: string;
}

export interface ParsedWizardTemplate {
  ok: boolean;
  template?: WizardTemplate;
  errors: string[];
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map(parseScalar).filter(Boolean);
}

function parseFrontmatter(body: string): Record<string, string | string[]> {
  if (!body.startsWith("---")) return {};
  const lines = body.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return {};

  const meta: Record<string, string | string[]> = {};
  for (let i = 1; i < end; i += 1) {
    const line = lines[i] ?? "";
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    const value = match[2] ?? "";
    if (key === "domains") {
      meta.domains = parseInlineList(value);
    } else {
      meta[key] = parseScalar(value);
    }
  }
  return meta;
}

export function bodyWithoutFrontmatter(body: string): string {
  if (!body.startsWith("---")) return body;
  const end = body.indexOf("\n---", 3);
  if (end === -1) return body;
  const after = body.indexOf("\n", end + 4);
  return after === -1 ? "" : body.slice(after + 1);
}

function parseSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let current = "body";
  let buffer: string[] = [];
  const flush = () => {
    sections[current] = buffer.join("\n").trim();
    buffer = [];
  };
  for (const line of lines) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      current = heading[1]!.trim().toLowerCase();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

export function parseWizardTemplateMarkdown(markdown: string): ParsedWizardTemplate {
  const errors: string[] = [];
  const meta = parseFrontmatter(markdown);
  const slug = typeof meta.slug === "string" ? meta.slug.trim() : "";
  const title = typeof meta.title === "string" ? meta.title.trim() : "";
  const kind = typeof meta.kind === "string" ? meta.kind.trim() : "";
  const appliesTo = typeof meta.applies_to === "string" ? meta.applies_to.trim() : "any";
  const version = typeof meta.version === "string" ? meta.version.trim() : "1";
  const domains = Array.isArray(meta.domains) ? meta.domains : [];

  if (!/^[a-z0-9-]+$/.test(slug)) errors.push("frontmatter.slug must be kebab-case");
  if (!title) errors.push("frontmatter.title is required");
  if (kind !== "framing" && kind !== "interview") errors.push("frontmatter.kind must be framing or interview");
  if (appliesTo !== "project" && appliesTo !== "sub-scope" && appliesTo !== "any") {
    errors.push("frontmatter.applies_to must be project, sub-scope, or any");
  }

  const content = bodyWithoutFrontmatter(markdown);
  const sections = parseSections(content);
  if (kind === "framing" && !sections["framing questions"]) {
    errors.push("framing templates need a ## Framing questions section");
  }
  if (kind === "interview" && !sections["interview guide"]) {
    errors.push("interview templates need a ## Interview guide section");
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    template: {
      slug,
      title,
      kind: kind as "framing" | "interview",
      appliesTo: appliesTo as "project" | "sub-scope" | "any",
      version,
      domains,
      sections,
      body: markdown,
    },
  };
}

export interface FramingQuestion {
  key: string;
  question: string;
}

export function parseFramingQuestions(markdown: string): FramingQuestion[] {
  const parsed = parseWizardTemplateMarkdown(markdown);
  const section = parsed.template?.sections["framing questions"] ?? parseSections(markdown)["framing questions"] ?? "";
  return section
    .split(/\r?\n/)
    .map((line) => /^-\s*([A-Za-z0-9_-]+):\s*(.+?)\s*$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => !!match)
    .map((match) => ({ key: match[1]!, question: match[2]! }));
}

export const INTAKE_PACKET_SCHEMA_MARKDOWN = `The final answer must end with one fenced json block:

\`\`\`json
{
  "packet_md": "Markdown summary with facts separated from assumptions.",
  "research_sources": [],
  "proposed_provision_spec": {},
  "proposed_docs": [],
  "proposed_tasks": [],
  "proposed_wiki_updates": [],
  "required_credentials": [{ "name": "Credential name only", "whatFor": "Why agents need it", "loginMethodNotes": "Who holds it or how access is normally granted; no secret values" }],
  "external_systems": [{ "name": "System name", "purpose": "What it is used for", "notes": "Existing state, owners, or setup notes" }],
  "open_questions": [],
  "risk_notes": [],
  "source_engine": "optional",
  "source_model": "optional"
}
\`\`\``;

export interface ExternalPackInput {
  intakeId: string;
  scopePath: string;
  scopeName?: string;
  briefing: string;
  templateBody: string;
  answers: unknown;
  structuralContext?: string | null;
  reason?: string | null;
  relatedHistory?: Array<{
    type: "record" | "doc";
    id: string;
    title: string;
    scopePath: string;
    snippet: string;
    kind?: string;
    slug?: string;
  }>;
  reusePatterns?: Array<{
    slug: string;
    title: string;
    summary: string;
    reusable: boolean;
    sourceScopePath: string | null;
    sourceVisible: boolean;
  }>;
  acceptedPattern?: string | null;
  mcpToolName?: string;
}

export function assembleExternalPack(input: ExternalPackInput): { pasteBack: string; mcp: string } {
  const answersJson = JSON.stringify(input.answers ?? {}, null, 2);
  const structural = input.structuralContext?.trim() || "(no structural context available)";
  const history = input.relatedHistory?.length
    ? input.relatedHistory.map((hit, index) => `${index + 1}. [${hit.type}${hit.kind ? `:${hit.kind}` : ""}] ${hit.title}
   id: ${hit.id}${hit.slug ? `; slug: ${hit.slug}` : ""}
   scope: ${hit.scopePath}
   snippet: ${hit.snippet || "(no snippet)"}`).join("\n\n")
    : "(no related history selected)";
  const similar = input.reusePatterns?.length
    ? input.reusePatterns.slice(0, 3).map((pattern, index) => `${index + 1}. ${pattern.title} (${pattern.slug})
   ${pattern.summary || "No summary available."}
   source: ${pattern.sourceScopePath && pattern.sourceVisible ? pattern.sourceScopePath : "pattern library"}
   ${pattern.reusable ? "Contains reusable provision/doc/task seeds. Adapt, don't copy." : "Reference only."}`).join("\n\n")
    : "(no similar work found)";
  const accepted = input.acceptedPattern
    ? `\n\nAccepted pattern: ${input.acceptedPattern}. Use its provision/doc/task seeds as a starting point. Adapt, don't copy.`
    : "";
  const base = `# CompanyOS Scope Intake

Intake id: ${input.intakeId}
Scope path: ${input.scopePath}
${input.scopeName ? `Scope name: ${input.scopeName}\n` : ""}

CompanyOS is authoritative. Fill this intake for the existing scope only; do not propose new CompanyOS scope structure unless the provision spec explicitly asks for child scopes.

## Briefing

${input.briefing.trim()}

## Structural Context

${structural}

## Reason and Framing

Reason, verbatim:

${input.reason?.trim() || "(no reason captured)"}

Framing answers:

\`\`\`json
${answersJson}
\`\`\`

## Lead-History Digest

${history}

## Similar Work

${similar}${accepted}

## Interview Template

${input.templateBody.trim()}

## Packet Schema

${INTAKE_PACKET_SCHEMA_MARKDOWN}
`;

  return {
    pasteBack: `${base}\nWhen finished, paste the complete markdown answer back into CompanyOS and end with the fenced json packet.`,
    mcp: `${base}\nWhen finished, use CompanyOS MCP for more context when needed: call get_context for scope "${input.scopePath}" and search for older docs/records. Then call ${input.mcpToolName ?? "submit_intake_packet"} with intake_id "${input.intakeId}".`,
  };
}
