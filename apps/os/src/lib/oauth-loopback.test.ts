import { describe, expect, it } from "vitest";
import { expandLoopbackRedirects } from "./oauth-loopback";

describe("expandLoopbackRedirects", () => {
  it("expands a 127.0.0.1 redirect to all loopback host forms, same port/path", () => {
    // Codex's real registration shape: numeric loopback + ephemeral port + callback path.
    expect(expandLoopbackRedirects(["http://127.0.0.1:62405/callback/x1"])).toEqual([
      "http://127.0.0.1:62405/callback/x1",
      "http://localhost:62405/callback/x1",
      "http://[::1]:62405/callback/x1",
    ]);
  });

  it("expands a localhost redirect to the same set (order fixed, dedup'd)", () => {
    expect(expandLoopbackRedirects(["http://localhost:1455/auth/callback"])).toEqual([
      "http://127.0.0.1:1455/auth/callback",
      "http://localhost:1455/auth/callback",
      "http://[::1]:1455/auth/callback",
    ]);
  });

  it("expands an IPv6 [::1] redirect", () => {
    expect(expandLoopbackRedirects(["http://[::1]:3000/cb"])).toEqual([
      "http://127.0.0.1:3000/cb",
      "http://localhost:3000/cb",
      "http://[::1]:3000/cb",
    ]);
  });

  it("preserves the query string", () => {
    expect(expandLoopbackRedirects(["http://127.0.0.1:8080/cb?state=abc"])).toEqual([
      "http://127.0.0.1:8080/cb?state=abc",
      "http://localhost:8080/cb?state=abc",
      "http://[::1]:8080/cb?state=abc",
    ]);
  });

  it("leaves non-loopback (hosted https) redirects untouched", () => {
    const uris = ["https://app.example.com/oauth/callback"];
    expect(expandLoopbackRedirects(uris)).toEqual(uris);
  });

  it("does not treat a non-loopback host containing 'localhost' as loopback", () => {
    const uris = ["https://localhost.evil.com/cb"];
    expect(expandLoopbackRedirects(uris)).toEqual(uris);
  });

  it("leaves custom-scheme (native app) redirects untouched", () => {
    const uris = ["myapp://callback"];
    expect(expandLoopbackRedirects(uris)).toEqual(uris);
  });

  it("does not expand a custom scheme even with a loopback host (F2)", () => {
    const uris = ["myapp://127.0.0.1/cb"];
    expect(expandLoopbackRedirects(uris)).toEqual(uris);
  });

  it("does not expand https loopback (only http per RFC 8252) (F2)", () => {
    const uris = ["https://127.0.0.1:1455/cb"];
    expect(expandLoopbackRedirects(uris)).toEqual(uris);
  });

  it("preserves userinfo when expanding (only the host changes)", () => {
    expect(expandLoopbackRedirects(["http://user:pw@127.0.0.1:8080/cb"])).toEqual([
      "http://user:pw@127.0.0.1:8080/cb",
      "http://user:pw@localhost:8080/cb",
      "http://user:pw@[::1]:8080/cb",
    ]);
  });

  it("preserves an explicit default port when expanding (F1)", () => {
    expect(expandLoopbackRedirects(["http://127.0.0.1:80/cb"])).toEqual([
      "http://127.0.0.1:80/cb",
      "http://localhost:80/cb",
      "http://[::1]:80/cb",
    ]);
  });

  it("passes unparseable entries through unchanged", () => {
    const uris = ["not a url"];
    expect(expandLoopbackRedirects(uris)).toEqual(uris);
  });

  it("is idempotent — re-expanding an already-expanded set adds nothing", () => {
    const once = expandLoopbackRedirects(["http://127.0.0.1:1455/cb"]);
    expect(expandLoopbackRedirects(once)).toEqual(once);
  });

  it("de-duplicates when loopback variants overlap across inputs", () => {
    expect(
      expandLoopbackRedirects([
        "http://127.0.0.1:1455/cb",
        "http://localhost:1455/cb",
      ]),
    ).toEqual([
      "http://127.0.0.1:1455/cb",
      "http://localhost:1455/cb",
      "http://[::1]:1455/cb",
    ]);
  });

  it("keeps loopback and non-loopback entries together, in order", () => {
    expect(
      expandLoopbackRedirects([
        "https://app.example.com/cb",
        "http://127.0.0.1:9999/cb",
      ]),
    ).toEqual([
      "https://app.example.com/cb",
      "http://127.0.0.1:9999/cb",
      "http://localhost:9999/cb",
      "http://[::1]:9999/cb",
    ]);
  });
});
