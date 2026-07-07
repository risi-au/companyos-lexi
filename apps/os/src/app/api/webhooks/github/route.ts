import "server-only";
import { GitHubClient, handleGitHubWebhook, verifyGitHubWebhookSignature } from "@companyos/api";
import { db, jsonError } from "@/lib/agent-auth";

export const runtime = "nodejs";

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

function githubClientFromEnv(): GitHubClient | null {
  const token = process.env.GITHUB_TOKEN;
  const org = process.env.GITHUB_ORG;
  if (!token || !org) return null;
  return new GitHubClient({ token, org, baseUrl: process.env.GITHUB_API_URL || undefined });
}

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
    const skillsRepo = process.env.SKILLS_REPO;
    const githubOrg = process.env.GITHUB_ORG;
    const result = await handleGitHubWebhook(db, {
      event,
      deliveryId,
      payload,
      skillsSync: skillsRepo && githubOrg
        ? { org: githubOrg, repo: skillsRepo, client: githubClientFromEnv() }
        : undefined,
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "GitHub webhook failed", 400);
  }
}
