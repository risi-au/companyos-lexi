import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getGoogleProviderConfig, isGoogleAuthEnabled } from "./google-auth";

const originalClientId = process.env.GOOGLE_CLIENT_ID;
const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;

function setGoogleConfig(clientId?: string, clientSecret?: string) {
  if (clientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = clientId;

  if (clientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = clientSecret;
}

afterEach(() => {
  setGoogleConfig(originalClientId, originalClientSecret);
});

describe("Google auth configuration", () => {
  it("enables Google only when both non-empty credentials are configured", () => {
    setGoogleConfig("  test-client-id  ", "  test-client-secret  ");

    expect(isGoogleAuthEnabled()).toBe(true);
    expect(getGoogleProviderConfig()).toEqual({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });
  });

  it.each([
    [undefined, undefined],
    ["", "test-client-secret"],
    ["   ", "test-client-secret"],
    ["test-client-id", undefined],
    ["test-client-id", ""],
    ["test-client-id", "   "],
  ])("disables Google when credentials are absent, blank, or partial", (clientId, clientSecret) => {
    setGoogleConfig(clientId, clientSecret);

    expect(isGoogleAuthEnabled()).toBe(false);
    expect(getGoogleProviderConfig()).toBeUndefined();
  });
});
