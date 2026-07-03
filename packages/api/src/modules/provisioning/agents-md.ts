import type { Scope } from "@companyos/db";

export const MANAGED_START = "<!-- companyos:managed:start -->";
export const MANAGED_END = "<!-- companyos:managed:end -->";

export interface ManagedSectionInput {
  scope: Scope;
  children: Scope[];
  companyosUrl?: string;
  tokenEnvVar?: string;
}

export function renderManagedSection(input: ManagedSectionInput): string {
  const baseUrl = (input.companyosUrl || process.env.COMPANYOS_URL || "http://localhost:3000").replace(/\/+$/, "");
  const tokenEnvVar = input.tokenEnvVar || "COMPANYOS_TOKEN";
  const children = input.children
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((child) => `- \`${child.slug}/\` -> \`${child.path}\``)
    .join("\n") || "- (none)";

  return `${MANAGED_START}
## CompanyOS Managed Context

- Scope path: \`${input.scope.path}\`
- CompanyOS HTTP endpoint: \`${baseUrl}\`
- CompanyOS MCP endpoint: \`${baseUrl}/api/mcp\`
- Token env var: \`${tokenEnvVar}\`

### Folder Map
${children}
${MANAGED_END}`;
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
