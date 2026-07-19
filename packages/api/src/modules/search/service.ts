import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { documents, embeddings, notReservedOperationalWikiReportSlug, records, scopes } from "@companyos/db";
import { type DB } from "../../kernel/events";
import { requireAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { ScopeNotFoundError } from "../../errors";
import { estimateTokens, logUsageEventSafely } from "../usage/service";
import { embedQuery, embeddingsConfigured, hasEmbeddingsInSubtree, toVectorSql } from "../../lib/embeddings";

export type SearchKind = "record" | "doc";
export type SearchMode = "keyword" | "semantic" | "hybrid";

export interface SearchInput {
  scopePath: string;
  query: string;
  kinds?: SearchKind[];
  limit?: number;
  mode?: SearchMode;
}

export interface SearchHit {
  type: SearchKind;
  id: string;
  slug?: string;
  kind?: string;
  title: string;
  scopePath: string;
  date: Date;
  snippet: string;
}

type RankedSearchHit = SearchHit & { rank: number };
type CandidateHit = SearchHit & { rank: number; source: "keyword" | "semantic" };

function effectiveLimit(limit?: number): number {
  return Math.min(Math.max(1, limit ?? 10), 50);
}

function normalizeKinds(kinds?: SearchKind[]): Set<SearchKind> {
  if (!kinds || kinds.length === 0) return new Set(["record", "doc"]);
  return new Set(kinds);
}

function subtreeCondition(scopePath: string) {
  return scopePath === "root"
    ? like(scopes.path, "%")
    : or(eq(scopes.path, scopePath), like(scopes.path, `${scopePath}/%`));
}

async function keywordSearch(db: DB, scopePath: string, query: string, kinds: Set<SearchKind>, limit: number): Promise<CandidateHit[]> {
  const scopeMatch = subtreeCondition(scopePath);
  const hits: CandidateHit[] = [];

  if (kinds.has("record")) {
    const vector = sql`to_tsvector('english', coalesce(${records.title}, '') || ' ' || coalesce(${records.bodyMd}, ''))`;
    const tsquery = sql`websearch_to_tsquery('english', ${query})`;
    const rows = (await db
      .select({
        type: sql<SearchKind>`'record'`.as("type"),
        id: records.id,
        kind: records.kind,
        title: records.title,
        scopePath: scopes.path,
        date: records.createdAt,
        snippet: sql<string>`ts_headline('english', ${records.bodyMd}, websearch_to_tsquery('english', ${query}), 'MaxWords=35, MinWords=15')`.as("snippet"),
        rank: sql<number>`ts_rank(${vector}, ${tsquery})`.as("rank"),
      })
      .from(records)
      .innerJoin(scopes, eq(records.scopeId, scopes.id))
      .where(and(scopeMatch, sql`${vector} @@ ${tsquery}`))
      .orderBy(desc(sql`rank`))
      .limit(limit)) as RankedSearchHit[];

    hits.push(...rows.map((row) => ({ ...row, source: "keyword" as const })));
  }

  if (kinds.has("doc")) {
    const vector = sql`to_tsvector('english', coalesce(${documents.title}, '') || ' ' || coalesce(${documents.bodyMd}, ''))`;
    const tsquery = sql`websearch_to_tsquery('english', ${query})`;
    const rows = (await db
      .select({
        type: sql<SearchKind>`'doc'`.as("type"),
        id: documents.id,
        slug: documents.slug,
        title: documents.title,
        scopePath: scopes.path,
        date: documents.updatedAt,
        snippet: sql<string>`ts_headline('english', ${documents.bodyMd}, websearch_to_tsquery('english', ${query}), 'MaxWords=35, MinWords=15')`.as("snippet"),
        rank: sql<number>`ts_rank(${vector}, ${tsquery})`.as("rank"),
      })
      .from(documents)
      .innerJoin(scopes, eq(documents.scopeId, scopes.id))
      .where(and(scopeMatch, sql`${documents.archivedAt} is null`, notReservedOperationalWikiReportSlug(documents.slug), sql`${vector} @@ ${tsquery}`))
      .orderBy(desc(sql`rank`))
      .limit(limit)) as RankedSearchHit[];

    hits.push(...rows.map((row) => ({ ...row, source: "keyword" as const })));
  }

  return hits;
}

async function semanticSearch(db: DB, scopePath: string, queryEmbedding: number[], kinds: Set<SearchKind>, limit: number): Promise<CandidateHit[]> {
  const scopeMatch = subtreeCondition(scopePath);
  const candidatesPerKind = limit;
  const hits: CandidateHit[] = [];
  const queryVector = toVectorSql(queryEmbedding);

  if (kinds.has("record")) {
    const rows = (await db
      .select({
        type: sql<SearchKind>`'record'`.as("type"),
        id: records.id,
        kind: records.kind,
        title: records.title,
        scopePath: scopes.path,
        date: records.createdAt,
        snippet: sql<string>`left(${records.bodyMd}, 280)`.as("snippet"),
        rank: sql<number>`1 - (${embeddings.embedding} <=> ${queryVector})`.as("rank"),
      })
      .from(embeddings)
      .innerJoin(records, eq(embeddings.entityId, records.id))
      .innerJoin(scopes, eq(records.scopeId, scopes.id))
      .where(and(scopeMatch, eq(embeddings.entityType, "record")))
      .orderBy(sql`${embeddings.embedding} <=> ${queryVector}`)
      .limit(candidatesPerKind)) as RankedSearchHit[];
    hits.push(...rows.map((row) => ({ ...row, source: "semantic" as const })));
  }

  if (kinds.has("doc")) {
    const rows = (await db
      .select({
        type: sql<SearchKind>`'doc'`.as("type"),
        id: documents.id,
        slug: documents.slug,
        title: documents.title,
        scopePath: scopes.path,
        date: documents.updatedAt,
        snippet: sql<string>`left(${documents.bodyMd}, 280)`.as("snippet"),
        rank: sql<number>`1 - (${embeddings.embedding} <=> ${queryVector})`.as("rank"),
      })
      .from(embeddings)
      .innerJoin(documents, eq(embeddings.entityId, documents.id))
      .innerJoin(scopes, eq(documents.scopeId, scopes.id))
      .where(and(scopeMatch, eq(embeddings.entityType, "doc"), sql`${documents.archivedAt} is null`, notReservedOperationalWikiReportSlug(documents.slug)))
      .orderBy(sql`${embeddings.embedding} <=> ${queryVector}`)
      .limit(candidatesPerKind)) as RankedSearchHit[];
    hits.push(...rows.map((row) => ({ ...row, source: "semantic" as const })));
  }

  return hits;
}

function stripRank(hit: CandidateHit): SearchHit {
  const { rank, source, ...rest } = hit;
  void rank;
  void source;
  return rest;
}

function keywordOrdered(hits: CandidateHit[], limit: number): SearchHit[] {
  return hits
    .sort((a, b) => {
      const rankDiff = Number(b.rank ?? 0) - Number(a.rank ?? 0);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    })
    .slice(0, limit)
    .map(stripRank);
}

function rrfFuse(keywordHits: CandidateHit[], semanticHits: CandidateHit[], limit: number): SearchHit[] {
  const k = 60;
  const fused = new Map<string, CandidateHit & { fusedRank: number }>();
  const add = (hits: CandidateHit[]) => {
    hits.forEach((hit, index) => {
      const key = `${hit.type}:${hit.id}`;
      const score = 1 / (k + index + 1);
      const existing = fused.get(key);
      if (existing) {
        existing.fusedRank += score;
        if (hit.source === "keyword") existing.snippet = hit.snippet;
      } else {
        fused.set(key, { ...hit, fusedRank: score });
      }
    });
  };
  add(keywordHits);
  add(semanticHits);
  return Array.from(fused.values())
    .sort((a, b) => {
      const rankDiff = b.fusedRank - a.fusedRank;
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    })
    .slice(0, limit)
    .map(stripRank);
}

export async function search(
  db: DB,
  input: SearchInput,
  actorPrincipalId: string
): Promise<SearchHit[]> {
  const scopePath = input.scopePath.trim();
  const query = input.query.trim();
  const limit = effectiveLimit(input.limit);
  const kinds = normalizeKinds(input.kinds);
  const mode: SearchMode = input.mode ?? "hybrid";

  if (!query) {
    return [];
  }

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const keywordHits = mode === "semantic" ? [] : await keywordSearch(db, scopePath, query, kinds, limit);
  let result = keywordOrdered(keywordHits, limit);
  let effectiveMode: SearchMode | "keyword-fallback" = mode;

  if (mode !== "keyword") {
    const semanticKinds = Array.from(kinds) as SearchKind[];
    const canUseSemantic = embeddingsConfigured() && await hasEmbeddingsInSubtree(db, scopePath, semanticKinds);
    if (canUseSemantic) {
      try {
        const queryEmbedding = await embedQuery(query);
        if (queryEmbedding) {
          const semanticHits = await semanticSearch(db, scopePath, queryEmbedding, kinds, limit);
          result = mode === "semantic"
            ? keywordOrdered(semanticHits, limit)
            : rrfFuse(keywordHits, semanticHits, limit);
        } else if (mode === "semantic") {
          result = keywordOrdered(await keywordSearch(db, scopePath, query, kinds, limit), limit);
          effectiveMode = "keyword-fallback";
        }
      } catch {
        await logUsageEventSafely(db, {
          scopeId: scope.id,
          principalId: actorPrincipalId,
          source: "search",
          operation: "search.semantic",
          success: false,
          errorCode: "semantic_unavailable",
          metadata: {
            mode,
            fallback: "keyword",
            kinds: Array.from(kinds),
          },
        });
        result = keywordOrdered(mode === "semantic" ? await keywordSearch(db, scopePath, query, kinds, limit) : keywordHits, limit);
        effectiveMode = "keyword-fallback";
      }
    } else if (mode === "semantic") {
      result = keywordOrdered(await keywordSearch(db, scopePath, query, kinds, limit), limit);
      effectiveMode = "keyword-fallback";
    } else {
      effectiveMode = "keyword-fallback";
    }
  }

  const returnedText = result.map((hit) => `${hit.type}\t${hit.title}\t${hit.scopePath}\t${hit.snippet}`).join("\n");
  const estimate = estimateTokens(returnedText);
  await logUsageEventSafely(db, {
    scopeId: scope.id,
    principalId: actorPrincipalId,
    source: "search",
    operation: "search",
    outputTokensEst: estimate.tokens,
    totalTokensEst: estimate.tokens,
    byteOut: estimate.bytes,
    success: true,
    metadata: {
      estimated: true,
      resultCount: result.length,
      requestedLimit: limit,
      kinds: Array.from(kinds),
      snippetBudgetWords: 35,
      mode,
      effectiveMode,
    },
  });

  return result;
}
