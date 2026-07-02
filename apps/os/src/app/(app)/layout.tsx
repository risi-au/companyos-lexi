import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { Sidebar } from "./_components/Sidebar";
import { UserMenu } from "./_components/UserMenu";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/sign-in");
  }

  // Ensure linked + get actor early (bootstrap happens here on first visit)
  const actorId = await getCurrentActorPrincipalId();
  if (!actorId) {
    // Should not happen post-middleware
    redirect("/sign-in");
  }

  // Scope tree from root (all scopes for M2-03)
  const tree = await api.getSubtree("root");

  return (
    <div className="flex min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-[var(--border)] bg-[var(--surface)]"> {/* structural width; tokens used for inner spacing per design system */}
        <div className="px-[var(--space-4)] py-[var(--space-3)] border-b border-[var(--border)]">
          <div className="text-[var(--font-size-lg)] font-semibold tracking-[-0.01em]">CompanyOS</div>
          <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">ops record</div>
        </div>

        <Sidebar tree={tree} />

        <div className="mt-auto border-t border-[var(--border)] p-[var(--space-3)]">
          <UserMenu
            name={session.user.name || session.user.email || "User"}
            email={session.user.email || undefined}
          />
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-[var(--space-12)] items-center border-b border-[var(--border)] px-[var(--space-4)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
          {/* Breadcrumb rendered by page for active scope; placeholder */}
          <div className="text-[var(--font-size-xs)]">Scope</div>
        </header>
        <main className="flex-1 overflow-auto p-[var(--space-4)]">{children}</main>
      </div>
    </div>
  );
}
