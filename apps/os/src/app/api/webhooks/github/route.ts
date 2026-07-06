import "server-only";
import { handleGitHubWebhook, verifyGitHubWebhookSignature } from "@companyos/api";
import { db, jsonError } from "@/lib/agent-auth";

export const runtime = "nodejs";

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const event = req.headers.get("x-github-event") || "";
  const deliveryId = req.headers.get("x-github-delivery") || "";

  if (!GITHUB_WEBHOOK_SECRET) {
    return jsonError("GitHub webhook secret is not configured", 500);
  }
  if (!verifyGitHubWebhookSignature(rawBody, signature, GITHUB_WEBHOOK_SECRET)) {
    return jsonError("Invalid signature", 403);
  }
  if (!deliveryId) {
    return jsonError("Missing X-GitHub-Delivery", 400);
  }
  if (!["ping", "push", "pull_request"].includes(event)) {
    return Response.json({ ok: true, ignored: true }, { status: 200 });
  }

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return jsonError("Invalid JSON payload", 400);
  }

  try {
    const result = await handleGitHubWebhook(db, { event, deliveryId, payload });
    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "GitHub webhook failed", 400);
  }
}
