export { createServer, type CreateServerOptions } from "./server";
export { createHttpHandler, type CreateHttpHandlerOptions } from "./http";
export type { PlaneClient } from "@companyos/api";

export function ping(): string {
  return "pong";
}
