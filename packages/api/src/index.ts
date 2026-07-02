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

// Canvas module (M3-03)
export * from "./modules/canvas/service";

// Tasks module (Plane adapter)
export * from "./modules/tasks/service";
export { PlaneClient, type PlaneConfig, type FetchLike } from "./modules/tasks/plane-client";

// Agent HTTP / n8n support (M2-05)
export * from "./agent";

// Errors (typed)
export * from "./errors";

// DB handle type for clients like MCP
export type { DB } from "./kernel/events";
