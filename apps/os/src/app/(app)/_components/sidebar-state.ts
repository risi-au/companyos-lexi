export const SIDEBAR_DEFAULT_WIDTH = 264;
export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_WIDTH_STORAGE_KEY = "companyos.sidebar.width";
export const SIDEBAR_MODULES_STORAGE_KEY = "companyos.sidebar.modulesOpen";

export function pathPrefixes(path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) return [];

  const prefixes: string[] = [];
  let acc = "";
  for (const part of trimmed.split("/").filter(Boolean)) {
    acc = acc ? `${acc}/${part}` : part;
    prefixes.push(acc);
  }
  return prefixes;
}

export function accordionBranchForPath(path: string): Set<string> {
  return new Set(pathPrefixes(path));
}

export function toggleAccordionPath(expandedPaths: ReadonlySet<string>, path: string): Set<string> {
  if (!path) return new Set(expandedPaths);
  if (!expandedPaths.has(path)) return accordionBranchForPath(path);

  return new Set([...expandedPaths].filter((expandedPath) => expandedPath !== path && !expandedPath.startsWith(`${path}/`)));
}

export function parseStoredModuleShortcut(value: string | null, activePath = ""): string | null {
  if (!value || value === "closed") return null;
  if (value === "open") return activePath || null;

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return value;
    const paths = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (activePath && paths.includes(activePath)) return activePath;
    return paths[0] ?? null;
  } catch {
    return value;
  }
}

export function serializeStoredModuleShortcut(openPath: string | null): string {
  return openPath || "closed";
}

export function toggleModuleShortcutPath(openPath: string | null, path: string): string | null {
  if (!path) return openPath;
  return openPath === path ? null : path;
}

export function isNewScopeParentOption(scope: { type: string }): boolean {
  return scope.type === "project" || scope.type === "subproject";
}

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

export function parseStoredSidebarWidth(value: string | null): number {
  if (!value) return SIDEBAR_DEFAULT_WIDTH;
  return clampSidebarWidth(Number(value));
}
