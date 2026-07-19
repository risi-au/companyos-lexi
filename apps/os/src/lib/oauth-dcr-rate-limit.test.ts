import { describe, expect, it } from "vitest";
import { getOauthDcrRateLimit } from "./oauth-dcr-rate-limit";

describe("getOauthDcrRateLimit", () => {
  it("uses the documented upstream-compatible defaults", () => {
    expect(getOauthDcrRateLimit({})).toEqual({ window: 60, max: 5 });
  });

  it("uses valid positive-integer environment overrides", () => {
    expect(getOauthDcrRateLimit({
      OAUTH_DCR_RATE_LIMIT_WINDOW_SECONDS: "120",
      OAUTH_DCR_RATE_LIMIT_MAX: "10",
    })).toEqual({ window: 120, max: 10 });
  });

  it("falls back safely for unset, invalid, zero, and negative overrides", () => {
    expect(getOauthDcrRateLimit({
      OAUTH_DCR_RATE_LIMIT_WINDOW_SECONDS: "0",
      OAUTH_DCR_RATE_LIMIT_MAX: "-1",
    })).toEqual({ window: 60, max: 5 });

    expect(getOauthDcrRateLimit({
      OAUTH_DCR_RATE_LIMIT_WINDOW_SECONDS: "1.5",
      OAUTH_DCR_RATE_LIMIT_MAX: "five",
    })).toEqual({ window: 60, max: 5 });
  });
});
