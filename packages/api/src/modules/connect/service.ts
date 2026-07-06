/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
  connections,
  grants,
  principals,
  scopes,
  tokens,
  type Grant,
  type Token,
} from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { grantRole, resolveAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { issueToken, revokeToken } from "../../kernel/tokens";
import { AccessDeniedError, ScopeNotFoundError, TokenNotFoundError } from "../../errors";

export type ConnectionRole = "agent" | "viewer";

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
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revoked: boolean;
  canRevoke: boolean;
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
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      revoked: !!row.revokedAt,
      canRevoke: !row.revokedAt && (actorIsAdmin || (actorIsEditor && row.mintedBy === actorPrincipalId)),
    }));
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
    await emitEvent(tx, {
      type: "connection.revoked",
      scopePath: row.scopePath,
      principalId: actorPrincipalId,
      payload: { tokenId: row.tokenId, scopePath: row.scopePath },
    });
  });
}
