"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { auth } from "@/lib/auth";

type Role = "owner" | "admin" | "editor" | "viewer" | "agent";

export interface CreateAdminUserActionState {
  error?: string;
  message?: string;
  tempPassword?: string;
}

export interface MintLiteLlmKeyActionState {
  error?: string;
  message?: string;
  key?: string;
}

function getActorOrThrow(actor: string | null): string {
  if (!actor) throw new Error("Your session expired. Sign in again.");
  return actor;
}

function formString(formData: FormData, key: string): string {
  return String(formData.get(key) || "").trim();
}

export async function createAdminUserAction(
  _state: CreateAdminUserActionState,
  formData: FormData
): Promise<CreateAdminUserActionState> {
  try {
    const actor = getActorOrThrow(await getCurrentActorPrincipalId());
    const email = formString(formData, "email");
    const name = formString(formData, "name");
    const tempPassword = formString(formData, "tempPassword") || undefined;
    const scopePath = formString(formData, "scopePath");
    const role = formString(formData, "role") as Role;
    const grants = scopePath && role ? [{ scopePath, role }] : [];
    const result = await api.createAdminUser({ email, name, tempPassword, grants }, actor);
    revalidatePath("/admin/users");
    revalidatePath("/admin/grants");
    return {
      message: `${result.user.email} created. Share this temporary password out of band.`,
      tempPassword: result.tempPassword,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't create the account. Fix the fields and retry." };
  }
}

export async function disableAdminUserAction(formData: FormData) {
  const actor = getActorOrThrow(await getCurrentActorPrincipalId());
  await api.disableAdminUser({ authUserId: formString(formData, "authUserId") }, actor);
  revalidatePath("/admin/users");
}

export async function resetAdminUserTempPasswordAction(formData: FormData) {
  const actor = getActorOrThrow(await getCurrentActorPrincipalId());
  await api.resetAdminUserTempPassword({ authUserId: formString(formData, "authUserId") }, actor);
  revalidatePath("/admin/users");
}

export async function grantAdminRoleAction(formData: FormData) {
  const actor = getActorOrThrow(await getCurrentActorPrincipalId());
  await api.grantAdminRole({
    principalId: formString(formData, "principalId"),
    scopePath: formString(formData, "scopePath") || "root",
    role: formString(formData, "role") as Role,
  }, actor);
  revalidatePath("/admin/grants");
  revalidatePath("/admin/users");
}

export async function revokeAdminGrantAction(formData: FormData) {
  const actor = getActorOrThrow(await getCurrentActorPrincipalId());
  await api.revokeAdminGrant({
    principalId: formString(formData, "principalId"),
    scopePath: formString(formData, "scopePath") || "root",
  }, actor);
  revalidatePath("/admin/grants");
  revalidatePath("/admin/users");
}

export async function mintLiteLlmKeyAction(formData: FormData) {
  const actor = getActorOrThrow(await getCurrentActorPrincipalId());
  const models = formString(formData, "models")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const budgetValue = Number(formString(formData, "budgetUsd") || "25");
  await api.mintAdminLiteLlmKey({
    alias: formString(formData, "alias"),
    budgetUsd: Number.isFinite(budgetValue) ? budgetValue : 25,
    models,
  }, actor);
  revalidatePath("/admin/settings");
}

export async function mintLiteLlmKeyStateAction(
  _state: MintLiteLlmKeyActionState,
  formData: FormData
): Promise<MintLiteLlmKeyActionState> {
  try {
    const actor = getActorOrThrow(await getCurrentActorPrincipalId());
    const models = formString(formData, "models")
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    const budgetValue = Number(formString(formData, "budgetUsd") || "25");
    const result = await api.mintAdminLiteLlmKey({
      alias: formString(formData, "alias"),
      budgetUsd: Number.isFinite(budgetValue) ? budgetValue : 25,
      models,
    }, actor);
    revalidatePath("/admin/settings");
    return {
      message: `${result.alias ?? "Key"} created. Store this value outside CompanyOS.`,
      key: result.key ?? undefined,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't create the key. Check the settings and retry." };
  }
}

export async function setLiteLlmBudgetAction(formData: FormData) {
  const actor = getActorOrThrow(await getCurrentActorPrincipalId());
  await api.setAdminLiteLlmKeyBudget({
    key: formString(formData, "key"),
    alias: formString(formData, "alias") || null,
    budgetUsd: Number(formString(formData, "budgetUsd")),
  }, actor);
  revalidatePath("/admin/settings");
}

export async function revokeLiteLlmKeyAction(formData: FormData) {
  const actor = getActorOrThrow(await getCurrentActorPrincipalId());
  await api.revokeAdminLiteLlmKey({
    key: formString(formData, "key"),
    alias: formString(formData, "alias") || null,
  }, actor);
  revalidatePath("/admin/settings");
}

export async function completeTempPasswordChangeAction(formData: FormData) {
  const actor = getActorOrThrow(await getCurrentActorPrincipalId());
  const authApi = auth.api as unknown as Partial<Record<string, (input: unknown) => Promise<unknown>>>;
  if (!authApi.changePassword) throw new Error("Password change isn't available right now, contact your admin.");
  await authApi.changePassword({
    headers: await headers(),
    body: {
      currentPassword: formString(formData, "currentPassword"),
      newPassword: formString(formData, "newPassword"),
      revokeOtherSessions: true,
    },
  });
  await api.completeTempPasswordChange(actor);
  redirect("/");
}
