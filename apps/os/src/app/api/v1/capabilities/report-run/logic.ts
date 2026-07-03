import {
  CapabilityNotFoundError,
  reportCapabilityRun,
  reportRun,
  type DB,
} from "@companyos/api";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CapabilityReportRouteInput {
  scopePath?: string;
  capability: string;
  status?: string;
  summary?: string;
  runId?: string;
  durationMs?: number;
  alert?: unknown;
  [key: string]: unknown;
}

export interface CapabilityReportRouteResult {
  ok: true;
  reported: string;
  recorded: "run" | "event-only";
}

const VALID_RUN_STATUSES = new Set(["running", "success", "error"]);

function payloadFromBody(body: any): Record<string, unknown> {
  if (body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload)) {
    return body.payload as Record<string, unknown>;
  }
  return body && typeof body === "object" ? { ...body } : {};
}

function legacyFallbackInput(input: CapabilityReportRouteInput): CapabilityReportRouteInput {
  const rest = { ...input };
  delete rest.alert;
  return rest;
}

export function mapCapabilityReportBody(body: any): CapabilityReportRouteInput {
  return {
    scopePath: (body?.scope ?? body?.scopePath) as string | undefined,
    capability: (body?.capability ?? body?.name ?? "unknown") as string,
    status: body?.status,
    summary: body?.summary,
    runId: body?.runRef ?? body?.runId ?? body?.id,
    durationMs: body?.durationMs,
    ...body,
  };
}

export async function recordCapabilityReport(
  db: DB,
  input: CapabilityReportRouteInput,
  actorPrincipalId: string
): Promise<CapabilityReportRouteResult> {
  if (!input.capability) {
    throw new Error("capability (or name) is required");
  }

  // Legacy reporters may omit scope or send statuses outside the run enum;
  // the HTTP edge stays lenient and degrades to event-only telemetry.
  if (!input.scopePath || !VALID_RUN_STATUSES.has(String(input.status))) {
    await reportCapabilityRun(db, legacyFallbackInput(input), actorPrincipalId);
    return { ok: true, reported: input.capability, recorded: "event-only" };
  }

  try {
    await reportRun(
      db,
      {
        scopePath: input.scopePath,
        name: input.capability,
        status: input.status as any,
        runRef: input.runRef as string | undefined ?? input.runId,
        summary: input.summary,
        durationMs: input.durationMs,
        startedAt: input.startedAt as string | Date | undefined,
        finishedAt: input.finishedAt as string | Date | null | undefined,
        payload: payloadFromBody(input),
        alert: input.alert as any,
      },
      actorPrincipalId
    );
    return { ok: true, reported: input.capability, recorded: "run" };
  } catch (error) {
    if (!(error instanceof CapabilityNotFoundError)) {
      throw error;
    }
    await reportCapabilityRun(db, legacyFallbackInput(input), actorPrincipalId);
    return { ok: true, reported: input.capability, recorded: "event-only" };
  }
}
