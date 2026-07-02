import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createDb, authSchema } from "@companyos/db";
import { nextCookies } from "better-auth/next-js";

// DB instance for auth adapter (per constitution limited to auth adapter only; runtime requires DATABASE_URL/BETTER_AUTH_SECRET).
const db = createDb();

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // M2-03: email/password only, verification later
  },
  // Use nextCookies plugin so server actions automatically set auth cookies
  plugins: [nextCookies()],
  // Secret from env; required for signing sessions
  secret: process.env.BETTER_AUTH_SECRET!,
  // Trust the local dev host; production will use proper trustedOrigins or env
  trustedOrigins: ["http://localhost:3000"],
});
