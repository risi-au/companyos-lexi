import { and, eq } from "drizzle-orm";
import { documents, grants, principals } from "@companyos/db";
import type { Document } from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { grantRole } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { saveDoc } from "./service";

const SHIPPED_SOURCE = "- shipped: cos self-docs (CompanyOS 2026-07-12)";
const SELF_DOCS_SYSTEM_ACTOR = "CompanyOS self-docs";

export const COS_ORIENTATION_MD = `CompanyOS is a self-hosted operating record for a business. Work can happen in agents, tools, folders, or external systems, but the durable truth lives in the OS.

## Scope Tree

Every instance has a root scope and a tree below it. Top-level scopes are projects; nested scopes are subprojects. A scope path such as ` + "`indya/marketing/meta-ads`" + ` is the stable address agents and humans use.

## Principals, Grants, And Tokens

Humans and agents are both principals. Access is granted to a principal on a scope with a role: owner, admin, editor, viewer, or agent. Grants apply to the subtree. Tokens belong to principals and authenticate MCP or HTTP API calls.

## Events

Every write emits an append-only event with a type, scope, principal, payload, and timestamp. Events power audit trails, activity feeds, health views, and cross-module reactions.

## Records And Modules

Records capture what happened: changelogs, decisions, reports, and notes. Modules are per-scope surfaces such as Wiki, Work log, Metrics, Canvas, Worker tokens, Platform connections, Tasks, and Setup. Business logic lives in the shared API service layer so the UI and MCP tools see the same behavior.

## Sources

${SHIPPED_SOURCE}`;

export const COS_WIKI_MD = `The Wiki is where CompanyOS keeps the business information that should be true now. Records say what happened; Wiki pages explain the current situation.

## Pages And Past Versions

Each page has a stable address and CompanyOS keeps its past versions automatically. Current pages are updated in place instead of creating duplicates. The main Wiki page is the starting point for a project, and pages can link to related pages.

## Quick Checks

When CompanyOS adds or updates a page, it can show ` + "`Needs a quick check`" + `. A human editor can read it and choose ` + "`Mark as correct`" + `. CompanyOS records that check and keeps the earlier page in Past versions.

## Wiki Notifications

Choose ` + "`Notify me`" + ` on a page to hear about later changes. The button changes to ` + "`Notifications on`" + `, and updates appear in Things to resolve. Later changes are grouped together until the notification is dismissed.

## Personal Wikis And Citations

Humans also have personal wiki scopes for operator preferences and working context. Search, recall, Ask OS, and agent wrap-ups return or store citations that point back to wiki pages and revisions when available.

## Suggested Wiki Updates

Agents and Ask OS suggest changes instead of silently rewriting an existing page. A person can compare the suggestion and choose ` + "`Apply update`" + ` or ` + "`Keep current page`" + `. CompanyOS records the outcome.

## Wiki Health

Wiki health checks can create a ` + "`Wiki question`" + ` when two pages disagree or a page may be out of date. The question shows the current page evidence and a clear outcome. Applying a correction updates one previewed page only; marking a page current requires choosing its next review date.

## Sources

${SHIPPED_SOURCE}`;

export const COS_AGENTS_MD = `Agents connect to CompanyOS through MCP or the HTTP API. They are principals with scoped grants, not privileged side channels.

## MCP Connection

The MCP server is the front door for tools such as Claude Code, Cursor, ChatGPT connectors, n8n, or custom scripts. Remote clients use the ` + "`/api/mcp`" + ` HTTP endpoint with an ` + "`Authorization: Bearer cos_...`" + ` token.

## Starting Context

Agents should start with ` + "`get_context({ scope })`" + `. The context bundle includes identity, scope structure, recent records, tasks, skills, workbench information, and the nearest wiki index when one exists.

## Search, Recall, And Citations

` + "`search`" + ` spans records and docs in the granted scope subtree. ` + "`recall_memory`" + ` returns raw wiki/page snippets from the effective scope, eligible ancestor wiki, root critical facts and patterns, and the actor's personal wiki when present. Hits carry citation fields such as slug, scope path, and revision id when available.

When a person asks about a notification or Wiki question, Ask OS should use ` + "`list_things_to_resolve`" + ` and ` + "`inspect_thing_to_resolve`" + ` first. Inspection returns the question and current linked pages together, so the answer can explain the evidence and available actions with page citations without repeatedly searching.

## Gardening Tools

Agents can save docs, list revisions, revert docs, rename/archive pages, inspect links from other pages, and read the link graph through MCP tools that delegate to the same docs service as the UI.

## Wrap-Ups

Agents should log changes, decisions, reports, notes, metrics, task updates, and session wrap-ups at the scope where work happened. Those writes become records and events the OS can retrieve later.

## Sources

${SHIPPED_SOURCE}`;

export const COS_TOKENS_MD = `Worker tokens are scoped connection tokens for non-human workers. They let an agent or automation connect to CompanyOS without using a human session.

## Where Tokens Are Created

Use the Worker tokens tab on a scope. Authorized users mint a worker token by entering a token name, choosing a role, optionally setting an expiry, and copying the token once into the MCP client or automation.

## Roles And Grants

Worker-token roles are intentionally narrow in the UI: ` + "`agent`" + ` for read/write worker access inside the scope subtree, or ` + "`viewer`" + ` for read-only access. The service layer enforces grants on every call.

## Expiry And Revocation

Tokens can expire and can be revoked. The stored database value is a hash; plaintext is shown only immediately after creation. Revocation affects the next authenticated request.

## Client Configuration

The Worker tokens panel generates ready-to-paste MCP snippets using the public MCP URL. If no public URL is configured, local/dev snippets fall back to ` + "`/api/mcp`" + `.

## Sources

${SHIPPED_SOURCE}`;

export const COS_VAULT_MD = `Platform connection values live in the credential vault. Wiki pages and docs may name credentials, but secret values must not be pasted into markdown, records, chats, tasks, logs, or workbench files.

## Names In Wiki, Values In Vault

Connection docs should use references such as ` + "`{{credential:VPS SSH}}`" + ` to name what an agent needs. The actual password, token, API key, or secret value is stored encrypted in the vault for that scope.

## Agent Read Path

Agents list credential metadata with ` + "`list_credentials`" + ` and fetch a needed value with ` + "`get_credential`" + `. Reads require agent/editor/admin/owner access and are checked by the service layer.

## Audit Events

Creating, updating, reading, and deleting credentials emit credential events. Metadata responses never include plaintext values, ciphertext, IVs, auth tags, passwords, API keys, or tokens.

## Configuration

Vault encryption uses ` + "`COS_VAULT_KEY`" + `. If the key is missing or invalid, the app still boots, but vault reads and writes fail until configured.

## Sources

${SHIPPED_SOURCE}`;

export const COS_ATTENTION_MD = `Things to resolve is where CompanyOS asks a person for a decision or lets them know about an important update.

## What Appears Here

Items include Wiki questions, Suggested Wiki updates, open questions, and Wiki notifications. Each card explains what needs attention and shows actions that match that specific situation.

## Wiki Questions

` + "`Two wiki pages disagree`" + ` shows the two page titles, exact statements, why they conflict, and the result of each correction. Choose ` + "`Apply this correction`" + ` only after reviewing the preview, or choose ` + "`Not a conflict`" + ` and briefly explain why both statements can be correct. ` + "`This page may be out of date`" + ` can be opened for review or marked current with a future review date.

Older Wiki questions may not contain enough evidence. They can only be closed as unclear and never change a page.

## Suggested Wiki Updates

Suggested Wiki updates use ` + "`Apply update`" + ` and ` + "`Keep current page`" + `. Applying an update saves the page through the same Wiki service and records the decision.

## Notifications On

Wiki notifications appear only for the person who chose ` + "`Notify me`" + `. They link back to the changed page and can be dismissed after they are read.

## Decision Records

Every outcome writes a durable history entry. When a Wiki page is involved, the history links back to that page without showing internal record ids or audit hashes in the main explanation.

## Sources

${SHIPPED_SOURCE}`;

export const COS_SELF_DOCS = [
  { slug: "cos-orientation", title: "CompanyOS orientation", bodyMd: COS_ORIENTATION_MD },
  { slug: "cos-wiki", title: "CompanyOS wiki", bodyMd: COS_WIKI_MD },
  { slug: "cos-agents", title: "CompanyOS agents", bodyMd: COS_AGENTS_MD },
  { slug: "cos-tokens", title: "CompanyOS worker tokens", bodyMd: COS_TOKENS_MD },
  { slug: "cos-vault", title: "CompanyOS platform connections vault", bodyMd: COS_VAULT_MD },
  { slug: "cos-attention", title: "CompanyOS things to resolve", bodyMd: COS_ATTENTION_MD },
] as const;

async function ensureSelfDocsActor(db: DB): Promise<string> {
  const [existing] = (await db
    .select({ id: principals.id })
    .from(principals)
    .where(eq(principals.name, SELF_DOCS_SYSTEM_ACTOR))
    .limit(1)) as Array<{ id: string }>;
  if (existing) return existing.id;

  const [created] = (await db
    .insert(principals)
    .values({ kind: "agent", name: SELF_DOCS_SYSTEM_ACTOR, status: "active" })
    .returning({ id: principals.id })) as Array<{ id: string }>;
  if (!created) throw new Error("Failed to create self-docs actor");

  await emitEvent(db, {
    type: "principal.created",
    scopePath: "root",
    principalId: created.id,
    payload: { principalId: created.id, kind: "agent", name: SELF_DOCS_SYSTEM_ACTOR },
  });
  return created.id;
}

async function ensureRootGrant(db: DB, principalId: string): Promise<void> {
  const root = await getScope(db, "root");
  if (!root) throw new Error("Root scope is required before self-doc seeding");

  const [existing] = (await db
    .select({ id: grants.id })
    .from(grants)
    .where(and(eq(grants.principalId, principalId), eq(grants.scopeId, root.id)))
    .limit(1)) as Array<{ id: string }>;
  if (existing) return;

  // editor, NOT admin/agent: an agent-kind principal with a root admin|agent grant
  // matches the personal-wiki mediation carve-out (resolveAccess) reserved for the
  // brain — this actor must never gain personal-scope access.
  await grantRole(db, { principalId, scopePath: "root", role: "editor" }, null);
}

export async function ensureSelfDocs(db: DB): Promise<{ created: string[] }> {
  const root = await getScope(db, "root");
  if (!root) return { created: [] };

  const existingRows = (await db
    .select({ slug: documents.slug })
    .from(documents)
    .where(eq(documents.scopeId, root.id))) as Array<Pick<Document, "slug">>;
  const existingSlugs = new Set(existingRows.map((row) => row.slug));
  const missing = COS_SELF_DOCS.filter((page) => !existingSlugs.has(page.slug));
  if (missing.length === 0) return { created: [] };

  const actor = await ensureSelfDocsActor(db);
  await ensureRootGrant(db, actor);

  const created: string[] = [];
  for (const page of missing) {
    await saveDoc(db, { scopePath: "root", slug: page.slug, title: page.title, bodyMd: page.bodyMd }, actor);
    created.push(page.slug);
  }
  return { created };
}
