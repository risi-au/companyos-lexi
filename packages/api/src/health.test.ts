import { describe, expect, it } from "vitest";
import { health } from "./index";

describe("health", () => {
  it("returns ok: true", () => {
    expect(health()).toEqual({ ok: true });
  });
});