import { describe, expect, it } from "vitest";
import { labelForEventType } from "./labels";

describe("labelForEventType", () => {
  it("renders known event types as human titles", () => {
    expect(labelForEventType("capability.run_reported")).toBe("Capability run reported");
    expect(labelForEventType("token.issued")).toBe("Token issued");
  });

  it("falls back without exposing separators", () => {
    expect(labelForEventType("custom.event_name")).toBe("Custom Event Name");
  });
});
