import { describe, expect, it } from "vitest";
import { NextURL } from "next/dist/server/web/next-url";

// Regression guard for #97 (and #93). Upstream Next.js historically ran a loopback regex
// over the ENTIRE request-URL string in NextURL.parseURL, rewriting 127.0.0.1 / [::1] ->
// localhost even inside the percent-encoded `redirect_uri` OAuth parameter — corrupting the
// value before any app or better-auth code could read it. We carry a version-pinned patch of
// upstream fix vercel/next.js#90158 (parse first, canonicalize only the authority hostname).
// If that patch ever silently drops on a Next.js bump, these tests fail loudly.
describe("NextURL loopback normalization (patched Next.js #90158)", () => {
  const base = "https://cos-staging.risi.au";

  it("preserves a 127.0.0.1 redirect_uri inside the query, verbatim", () => {
    const redirectUri = "http://127.0.0.1:62405/callback/abc";
    const url = new NextURL(
      `/api/auth/oauth2/authorize?client_id=x&redirect_uri=${encodeURIComponent(redirectUri)}&scope=openid`,
      base,
    );
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.href).toContain("127.0.0.1");
    expect(url.href).not.toContain("localhost");
  });

  it("preserves an IPv6 [::1] redirect_uri inside the query", () => {
    const redirectUri = "http://[::1]:55430/callback/abc";
    const url = new NextURL(
      `/api/auth/oauth2/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`,
      base,
    );
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
  });

  it("preserves a genuine localhost redirect_uri (no conversion to an IP literal)", () => {
    const redirectUri = "http://localhost:8787/callback";
    const url = new NextURL(
      `/api/auth/oauth2/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`,
      base,
    );
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
  });

  it("still canonicalizes a loopback request authority to localhost, while leaving the query untouched", () => {
    // Proves the fix splits authority-normalization (kept) from query-data (preserved):
    // Next intentionally normalizes the request host, but must not touch the OAuth param.
    const url = new NextURL(
      "http://127.0.0.1:3000/some/path?redirect_uri=http%3A%2F%2F127.0.0.1%3A62405%2Fcb",
    );
    expect(url.hostname).toBe("localhost");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:62405/cb");
  });
});
