function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getCompanyOsPublicUrl(): string {
  const configured = process.env.BETTER_AUTH_URL?.trim() || process.env.COMPANYOS_URL?.trim();
  if (configured) return trimTrailingSlash(configured);

  const mcpPublicUrl = process.env.MCP_PUBLIC_URL?.trim();
  if (mcpPublicUrl) {
    try {
      return new URL(mcpPublicUrl).origin;
    } catch {
      // Fall through to the local development origin.
    }
  }

  return "http://localhost:3000";
}

export function getMcpPublicUrl(): string {
  const explicit = process.env.MCP_PUBLIC_URL?.trim();
  if (explicit) return trimTrailingSlash(explicit);
  return `${getCompanyOsPublicUrl()}/api/mcp`;
}

export function getMcpProtectedResourceMetadataUrl(): string {
  return `${getCompanyOsPublicUrl()}/.well-known/oauth-protected-resource/api/mcp`;
}

// Public JWKS endpoint served by the better-auth jwt plugin (mounted under the
// auth base path). Used to verify OAuth access-token signatures locally.
export function getJwksUrl(): string {
  return `${getCompanyOsPublicUrl()}/api/auth/jwks`;
}

export function getMcpProtectedResourceMetadata() {
  return {
    resource: getMcpPublicUrl(),
    authorization_servers: [getCompanyOsPublicUrl()],
  };
}
