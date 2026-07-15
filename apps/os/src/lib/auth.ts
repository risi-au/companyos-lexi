import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createDb, authSchema } from "@companyos/db";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { getCompanyOsPublicUrl, getMcpPublicUrl } from "@/lib/mcp-public-url";

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
  secret: process.env.BETTER_AUTH_SECRET!,
  trustedOrigins: [getCompanyOsPublicUrl()],
});
