export const DEFAULT_POST_AUTH_PATH = "/s/root";

type SearchParamsLike = {
  get(name: string): string | null;
  has(name: string): boolean;
  toString(): string;
};

function safeInternalPath(raw: string | null, origin: string): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return null;
  }

  try {
    const decoded = decodeURI(raw);
    if (decoded.includes("\\")) return null;
    return new URL(raw, origin).origin === origin ? raw : null;
  } catch {
    return null;
  }
}

function getOauthAuthorizationResumePath(searchParams: SearchParamsLike): string | null {
  if (
    !searchParams.has("client_id") ||
    !searchParams.has("redirect_uri") ||
    !searchParams.has("response_type")
  ) {
    return null;
  }

  return "/api/auth/oauth2/authorize?" + searchParams.toString();
}

export function getPostAuthDestination(searchParams: SearchParamsLike, origin: string): string {
  return (
    getOauthAuthorizationResumePath(searchParams) ??
    safeInternalPath(searchParams.get("redirect"), origin) ??
    DEFAULT_POST_AUTH_PATH
  );
}
