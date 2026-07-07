"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import type { BrainRunMode } from "@companyos/brain";
import { api, getCurrentActorPrincipalId } from "@/lib/api";

const VALID_MODES = new Set<BrainRunMode>(["ingest", "lint", "backfill"]);

export async function triggerBrainRunAction(formData: FormData) {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) throw new Error("No authenticated actor");
  const mode = String(formData.get("mode") || "ingest") as BrainRunMode;
  if (!VALID_MODES.has(mode)) throw new Error("mode must be ingest, lint, or backfill");

  await api.assertBrainManualTriggerAllowed({ mode }, actor);
  await api.runBrainEngine({ mode }, actor);
  revalidatePath("/brain/engine");
}
