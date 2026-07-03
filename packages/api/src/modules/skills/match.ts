function splitPath(value: string): string[] {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  return normalized ? normalized.split("/") : [];
}

function hasWildcard(patternSegments: string[]): boolean {
  return patternSegments.some((segment) => segment === "*" || segment === "**");
}

function matchSegments(patternSegments: string[], scopeSegments: string[], patternIndex = 0, scopeIndex = 0): boolean {
  if (patternIndex === patternSegments.length) {
    return scopeIndex === scopeSegments.length;
  }

  const segment = patternSegments[patternIndex];
  if (segment === "**") {
    if (patternIndex === patternSegments.length - 1) return true;
    for (let nextScopeIndex = scopeIndex; nextScopeIndex <= scopeSegments.length; nextScopeIndex += 1) {
      if (matchSegments(patternSegments, scopeSegments, patternIndex + 1, nextScopeIndex)) {
        return true;
      }
    }
    return false;
  }

  if (scopeIndex >= scopeSegments.length) return false;
  if (segment === "*") {
    return matchSegments(patternSegments, scopeSegments, patternIndex + 1, scopeIndex + 1);
  }
  if (segment !== scopeSegments[scopeIndex]) return false;
  return matchSegments(patternSegments, scopeSegments, patternIndex + 1, scopeIndex + 1);
}

export function matchesScope(pattern: string, scopePath: string): boolean {
  const normalizedPattern = pattern.trim() || "**";
  const patternSegments = splitPath(normalizedPattern);
  const scopeSegments = splitPath(scopePath);

  if (!hasWildcard(patternSegments)) {
    const patternPath = patternSegments.join("/");
    const scope = scopeSegments.join("/");
    return scope === patternPath || scope.startsWith(`${patternPath}/`);
  }

  return matchSegments(patternSegments, scopeSegments);
}
