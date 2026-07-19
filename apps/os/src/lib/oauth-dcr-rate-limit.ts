const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_MAX_REGISTRATIONS = 5;

type OauthDcrRateLimitEnv = Record<string, string | undefined>;

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const normalized = value?.trim();
  if (!normalized || !/^[1-9]\d*$/.test(normalized)) return fallback;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export function getOauthDcrRateLimit(
  env: OauthDcrRateLimitEnv = process.env,
): { window: number; max: number } {
  return {
    window: readPositiveInteger(
      env.OAUTH_DCR_RATE_LIMIT_WINDOW_SECONDS,
      DEFAULT_WINDOW_SECONDS,
    ),
    max: readPositiveInteger(env.OAUTH_DCR_RATE_LIMIT_MAX, DEFAULT_MAX_REGISTRATIONS),
  };
}
