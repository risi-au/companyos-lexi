"use server";

import { revalidatePath } from "next/cache";
import { api, getCurrentActorPrincipalId } from "@/lib/api";

function requireActor(actor: string | null): string {
  if (!actor) throw new Error("Not authenticated");
  return actor;
}

export async function listCredentialsAction(scopePath: string) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  return api.listCredentials({ scopePath }, actor);
}

export async function setCredentialAction(input: {
  scopePath: string;
  name: string;
  description?: string;
  value: string;
}) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const result = await api.setCredential({
    scopePath: input.scopePath,
    name: input.name,
    description: input.description,
    value: input.value,
  }, actor);
  revalidatePath(`/s/${input.scopePath}?tab=credentials`);
  return result;
}

export async function deleteCredentialAction(input: { scopePath: string; name: string }) {
  const actor = requireActor(await getCurrentActorPrincipalId());
  await api.deleteCredential({ scopePath: input.scopePath, name: input.name }, actor);
  revalidatePath(`/s/${input.scopePath}?tab=credentials`);
}
