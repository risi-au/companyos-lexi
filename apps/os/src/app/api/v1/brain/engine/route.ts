import "server-only";
import { AccessDeniedError } from "@companyos/api";
import { api, getCurrentActorPrincipalId } from "@/lib/api";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return jsonError("Unauthorized", 401);
  try {
    return Response.json(await api.getBrainEngineOps({}, actor));
  } catch (error) {
    if (error instanceof AccessDeniedError) return jsonError("Forbidden", 403);
    return jsonError(error instanceof Error ? error.message : "Bad request", 400);
  }
}
