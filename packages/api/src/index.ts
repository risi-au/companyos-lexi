export function health(): { ok: true } {
  return { ok: true };
}

// Kernel services
export * from "./kernel";

// Records module
export * from "./modules/records/service";

// Errors (typed)
export * from "./errors";

// DB handle type for clients like MCP
export type { DB } from "./kernel/events";
