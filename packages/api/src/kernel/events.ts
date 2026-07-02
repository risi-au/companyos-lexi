/* eslint-disable @typescript-eslint/no-explicit-any */
import { eq, and, gte, desc } from "drizzle-orm";
import { scopes, events } from "@companyos/db";
import type { Event } from "@companyos/db";

export type DB = any; // compatible with pglite and postgres-js drizzle instances (PGlite + prod)

export interface EmitEventInput {
  type: string;
  scopePath?: string | null;
  principalId?: string | null;
  payload?: Record<string, unknown>;
}

export async function emitEvent(db: DB, input: EmitEventInput): Promise<void> {
  let scopeId: string | null = null;
  if (input.scopePath) {
    const [scope] = await db
      .select({ id: scopes.id })
      .from(scopes)
      .where(eq(scopes.path, input.scopePath))
      .limit(1);
    if (scope) {
      scopeId = scope.id;
    }
  }

  await db.insert(events).values({
    type: input.type,
    scopeId,
    principalId: input.principalId ?? null,
    payload: input.payload ?? {},
  });
}

export interface ListEventsInput {
  scopePath?: string | null;
  type?: string;
  since?: Date;
  limit?: number;
}

export async function listEvents(db: DB, input: ListEventsInput = {}): Promise<Event[]> {
  const conditions: any[] = [];

  let scopeId: string | null = null;
  if (input.scopePath) {
    const [scope] = await db
      .select({ id: scopes.id })
      .from(scopes)
      .where(eq(scopes.path, input.scopePath))
      .limit(1);
    if (scope) {
      scopeId = scope.id;
    }
  }
  if (scopeId) {
    conditions.push(eq(events.scopeId, scopeId));
  }
  if (input.type) {
    conditions.push(eq(events.type, input.type));
  }
  if (input.since) {
    conditions.push(gte(events.createdAt, input.since));
  }

  let q = db
    .select()
    .from(events)
    .orderBy(desc(events.createdAt))
    .limit(input.limit ?? 100);

  if (conditions.length > 0) {
    q = q.where(and(...conditions));
  }

  return (await q) as Event[];
}
