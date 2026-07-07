import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { credentials, type Credential } from "@companyos/db";
import { emitEvent, type DB } from "../../kernel/events";
import { requireAccess } from "../../kernel/grants";
import { getScope } from "../../kernel/scopes";
import { ScopeNotFoundError } from "../../errors";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export class CredentialNotFoundError extends Error {
  public readonly scopePath: string;
  public readonly credentialName: string;

  constructor(scopePath: string, credentialName: string) {
    super(`Credential not found: ${credentialName} in ${scopePath}`);
    this.name = "CredentialNotFoundError";
    this.scopePath = scopePath;
    this.credentialName = credentialName;
  }
}

export class VaultNotConfiguredError extends Error {
  constructor() {
    super("vault-not-configured: COS_VAULT_KEY must be a 32-byte base64 key to use the credential vault");
    this.name = "VaultNotConfiguredError";
  }
}

export interface SetCredentialInput {
  scopePath: string;
  name: string;
  description?: string | null;
  value: string;
}

export interface ListCredentialRow {
  id: string;
  name: string;
  description: string;
  setAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date | null;
  hasValue: true;
}

function vaultKey(): Buffer {
  const raw = process.env.COS_VAULT_KEY?.trim();
  if (!raw) throw new VaultNotConfiguredError();
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new VaultNotConfiguredError();
  }
  if (key.length !== 32) throw new VaultNotConfiguredError();
  return key;
}

function encryptValue(value: string): Pick<Credential, "valueCiphertext" | "valueIv" | "valueTag"> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, vaultKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    valueCiphertext: ciphertext.toString("base64"),
    valueIv: iv.toString("base64"),
    valueTag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptValue(row: Pick<Credential, "valueCiphertext" | "valueIv" | "valueTag">): string {
  const decipher = createDecipheriv(ALGORITHM, vaultKey(), Buffer.from(row.valueIv, "base64"));
  decipher.setAuthTag(Buffer.from(row.valueTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.valueCiphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

async function requireScope(db: DB, scopePath: string) {
  const scope = await getScope(db, scopePath);
  if (!scope) throw new ScopeNotFoundError(scopePath);
  return scope;
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error("Credential name is required");
  return normalized;
}

export async function setCredential(
  db: DB,
  input: SetCredentialInput,
  actorPrincipalId: string
): Promise<ListCredentialRow> {
  const scopePath = input.scopePath.trim();
  const scope = await requireScope(db, scopePath);
  await requireAccess(db, actorPrincipalId, scopePath, "admin");

  const name = normalizeName(input.name);
  const description = input.description?.trim() ?? "";
  const encrypted = encryptValue(input.value);
  const now = new Date();

  return db.transaction(async (tx: DB) => {
    const [existing] = (await tx
      .select()
      .from(credentials)
      .where(and(eq(credentials.scopeId, scope.id), eq(credentials.name, name)))
      .limit(1)) as Credential[];

    let saved: Credential;
    if (existing) {
      const [updated] = (await tx
        .update(credentials)
        .set({
          description,
          ...encrypted,
          updatedAt: now,
        })
        .where(eq(credentials.id, existing.id))
        .returning()) as Credential[];
      if (!updated) throw new Error("Failed to update credential");
      saved = updated;
    } else {
      const [created] = (await tx
        .insert(credentials)
        .values({
          scopeId: scope.id,
          name,
          description,
          ...encrypted,
          createdBy: actorPrincipalId,
        })
        .returning()) as Credential[];
      if (!created) throw new Error("Failed to create credential");
      saved = created;
    }

    await emitEvent(tx, {
      type: existing ? "credential.updated" : "credential.created",
      scopePath,
      principalId: actorPrincipalId,
      payload: { credentialId: saved.id, name },
    });

    return toListedCredential(saved);
  });
}

export async function listCredentials(
  db: DB,
  input: { scopePath: string },
  actorPrincipalId: string
): Promise<ListCredentialRow[]> {
  const scopePath = input.scopePath.trim();
  const scope = await requireScope(db, scopePath);
  await requireAccess(db, actorPrincipalId, scopePath, "viewer");

  const rows = (await db
    .select({
      id: credentials.id,
      name: credentials.name,
      description: credentials.description,
      createdAt: credentials.createdAt,
      updatedAt: credentials.updatedAt,
      lastAccessedAt: credentials.lastAccessedAt,
    })
    .from(credentials)
    .where(eq(credentials.scopeId, scope.id))
    .orderBy(desc(credentials.updatedAt))) as Array<{
      id: string;
      name: string;
      description: string;
      createdAt: Date;
      updatedAt: Date;
      lastAccessedAt: Date | null;
    }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    setAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastAccessedAt: row.lastAccessedAt,
    hasValue: true,
  }));
}

export async function getCredentialValue(
  db: DB,
  input: { scopePath: string; name: string },
  actorPrincipalId: string
): Promise<{ name: string; value: string }> {
  const scopePath = input.scopePath.trim();
  const scope = await requireScope(db, scopePath);
  await requireAccess(db, actorPrincipalId, scopePath, "agent");
  const name = normalizeName(input.name);

  const [row] = (await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.scopeId, scope.id), eq(credentials.name, name)))
    .limit(1)) as Credential[];
  if (!row) throw new CredentialNotFoundError(scopePath, name);

  const value = decryptValue(row);
  const now = new Date();
  await db.transaction(async (tx: DB) => {
    await tx
      .update(credentials)
      .set({ lastAccessedAt: now })
      .where(eq(credentials.id, row.id));
    await emitEvent(tx, {
      type: "credential.accessed",
      scopePath,
      principalId: actorPrincipalId,
      payload: { credentialId: row.id, name },
    });
  });

  return { name: row.name, value };
}

export async function deleteCredential(
  db: DB,
  input: { scopePath: string; name: string },
  actorPrincipalId: string
): Promise<void> {
  const scopePath = input.scopePath.trim();
  const scope = await requireScope(db, scopePath);
  await requireAccess(db, actorPrincipalId, scopePath, "admin");
  const name = normalizeName(input.name);

  const [row] = (await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.scopeId, scope.id), eq(credentials.name, name)))
    .limit(1)) as Array<{ id: string }>;
  if (!row) return;

  await db.transaction(async (tx: DB) => {
    await tx.delete(credentials).where(eq(credentials.id, row.id));
    await emitEvent(tx, {
      type: "credential.deleted",
      scopePath,
      principalId: actorPrincipalId,
      payload: { credentialId: row.id, name },
    });
  });
}

function toListedCredential(row: Credential): ListCredentialRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    setAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastAccessedAt: row.lastAccessedAt,
    hasValue: true,
  };
}
