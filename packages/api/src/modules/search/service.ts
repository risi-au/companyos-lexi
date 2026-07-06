import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { documents, records, scopes } from "@companyos/db";
import { type DB } from "../../kernel/events";
import { requireAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { ScopeNotFoundError } from "../../errors";

export type SearchKind = "record" | "doc";

export interface SearchInput {
  scopePath: string;
  query: string;
  kinds?: SearchKind[];
  limit?: number;
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

export async function search(
  db: DB,
  input: SearchInput,
  actorPrincipalId: string
): Promise<SearchHit[]> {
  const scopePath = input.scopePath.trim();
  const query = input.query.trim();
  const limit = effectiveLimit(input.limit);
  const kinds = normalizeKinds(input.kinds);

  if (!query) {
    return [];
  }

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const scopeMatch = subtreeCondition(scopePath);
  const hits: RankedSearchHit[] = [];

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

    hits.push(...rows);
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
      .where(and(scopeMatch, sql`${documents.archivedAt} is null`, sql`${vector} @@ ${tsquery}`))
      .orderBy(desc(sql`rank`))
      .limit(limit)) as RankedSearchHit[];

    hits.push(...rows);
  }

  return hits
    .sort((a, b) => {
      const rankDiff = Number(b.rank ?? 0) - Number(a.rank ?? 0);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    })
    .slice(0, limit)
    .map((hit): SearchHit => {
      const { rank, ...rest } = hit;
      void rank;
      return rest;
    });
}
