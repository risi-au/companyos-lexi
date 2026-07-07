import Link from "next/link";
import { notFound } from "next/navigation";
import { api, getCurrentActorPrincipalId } from "@/lib/api";

function isRootAdmin(access: string | null): boolean {
  return access === "owner" || access === "admin";
}

const tabs = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/grants", label: "Grants" },
  { href: "/admin/activity", label: "Activity" },
  { href: "/admin/automations", label: "Automations" },
  { href: "/admin/settings", label: "Settings" },
];

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
      <nav className="flex flex-wrap gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} className="rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            {tab.label}
          </Link>
        ))}
        <Link href="/admin/mcp" className="rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
          MCP
        </Link>
        <Link href="/admin/health" className="rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
          Health
        </Link>
      </nav>
      {children}
    </div>
  );
}
