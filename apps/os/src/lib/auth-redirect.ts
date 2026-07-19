export const DEFAULT_POST_AUTH_PATH = "/s/root";

type SearchParamsLike = {
  get(name: string): string | null;
  has(name: string): boolean;
  toString(): string;
};

type VisibleScopeLike = {
  type: string;
  path: string;
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

  const oauthParams = new URLSearchParams(searchParams.toString());
  oauthParams.delete("error");
  oauthParams.delete("error_description");
  oauthParams.delete("google_link");
  return "/api/auth/oauth2/authorize?" + oauthParams.toString();
}

export function getPostAuthDestination(searchParams: SearchParamsLike, origin: string): string {
  return (
    getOauthAuthorizationResumePath(searchParams) ??
    safeInternalPath(searchParams.get("redirect"), origin) ??
    DEFAULT_POST_AUTH_PATH
  );
}

export function getPostAuthScopePath(scopes: VisibleScopeLike[]): string | null {
  const scope = scopes.find((item) => item.type === "project")
    ?? scopes.find((item) => item.type === "personal");
  return scope ? `/s/${scope.path}` : null;
}

export function shouldLinkGoogleAfterPassword(searchParams: SearchParamsLike): boolean {
  if (searchParams.get("google_link") !== "1") return false;
  const error = searchParams.get("error");
  return error === "account_not_linked" || error === "unable_to_link_account";
}
