export function health(): { ok: true } {
  return { ok: true };
}

// Kernel services
export * from "./kernel";

// Errors (typed)
export * from "./errors";
