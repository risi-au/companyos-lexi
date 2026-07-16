import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoadSequence, DOC_LOAD_TIMEOUT_MS, DocLoadTimeoutError, withTimeout } from "./doc-load";

// Regression guards for issue #54: a wiki page click whose server action never
// settles (Next.js drops actions superseded by a navigation) left the center
// pane on "Loading page..." forever. Loads must escape via timeout, and stale
// loads must never apply state over a newer selection.
describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with DocLoadTimeoutError when the promise never settles", async () => {
    const hung = new Promise<never>(() => {});
    const guarded = withTimeout(hung, DOC_LOAD_TIMEOUT_MS);
    const outcome = expect(guarded).rejects.toBeInstanceOf(DocLoadTimeoutError);
    await vi.advanceTimersByTimeAsync(DOC_LOAD_TIMEOUT_MS);
    await outcome;
  });

  it("resolves with the value when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve("doc"), DOC_LOAD_TIMEOUT_MS)).resolves.toBe("doc");
  });

  it("propagates the original rejection when the promise fails in time", async () => {
    const boom = new Error("boom");
    await expect(withTimeout(Promise.reject(boom), DOC_LOAD_TIMEOUT_MS)).rejects.toBe(boom);
  });

  it("does not reject after a successful resolution once the timeout elapses", async () => {
    const onRejected = vi.fn();
    const guarded = withTimeout(Promise.resolve("doc"), DOC_LOAD_TIMEOUT_MS);
    guarded.catch(onRejected);
    await guarded;
    await vi.advanceTimersByTimeAsync(DOC_LOAD_TIMEOUT_MS + 1);
    expect(onRejected).not.toHaveBeenCalled();
  });
});

describe("createLoadSequence", () => {
  it("marks only the most recently started load as current", () => {
    const sequence = createLoadSequence();
    const first = sequence.next();
    expect(sequence.isCurrent(first)).toBe(true);

    const second = sequence.next();
    expect(sequence.isCurrent(first)).toBe(false);
    expect(sequence.isCurrent(second)).toBe(true);
  });

  it("keeps a stale load stale even after it settles late", () => {
    const sequence = createLoadSequence();
    const stale = sequence.next();
    const fresh = sequence.next();
    // The stale load settling (e.g. after its timeout) must not become current again.
    expect(sequence.isCurrent(stale)).toBe(false);
    expect(sequence.isCurrent(fresh)).toBe(true);
  });
});
