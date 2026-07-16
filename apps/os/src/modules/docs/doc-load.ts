/**
 * Client-safe load guards for the Docs surface (issue #54).
 *
 * Server-action promises can hang forever when a Next.js navigation supersedes
 * them (vercel/next.js#74246), so every doc load races against a timeout and
 * carries a sequence number so stale responses can't clobber a newer load.
 */

export const DOC_LOAD_TIMEOUT_MS = 15_000;

export class DocLoadTimeoutError extends Error {
  constructor(ms: number) {
    super(`Doc load timed out after ${ms}ms`);
    this.name = "DocLoadTimeoutError";
  }
}

/** Resolve with the promise's value, or reject with DocLoadTimeoutError after ms. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DocLoadTimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Monotonic sequence for in-flight loads. Only the most recently started load
 * may apply state; earlier ones become no-ops instead of racing.
 */
export function createLoadSequence() {
  let current = 0;
  return {
    next(): number {
      current += 1;
      return current;
    },
    isCurrent(seq: number): boolean {
      return seq === current;
    },
  };
}
