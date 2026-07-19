"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { getPostAuthDestination } from "@/lib/auth-redirect";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { Button } from "@companyos/ui";

function messageFromAuthError(code: string, description: string | null): string {
  if (description) return description;
  switch (code) {
    case "invalid_client":
      return "The connecting app is not registered or its client id is invalid.";
    case "access_denied":
      return "Authorization was denied.";
    case "server_error":
      return "The authorization server hit an error.";
    case "account_not_linked":
    case "unable_to_link_account":
      return "This Google email matches an account that cannot be linked automatically. Sign in with your password instead.";
    default:
      return code;
  }
}

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => {
    const code = searchParams.get("error");
    if (!code) return null;
    return messageFromAuthError(code, searchParams.get("error_description"));
  });
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function postAuthDestination(): string {
    return getPostAuthDestination(searchParams, window.location.origin);
  }

  function googleErrorDestination(): string {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("error");
    params.delete("error_description");
    const query = params.toString();
    return query ? `/sign-in?${query}` : "/sign-in";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await authClient.signIn.email({ email, password });

    if (res.error) {
      setError(res.error.message || "Couldn't sign in. Check your email and password, then retry.");
      setLoading(false);
      return;
    }

    router.push(postAuthDestination());
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-[var(--space-4)]">
      <div className="w-full max-w-[380px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-6)] shadow-sm">
        <h1 className="mb-[var(--space-1)] text-[var(--font-size-2xl)] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
          Sign in
        </h1>
        <p className="mb-[var(--space-6)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
          Access your CompanyOS workspace
        </p>

        {googleEnabled && (
          <div className="mb-[var(--space-4)] space-y-[var(--space-4)]">
            <GoogleSignInButton
              callbackURL={postAuthDestination}
              errorCallbackURL={googleErrorDestination}
            />
            <div className="flex items-center gap-[var(--space-3)]" aria-hidden="true">
              <span className="h-px flex-1 bg-[var(--border)]" />
              <span className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">or</span>
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-[var(--space-4)]">
          <div>
            <label className="mb-[var(--space-1)] block text-[var(--font-size-sm)] font-medium text-[var(--foreground)]">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-md)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
              placeholder="you@company.com"
              disabled={loading}
            />
          </div>

          <div>
            <label className="mb-[var(--space-1)] block text-[var(--font-size-sm)] font-medium text-[var(--foreground)]">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-md)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
              placeholder="At least 8 characters"
              disabled={loading}
            />
          </div>

          {error && (
            <p className="text-[var(--font-size-sm)] text-[var(--destructive)]">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        <p className="mt-[var(--space-4)] text-center text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
          Don&apos;t have an account?{" "}
          <a href="/sign-up" className="text-[var(--primary)] hover:underline">
            Sign up
          </a>
        </p>
      </div>
    </main>
  );
}
