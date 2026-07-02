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

// Tasks module (Plane adapter)
export * from "./modules/tasks/service";
export { PlaneClient, type PlaneConfig, type FetchLike } from "./modules/tasks/plane-client";

// Errors (typed)
export * from "./errors";

// DB handle type for clients like MCP
export type { DB } from "./kernel/events";
