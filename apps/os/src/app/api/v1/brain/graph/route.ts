import "server-only";
import { AccessDeniedError } from "@companyos/api";
import { api, getCurrentActorPrincipalId } from "@/lib/api";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function intParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

export async function GET(req: Request) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return jsonError("Unauthorized", 401);
  try {
    const url = new URL(req.url);
    const result = await api.getBrainGraph(
      {
        nodeLimit: intParam(url.searchParams.get("limit")),
        edgeLimit: intParam(url.searchParams.get("edgeLimit")),
      },
      actor
    );
    return Response.json(result);
  } catch (error) {
    if (error instanceof AccessDeniedError) return jsonError("Forbidden", 403);
    return jsonError(error instanceof Error ? error.message : "Bad request", 400);
  }
}
