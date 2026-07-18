import { afterEach, describe, expect, it } from "vitest";
import { applyIssParamAdvertisement, shouldAdvertiseIssParam } from "./oauth-metadata";

const original = process.env.OAUTH_ADVERTISE_ISS_PARAM;
afterEach(() => {
  if (original === undefined) delete process.env.OAUTH_ADVERTISE_ISS_PARAM;
  else process.env.OAUTH_ADVERTISE_ISS_PARAM = original;
});

describe("shouldAdvertiseIssParam", () => {
  it("defaults to false when the env var is unset", () => {
    delete process.env.OAUTH_ADVERTISE_ISS_PARAM;
    expect(shouldAdvertiseIssParam()).toBe(false);
  });

  it("is false for any value other than the literal 'true'", () => {
    process.env.OAUTH_ADVERTISE_ISS_PARAM = "1";
    expect(shouldAdvertiseIssParam()).toBe(false);
    process.env.OAUTH_ADVERTISE_ISS_PARAM = "false";
    expect(shouldAdvertiseIssParam()).toBe(false);
  });

  it("is true only for the literal 'true'", () => {
    process.env.OAUTH_ADVERTISE_ISS_PARAM = "true";
    expect(shouldAdvertiseIssParam()).toBe(true);
  });
});

describe("applyIssParamAdvertisement", () => {
  const base = {
    issuer: "https://cos-staging.risi.au",
    authorization_endpoint: "https://cos-staging.risi.au/api/auth/oauth2/authorize",
    authorization_response_iss_parameter_supported: true,
  } as const;

  it("downgrades the flag to false when advertising is disabled, preserving other fields", () => {
    const result = applyIssParamAdvertisement({ ...base }, false);
    expect(result.authorization_response_iss_parameter_supported).toBe(false);
    expect(result.issuer).toBe("https://cos-staging.risi.au");
    expect(result.authorization_endpoint).toBe(base.authorization_endpoint);
  });

  it("does not mutate the input object", () => {
    const input = { ...base };
    applyIssParamAdvertisement(input, false);
    expect(input.authorization_response_iss_parameter_supported).toBe(true);
  });

  it("returns the same reference (no-op) when advertising is enabled", () => {
    const input = { ...base };
    expect(applyIssParamAdvertisement(input, true)).toBe(input);
  });

  it("returns the same reference (no-op) when the flag is already absent/not true", () => {
    const input = { issuer: "https://cos-staging.risi.au" } as Record<string, unknown>;
    expect(applyIssParamAdvertisement(input, false)).toBe(input);
  });
});
