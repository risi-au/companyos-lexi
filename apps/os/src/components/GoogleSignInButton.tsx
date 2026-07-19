"use client";

import { useId, useState } from "react";
import { Button } from "@companyos/ui";
import { authClient } from "@/lib/auth-client";

type GoogleSignInButtonProps = {
  callbackURL: string | (() => string);
  errorCallbackURL: string | (() => string);
};

function resolveURL(value: string | (() => string)): string {
  return typeof value === "function" ? value() : value;
}

export function GoogleSignInButton({ callbackURL, errorCallbackURL }: GoogleSignInButtonProps) {
  const errorId = useId();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setError(null);
    setLoading(true);

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: resolveURL(callbackURL),
        errorCallbackURL: resolveURL(errorCallbackURL),
      });
      if (result.error) {
        setError(result.error.message || "Google sign in could not be started. Please try again.");
      }
    } catch {
      setError("Google sign in could not be started. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-[var(--space-2)]">
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={signInWithGoogle}
        disabled={loading}
        aria-describedby={error ? errorId : undefined}
      >
        {loading ? "Connecting to Google..." : "Continue with Google"}
      </Button>
      {error && (
        <p id={errorId} role="alert" className="text-[var(--font-size-sm)] text-[var(--destructive)]">
          {error}
        </p>
      )}
    </div>
  );
}
