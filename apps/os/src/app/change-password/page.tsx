import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { completeTempPasswordChangeAction } from "@/modules/admin/actions";

export default async function ChangePasswordPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const actor = await getCurrentActorPrincipalId();
  if (!actor) redirect("/sign-in");
  const required = await api.isTempPasswordChangeRequired(actor);
  if (!required) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-[var(--space-4)]">
      <form action={completeTempPasswordChangeAction} className="w-full max-w-[420px] space-y-[var(--space-4)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-6)] shadow-sm">
        <div>
          <h1 className="text-[var(--font-size-2xl)] font-semibold tracking-[-0.01em]">Change password</h1>
          <div className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">This account was created with a temporary password.</div>
        </div>
        <label className="block">
          <span className="mb-[var(--space-1)] block text-[var(--font-size-sm)] font-medium">Current password</span>
          <input name="currentPassword" type="password" required className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-md)]" />
        </label>
        <label className="block">
          <span className="mb-[var(--space-1)] block text-[var(--font-size-sm)] font-medium">New password</span>
          <input name="newPassword" type="password" required minLength={8} className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-md)]" />
        </label>
        <button className="w-full rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primary-foreground)]">Save password</button>
      </form>
    </main>
  );
}
