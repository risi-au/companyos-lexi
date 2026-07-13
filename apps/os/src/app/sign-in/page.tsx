"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@companyos/ui";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await authClient.signIn.email({
      email,
      password,
    });

    if (res.error) {
      setError(res.error.message || "Couldn't sign in. Check your email and password, then retry.");
      setLoading(false);
      return;
    }

    // Successful sign in — land on root scope (or a safe same-origin ?redirect=).
    // Do not push "/" : authenticated `/` is redirected in middleware to avoid a
    // Next.js 15.5 server-only page 500 (missing clientReferenceManifest).
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("redirect");
    const dest =
      raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/s/root";
    router.push(dest);
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
            {loading ? "Signing in…" : "Sign in"}
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
