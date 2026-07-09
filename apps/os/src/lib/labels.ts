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

export function labelForConnectionStatus(revoked: boolean): string {
  return revoked ? "Revoked" : "Active";
}

export function labelForMemoryAccess(value: string | null | undefined): string {
  return value === "on" ? "On" : "Off";
}
