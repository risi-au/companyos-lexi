import { createHash } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateToken, type DB } from "@companyos/api";
import type { GitHubClient, PlaneClient } from "@companyos/api";
import { createServer } from "./server";

export interface HttpAuthenticatedPrincipal {
  principalId: string;
}

export interface HttpRateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
}

export interface CreateHttpHandlerOptions {
  db: DB;
  planeClient?: PlaneClient | null;
  githubClient?: GitHubClient | null;
  authenticateRequest?: (request: Request) => Promise<HttpAuthenticatedPrincipal>;
  allowedOrigins?: string[];
  maxBodyBytes?: number;
  rateLimit?: HttpRateLimitOptions;
  mcpPublicUrl?: string | null;
}

interface Bucket {
  resetAt: number;
  remaining: number;
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 120;

const buckets = new Map<string, Bucket>();

function jsonError(error: string, status: number, extra?: Record<string, unknown>): Response {
  return Response.json({ error, ...(extra || {}) }, { status });
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });
}

function bearerToken(request: Request): string | null {
  const authz = request.headers.get("authorization");
  if (!authz || !authz.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = authz.slice(7).trim();
  return token || null;
}

function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function originFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function defaultAllowedOrigins(): string[] {
  const explicit = parseCsv(process.env.MCP_ALLOWED_ORIGINS);
  if (explicit.length > 0) return explicit;

  const derived = [
    originFromUrl(process.env.MCP_PUBLIC_URL),
    originFromUrl(process.env.COMPANYOS_URL),
  ].filter((origin): origin is string => Boolean(origin));

  return Array.from(new Set(derived));
}

function originAllowed(request: Request, allowedOrigins: string[]): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

function consumeRateLimit(token: string, options: Required<HttpRateLimitOptions>): Response | null {
  const key = tokenFingerprint(token);
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { resetAt: now + options.windowMs, remaining: options.maxRequests - 1 });
    return null;
  }

  if (existing.remaining <= 0) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return jsonError("Rate limit exceeded", 429, { retryAfterSeconds });
  }

  existing.remaining -= 1;
  return null;
}

async function readJsonBody(request: Request, maxBodyBytes: number): Promise<
  | { ok: true; parsedBody: unknown }
  | { ok: false; response: Response }
> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
      return { ok: false, response: jsonError("Request body too large", 413) };
    }
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > maxBodyBytes) {
    return { ok: false, response: jsonError("Request body too large", 413) };
  }

  const text = new TextDecoder().decode(body);
  if (!text.trim()) {
    return { ok: false, response: jsonRpcError(400, -32700, "Parse error: Invalid JSON") };
  }

  try {
    return { ok: true, parsedBody: JSON.parse(text) };
  } catch {
    return { ok: false, response: jsonRpcError(400, -32700, "Parse error: Invalid JSON") };
  }
}

async function defaultAuthenticateRequest(db: DB, request: Request): Promise<HttpAuthenticatedPrincipal> {
  const token = bearerToken(request);
  if (!token) {
    const e = new Error("Missing Authorization header") as Error & { status?: number };
    e.status = 401;
    throw e;
  }

  const principal = await authenticateToken(db, token);
  if (!principal) {
    const e = new Error("Invalid or expired token") as Error & { status?: number };
    e.status = 401;
    throw e;
  }

  return { principalId: principal.id };
}

export function createHttpHandler(options: CreateHttpHandlerOptions): (request: Request) => Promise<Response> {
  const allowedOrigins = options.allowedOrigins ?? defaultAllowedOrigins();
  const maxBodyBytes = options.maxBodyBytes ?? positiveNumber(process.env.MCP_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
  const rateLimit = {
    windowMs: options.rateLimit?.windowMs ?? positiveNumber(process.env.MCP_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS),
    maxRequests: options.rateLimit?.maxRequests ?? positiveNumber(process.env.MCP_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX),
  };

  return async function handleMcpHttp(request: Request): Promise<Response> {
    const token = bearerToken(request);
    if (!token) {
      return jsonError("Unauthorized", 401);
    }

    const rateLimited = consumeRateLimit(token, rateLimit);
    if (rateLimited) return rateLimited;

    let principal: HttpAuthenticatedPrincipal;
    try {
      principal = await (options.authenticateRequest ?? ((req) => defaultAuthenticateRequest(options.db, req)))(request);
    } catch (e) {
      const status = (e as Error & { status?: number }).status;
      if (status === 401) {
        return jsonError("Unauthorized", 401);
      }
      return jsonError("Bad request", status || 400);
    }

    if (!originAllowed(request, allowedOrigins)) {
      return jsonError("Forbidden origin", 403);
    }

    let parsedBody: unknown;
    if (request.method === "POST") {
      const bodyResult = await readJsonBody(request, maxBodyBytes);
      if (!bodyResult.ok) return bodyResult.response;
      parsedBody = bodyResult.parsedBody;
    }

    const server = createServer({
      db: options.db,
      principalId: principal.principalId,
      planeClient: options.planeClient,
      githubClient: options.githubClient,
      mcpPublicUrl: options.mcpPublicUrl ?? process.env.MCP_PUBLIC_URL ?? null,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    try {
      await server.connect(transport);
      return await transport.handleRequest(request, { parsedBody });
    } catch {
      return jsonRpcError(500, -32603, "Internal server error");
    } finally {
      await transport.close();
      await server.close();
    }
  };
}
