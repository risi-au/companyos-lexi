import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { headers, cookies } from "next/headers";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { Sidebar } from "./_components/Sidebar";
import { UserMenu } from "./_components/UserMenu";
import { FeedbackProviders } from "./_components/FeedbackProviders";
import { AppShellChrome } from "./_components/AppShellChrome";
import type { Scope } from "@companyos/db";

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

  if (await api.isTempPasswordChangeRequired(actorId)) {
    redirect("/change-password");
  }

  // Grant-filtered tree (M4-01)
  const tree = await api.getVisibleTree(actorId);

  // M4-02 nav-v2: resolve selected project (cookie or default first visible project); root overview for root-grant principals
  const cookieStore = await cookies();
  const cookieSelected = cookieStore.get("nav.selectedProject")?.value;
  const hasRootGrant = tree.some((s: Scope) => s.type === "root" || s.path === "root");
  const rootRole = hasRootGrant ? await api.resolveAccess(actorId, "root") : null;
  const topLevelProjects = tree
    .filter((s: Scope) => s.type === "project" && s.path.split("/").length === 1)
    .sort((a: Scope, b: Scope) => a.path.localeCompare(b.path));
  const validPaths = topLevelProjects.map((p: Scope) => p.path);
  let resolvedSelected: string | null = cookieSelected && (cookieSelected === "root" || validPaths.includes(cookieSelected)) ? cookieSelected : null;
  if (!resolvedSelected) {
    resolvedSelected = validPaths[0] || (hasRootGrant ? "root" : null);
  }
  if (resolvedSelected === "root" && !hasRootGrant) {
    resolvedSelected = validPaths[0] || null;
  }

  // Server-rendered Task Manager URL (uses getPlaneUrl; falls back per spec)
  let taskManagerUrl: string | null = null;
  if (resolvedSelected && resolvedSelected !== "root") {
    try {
      taskManagerUrl = await api.getPlaneUrl(resolvedSelected);
    } catch {
      taskManagerUrl = process.env.PLANE_BASE_URL || null;
    }
  }

  const instanceName = process.env.INSTANCE_NAME || "CompanyOS";

  return (
    <FeedbackProviders>
      <AppShellChrome
        instanceName={instanceName}
        sidebar={
          <Sidebar
            tree={tree}
            selected={resolvedSelected}
            taskManagerUrl={taskManagerUrl}
            instanceName={instanceName}
            rootRole={rootRole}
          />
        }
        userMenu={
          <UserMenu
            name={session.user.name || session.user.email || "User"}
            email={session.user.email || undefined}
          />
        }
      >
        {children}
      </AppShellChrome>
    </FeedbackProviders>
  );
}
