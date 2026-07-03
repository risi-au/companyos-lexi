import { describe, it, expect, vi, beforeEach } from "vitest";

const apiMock = vi.hoisted(() => {
  class CapabilityNotFoundError extends Error {
    public readonly scopePath: string;
    public readonly capabilityName: string;
    constructor(scopePath: string, name: string) {
      super(`Capability not found: ${name} in scope ${scopePath}`);
      this.name = "CapabilityNotFoundError";
      this.scopePath = scopePath;
      this.capabilityName = name;
    }
  }

  return {
    CapabilityNotFoundError,
    reportRun: vi.fn(),
    reportCapabilityRun: vi.fn(),
  };
});

vi.mock("@companyos/api", () => apiMock);

import { mapCapabilityReportBody, recordCapabilityReport } from "./logic";

describe("capability report route logic", () => {
  const db = {} as never;
  const principalId = "principal_1";

  beforeEach(() => {
    apiMock.reportRun.mockReset();
    apiMock.reportCapabilityRun.mockReset();
  });

  it("records a real run row for registered capabilities", async () => {
    apiMock.reportRun.mockResolvedValueOnce({ run: { id: "run_1" }, created: true });

    const result = await recordCapabilityReport(
      db,
      mapCapabilityReportBody({
        scope: "acme",
        capability: "nightly",
        status: "success",
        runId: "http-1",
        summary: "ok",
      }),
      principalId
    );

    expect(result).toEqual({ ok: true, reported: "nightly", recorded: "run" });
    expect(apiMock.reportRun).toHaveBeenCalledWith(db, expect.objectContaining({
      scopePath: "acme",
      name: "nightly",
      status: "success",
      runRef: "http-1",
      summary: "ok",
    }), principalId);
    expect(apiMock.reportCapabilityRun).not.toHaveBeenCalled();
  });

  it("falls back to event-only for unregistered capabilities", async () => {
    apiMock.reportRun.mockRejectedValueOnce(new apiMock.CapabilityNotFoundError("acme", "legacy-only"));
    apiMock.reportCapabilityRun.mockResolvedValueOnce(undefined);

    const input = mapCapabilityReportBody({
      scope: "acme",
      capability: "legacy-only",
      status: "success",
      runId: "http-legacy-1",
    });
    const result = await recordCapabilityReport(db, input, principalId);

    expect(result).toEqual({ ok: true, reported: "legacy-only", recorded: "event-only" });
    expect(apiMock.reportCapabilityRun).toHaveBeenCalledWith(db, input, principalId);
  });

  it("stays event-only for scoped reports with legacy/missing statuses", async () => {
    apiMock.reportCapabilityRun.mockResolvedValue(undefined);

    for (const body of [
      { scope: "acme", capability: "legacy-status", status: "ok" },
      { scope: "acme", capability: "legacy-status" },
    ]) {
      const result = await recordCapabilityReport(db, mapCapabilityReportBody(body), principalId);
      expect(result).toEqual({ ok: true, reported: "legacy-status", recorded: "event-only" });
    }

    expect(apiMock.reportRun).not.toHaveBeenCalled();
    expect(apiMock.reportCapabilityRun).toHaveBeenCalledTimes(2);
  });
});
