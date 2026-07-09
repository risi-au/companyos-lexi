import { notFound } from "next/navigation";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { AdminTabs } from "./AdminTabs";

function isRootAdmin(access: string | null): boolean {
  return access === "owner" || access === "admin";
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) notFound();
  const rootAccess = await api.resolveAccess(actor, "root");
  if (!isRootAdmin(rootAccess)) notFound();

  return (
    <div className="space-y-[var(--space-5)]">
      <div className="flex flex-wrap items-end justify-between gap-[var(--space-3)]">
        <div>
          <h1 className="text-[var(--font-size-2xl)] font-semibold tracking-[-0.01em]">Tenant Admin</h1>
          <div className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            Root-scope operations for this CompanyOS instance.
          </div>
        </div>
        <div className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">root:{rootAccess}</div>
      </div>
      <AdminTabs />
      {children}
    </div>
  );
}
