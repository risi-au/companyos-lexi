import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createDb, authSchema } from "@companyos/db";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { createAuthMiddleware } from "better-auth/api";
import { getCompanyOsPublicUrl, getMcpPublicUrl } from "@/lib/mcp-public-url";
import { expandLoopbackRedirects } from "@/lib/oauth-loopback";
import { tokenRequestWithDefaultResource } from "@/lib/oauth-resource";

const db = createDb();

export const auth = betterAuth({
  baseURL: getCompanyOsPublicUrl(),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  plugins: [
    jwt({
      jwt: { issuer: getCompanyOsPublicUrl() },
      disableSettingJwtHeader: true,
    }),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/oauth/consent",
      validAudiences: [getMcpPublicUrl()],
      accessTokenExpiresIn: 60 * 60,
      refreshTokenExpiresIn: 60 * 60 * 24 * 30,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      scopes: ["openid", "profile", "email", "offline_access"],
    }),
    nextCookies(),
  ],
  hooks: {
    // Dynamic Client Registration: expand loopback redirect_uris (127.0.0.1 / localhost
    // / [::1]) to all equivalent forms so MCP clients that register one loopback form
    // (codex uses 127.0.0.1) still match at /authorize regardless of how the request's
    // loopback host is normalized. See lib/oauth-loopback.ts and
    // docs/tasks/DIAG-mcp-oauth-invalid-redirect.md.
    before: createAuthMiddleware(async (ctx) => {
      // RFC 8707: default the token request's `resource` to the MCP endpoint when an
      // authorization_code/refresh_token client omits it, so better-auth mints a JWT access
      // token bound to aud=<MCP URL> instead of an opaque token that /api/mcp's JWT verifier
      // rejects. Clients that omit `resource` (e.g. Claude Desktop) otherwise fail post-approval
      // (and again on refresh); codex already sends it (no-op). See lib/oauth-resource.ts +
      // docs/tasks/DIAG-mcp-oauth-invalid-redirect.md (#102).
      if (ctx.path === "/oauth2/token") {
        const nextBody = tokenRequestWithDefaultResource(ctx.body, getMcpPublicUrl());
        if (nextBody) return { context: { body: nextBody } };
        return;
      }

      if (ctx.path !== "/oauth2/register") return;
      const body = ctx.body as { redirect_uris?: unknown } | undefined;
      if (!body || !Array.isArray(body.redirect_uris)) return;
      // Only touch a well-formed all-string array; otherwise leave the body for
      // upstream validation to reject (don't let filtering turn an invalid request valid).
      if (body.redirect_uris.length === 0) return;
      if (!body.redirect_uris.every((u) => typeof u === "string")) return;
      const uris = body.redirect_uris as string[];
      const expanded = expandLoopbackRedirects(uris);
      if (expanded.length === uris.length && expanded.every((u, i) => u === uris[i])) return;
      return { context: { body: { ...body, redirect_uris: expanded } } };
    }),
  },
  secret: process.env.BETTER_AUTH_SECRET!,
  trustedOrigins: [getCompanyOsPublicUrl()],
});
