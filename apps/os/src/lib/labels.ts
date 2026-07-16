const fallbackTitle = (value: string) =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const intakeStatusLabels: Record<string, string> = {
  draft: "In progress",
  awaiting_external: "Waiting on interview",
  needs_review: "Ready for review",
  approved: "Approved",
  provisioning: "Provisioning",
  provisioned: "Live",
  rejected: "Sent back",
  dismissed: "Discarded",
};

export function labelForIntakeStatus(status: string | null | undefined): string {
  if (!status) return "In progress";
  return intakeStatusLabels[status] ?? fallbackTitle(status);
}

export const roleLabels: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
  agent: "Agent",
};

export function labelForRole(role: string | null | undefined): string {
  if (!role) return "-";
  return roleLabels[role] ?? fallbackTitle(role);
}

export const sessionStatusLabels: Record<string, string> = {
  running: "Running",
  waiting: "Waiting",
  idle: "Idle",
  completed: "Completed",
  error: "Error",
  stale: "Stale",
};

export function labelForSessionStatus(status: string | null | undefined): string {
  if (!status) return "-";
  return sessionStatusLabels[status] ?? fallbackTitle(status);
}

export const healthStatusLabels: Record<string, string> = {
  ok: "Healthy",
  warning: "Warning",
  error: "Failing",
};

export function labelForHealthStatus(status: string | null | undefined): string {
  if (!status) return "-";
  return healthStatusLabels[status] ?? fallbackTitle(status);
}

export function labelForCredentialState(hasValue: boolean): string {
  return hasValue ? "Set ✓" : "Needed";
}

export function labelForPasswordState(forcePasswordChange: boolean): string {
  return forcePasswordChange ? "Temporary" : "Set";
}

export function labelForPrincipalStatus(status: string | null | undefined): string {
  if (status === "unlinked" || !status) return "Not signed in yet";
  return fallbackTitle(status);
}

export function labelForIntegrationState(configured: boolean): string {
  return configured ? "Connected" : "Not configured";
}

export function labelForScopeStatus(status: string | null | undefined): string {
  if (status === "active") return "Active";
  if (status === "archived") return "Archived";
  return status ? fallbackTitle(status) : "-";
}

export function labelForConnectionStatus(status: string | boolean | null | undefined): string {
  if (typeof status === "boolean") return status ? "Revoked" : "Active";
  if (status === "active") return "Active";
  if (status === "expired") return "Expired";
  if (status === "revoked") return "Revoked";
  if (status === "never_used") return "Never used";
  return status ? fallbackTitle(status) : "-";
}


export const eventTypeLabels: Record<string, string> = {
  "admin.user_created": "User created",
  "admin.user_disabled": "User disabled",
  "admin.user_temp_password_reset": "Temporary password reset",
  "admin.user_password_changed": "Password changed",
  "admin.litellm_key_minted": "LiteLLM key created",
  "admin.litellm_key_revoked": "LiteLLM key revoked",
  "admin.litellm_key_budget_set": "LiteLLM budget updated",
  "alert.fired": "Alert fired",
  "capability.run_reported": "Capability run reported",
  "scope.created": "Scope created",
  "token.issued": "Token issued",
};

export function labelForEventType(type: string | null | undefined): string {
  if (!type) return "Activity";
  return eventTypeLabels[type] ?? fallbackTitle(type.replace(/[.]/g, " "));
}
export function labelForMemoryAccess(value: string | null | undefined): string {
  return value === "on" ? "On" : "Off";
}

