export function health(): { ok: true } {
  return { ok: true };
}

// Kernel services
export * from "./kernel";

// Records module
export * from "./modules/records/service";

// Metrics module
export * from "./modules/metrics/service";

// Dashboards module
export * from "./modules/dashboards/service";

// Docs (KB) module
export * from "./modules/docs/service";
export * from "./modules/docs/follows";
export * from "./modules/docs/self-docs";

// Canvas module (M3-03)
export * from "./modules/canvas/service";

// Tasks module (Plane adapter)
export * from "./modules/tasks/service";
export { setProjectWorkspace } from "./modules/tasks/service";
export { PlaneClient, type PlaneConfig, type FetchLike } from "./modules/tasks/plane-client";

// Provisioning module (M4-04)
export * from "./modules/provisioning/service";
export * from "./modules/provisioning/agents-md";
export { GitHubClient, OrgNotFoundError, type GitHubConfig } from "./lib/github-client";
export * from "./lib/embeddings";

// Capabilities module (M4-05)
export * from "./modules/capabilities/service";

// Skills module (M4-06)
export * from "./modules/skills/service";

// Connect module (M6-02)
export * from "./modules/connect/service";

// Sessions module (M6-07)
export * from "./modules/sessions/service";

// Workbench events module (M7-02)
export * from "./modules/workbench-events/service";

// Search module (M6-09)
export * from "./modules/search/service";

// Scoped memory module (M8-03)
export * from "./modules/memory/service";

// Brain root-admin surfaces (M8-05)
export * from "./modules/brain-surfaces/service";

// Creation wizard intake (M8-04)
export * from "./modules/intake/service";

// Attention queue / approvals (M10-01)
export * from "./modules/attention/service";
export { isReservedOperationalWikiReportSlug } from "@companyos/db";

// Daily digest (M13-05)
export * from "./modules/digest/service";

// Assistants module (M13-01, M13-07)
export * from "./modules/assistants/service";

// Credential vault (M8-09)
export * from "./modules/credentials/service";

// Ops health module (M9-01)
export * from "./modules/health/service";

// Usage observability module (M7-03)
export * from "./modules/usage/service";

// Tenant admin module (M5-04)
export * from "./modules/admin/service";
export * from "./modules/admin/litellm";

// Agent HTTP / n8n support (M2-05)
export * from "./agent";

// Resident agent module (M3-04)
export * from "./modules/agent/service";

// Errors (typed)
export * from "./errors";

// DB handle type for clients like MCP
export type { DB } from "./kernel/events";

export { listOAuthConnections, touchOAuthConnection } from "./modules/connect/service";
