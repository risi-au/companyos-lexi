import "server-only";

export type GoogleProviderConfig = {
  clientId: string;
  clientSecret: string;
};

export function getGoogleProviderConfig(): GoogleProviderConfig | undefined {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) return undefined;
  return { clientId, clientSecret };
}

export function isGoogleAuthEnabled(): boolean {
  return getGoogleProviderConfig() !== undefined;
}
