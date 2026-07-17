// RFC 8252 §7.3 loopback-redirect handling for OAuth Dynamic Client Registration.
//
// MCP clients (codex, Claude, etc.) register an ephemeral loopback callback such as
// `http://127.0.0.1:<port>/callback`. The deployed better-auth authorize endpoint
// matches an incoming `127.0.0.1` request host as `localhost`, so a client that
// registered `127.0.0.1` never matches its own redirect and gets `invalid_redirect`.
//
// Fix: at registration, expand any loopback redirect_uri to all equivalent loopback
// hosts (`127.0.0.1`, `localhost`, `[::1]`) at the same port/path/query/scheme. The
// client then matches regardless of which loopback form the request arrives (or is
// normalized) as — robust whether or not the upstream host rewrite is present.
// Non-loopback redirect_uris are returned untouched.

// Loopback host literals we treat as interchangeable. `hostname` from the WHATWG URL
// parser is bracket-stripped for IPv6, so `::1` (not `[::1]`) is what we compare.
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

// Host tokens (URL-authority form) emitted for each loopback redirect. IPv6 must be
// bracketed in a URL authority.
const LOOPBACK_HOST_TOKENS = ["127.0.0.1", "localhost", "[::1]"] as const;

function isLoopbackHostname(hostname: string): boolean {
  // `URL.hostname` may return an IPv6 literal bracketed (`[::1]`) or bare (`::1`)
  // depending on the runtime; normalize before comparing.
  const lower = hostname.toLowerCase();
  const bare = lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
  return LOOPBACK_HOSTNAMES.has(bare);
}

// Rebuild the URI with a different host token, preserving scheme, port, path and query
// EXACTLY. Splices only the host out of the original authority (rather than using
// `url.port`, which silently drops explicit default ports like `:80`/`:443`) so the
// result differs from the original only in the host.
function withHost(originalUri: string, protocol: string, hostToken: string): string {
  const afterScheme = originalUri.slice(originalUri.indexOf("://") + 3);
  const authEnd = afterScheme.search(/[/?#]/);
  const authority = authEnd === -1 ? afterScheme : afterScheme.slice(0, authEnd);
  const rest = authEnd === -1 ? "" : afterScheme.slice(authEnd);
  // authority = [userinfo "@"] host [":" port] — preserve userinfo and port, swap only host.
  const at = authority.lastIndexOf("@");
  const userinfo = at === -1 ? "" : authority.slice(0, at + 1);
  const hostPort = at === -1 ? authority : authority.slice(at + 1);
  // ":port" is whatever follows the last colon after any IPv6 "]" bracket.
  const bracketEnd = hostPort.lastIndexOf("]");
  const portColon = hostPort.lastIndexOf(":");
  const port = portColon > bracketEnd ? hostPort.slice(portColon) : "";
  return `${protocol}//${userinfo}${hostToken}${port}${rest}`;
}

// Expand loopback redirect_uris to all equivalent loopback host forms. Order is
// preserved (each input's variants are emitted where the input first appeared) and the
// result is de-duplicated, so re-registration is idempotent. Unparseable or non-loopback
// entries pass through unchanged.
export function expandLoopbackRedirects(redirectUris: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (uri: string) => {
    if (!seen.has(uri)) {
      seen.add(uri);
      out.push(uri);
    }
  };

  for (const uri of redirectUris) {
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      push(uri);
      continue;
    }

    // Only http loopback redirects get expanded (RFC 8252 §7.3 loopback redirects are
    // http). This leaves custom-scheme native redirects (e.g. `myapp://127.0.0.1/cb`)
    // and hosted https redirects untouched.
    if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) {
      push(uri);
      continue;
    }

    for (const hostToken of LOOPBACK_HOST_TOKENS) {
      push(withHost(uri, url.protocol, hostToken));
    }
  }

  return out;
}
