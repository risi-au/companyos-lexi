import { createHash } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  authenticateTokenWithMetadata,
  estimateTokens,
  logUsageEventSafely,
  type DB,
} from "@companyos/api";
import type { GitHubClient, PlaneClient } from "@companyos/api";
import { createServer } from "./server";

export interface HttpAuthenticatedPrincipal {
  principalId: string;
  tokenId?: string | null;
  oauthClientId?: string | null;
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

function jsonError(error: string, status: number, extra?: Record<string, unknown>, headers?: HeadersInit): Response {
  return Response.json({ error, ...(extra || {}) }, { status, headers });
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
  | { ok: true; parsedBody: unknown; rawText: string; byteLength: number }
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
    return { ok: true, parsedBody: JSON.parse(text), rawText: text, byteLength: body.byteLength };
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

  const authenticated = await authenticateTokenWithMetadata(db, token);
  if (!authenticated) {
    const e = new Error("Invalid or expired token") as Error & { status?: number };
    e.status = 401;
    throw e;
  }

  return { principalId: authenticated.principal.id, tokenId: authenticated.tokenId };
}

interface ToolCallTelemetry {
  operation: string;
  scopePath: string | null;
  sessionId: string | null;
  engine: string | null;
  model: string | null;
  metadata: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toolCallsFromJsonRpc(parsedBody: unknown): ToolCallTelemetry[] {
  const requests = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
  const calls: ToolCallTelemetry[] = [];
  for (const request of requests) {
    const req = asRecord(request);
    if (req.method !== "tools/call") continue;
    const params = asRecord(req.params);
    const args = asRecord(params.arguments);
    const operation = stringOrNull(params.name) || "unknown_tool";
    calls.push({
      operation,
      scopePath: stringOrNull(args.scope) || stringOrNull(args.scopePath),
      sessionId: stringOrNull(args.session_id) || stringOrNull(args.sessionId),
      engine: stringOrNull(args.engine),
      model: stringOrNull(args.model),
      metadata: {
        jsonrpcMethod: req.method,
        argumentKeys: Object.keys(args).sort(),
        requestIdType: req.id === null || req.id === undefined ? null : typeof req.id,
      },
    });
  }
  return calls;
}

async function responseBodyText(response: Response): Promise<string> {
  try {
    return await response.clone().text();
  } catch {
    return "";
  }
}

function jsonRpcResponseSuccess(text: string, status: number): { success: boolean; errorCode: string | null } {
  if (status >= 400) return { success: false, errorCode: String(status) };
  try {
    const parsed = JSON.parse(text);
    const responses = Array.isArray(parsed) ? parsed : [parsed];
    const failed = responses.find((item) => {
      const row = asRecord(item);
      const result = asRecord(row.result);
      return row.error || result.isError === true;
    });
    if (failed) {
      const row = asRecord(failed);
      const error = asRecord(row.error);
      return { success: false, errorCode: stringOrNull(error.code) || stringOrNull(error.message) || "tool_error" };
    }
  } catch {
    return { success: status < 400, errorCode: null };
  }
  return { success: true, errorCode: null };
}

function usageLoggingEnabled(): boolean {
  const enabled = process.env.USAGE_LOG_MCP_HTTP;
  if (enabled === "0" || enabled === "false") return false;
  const sampleRate = Number(process.env.USAGE_SAMPLE_RATE ?? "1");
  const normalized = Number.isFinite(sampleRate) ? Math.min(Math.max(sampleRate, 0), 1) : 1;
  return normalized >= 1 || Math.random() < normalized;
}

async function logMcpToolCalls(input: {
  db: DB;
  principal: HttpAuthenticatedPrincipal;
  parsedBody: unknown;
  rawText: string;
  byteIn: number;
  response: Response;
  startedAt: number;
}): Promise<void> {
  if (!usageLoggingEnabled()) return;
  const calls = toolCallsFromJsonRpc(input.parsedBody);
  if (calls.length === 0) return;

  const outputText = await responseBodyText(input.response);
  const inputEstimate = estimateTokens(input.rawText);
  const outputEstimate = estimateTokens(outputText);
  const result = jsonRpcResponseSuccess(outputText, input.response.status);
  const latencyMs = Date.now() - input.startedAt;

  for (const call of calls) {
    await logUsageEventSafely(input.db, {
      scopePath: call.scopePath,
      principalId: input.principal.principalId,
      tokenId: input.principal.tokenId ?? null,
      sessionId: call.sessionId,
      source: "mcp_http",
      engine: call.engine,
      model: call.model,
      operation: call.operation,
      inputTokensEst: inputEstimate.tokens,
      outputTokensEst: outputEstimate.tokens,
      byteIn: input.byteIn,
      byteOut: new TextEncoder().encode(outputText).byteLength,
      latencyMs,
      success: result.success,
      errorCode: result.errorCode,
      metadata: {
        ...call.metadata,
        estimated: true,
        httpStatus: input.response.status,
      },
    });
  }
}

export function createHttpHandler(options: CreateHttpHandlerOptions): (request: Request) => Promise<Response> {
  const allowedOrigins = options.allowedOrigins ?? defaultAllowedOrigins();
  const maxBodyBytes = options.maxBodyBytes ?? positiveNumber(process.env.MCP_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
  const rateLimit = {
    windowMs: options.rateLimit?.windowMs ?? positiveNumber(process.env.MCP_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS),
    maxRequests: options.rateLimit?.maxRequests ?? positiveNumber(process.env.MCP_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX),
  };

  return async function handleMcpHttp(request: Request): Promise<Response> {
    const startedAt = Date.now();
    const token = bearerToken(request);
    if (!token) {
      try {
        await (options.authenticateRequest ?? ((req) => defaultAuthenticateRequest(options.db, req)))(request);
      } catch (e) {
        const error = e as Error & { status?: number; wwwAuthenticate?: string };
        if (error.status === 401) {
          return jsonError("Unauthorized", 401, undefined, error.wwwAuthenticate ? { "WWW-Authenticate": error.wwwAuthenticate } : undefined);
        }
      }
      return jsonError("Unauthorized", 401);
    }

    const rateLimited = consumeRateLimit(token, rateLimit);
    if (rateLimited) return rateLimited;

    let principal: HttpAuthenticatedPrincipal;
    try {
      principal = await (options.authenticateRequest ?? ((req) => defaultAuthenticateRequest(options.db, req)))(request);
    } catch (e) {
      const error = e as Error & { status?: number; wwwAuthenticate?: string };
      const status = error.status;
      if (status === 401) {
        return jsonError("Unauthorized", 401, undefined, error.wwwAuthenticate ? { "WWW-Authenticate": error.wwwAuthenticate } : undefined);
      }
      return jsonError("Bad request", status || 400);
    }

    if (!originAllowed(request, allowedOrigins)) {
      return jsonError("Forbidden origin", 403);
    }

    let parsedBody: unknown;
    let rawText = "";
    let byteIn = 0;
    if (request.method === "POST") {
      const bodyResult = await readJsonBody(request, maxBodyBytes);
      if (!bodyResult.ok) return bodyResult.response;
      parsedBody = bodyResult.parsedBody;
      rawText = bodyResult.rawText;
      byteIn = bodyResult.byteLength;
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
      const response = await transport.handleRequest(request, { parsedBody });
      try {
        await logMcpToolCalls({
          db: options.db,
          principal,
          parsedBody,
          rawText,
          byteIn,
          response,
          startedAt,
        });
      } catch {
        // usage logging must never fail the MCP request itself
      }
      return response;
    } catch {
      return jsonRpcError(500, -32603, "Internal server error");
    } finally {
      await transport.close();
      await server.close();
    }
  };
}
