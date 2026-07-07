import { createHash } from "crypto";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { documents, embeddings, records, scopes } from "@companyos/db";
import type { Document, Embedding, Record as DbRecord, Scope } from "@companyos/db";
import { emitEvent, type DB } from "../kernel/events";
import { requireAccess } from "../kernel/grants";
import { getScope } from "../kernel/scopes";
import { ScopeNotFoundError } from "../errors";
import { logUsageEventSafely } from "../modules/usage/service";

export type SemanticEntityType = "doc" | "record";

export interface EmbeddingClient {
  embed(input: { model: string; text: string }): Promise<number[]>;
}

export interface EmbedEntityResult {
  embedded: boolean;
  skipped: boolean;
  reason?: "unchanged" | "missing" | "unconfigured";
}

export interface SemanticBackfillResult {
  docsSeen: number;
  recordsSeen: number;
  embedded: number;
  skipped: number;
  linksExtracted: number;
}

const EMBEDDING_MODEL_ALIAS = "embed";
let injectedClient: EmbeddingClient | null = null;

function embeddingDimensions(): number {
  const parsed = Number(process.env.EMBEDDING_DIMENSIONS || 1536);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1536;
}

export function embeddingModelAlias(): string {
  return EMBEDDING_MODEL_ALIAS;
}

export function setEmbeddingClientForTests(client: EmbeddingClient | null): void {
  injectedClient = client;
}

function configuredClient(): EmbeddingClient | null {
  if (injectedClient) return injectedClient;
  const baseUrl = process.env.LITELLM_BASE_URL;
  const apiKey = process.env.LITELLM_EMBED_KEY || process.env.LITELLM_API_KEY || process.env.LITELLM_MASTER_KEY;
  if (!baseUrl || !apiKey) return null;
  return {
    async embed(input) {
      const response = await fetch(`${baseUrl.replace(/\/+$/g, "")}/v1/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: input.model, input: input.text }),
      });
      if (!response.ok) {
        throw new Error(`LiteLLM embeddings request failed: ${response.status}`);
      }
      const data = await response.json() as { data?: Array<{ embedding?: number[] }> };
      const vector = data.data?.[0]?.embedding;
      if (!Array.isArray(vector)) {
        throw new Error("LiteLLM embeddings response did not include an embedding");
      }
      return vector;
    },
  };
}

export function embeddingsConfigured(): boolean {
  return configuredClient() !== null;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function entityContent(entity: Pick<Document | DbRecord, "title" | "bodyMd">): string {
  return `${entity.title}\n\n${entity.bodyMd || ""}`;
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => Number(value)).join(",")}]`;
}

async function lookupEntity(db: DB, entityType: SemanticEntityType, entityId: string): Promise<{
  scopeId: string;
  scopePath: string;
  text: string;
} | null> {
  if (entityType === "doc") {
    const [row] = (await db
      .select({
        id: documents.id,
        title: documents.title,
        bodyMd: documents.bodyMd,
        scopeId: documents.scopeId,
        scopePath: scopes.path,
      })
      .from(documents)
      .innerJoin(scopes, eq(documents.scopeId, scopes.id))
      .where(eq(documents.id, entityId))
      .limit(1)) as Array<Pick<Document, "id" | "title" | "bodyMd" | "scopeId"> & { scopePath: string }>;
    return row ? { scopeId: row.scopeId, scopePath: row.scopePath, text: entityContent(row) } : null;
  }

  const [row] = (await db
    .select({
      id: records.id,
      title: records.title,
      bodyMd: records.bodyMd,
      scopeId: records.scopeId,
      scopePath: scopes.path,
    })
    .from(records)
    .innerJoin(scopes, eq(records.scopeId, scopes.id))
    .where(eq(records.id, entityId))
    .limit(1)) as Array<Pick<DbRecord, "id" | "title" | "bodyMd" | "scopeId"> & { scopePath: string }>;
  return row ? { scopeId: row.scopeId, scopePath: row.scopePath, text: entityContent(row) } : null;
}

async function warnEmbeddingFailure(
  db: DB,
  input: {
    entityType: SemanticEntityType;
    entityId: string;
    scopeId?: string | null;
    scopePath?: string | null;
    principalId?: string | null;
    error: unknown;
  }
): Promise<void> {
  const errorName = input.error instanceof Error ? input.error.name : "EmbeddingError";
  await logUsageEventSafely(db, {
    scopeId: input.scopeId ?? null,
    principalId: input.principalId ?? null,
    source: "semantic",
    operation: "embedding",
    success: false,
    errorCode: "embedding_failed",
    metadata: {
      entityType: input.entityType,
      entityId: input.entityId,
      model: EMBEDDING_MODEL_ALIAS,
      errorName,
    },
  });

  if (input.scopePath) {
    try {
      await emitEvent(db, {
        type: "alert.fired",
        scopePath: input.scopePath,
        principalId: input.principalId ?? null,
        payload: {
          capability: "semantic.embeddings",
          severity: "warning",
          message: "Embedding generation failed; semantic search will fall back to keyword where needed.",
          entityType: input.entityType,
          entityId: input.entityId,
          errorCode: "embedding_failed",
        },
      });
    } catch {
      // Alert surfacing is fail-open; the write that triggered embedding must not fail.
    }
  }
}

export async function embedEntityFailOpen(
  db: DB,
  input: { entityType: SemanticEntityType; entityId: string; principalId?: string | null }
): Promise<EmbedEntityResult> {
  const client = configuredClient();
  if (!client) {
    return { embedded: false, skipped: true, reason: "unconfigured" };
  }

  const entity = await lookupEntity(db, input.entityType, input.entityId);
  if (!entity) {
    return { embedded: false, skipped: true, reason: "missing" };
  }

  const hash = contentHash(entity.text);
  const [existing] = (await db
    .select({ contentHash: embeddings.contentHash, model: embeddings.model })
    .from(embeddings)
    .where(and(eq(embeddings.entityType, input.entityType), eq(embeddings.entityId, input.entityId)))
    .limit(1)) as Array<Pick<Embedding, "contentHash" | "model">>;
  if (existing?.contentHash === hash && existing.model === EMBEDDING_MODEL_ALIAS) {
    return { embedded: false, skipped: true, reason: "unchanged" };
  }

  try {
    const vector = await client.embed({ model: EMBEDDING_MODEL_ALIAS, text: entity.text });
    if (vector.length !== embeddingDimensions()) {
      throw new Error(`Embedding dimension mismatch: expected ${embeddingDimensions()}, received ${vector.length}`);
    }
    const now = new Date();
    await db
      .insert(embeddings)
      .values({
        entityType: input.entityType,
        entityId: input.entityId,
        scopeId: entity.scopeId,
        contentHash: hash,
        model: EMBEDDING_MODEL_ALIAS,
        embedding: vector,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [embeddings.entityType, embeddings.entityId],
        set: {
          scopeId: entity.scopeId,
          contentHash: hash,
          model: EMBEDDING_MODEL_ALIAS,
          embedding: vector,
          updatedAt: now,
        },
      });

    await emitEvent(db, {
      type: "semantic.embedding_updated",
      scopePath: entity.scopePath,
      principalId: input.principalId ?? null,
      payload: {
        entityType: input.entityType,
        entityId: input.entityId,
        model: EMBEDDING_MODEL_ALIAS,
      },
    });
    return { embedded: true, skipped: false };
  } catch (error) {
    await warnEmbeddingFailure(db, {
      entityType: input.entityType,
      entityId: input.entityId,
      scopeId: entity.scopeId,
      scopePath: entity.scopePath,
      principalId: input.principalId ?? null,
      error,
    });
    return { embedded: false, skipped: true };
  }
}

export function enqueueEmbeddingForEntity(
  db: DB,
  input: { entityType: SemanticEntityType; entityId: string; principalId?: string | null }
): void {
  if (!embeddingsConfigured()) return;
  void Promise.resolve().then(() => embedEntityFailOpen(db, input));
}

export async function embedQuery(text: string): Promise<number[] | null> {
  const client = configuredClient();
  if (!client) return null;
  return client.embed({ model: EMBEDDING_MODEL_ALIAS, text });
}

export function toVectorSql(vector: number[]) {
  return sql`${vectorLiteral(vector)}::vector`;
}

function subtreeCondition(scopePath: string) {
  return scopePath === "root"
    ? like(scopes.path, "%")
    : or(eq(scopes.path, scopePath), like(scopes.path, `${scopePath}/%`));
}

export async function hasEmbeddingsInSubtree(db: DB, scopePath: string, kinds: SemanticEntityType[]): Promise<boolean> {
  const rows = (await db
    .select({ id: embeddings.id })
    .from(embeddings)
    .innerJoin(scopes, eq(embeddings.scopeId, scopes.id))
    .where(and(subtreeCondition(scopePath), inArray(embeddings.entityType, kinds)))
    .limit(1)) as Array<{ id: string }>;
  return rows.length > 0;
}

export async function backfillSemanticLayer(
  db: DB,
  input: { scopePath?: string },
  actorPrincipalId: string
): Promise<SemanticBackfillResult> {
  const scopePath = input.scopePath?.trim() || "root";
  const scope = await getScope(db, scopePath);
  if (!scope) throw new ScopeNotFoundError(scopePath);
  await requireAccess(db, actorPrincipalId, scopePath, "admin");

  const result: SemanticBackfillResult = {
    docsSeen: 0,
    recordsSeen: 0,
    embedded: 0,
    skipped: 0,
    linksExtracted: 0,
  };

  const scopeRows = (await db
    .select({ id: scopes.id, path: scopes.path })
    .from(scopes)
    .where(subtreeCondition(scopePath))) as Array<Pick<Scope, "id" | "path">>;
  const scopeIds = scopeRows.map((row) => row.id);
  if (scopeIds.length === 0) return result;

  const docRows = (await db
    .select({ id: documents.id })
    .from(documents)
    .where(inArray(documents.scopeId, scopeIds))) as Array<{ id: string }>;
  const recordRows = (await db
    .select({ id: records.id })
    .from(records)
    .where(inArray(records.scopeId, scopeIds))) as Array<{ id: string }>;

  const { extractLinksForDocument } = await import("../modules/docs/service");

  for (const doc of docRows) {
    result.docsSeen += 1;
    await extractLinksForDocument(db, doc.id, actorPrincipalId);
    result.linksExtracted += 1;
    const embedded = await embedEntityFailOpen(db, { entityType: "doc", entityId: doc.id, principalId: actorPrincipalId });
    if (embedded.embedded) result.embedded += 1;
    else result.skipped += 1;
  }
  for (const record of recordRows) {
    result.recordsSeen += 1;
    const embedded = await embedEntityFailOpen(db, { entityType: "record", entityId: record.id, principalId: actorPrincipalId });
    if (embedded.embedded) result.embedded += 1;
    else result.skipped += 1;
  }

  return result;
}
