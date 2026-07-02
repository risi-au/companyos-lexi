import {
  getScope,
  getChildren,
  listModules,
  listRecords,
  emitEvent,
  type DB,
} from "./index";
import { ScopeNotFoundError } from "./errors";
import { createHmac, timingSafeEqual } from "crypto";

/* eslint-disable @typescript-eslint/no-explicit-any */

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

/**
 * Returns the same markdown context bundle as MCP get_context tool.
 * Requires viewer on the scope.
 */
export async function getContextBundle(
  db: DB,
  scopePath: string,
  actorPrincipalId: string
): Promise<string> {
  const sc = await getScope(db, scopePath);
  if (!sc) {
    throw new ScopeNotFoundError(scopePath);
  }

  // Access checked downstream
  const mods = await listModules(db, scopePath, actorPrincipalId);
  const children = await getChildren(db, scopePath);
  const childPaths = children.map((c: any) => c.path).join("\n");

  const recentCh = await listRecords(db, { scopePath, kind: "changelog", limit: 10 }, actorPrincipalId);
  const recentDec = await listRecords(db, { scopePath, kind: "decision", limit: 10 }, actorPrincipalId);
  const combined = [...recentCh, ...recentDec]
    .sort((a: any, b: any) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))
    .slice(0, 10);

  let recordsMd = "";
  for (const r of combined) {
    const bodyStart = (r.bodyMd || "").slice(0, 200).replace(/\n/g, " ");
    const date = formatDate(r.createdAt);
    recordsMd += `- [${r.kind}] ${r.title} (${date})\n  ${bodyStart}${ (r.bodyMd || "").length > 200 ? "..." : "" }\n`;
  }
  if (!recordsMd) recordsMd = "(no recent changelog/decision records)\n";

  const moduleList = mods.length
    ? mods.map((m: any) => `- ${m.moduleType}`).join("\n")
    : "(none attached)";

  const md = `# Context for ${scopePath}

**Identity**
- name: ${sc.name}
- path: ${sc.path}
- type: ${sc.type}
- status: ${sc.status}

**Modules**
${moduleList}

**Children**
${childPaths || "(none)"}

**Recent changelog/decision records (last 10)**
${recordsMd}
Use list_records / get_record for full history and other kinds.
`;

  return md;
}

export interface ReportCapabilityRunInput {
  scopePath?: string | null;
  capability: string;
  status?: string;
  summary?: string;
  runId?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export async function reportCapabilityRun(
  db: DB,
  input: ReportCapabilityRunInput,
  actorPrincipalId: string
): Promise<void> {
  const { scopePath, capability, ...rest } = input;
  const payload = {
    capability,
    ...rest,
    reportedAt: new Date().toISOString(),
  };

  await emitEvent(db, {
    type: "capability.run_reported",
    scopePath: scopePath || null,
    principalId: actorPrincipalId,
    payload,
  });
}

/**
 * Verifies Plane X-Plane-Signature using raw body text (per current docs/examples).
 */
export function verifyPlaneWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}
