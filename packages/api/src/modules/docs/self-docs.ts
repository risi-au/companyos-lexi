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

export const COS_WIKI_MD = `The wiki is the current-truth layer built on top of markdown docs. Records say what happened; wiki pages say what is true now.

## Pages And Revisions

Wiki pages are ordinary docs with stable slugs and automatic revisions. Maintained pages are updated in place instead of creating duplicates. The ` + "`wiki`" + ` page is the index for a scope wiki, and topic pages link with ` + "`[[slug]]`" + ` or ` + "`[[scope-path:slug]]`" + `.

## Verification And Unreviewed Pages

Agent-authored pages can be listed as unreviewed until a human editor verifies them. Verification writes frontmatter metadata and a revision, so the markdown body remains the canonical source.

## Following And Notifications

Humans can follow pages. Human authors and verifiers auto-follow pages they create or verify. Changes to a followed page create a targeted Things to resolve item in the Following section; later changes coalesce until dismissed.

## Personal Wikis And Citations

Humans also have personal wiki scopes for operator preferences and working context. Search, recall, Ask OS, and agent wrap-ups return or store citations that point back to wiki pages and revisions when available.

## Attention Proposals

Task agents and Ask OS use attention items for wiki proposals instead of directly rewriting existing pages. Approving a proposal applies the markdown through the docs service and records the durable decision trail.

## Sources

${SHIPPED_SOURCE}`;

export const COS_AGENTS_MD = `Agents connect to CompanyOS through MCP or the HTTP API. They are principals with scoped grants, not privileged side channels.

## MCP Connection

The MCP server is the front door for tools such as Claude Code, Cursor, ChatGPT connectors, n8n, or custom scripts. Remote clients use the ` + "`/api/mcp`" + ` HTTP endpoint with an ` + "`Authorization: Bearer cos_...`" + ` token.

## Starting Context

Agents should start with ` + "`get_context({ scope })`" + `. The context bundle includes identity, scope structure, recent records, tasks, skills, workbench information, and the nearest wiki index when one exists.

## Search, Recall, And Citations

` + "`search`" + ` spans records and docs in the granted scope subtree. ` + "`recall_memory`" + ` returns raw wiki/page snippets from the effective scope, eligible ancestor wiki, root critical facts and patterns, and the actor's personal wiki when present. Hits carry citation fields such as slug, scope path, and revision id when available.

## Gardening Tools

Agents can save docs, list revisions, revert docs, rename/archive pages, inspect backlinks, and read the link graph through MCP tools that delegate to the same docs service as the UI.

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

export const COS_ATTENTION_MD = `Things to resolve is the human-resolution queue for CompanyOS. It is backed by generic attention items and is used anywhere the OS needs a person to approve, reject, or dismiss something.

## Item Kinds

Attention items cover wiki proposals, lint findings, graduation suggestions, external gates, and followed-page updates. Each item stores a kind, status, title, summary, payload, scope, creator, and optional target principal.

## Approve, Reject, Dismiss

Approval items require admin or owner access to resolve. Approving a wiki proposal saves the proposed markdown through the docs service. Rejecting or dismissing closes the item with an event and decision trail where applicable.

## Following Section

Followed-page updates are targeted notifications. They appear only for the follower, can only be dismissed by that follower, and do not expose approve or reject actions.

## Decision Records

Resolution of approval-style items writes the durable trail. When a wiki page is involved, the decision body links the page with a wikilink so backlinks preserve the relationship.

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