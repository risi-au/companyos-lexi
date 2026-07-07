"use server";

import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function createNewScope(formData: FormData): Promise<{ path?: string; intakeId?: string; error?: string }> {
  const name = (formData.get("name") as string || "").trim();
  const slug = (formData.get("slug") as string || "").trim() || name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const parentPath = (formData.get("parentPath") as string || "").trim() || null;
  // Type follows placement: top level = project, nested = subproject
  const type: "project" | "subproject" = parentPath ? "subproject" : "project";

  if (!name || !slug) {
    return { error: "Name and slug required" };
  }

  const actor = await getCurrentActorPrincipalId();
  if (!actor) return { error: "Not authenticated" };

  // Enforce at least admin on the parent (or root for top-level creates)
  const canCreate = await api.resolveAccess(actor, parentPath || "root");
  if (!canCreate || !["owner", "admin"].includes(canCreate)) {
    return { error: "Insufficient permissions to create scope" };
  }

  const created = await api.createScope({ slug, name, type, parentPath }, actor);
  const intake = await api.ensureDraftIntakeForScope({ scopePath: created.path }, actor);

  revalidatePath("/");
  revalidatePath(`/s/${created.path}`);
  return { path: created.path, intakeId: intake.id };
}

export async function addMemberToScope(formData: FormData): Promise<void> {
  const scopePath = (formData.get("scopePath") as string || "").trim();
  const email = (formData.get("email") as string || "").trim().toLowerCase();
  const role = (formData.get("role") as "owner" | "admin" | "editor" | "viewer" | "agent") || "editor";

  if (!scopePath || !email) throw new Error("Scope and email required");

  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");

  // UI guard: only owner/admin on this scope or root should reach, but recheck
  const myAccess = await api.resolveAccess(actor, scopePath);
  if (!myAccess || !["owner", "admin"].includes(myAccess)) {
    throw new Error("Insufficient permissions to manage members");
  }

  const principal = await api.getPrincipalByEmail(email);
  if (!principal) {
    throw new Error(`No existing user with email "${email}". (User must sign up first; invites in M5)`);
  }

  await api.grantRole({ principalId: principal.id, scopePath, role }, actor);
  revalidatePath(`/s/${scopePath}`);
}

export async function changeMemberRole(formData: FormData): Promise<void> {
  const scopePath = (formData.get("scopePath") as string || "").trim();
  const principalId = (formData.get("principalId") as string || "").trim();
  const role = (formData.get("role") as "owner" | "admin" | "editor" | "viewer" | "agent") || "editor";

  if (!scopePath || !principalId) throw new Error("Scope and principal required");

  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");

  const myAccess = await api.resolveAccess(actor, scopePath);
  if (!myAccess || !["owner", "admin"].includes(myAccess)) {
    throw new Error("Insufficient permissions to manage members");
  }

  await api.grantRole({ principalId, scopePath, role }, actor);
  revalidatePath(`/s/${scopePath}`);
}

export async function revokeMember(formData: FormData): Promise<void> {
  const scopePath = (formData.get("scopePath") as string || "").trim();
  const principalId = (formData.get("principalId") as string || "").trim();

  if (!scopePath || !principalId) throw new Error("Scope and principal required");

  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("Not authenticated");

  const myAccess = await api.resolveAccess(actor, scopePath);
  if (!myAccess || !["owner", "admin"].includes(myAccess)) {
    throw new Error("Insufficient permissions to manage members");
  }

  await api.revokeGrant({ principalId, scopePath }, actor);
  revalidatePath(`/s/${scopePath}`);
}

/** Server action for project switcher: persists selection in cookie (SSR) then redirects */
export async function setSelectedProject(formData: FormData): Promise<void> {
  const path = ((formData.get("path") as string) || "").trim();
  const store = await cookies();
  if (path) {
    store.set("nav.selectedProject", path, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  } else {
    store.delete("nav.selectedProject");
  }
  const dest = !path || path === "root" ? "/s/root" : `/s/${path}`;
  redirect(dest);
}
