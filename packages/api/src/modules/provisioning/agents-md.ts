import type { Scope } from "@companyos/db";
import { estimateTokens } from "../usage/service";

export const MANAGED_START = "<!-- companyos:managed:start -->";
export const MANAGED_END = "<!-- companyos:managed:end -->";

export interface ManagedSectionInput {
  scope: Scope;
  children: Scope[];
  companyosUrl?: string;
  mcpPublicUrl?: string;
  tokenEnvVar?: string;
}

export function renderManagedSection(input: ManagedSectionInput): string {
  const baseUrl = (input.companyosUrl || process.env.COMPANYOS_URL || "http://localhost:3000").replace(/\/+$/, "");
  const mcpPublicUrl = (input.mcpPublicUrl || process.env.MCP_PUBLIC_URL || `${baseUrl}/api/mcp`).replace(/\/+$/, "");
  const tokenEnvVar = input.tokenEnvVar || "COMPANYOS_TOKEN";
  const children = input.children
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((child) => `- \`${child.slug}/\` -> \`${child.path}\``)
    .join("\n") || "- (none)";

  return `${MANAGED_START}
## CompanyOS Managed Context

- Scope path: \`${input.scope.path}\`

### MCP Connection
- CompanyOS HTTP endpoint: \`${baseUrl}\`
- MCP_PUBLIC_URL: \`${mcpPublicUrl}\`
- Token env var: \`${tokenEnvVar}\` (if missing or expired, mint at Connect to MCP on this scope's page in the OS)

### Session Start Checklist
1. Call \`whoami\`.
2. Call \`get_context("${input.scope.path}")\`.
3. Call \`recall_memory\` before external research or broad record trawling.
4. Call \`register_session\` before file work so the OS can track active sessions on this scope.
5. Use \`list_credentials\` / \`get_credential\` only when work needs vault values; never store or log retrieved values.
6. If MCP is unreachable or auth fails: STOP and tell the user - never proceed on assumed OS state.

### Folder Guard
- Your cwd must be under \`<workbench.path>\`; if it isn't, stop and ask the user.
- Call \`verify_workbench\` (if available) after \`get_context\` when doing file work.

### Session End / Handover
- Use \`log_change\` incrementally during work; include PR URLs, PR numbers, and commit SHAs when available.
- Call \`complete_session\` on wrap-up for any session registered at start; include PR URLs, PR numbers, and commit SHAs when available.
- On wrap-up, call \`complete_task\` and \`log_decision\` where applicable.
- If the work changed standing truth, update the affected wiki topic page via \`save_doc\` (see docs/patterns/WIKI.md - update in place, cite record ids).
- Durable state lives in the OS, not the chat transcript.

### Git Worktree Convention
- Use one worktree per parallel agent on the same sub-project, named \`<scope-slug>/<session-slug>\`.
- Merge via PR to main.

### Folder Map
${children}

## Memory precedence
- CompanyOS (get_context, list_records, tasks, docs) = authoritative for all
  client/scope facts.
- CompanyOS recall_memory = distilled scope memory and company-wide patterns to check
  before external research or broad record trawling.
- Vendor memory (Claude/OpenAI) = personal preferences only.
- On conflict: follow CompanyOS; log_decision if the OS record should be updated.
- Never assume vendor memory knows the current scope — always call get_context at
  session start.
${MANAGED_END}`;
}

export function estimateManagedSection(input: ManagedSectionInput): { markdown: string; bytes: number; tokensEst: number } {
  const markdown = renderManagedSection(input);
  const estimate = estimateTokens(markdown);
  return { markdown, bytes: estimate.bytes, tokensEst: estimate.tokens };
}

export function applyManagedSection(existingContent: string | null, section: string): string {
  if (existingContent === null) {
    return `# AGENTS.md\n\n${section}\n`;
  }

  const start = existingContent.indexOf(MANAGED_START);
  const end = existingContent.indexOf(MANAGED_END);
  if (start !== -1 && end !== -1 && end > start) {
    const afterEnd = end + MANAGED_END.length;
    return `${existingContent.slice(0, start)}${section}${existingContent.slice(afterEnd)}`;
  }

  const separator = existingContent.endsWith("\n") ? "\n" : "\n\n";
  return `${existingContent}${separator}${section}\n`;
}
