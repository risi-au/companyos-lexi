"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@companyos/ui";

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await authClient.signUp.email({
      email,
      password,
      name: name || email.split("@")[0] || "User",
    });

    if (res.error) {
      setError(res.error.message || "Couldn't create the account. Check the fields and retry.");
      setLoading(false);
      return;
    }

    // After sign up, go to app (bootstrap will link principal)
    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-[var(--space-4)]">
      <div className="w-full max-w-[380px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-6)] shadow-sm">
        <h1 className="mb-[var(--space-1)] text-[var(--font-size-2xl)] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
          Create account
        </h1>
        <p className="mb-[var(--space-6)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
          The first account becomes this instance's owner.
        </p>

        <form onSubmit={onSubmit} className="space-y-[var(--space-4)]">
          <div>
            <label className="mb-[var(--space-1)] block text-[var(--font-size-sm)] font-medium text-[var(--foreground)]">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-md)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
              placeholder="Your name"
              disabled={loading}
            />
          </div>

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
              minLength={8}
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
            {loading ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-[var(--space-4)] text-center text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
          Already have an account?{" "}
          <a href="/sign-in" className="text-[var(--primary)] hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
