import { randomBytes, createHash } from "node:crypto";
import { eq, and, isNull, or, gt } from "drizzle-orm";
import { tokens, principals } from "@companyos/db";
import type { Principal, Token } from "@companyos/db";
import { emitEvent, type DB } from "./events";
import { TokenNotFoundError } from "../errors";

/* eslint-disable @typescript-eslint/no-explicit-any */

const TOKEN_PREFIX = "cos_";
const TOKEN_RANDOM_BYTES = 32;

function generatePlaintextToken(): string {
  const bytes = randomBytes(TOKEN_RANDOM_BYTES);
  // base64url without padding
  const b64 = bytes.toString("base64url");
  return `${TOKEN_PREFIX}${b64}`;
}

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export interface IssueTokenInput {
  principalId: string;
  name: string;
  expiresAt?: Date | null;
}

export async function issueToken(
  db: DB,
  input: IssueTokenInput,
  actor?: string | null
): Promise<string> {
  const { principalId, name, expiresAt = null } = input;

  const plaintext = generatePlaintextToken();
  const tokenHash = hashToken(plaintext);

  const [created] = (await db
    .insert(tokens)
    .values({
      principalId,
      name,
      tokenHash,
      expiresAt,
      revokedAt: null,
    })
    .returning()) as Token[];

  if (!created) {
    throw new Error("Failed to issue token");
  }

  await emitEvent(db, {
    type: "token.issued",
    principalId: actor ?? principalId ?? null,
    payload: { name, tokenId: created.id, principalId },
  });

  // return plaintext exactly once
  return plaintext;
}

export async function authenticateToken(
  db: DB,
  plaintext: string
): Promise<Principal | null> {
  if (!plaintext || !plaintext.startsWith(TOKEN_PREFIX)) {
    return null;
  }

  const tokenHash = hashToken(plaintext);
  const now = new Date();

  const [token] = (await db
    .select()
    .from(tokens)
    .where(
      and(
        eq(tokens.tokenHash, tokenHash),
        isNull(tokens.revokedAt),
        or(
          isNull(tokens.expiresAt),
          // expiresAt > now
          gt(tokens.expiresAt, now)
        )
      )
    )
    .limit(1)) as Token[];

  if (!token) {
    return null;
  }

  // update last_used_at
  await db
    .update(tokens)
    .set({ lastUsedAt: now })
    .where(eq(tokens.id, token.id));

  // fetch principal
  const [principal] = (await db
    .select()
    .from(principals)
    .where(eq(principals.id, token.principalId))
    .limit(1)) as Principal[];

  return principal ?? null;
}

export async function revokeToken(
  db: DB,
  tokenId: string,
  actor?: string | null
): Promise<void> {
  const [existing] = await db
    .select()
    .from(tokens)
    .where(eq(tokens.id, tokenId))
    .limit(1);

  if (!existing) {
    throw new TokenNotFoundError(tokenId);
  }

  await db
    .update(tokens)
    .set({ revokedAt: new Date() })
    .where(eq(tokens.id, tokenId));

  await emitEvent(db, {
    type: "token.revoked",
    principalId: actor ?? (existing as any).principalId ?? null,
    payload: { tokenId, name: (existing as any).name },
  });
}
