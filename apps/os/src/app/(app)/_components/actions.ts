"use server";

import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { revalidatePath } from "next/cache";

export async function createNewScope(formData: FormData): Promise<{ path?: string; error?: string }> {
  const name = (formData.get("name") as string || "").trim();
  const slug = (formData.get("slug") as string || "").trim() || name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const type = (formData.get("type") as "client" | "project" | "area") || "client";

  if (!name || !slug) {
    return { error: "Name and slug required" };
  }

  const actor = await getCurrentActorPrincipalId();
  if (!actor) return { error: "Not authenticated" };

  // Enforce at least admin on root (UI layer + service expectation); note createScope itself does not call requireAccess (kernel limited per task)
  const canCreate = await api.resolveAccess(actor, "root");
  if (!canCreate || !["owner", "admin"].includes(canCreate)) {
    return { error: "Insufficient permissions to create scope" };
  }

  // Determine parent: default to root (dialog lacks live current path context)
  const created = await api.createScope({ slug, name, type, parentPath: null }, actor);

  revalidatePath("/");
  revalidatePath(`/s/${created.path}`);
  return { path: created.path };
}
