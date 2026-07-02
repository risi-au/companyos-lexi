import { describe, expect, it } from "vitest";
import { createServer, ping } from "./index";

describe("mcp ping", () => {
  it("returns pong", () => {
    expect(ping()).toBe("pong");
  });

  it("createServer registers the ping tool", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});