/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, desc, eq, gte, inArray, isNotNull, isNull, like, lt, lte, or, sql } from "drizzle-orm";
import {
  attentionItems,
  connections,
  grants,
  oauthClient,
  oauthConnections,
  principals,
  scopes,
  tokens,
  type Grant,
  type Token,
} from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { grantRole, resolveAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { issueToken, revokeToken, updateTokenExpiry } from "../../kernel/tokens";
import { AccessDeniedError, ScopeNotFoundError, TokenNotFoundError } from "../../errors";
import { createSystemAttentionItem, dismissAttentionItemsInternal } from "../attention/service";

export type ConnectionRole = "agent" | "viewer";
export type ConnectionTokenStatus = "active" | "expired" | "revoked" | "never_used";

const ROLE_RANK: Record<Grant["role"], number> = {
  owner: 5,
  admin: 4,
  editor: 3,
  agent: 3,
  viewer: 2,
};

export interface MintConnectionTokenInput {
  scopePath: string;
  name: string;
  role: ConnectionRole;
  expiresAt?: Date | null;
}

export interface MintConnectionTokenResult {
  token: string;
  storeNow: true;
  tokenId: string;
  principalId: string;
  expiresAt: Date | null;
}

export interface ListedConnectionToken {
  tokenId: string;
  name: string;
  principalId: string;
  principalName: string;
  mintedBy: string;
  mintedByName: string;
  role: ConnectionRole;
  memoryAccess: "on";
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revoked: boolean;
  status: ConnectionTokenStatus;
  canRevoke: boolean;
}

export type ListedAdminConnection = Omit<ListedConnectionToken, "canRevoke"> & {
  scopePath: string;
};

export interface ListedOAuthConnection {
  oauthClientId: string;
  clientName: string | null;
  principalId: string;
  firstUsedAt: Date;
  lastUsedAt: Date;
}

export interface ListConnectionsInput {
  scopePath?: string;
  principalId?: string;
  activeSince?: Date;
  expiringWithin?: Date;
}

function assertConnectionRole(role: string): asserts role is ConnectionRole {
  if (role !== "agent" && role !== "viewer") {
    throw new Error("Connection role must be agent or viewer");
  }
}

function rank(role: Grant["role"] | null): number {
  return role ? ROLE_RANK[role] ?? 0 : 0;
}

async function requireMintAccess(
  db: DB,
  actorPrincipalId: string,
  scopePath: string,
  requestedRole: ConnectionRole
): Promise<void> {
  const actorRole = await resolveAccess(db, actorPrincipalId, scopePath);
  if (rank(actorRole) < ROLE_RANK.editor || rank(actorRole) < ROLE_RANK[requestedRole]) {
    throw new AccessDeniedError(actorPrincipalId, scopePath, requestedRole);
  }
}

async function requireViewerAccess(db: DB, actorPrincipalId: string, scopePath: string): Promise<void> {
  const actorRole = await resolveAccess(db, actorPrincipalId, scopePath);
  if (rank(actorRole) < ROLE_RANK.viewer) {
    throw new AccessDeniedError(actorPrincipalId, scopePath, "viewer");
  }
}

async function requireAdminAccess(db: DB, actorPrincipalId: string, scopePath: string): Promise<void> {
  const actorRole = await resolveAccess(db, actorPrincipalId, scopePath);
  if (rank(actorRole) < ROLE_RANK.admin) {
    throw new AccessDeniedError(actorPrincipalId, scopePath, "admin");
  }
}

function subtreeCondition(scopePath: string) {
  return scopePath === "root"
    ? like(scopes.path, "%")
    : or(eq(scopes.path, scopePath), like(scopes.path, `${scopePath}/%`));
}

function connectionTokenStatus(
  row: { revokedAt: Date | null; expiresAt: Date | null; lastUsedAt: Date | null },
  now: Date
): ConnectionTokenStatus {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && row.expiresAt.getTime() < now.getTime()) return "expired";
  if (!row.lastUsedAt) return "never_used";
  return "active";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Auth-boundary bookkeeping like authenticateTokenWithMetadata: no actor param because
// the caller IS the authenticator and must pass the principal it just verified. Never
// expose this through a route or MCP tool.
export async function touchOAuthConnection(
  db: DB,
  input: { oauthClientId: string; principalId: string }
): Promise<void> {
  await db.transaction(async (tx: DB) => {
    const [row] = await tx
      .insert(oauthConnections)
      .values({ oauthClientId: input.oauthClientId, principalId: input.principalId })
      .onConflictDoUpdate({
        target: [oauthConnections.oauthClientId, oauthConnections.principalId],
        set: { lastUsedAt: sql.raw("now()") },
      })
      .returning({ inserted: sql.raw("xmax = 0") });

    if (row?.inserted) {
      await emitEvent(tx, {
        type: "connection.first_used",
        principalId: input.principalId,
        payload: { oauthClientId: input.oauthClientId, principalId: input.principalId },
      });
    }
  });
}

export async function listOAuthConnections(
  db: DB,
  input: { principalId: string; since?: Date },
  actorPrincipalId: string
): Promise<ListedOAuthConnection[]> {
  if (input.principalId !== actorPrincipalId) {
    throw new AccessDeniedError(actorPrincipalId, "root", "viewer", "OAuth connections are only visible to the authenticated principal.");
  }

  const conditions = [eq(oauthConnections.principalId, input.principalId)];
  if (input.since) conditions.push(gte(oauthConnections.firstUsedAt, input.since));

  return (await db
    .select({
      oauthClientId: oauthConnections.oauthClientId,
      clientName: oauthClient.name,
      principalId: oauthConnections.principalId,
      firstUsedAt: oauthConnections.firstUsedAt,
      lastUsedAt: oauthConnections.lastUsedAt,
    })
    .from(oauthConnections)
    .innerJoin(oauthClient, eq(oauthConnections.oauthClientId, oauthClient.clientId))
    .where(and(...conditions))
    .orderBy(desc(oauthConnections.firstUsedAt))) as ListedOAuthConnection[];
}

async function listMinterNames(db: DB, mintedByIds: string[]): Promise<Map<string, string>> {
  const minterRows = mintedByIds.length
    ? await db.select({ id: principals.id, name: principals.name }).from(principals)
    : [];
  const minterNames = new Map<string, string>();
  for (const row of minterRows as Array<{ id: string; name: string }>) {
    if (mintedByIds.includes(row.id)) minterNames.set(row.id, row.name);
  }
  return minterNames;
}

export async function mintConnectionToken(
  db: DB,
  input: MintConnectionTokenInput,
  actorPrincipalId: string
): Promise<MintConnectionTokenResult> {
  const scopePath = input.scopePath.trim();
  const name = input.name.trim();
  const role = input.role;
  assertConnectionRole(role);
  if (!name) {
    throw new Error("Connection name is required");
  }

  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }

  await requireMintAccess(db, actorPrincipalId, scopePath, role);

  return db.transaction(async (tx: DB) => {
    const [principal] = (await tx
      .insert(principals)
      .values({ kind: "agent", name, status: "active" })
      .returning()) as Array<{ id: string }>;
    if (!principal) {
      throw new Error("Failed to create connection principal");
    }

    await grantRole(tx, { principalId: principal.id, scopePath, role }, actorPrincipalId);
    const plaintext = await issueToken(
      tx,
      { principalId: principal.id, name, expiresAt: input.expiresAt ?? null },
      actorPrincipalId
    );

    const [tokenRow] = (await tx
      .select()
      .from(tokens)
      .where(and(eq(tokens.principalId, principal.id), eq(tokens.name, name)))
      .orderBy(desc(tokens.createdAt))
      .limit(1)) as Token[];
    if (!tokenRow) {
      throw new Error("Failed to load issued token");
    }

    await tx.insert(connections).values({
      tokenId: tokenRow.id,
      scopeId: scope.id,
      mintedBy: actorPrincipalId,
    });

    await emitEvent(tx, {
      type: "connection.minted",
      scopePath,
      principalId: actorPrincipalId,
      payload: {
        scopePath,
        role,
        tokenId: tokenRow.id,
        name,
        expiresAt: tokenRow.expiresAt ? tokenRow.expiresAt.toISOString() : null,
      },
    });

    return {
      token: plaintext,
      storeNow: true,
      tokenId: tokenRow.id,
      principalId: principal.id,
      expiresAt: tokenRow.expiresAt,
    };
  });
}

export async function listConnectionTokens(
  db: DB,
  input: { scopePath: string },
  actorPrincipalId: string
): Promise<ListedConnectionToken[]> {
  const scopePath = input.scopePath.trim();
  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }
  await requireViewerAccess(db, actorPrincipalId, scopePath);
  const actorRole = await resolveAccess(db, actorPrincipalId, scopePath);
  const actorIsAdmin = rank(actorRole) >= ROLE_RANK.admin;
  const actorIsEditor = rank(actorRole) >= ROLE_RANK.editor;

  const rows = await db
    .select({
      tokenId: tokens.id,
      name: tokens.name,
      principalId: principals.id,
      principalName: principals.name,
      mintedBy: connections.mintedBy,
      mintedByName: principals.name,
      role: grants.role,
      createdAt: connections.createdAt,
      expiresAt: tokens.expiresAt,
      lastUsedAt: tokens.lastUsedAt,
      revokedAt: tokens.revokedAt,
    })
    .from(connections)
    .innerJoin(tokens, eq(connections.tokenId, tokens.id))
    .innerJoin(principals, eq(tokens.principalId, principals.id))
    .innerJoin(grants, and(eq(grants.principalId, principals.id), eq(grants.scopeId, connections.scopeId)))
    .where(and(eq(connections.scopeId, scope.id), isNotNull(connections.tokenId)))
    .orderBy(desc(connections.createdAt));

  const mintedByIds = Array.from(new Set(rows.map((row: any) => row.mintedBy)));
  const minterRows = mintedByIds.length
    ? await db.select({ id: principals.id, name: principals.name }).from(principals)
    : [];
  const minterNames = new Map<string, string>();
  for (const row of minterRows as Array<{ id: string; name: string }>) {
    if (mintedByIds.includes(row.id)) minterNames.set(row.id, row.name);
  }

  const now = new Date();

  return (rows as any[])
    .filter((row) => row.role === "agent" || row.role === "viewer")
    .map((row) => ({
      tokenId: row.tokenId,
      name: row.name,
      principalId: row.principalId,
      principalName: row.principalName,
      mintedBy: row.mintedBy,
      mintedByName: minterNames.get(row.mintedBy) || row.mintedBy,
      role: row.role,
      memoryAccess: "on" as const,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      revoked: !!row.revokedAt,
      status: connectionTokenStatus(row, now),
      canRevoke: !row.revokedAt && (actorIsAdmin || (actorIsEditor && row.mintedBy === actorPrincipalId)),
    }));
}

export async function ensureConnectionExpiryAttention(db: DB): Promise<{ created: number; superseded: number }> {
  return db.transaction(async (tx: DB) => {
    // Serialize concurrent sweeps (multi-instance deployments): the in-process
    // throttle only guards one process, and check-then-insert would duplicate items.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('connection_expiry_sweep'))`);
    const now = new Date();
    const threshold = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    let created = 0;
    let superseded = 0;

    const candidates = (await tx
      .select({
        tokenId: tokens.id,
        name: tokens.name,
        expiresAt: tokens.expiresAt,
        scopeId: connections.scopeId,
        scopePath: scopes.path,
        mintedBy: connections.mintedBy,
      })
      .from(connections)
      .innerJoin(tokens, eq(connections.tokenId, tokens.id))
      .innerJoin(scopes, eq(connections.scopeId, scopes.id))
      .where(and(
        isNotNull(connections.tokenId),
        isNull(tokens.revokedAt),
        isNotNull(tokens.expiresAt),
        lt(tokens.expiresAt, threshold)
      ))) as Array<{
        tokenId: string;
        name: string;
        expiresAt: Date;
        scopeId: string;
        scopePath: string;
        mintedBy: string;
      }>;

    for (const candidate of candidates) {
      const state = candidate.expiresAt.getTime() < now.getTime() ? "expired" : "expiring";
      const [openItem] = (await tx
        .select({ id: attentionItems.id, payload: attentionItems.payload })
        .from(attentionItems)
        .where(and(
          eq(attentionItems.kind, "connection_expiry"),
          eq(attentionItems.status, "open"),
          sql`${attentionItems.payload}->>'tokenId' = ${candidate.tokenId}`
        ))
        .limit(1)) as Array<{ id: string; payload: Record<string, unknown> }>;

      if (openItem) {
        const existingState = isRecord(openItem.payload) ? openItem.payload.state : null;
        if (existingState === "expiring" && state === "expired") {
          const dismissed = await dismissAttentionItemsInternal(tx, {
            kind: "connection_expiry",
            payloadTokenId: candidate.tokenId,
            note: "superseded: token expired",
          });
          if (dismissed > 0) superseded += 1;
        } else {
          continue;
        }
      }

      const expiresAt = candidate.expiresAt.toISOString();
      await createSystemAttentionItem(tx, {
        scopeId: candidate.scopeId,
        kind: "connection_expiry",
        title: state === "expired"
          ? `Worker token "${candidate.name}" has expired`
          : `Worker token "${candidate.name}" expires soon`,
        summary: state === "expired"
          ? `Expired on ${expiresAt}.`
          : `Expires on ${expiresAt}.`,
        payload: { tokenId: candidate.tokenId, name: candidate.name, scopePath: candidate.scopePath, state, expiresAt },
        createdBy: candidate.mintedBy,
      });
      created += 1;
    }

    return { created, superseded };
  });
}

export async function revokeConnectionToken(
  db: DB,
  input: { tokenId: string },
  actorPrincipalId: string
): Promise<void> {
  const [row] = (await db
    .select({
      tokenId: tokens.id,
      scopePath: scopes.path,
      mintedBy: connections.mintedBy,
    })
    .from(connections)
    .innerJoin(tokens, eq(connections.tokenId, tokens.id))
    .innerJoin(scopes, eq(connections.scopeId, scopes.id))
    .where(eq(connections.tokenId, input.tokenId))
    .limit(1)) as Array<{ tokenId: string; scopePath: string; mintedBy: string }>;

  if (!row) {
    throw new TokenNotFoundError(input.tokenId);
  }

  const actorRole = await resolveAccess(db, actorPrincipalId, row.scopePath);
  const actorRank = rank(actorRole);
  const isOwnMint = row.mintedBy === actorPrincipalId;
  const canRevoke = actorRank >= ROLE_RANK.admin || (actorRank >= ROLE_RANK.editor && isOwnMint);
  if (!canRevoke) {
    throw new AccessDeniedError(actorPrincipalId, row.scopePath, isOwnMint ? "editor" : "admin");
  }

  await db.transaction(async (tx: DB) => {
    await revokeToken(tx, row.tokenId, actorPrincipalId);
    await dismissAttentionItemsInternal(tx, { kind: "connection_expiry", payloadTokenId: row.tokenId, note: "token revoked" });
    await emitEvent(tx, {
      type: "connection.revoked",
      scopePath: row.scopePath,
      principalId: actorPrincipalId,
      payload: { tokenId: row.tokenId, scopePath: row.scopePath },
    });
  });
}

export async function updateConnectionTokenExpiry(
  db: DB,
  input: { tokenId: string; expiresAt: Date | null },
  actorPrincipalId: string
): Promise<void> {
  const [row] = (await db
    .select({
      tokenId: tokens.id,
      scopePath: scopes.path,
    })
    .from(connections)
    .innerJoin(tokens, eq(connections.tokenId, tokens.id))
    .innerJoin(scopes, eq(connections.scopeId, scopes.id))
    .where(eq(connections.tokenId, input.tokenId))
    .limit(1)) as Array<{ tokenId: string; scopePath: string }>;

  if (!row) {
    throw new TokenNotFoundError(input.tokenId);
  }

  // Admin-only: changing an expiry can extend a token's life, so it is held to a
  // higher bar than revoke (which also allows an editor to revoke their own mint).
  const actorRole = await resolveAccess(db, actorPrincipalId, row.scopePath);
  if (rank(actorRole) < ROLE_RANK.admin) {
    throw new AccessDeniedError(actorPrincipalId, row.scopePath, "admin");
  }

  await db.transaction(async (tx: DB) => {
    await updateTokenExpiry(tx, row.tokenId, input.expiresAt, actorPrincipalId);
    // The old expiry attention no longer reflects reality; the nightly sweep
    // (ensureConnectionExpiryAttention) re-creates one if the new expiry still warrants it.
    await dismissAttentionItemsInternal(tx, { kind: "connection_expiry", payloadTokenId: row.tokenId, note: "token expiry updated" });
    await emitEvent(tx, {
      type: "connection.expiry_updated",
      scopePath: row.scopePath,
      principalId: actorPrincipalId,
      payload: { tokenId: row.tokenId, scopePath: row.scopePath, expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null },
    });
  });
}

export async function listConnections(
  db: DB,
  input: ListConnectionsInput,
  actorPrincipalId: string
): Promise<ListedAdminConnection[]> {
  const scopePath = input.scopePath?.trim();
  const conditions: any[] = [isNotNull(connections.tokenId)];

  if (scopePath) {
    const scope = await getScope(db, scopePath);
    if (!scope) {
      throw new ScopeNotFoundError(scopePath);
    }
    await requireAdminAccess(db, actorPrincipalId, scopePath);
    conditions.push(subtreeCondition(scopePath));
  } else {
    const rootRole = await resolveAccess(db, actorPrincipalId, "root");
    if (rank(rootRole) < ROLE_RANK.admin) {
      throw new AccessDeniedError(
        actorPrincipalId,
        "root",
        "admin",
        "Fleet-wide connection listing requires root admin access. Pass an explicit scopePath for scoped listing."
      );
    }
  }

  if (input.principalId) {
    conditions.push(eq(principals.id, input.principalId));
  }
  if (input.activeSince) {
    conditions.push(gte(tokens.lastUsedAt, input.activeSince));
  }
  if (input.expiringWithin) {
    conditions.push(and(isNotNull(tokens.expiresAt), lte(tokens.expiresAt, input.expiringWithin)));
  }

  const rows = await db
    .select({
      tokenId: tokens.id,
      name: tokens.name,
      principalId: principals.id,
      principalName: principals.name,
      mintedBy: connections.mintedBy,
      role: grants.role,
      createdAt: connections.createdAt,
      expiresAt: tokens.expiresAt,
      lastUsedAt: tokens.lastUsedAt,
      revokedAt: tokens.revokedAt,
      scopePath: scopes.path,
    })
    .from(connections)
    .innerJoin(tokens, eq(connections.tokenId, tokens.id))
    .innerJoin(principals, eq(tokens.principalId, principals.id))
    .innerJoin(scopes, eq(connections.scopeId, scopes.id))
    .innerJoin(grants, and(eq(grants.principalId, principals.id), eq(grants.scopeId, connections.scopeId)))
    .where(and(...conditions))
    .orderBy(desc(connections.createdAt));

  const minterNames = await listMinterNames(db, Array.from(new Set((rows as any[]).map((row) => row.mintedBy))));

  const now = new Date();

  return (rows as any[])
    .filter((row) => row.role === "agent" || row.role === "viewer")
    .map((row) => ({
      tokenId: row.tokenId,
      name: row.name,
      principalId: row.principalId,
      principalName: row.principalName,
      mintedBy: row.mintedBy,
      mintedByName: minterNames.get(row.mintedBy) || row.mintedBy,
      role: row.role,
      memoryAccess: "on" as const,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      revoked: !!row.revokedAt,
      status: connectionTokenStatus(row, now),
      scopePath: row.scopePath,
    }));
}

export async function revokeScopeAccess(
  db: DB,
  input: { scopePath: string },
  actorPrincipalId: string
): Promise<{ revokedCount: number; scopePaths: string[] }> {
  const scopePath = input.scopePath.trim();
  const scope = await getScope(db, scopePath);
  if (!scope) {
    throw new ScopeNotFoundError(scopePath);
  }
  await requireAdminAccess(db, actorPrincipalId, scopePath);

  return db.transaction(async (tx: DB) => {
    const rows = (await tx
      .select({
        tokenId: tokens.id,
        scopePath: scopes.path,
      })
      .from(connections)
      .innerJoin(tokens, eq(connections.tokenId, tokens.id))
      .innerJoin(scopes, eq(connections.scopeId, scopes.id))
      .where(and(subtreeCondition(scopePath), isNull(tokens.revokedAt)))) as Array<{
        tokenId: string;
        scopePath: string;
      }>;

    for (const row of rows) {
      await revokeToken(tx, row.tokenId, actorPrincipalId);
      await dismissAttentionItemsInternal(tx, { kind: "connection_expiry", payloadTokenId: row.tokenId, note: "token revoked" });
    }

    const scopePaths = Array.from(new Set(rows.map((row) => row.scopePath))).sort();
    const result = { revokedCount: rows.length, scopePaths };

    await emitEvent(tx, {
      type: "connection.bulk_revoked",
      scopePath,
      principalId: actorPrincipalId,
      payload: { scopePath, revokedCount: result.revokedCount, scopePaths },
    });

    return result;
  });
}

export async function revokePrincipalAccess(
  db: DB,
  input: { principalId: string },
  actorPrincipalId: string
): Promise<{ revokedCount: number; scopePaths: string[] }> {
  const principalGrantScopes = (await db
    .select({ scopePath: scopes.path })
    .from(grants)
    .innerJoin(scopes, eq(grants.scopeId, scopes.id))
    .where(eq(grants.principalId, input.principalId))) as Array<{ scopePath: string }>;

  for (const grantScope of principalGrantScopes) {
    const actorRole = await resolveAccess(db, actorPrincipalId, grantScope.scopePath);
    if (rank(actorRole) < ROLE_RANK.admin) {
      throw new AccessDeniedError(actorPrincipalId, grantScope.scopePath, "admin");
    }
  }

  return db.transaction(async (tx: DB) => {
    const tokenRows = (await tx
      .select({ tokenId: tokens.id })
      .from(tokens)
      .where(and(eq(tokens.principalId, input.principalId), isNull(tokens.revokedAt)))) as Array<{
        tokenId: string;
      }>;

    let connectionScopes: Array<{ scopePath: string }> = [];
    if (tokenRows.length) {
      connectionScopes = (await tx
        .select({ scopePath: scopes.path })
        .from(connections)
        .innerJoin(scopes, eq(connections.scopeId, scopes.id))
        .where(inArray(connections.tokenId, tokenRows.map((row) => row.tokenId)))) as Array<{ scopePath: string }>;
    }

    for (const row of tokenRows) {
      await revokeToken(tx, row.tokenId, actorPrincipalId);
      await dismissAttentionItemsInternal(tx, { kind: "connection_expiry", payloadTokenId: row.tokenId, note: "token revoked" });
    }

    const fallbackScopePaths = principalGrantScopes.map((row) => ({ scopePath: row.scopePath }));
    const scopePaths = Array.from(
      new Set((connectionScopes.length ? connectionScopes : fallbackScopePaths).map((row) => row.scopePath))
    ).sort();
    const result = { revokedCount: tokenRows.length, scopePaths };

    await emitEvent(tx, {
      type: "connection.bulk_revoked",
      scopePath: scopePaths[0] ?? "root",
      principalId: actorPrincipalId,
      payload: { principalId: input.principalId, revokedCount: result.revokedCount, scopePaths },
    });

    return result;
  });
}
