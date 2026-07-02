/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";
import { emitEvent, findScopeByPlaneProject, verifyPlaneWebhookSignature } from "@companyos/api";
import { jsonError, db } from "@/lib/agent-auth";

const PLANE_WEBHOOK_SECRET = process.env.PLANE_WEBHOOK_SECRET || "";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-plane-signature") || req.headers.get("X-Plane-Signature");

  let payload: Record<string, any>;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    // still process? but log unhandled
    await emitEvent(db, {
      type: "webhook.unhandled",
      scopePath: null,
      principalId: null,
      payload: { reason: "invalid_json", source: "plane" },
    });
    return Response.json({ ok: true }, { status: 200 });
  }

  const isPlane = !signature || !PLANE_WEBHOOK_SECRET ? true : verifyPlaneWebhookSignature(rawBody, signature, PLANE_WEBHOOK_SECRET);
  if (!isPlane) {
    // invalid sig -> 403 but still don't 5xx per spec? Brief says verify, on fail should reject.
    // per "verify via shared secret", return 403 on bad sig
    return jsonError("Invalid signature", 403);
  }

  const event = payload?.event || payload?.type || "unknown";
  const action = payload?.action || "";
  const data = payload?.data || payload || {};

  // Extract project id from common shapes
  const projectId =
    data?.project ||
    data?.project_id ||
    data?.project_detail?.id ||
    data?.workspace_detail?.id ||
    null;

  // labels may be present
  let labelId: string | null = null;
  if (Array.isArray(data?.labels) && data.labels.length) {
    labelId = typeof data.labels[0] === "string" ? data.labels[0] : data.labels[0]?.id || null;
  } else if (data?.label) {
    labelId = typeof data.label === "string" ? data.label : data.label?.id || null;
  }

  try {
    if (event === "issue" || event === "work_item" || event === "issue_comment" /* allow broader */) {
      let scopePath: string | null = null;
      if (projectId) {
        const link = await findScopeByPlaneProject(db, String(projectId), labelId);
        if (link) scopePath = link.scopePath;
      }

      const issueId = data?.id || data?.issue_id || null;
      const stateGroup = data?.state?.group || data?.state_detail?.group || data?.state?.name || "";
      const isCompleted = /completed|done|closed/i.test(String(stateGroup)) || stateGroup === "completed";

      if (isCompleted && (action === "update" || action === "updated")) {
        await emitEvent(db, {
          type: "task.completed_external",
          scopePath: scopePath || null,
          principalId: null,
          payload: {
            source: "plane",
            planeProjectId: projectId,
            planeIssueId: issueId,
            planeLabelId: labelId,
            action,
            data: { id: issueId, name: data?.name || data?.title, state: data?.state || null },
          },
        });
      } else {
        await emitEvent(db, {
          type: "task.updated_external",
          scopePath: scopePath || null,
          principalId: null,
          payload: {
            source: "plane",
            planeProjectId: projectId,
            planeIssueId: issueId,
            action,
            data: { id: issueId, name: data?.name || data?.title },
          },
        });
      }
    } else {
      await emitEvent(db, {
        type: "webhook.unhandled",
        scopePath: null,
        principalId: null,
        payload: { source: "plane", event, action, note: "non-issue event" },
      });
    }
  } catch (e: unknown) {
    // never 500; log unhandled
    const msg = e instanceof Error ? e.message : String(e);
    await emitEvent(db, {
      type: "webhook.unhandled",
      scopePath: null,
      principalId: null,
      payload: { source: "plane", error: msg, event: (payload as any)?.event },
    });
  }

  return Response.json({ ok: true }, { status: 200 });
}
