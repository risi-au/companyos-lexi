"use server";

import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { revalidatePath } from "next/cache";

function requireActor(actor: string | null): string {
  if (!actor) throw new Error("Your session expired. Sign in again.");
  return actor;
}

export async function resolveAttentionFormAction(formData: FormData) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const id = String(formData.get("id") ?? "");
  const scopePath = String(formData.get("scopePath") ?? "root");
  const resolution = String(formData.get("resolution") ?? "");
  const noteValue = String(formData.get("note") ?? "").trim();
  if (resolution !== "approved" && resolution !== "rejected" && resolution !== "dismissed") {
    throw new Error(`Invalid attention resolution: ${resolution}`);
  }
  await api.resolveAttentionItem({ id, resolution, note: noteValue || undefined }, actor);
  revalidatePath(`/s/${scopePath}`);
  revalidatePath("/s/root");
}
