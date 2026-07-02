export { createServer, type CreateServerOptions } from "./server";
export type { PlaneClient } from "@companyos/api";

export function ping(): string {
  return "pong";
}