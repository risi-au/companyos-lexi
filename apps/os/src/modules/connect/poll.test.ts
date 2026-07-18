import { describe, expect, it } from "vitest";
import { shouldPollForConnection } from "./poll";

describe("shouldPollForConnection", () => {
  it("polls the OAuth lane on the setup step (auto-advance, no manual click)", () => {
    expect(shouldPollForConnection({ step: 2, oauthLane: true, connected: false, waiting: false })).toBe(true);
  });

  it("does NOT poll the token lane on the setup step", () => {
    expect(shouldPollForConnection({ step: 2, oauthLane: false, connected: false, waiting: false })).toBe(false);
  });

  it("polls both lanes on the verify step", () => {
    expect(shouldPollForConnection({ step: 3, oauthLane: true, connected: false, waiting: false })).toBe(true);
    expect(shouldPollForConnection({ step: 3, oauthLane: false, connected: false, waiting: false })).toBe(true);
  });

  it("does not poll on the platform-select step", () => {
    expect(shouldPollForConnection({ step: 1, oauthLane: true, connected: false, waiting: false })).toBe(false);
  });

  it("stops polling once connected", () => {
    expect(shouldPollForConnection({ step: 2, oauthLane: true, connected: true, waiting: false })).toBe(false);
    expect(shouldPollForConnection({ step: 3, oauthLane: true, connected: true, waiting: false })).toBe(false);
  });

  it("stops polling after the wait deadline lapsed", () => {
    expect(shouldPollForConnection({ step: 2, oauthLane: true, connected: false, waiting: true })).toBe(false);
    expect(shouldPollForConnection({ step: 3, oauthLane: false, connected: false, waiting: true })).toBe(false);
  });
});
