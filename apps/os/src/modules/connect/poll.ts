/**
 * When the Connect wizard should be polling for an incoming connection.
 *
 * Token lane: only on the Verify step (3) — the admin must configure the client with the minted
 * token first, and the manual "I have connected" advance is a reasonable "I'm done" signal.
 *
 * OAuth lane (#98): also poll on the Set-up step (2), so the wizard auto-advances
 * waiting -> connected the moment the client attaches, with no manual "I have connected" click.
 *
 * Never poll once connected, or after the wait deadline lapsed (the user resumes with "Keep
 * waiting").
 */
export function shouldPollForConnection(opts: {
  step: number;
  oauthLane: boolean;
  connected: boolean;
  waiting: boolean;
}): boolean {
  if (opts.connected || opts.waiting) return false;
  if (opts.step === 3) return true;
  return opts.oauthLane && opts.step === 2;
}
