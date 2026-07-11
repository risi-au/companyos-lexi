import { and, desc, eq, inArray, isNull, like, ne, or, sql } from "drizzle-orm";
import { documents, documentRevisions, embeddings, grants, scopes } from "@companyos/db";
import { AccessDeniedError, ScopeNotFoundError } from "../../errors";
import { type DB } from "../../kernel/events";
import { resolveAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { getPersonalScopePath } from "../../kernel/personal-path";
import { embedQuery, embeddingsConfigured, toVectorSql } from "../../lib/embeddings";
import { estimateTokens, logUsageEventSafely } from "../usage/service";

export interface RecallMemoryInput {
  query: string;
  scopePath?: string | null;
  limit?: number;
}

export type Citation = {
  slug: string;
  scopePath: string;
  revisionId?: string;
  source: "scope" | "ancestor" | "root-pattern" | "critical-facts" | "personal";
  title?: string;
};

export interface RecallMemoryHit {
  type: "page";
  id: string;
  slug: string;
  title: string;
  scopePath: string;
  revisionId: string | null;
  source: "scope" | "ancestor" | "root-pattern" | "critical-facts" | "personal";
  updatedAt: Date;
  snippet: string;
  confidence: string | number | null;
  frontmatter: Record<string, string | number | boolean>;
}

interface ActorGrant {
  scopePath: string;
  role: string;
}

type CandidateMemoryHit = RecallMemoryHit & { rank: number; retrieval: "keyword" | "semantic" };

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

function effectiveLimit(limit?: number): number {
  return Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT);
}

function canReadRole(role: string | null): boolean {
  return role === "owner" || role === "admin" || role === "editor" || role === "agent" || role === "viewer";
}

function isSameOrDescendant(path: string, ancestor: string): boolean {
  return ancestor === "root" || path === ancestor || path.startsWith(`${ancestor}/`);
}

function isAncestorOrSame(path: string, descendant: string): boolean {
  return path === "root" || descendant === path || descendant.startsWith(`${path}/`);
}

function subtreeCondition(scopePath: string) {
  return scopePath === "root"
    ? and(like(scopes.path, "%"), ne(scopes.type, "personal"))
    : or(eq(scopes.path, scopePath), like(scopes.path, `${scopePath}/%`));
}

function ancestorPaths(scopePath: string): string[] {
  if (scopePath === "root") return ["root"];
  const parts = scopePath.split("/").filter(Boolean);
  return [...parts.map((_, idx) => parts.slice(0, parts.length - idx).join("/")), "root"];
}

async function findNearestWikiScopePath(db: DB, scopePath: string): Promise<string | null> {
  const candidates = ancestorPaths(scopePath);
  const rows = (await db
    .select({ scopePath: scopes.path })
    .from(scopes)
    .innerJoin(documents, eq(documents.scopeId, scopes.id))
    .where(and(inArray(scopes.path, candidates), eq(documents.slug, "wiki"), isNull(documents.archivedAt)))) as Array<{ scopePath: string }>;

  for (const candidate of candidates) {
    if (rows.some((row) => row.scopePath === candidate)) return candidate;
  }
  return null;
}

async function actorDirectGrants(db: DB, actorPrincipalId: string): Promise<ActorGrant[]> {
  return (await db
    .select({
      scopePath: scopes.path,
      role: grants.role,
    })
    .from(grants)
    .innerJoin(scopes, eq(grants.scopeId, scopes.id))
    .where(eq(grants.principalId, actorPrincipalId))
    .orderBy(scopes.path)) as ActorGrant[];
}

async function resolveEffectiveScope(db: DB, requestedScopePath: string | null, actorPrincipalId: string): Promise<string> {
  const requested = requestedScopePath?.trim() || null;

  if (requested) {
    const scope = await getScope(db, requested);
    if (!scope) throw new ScopeNotFoundError(requested);

    const directRole = await resolveAccess(db, actorPrincipalId, requested);
    if (canReadRole(directRole)) return requested;

    const narrower = (await actorDirectGrants(db, actorPrincipalId))
      .filter((grant) => canReadRole(grant.role) && isSameOrDescendant(grant.scopePath, requested));
    if (narrower.length === 1) return narrower[0]!.scopePath;
    if (narrower.length > 1) {
      throw new Error("multiple narrower grants found for requested scope; pass a more specific scopePath");
    }
    return requested;
  }

  const rootRole = await resolveAccess(db, actorPrincipalId, "root");
  if (canReadRole(rootRole)) return "root";

  const readable = (await actorDirectGrants(db, actorPrincipalId)).filter((grant) => canReadRole(grant.role));
  if (readable.length === 1) return readable[0]!.scopePath;
  if (readable.length > 1) {
    throw new Error("multiple scope grants found for this principal; pass scopePath");
  }
  return "root";
}

function parseFrontmatter(body: string): Record<string, string | number | boolean> {
  if (!body.startsWith("---\n")) return {};
  const end = body.indexOf("\n---", 4);
  if (end === -1) return {};

  const frontmatter: Record<string, string | number | boolean> = {};
  const raw = body.slice(4, end).split(/\r?\n/);
  for (const line of raw) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!;
    const value = match[2]!.trim().replace(/^["']|["']$/g, "");
    if (/^(true|false)$/i.test(value)) {
      frontmatter[key] = value.toLowerCase() === "true";
    } else if (value && Number.isFinite(Number(value))) {
      frontmatter[key] = Number(value);
    } else {
      frontmatter[key] = value;
    }
  }
  return frontmatter;
}

function sourceFor(
  scopePath: string,
  slug: string,
  effectiveScopePath: string,
  ancestorWikiScopePath: string | null,
  personalScopePath: string | null
): RecallMemoryHit["source"] {
  if (personalScopePath && scopePath === personalScopePath) return "personal";
  if (scopePath === "root" && slug === "critical-facts") return "critical-facts";
  if (scopePath === "root" && slug.startsWith("pattern-")) return "root-pattern";
  if (ancestorWikiScopePath && scopePath === ancestorWikiScopePath && !isAncestorOrSame(effectiveScopePath, scopePath)) return "ancestor";
  return "scope";
}

function stripCandidate(hit: CandidateMemoryHit): RecallMemoryHit {
  const { rank, retrieval, ...rest } = hit;
  void rank;
  void retrieval;
  return rest;
}

function rowToCandidate(
  row: {
    id: string;
    slug: string;
    title: string;
    bodyMd: string;
    scopePath: string;
    updatedAt: Date;
    snippet: string;
    rank: number;
  },
  effectiveScopePath: string,
  includeAncestorPath: string | null,
  personalScopePath: string | null,
  retrieval: "keyword" | "semantic"
): CandidateMemoryHit {
  const frontmatter = parseFrontmatter(row.bodyMd || "");
  const confidence = frontmatter.confidence ?? frontmatter.confidence_level ?? null;
  return {
    type: "page",
    id: row.id,
    slug: row.slug,
    title: row.title,
    scopePath: row.scopePath,
    revisionId: null,
    source: sourceFor(row.scopePath, row.slug, effectiveScopePath, includeAncestorPath, personalScopePath),
    updatedAt: row.updatedAt,
    snippet: row.snippet,
    confidence: typeof confidence === "string" || typeof confidence === "number" ? confidence : null,
    frontmatter,
    rank: row.rank,
    retrieval,
  };
}

function keywordOrdered(hits: CandidateMemoryHit[], limit: number): RecallMemoryHit[] {
  return hits
    .sort((a, b) => {
      const rankDiff = Number(b.rank ?? 0) - Number(a.rank ?? 0);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .slice(0, limit)
    .map(stripCandidate);
}

function rrfFuse(keywordHits: CandidateMemoryHit[], semanticHits: CandidateMemoryHit[], limit: number): RecallMemoryHit[] {
  const k = 60;
  const fused = new Map<string, CandidateMemoryHit & { fusedRank: number }>();
  const add = (hits: CandidateMemoryHit[]) => {
    hits.forEach((hit, index) => {
      const score = 1 / (k + index + 1);
      const existing = fused.get(hit.id);
      if (existing) {
        existing.fusedRank += score;
        if (hit.retrieval === "keyword") existing.snippet = hit.snippet;
      } else {
        fused.set(hit.id, { ...hit, fusedRank: score });
      }
    });
  };
  add(keywordHits);
  add(semanticHits);
  return Array.from(fused.values())
    .sort((a, b) => {
      const rankDiff = b.fusedRank - a.fusedRank;
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .slice(0, limit)
    .map(stripCandidate);
}

async function attachRevisionIds(db: DB, hits: RecallMemoryHit[]): Promise<RecallMemoryHit[]> {
  const documentIds = Array.from(new Set(hits.map((hit) => hit.id)));
  if (documentIds.length === 0) return hits;

  const rows = (await db
    .select({
      id: documentRevisions.id,
      documentId: documentRevisions.documentId,
    })
    .from(documentRevisions)
    .where(inArray(documentRevisions.documentId, documentIds))
    .orderBy(documentRevisions.documentId, desc(documentRevisions.createdAt))) as Array<{
      id: string;
      documentId: string;
    }>;

  const latestRevisionByDocument = new Map<string, string>();
  for (const row of rows) {
    if (!latestRevisionByDocument.has(row.documentId)) {
      latestRevisionByDocument.set(row.documentId, row.id);
    }
  }

  return hits.map((hit) => ({
    ...hit,
    revisionId: latestRevisionByDocument.get(hit.id) ?? null,
  }));
}

export async function recallMemory(
  db: DB,
  input: RecallMemoryInput,
  actorPrincipalId: string
): Promise<RecallMemoryHit[]> {
  const query = input.query.trim();
  if (!query) return [];

  const effectiveScopePath = await resolveEffectiveScope(db, input.scopePath ?? null, actorPrincipalId);
  const effectiveScope = await getScope(db, effectiveScopePath);
  if (!effectiveScope) throw new ScopeNotFoundError(effectiveScopePath);

  const actorRole = await resolveAccess(db, actorPrincipalId, effectiveScopePath);
  if (!canReadRole(actorRole)) {
    throw new AccessDeniedError(actorPrincipalId, effectiveScopePath, "viewer");
  }

  const limit = effectiveLimit(input.limit);
  const nearestWikiScopePath = await findNearestWikiScopePath(db, effectiveScopePath);
  // Root is never an includable ancestor: root docs are reachable only through the
  // structural allowlist predicate below, regardless of where the nearest wiki lives.
  const includeAncestorPath = nearestWikiScopePath && nearestWikiScopePath !== "root"
    && !isAncestorOrSame(effectiveScopePath, nearestWikiScopePath)
    ? nearestWikiScopePath
    : null;

  const scopePredicate = subtreeCondition(effectiveScopePath);
  const rootAllowlistPredicate = and(eq(scopes.path, "root"), or(eq(documents.slug, "critical-facts"), like(documents.slug, "pattern-%")));
  const personalScopePath = getPersonalScopePath(actorPrincipalId);
  const personalScope = await getScope(db, personalScopePath);
  const predicates = personalScope
    ? includeAncestorPath
      ? or(eq(scopes.id, personalScope.id), scopePredicate, eq(scopes.path, includeAncestorPath), rootAllowlistPredicate)
      : or(eq(scopes.id, personalScope.id), scopePredicate, rootAllowlistPredicate)
    : includeAncestorPath
      ? or(scopePredicate, eq(scopes.path, includeAncestorPath), rootAllowlistPredicate)
      : or(scopePredicate, rootAllowlistPredicate);

  const vector = sql`to_tsvector('english', coalesce(${documents.title}, '') || ' ' || coalesce(${documents.bodyMd}, ''))`;
  const tsquery = sql`websearch_to_tsquery('english', ${query})`;
  const keywordRows = (await db
    .select({
      id: documents.id,
      slug: documents.slug,
      title: documents.title,
      bodyMd: documents.bodyMd,
      scopePath: scopes.path,
      updatedAt: documents.updatedAt,
      snippet: sql<string>`ts_headline('english', ${documents.bodyMd}, websearch_to_tsquery('english', ${query}), 'MaxWords=45, MinWords=12')`.as("snippet"),
      rank: sql<number>`ts_rank(${vector}, ${tsquery})`.as("rank"),
    })
    .from(documents)
    .innerJoin(scopes, eq(documents.scopeId, scopes.id))
    .where(and(predicates, isNull(documents.archivedAt), sql`${vector} @@ ${tsquery}`))
    .orderBy(desc(sql`rank`), desc(documents.updatedAt))
    .limit(limit)) as Array<{
      id: string;
      slug: string;
      title: string;
      bodyMd: string;
      scopePath: string;
      updatedAt: Date;
      snippet: string;
      rank: number;
    }>;

  const keywordHits = keywordRows.map((row) => rowToCandidate(row, effectiveScopePath, includeAncestorPath, personalScope ? personalScopePath : null, "keyword"));
  let hits = keywordOrdered(keywordHits, limit);
  let effectiveMode: "hybrid" | "keyword-fallback" = "keyword-fallback";

  if (embeddingsConfigured()) {
    const [embeddedDoc] = await db
      .select({ id: embeddings.id })
      .from(embeddings)
      .innerJoin(documents, eq(embeddings.entityId, documents.id))
      .innerJoin(scopes, eq(documents.scopeId, scopes.id))
      .where(and(predicates, eq(embeddings.entityType, "doc"), isNull(documents.archivedAt)))
      .limit(1);

    if (embeddedDoc) {
      try {
        const queryEmbedding = await embedQuery(query);
        if (queryEmbedding) {
          const queryVector = toVectorSql(queryEmbedding);
          const semanticRows = (await db
            .select({
              id: documents.id,
              slug: documents.slug,
              title: documents.title,
              bodyMd: documents.bodyMd,
              scopePath: scopes.path,
              updatedAt: documents.updatedAt,
              snippet: sql<string>`left(${documents.bodyMd}, 360)`.as("snippet"),
              rank: sql<number>`1 - (${embeddings.embedding} <=> ${queryVector})`.as("rank"),
            })
            .from(embeddings)
            .innerJoin(documents, eq(embeddings.entityId, documents.id))
            .innerJoin(scopes, eq(documents.scopeId, scopes.id))
            .where(and(predicates, eq(embeddings.entityType, "doc"), isNull(documents.archivedAt)))
            .orderBy(sql`${embeddings.embedding} <=> ${queryVector}`)
            .limit(limit)) as Array<{
              id: string;
              slug: string;
              title: string;
              bodyMd: string;
              scopePath: string;
              updatedAt: Date;
              snippet: string;
              rank: number;
            }>;
          const semanticHits = semanticRows.map((row) => rowToCandidate(row, effectiveScopePath, includeAncestorPath, personalScope ? personalScopePath : null, "semantic"));
          hits = rrfFuse(keywordHits, semanticHits, limit);
          effectiveMode = "hybrid";
        }
      } catch {
        await logUsageEventSafely(db, {
          scopeId: effectiveScope.id,
          principalId: actorPrincipalId,
          source: "memory",
          operation: "recall_memory.semantic",
          success: false,
          errorCode: "semantic_unavailable",
          metadata: {
            fallback: "keyword",
            effectiveScopePath,
            rootAllowlist: ["critical-facts", "pattern-*"],
          },
        });
      }
    }
  }

  const returnedText = hits.map((hit) => `${hit.source}\t${hit.slug}\t${hit.title}\t${hit.scopePath}\t${hit.snippet}`).join("\n");
  const estimate = estimateTokens(returnedText);
  await logUsageEventSafely(db, {
    scopeId: effectiveScope.id,
    principalId: actorPrincipalId,
    source: "memory",
    operation: "recall_memory",
    outputTokensEst: estimate.tokens,
    totalTokensEst: estimate.tokens,
    byteOut: estimate.bytes,
    success: true,
    metadata: {
      estimated: true,
      resultCount: hits.length,
      requestedLimit: limit,
      effectiveScopePath,
      requestedScopeClass: input.scopePath ? "explicit" : "implicit",
      sources: hits.reduce<Record<string, number>>((acc, hit) => {
        acc[hit.source] = (acc[hit.source] ?? 0) + 1;
        return acc;
      }, {}),
      mode: "hybrid",
      effectiveMode,
      rootAllowlist: ["critical-facts", "pattern-*"],
    },
  });

  return attachRevisionIds(db, hits);
}

export async function getRootCriticalFacts(db: DB): Promise<string | null> {
  const [row] = (await db
    .select({
      bodyMd: documents.bodyMd,
    })
    .from(documents)
    .innerJoin(scopes, eq(documents.scopeId, scopes.id))
    .where(and(eq(scopes.path, "root"), eq(documents.slug, "critical-facts"), isNull(documents.archivedAt)))
    .limit(1)) as Array<{ bodyMd: string }>;

  return row?.bodyMd ?? null;
}
