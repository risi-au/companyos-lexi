import { describe, expect, it } from "vitest";
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  accordionBranchForPath,
  clampSidebarWidth,
  parseStoredModuleShortcut,
  parseStoredSidebarWidth,
  serializeStoredModuleShortcut,
  pathPrefixes,
  toggleAccordionPath,
  toggleModuleShortcutPath,
} from "./sidebar-state";

function paths(set: ReadonlySet<string>) {
  return [...set];
}

describe("sidebar accordion state", () => {
  it("builds a deep-link branch from each path prefix", () => {
    expect(pathPrefixes("airbuddy/marketing/meta-ads")).toEqual([
      "airbuddy",
      "airbuddy/marketing",
      "airbuddy/marketing/meta-ads",
    ]);
    expect(paths(accordionBranchForPath("airbuddy/marketing/meta-ads"))).toEqual([
      "airbuddy",
      "airbuddy/marketing",
      "airbuddy/marketing/meta-ads",
    ]);
  });

  it("opens one branch at a time when expanding a sibling", () => {
    const first = accordionBranchForPath("airbuddy/marketing/meta-ads");
    const next = toggleAccordionPath(first, "indya/content");

    expect(paths(next)).toEqual(["indya", "indya/content"]);
    expect(next.has("airbuddy")).toBe(false);
    expect(next.has("airbuddy/marketing")).toBe(false);
  });

  it("collapses an open node and its descendants while keeping ancestors open", () => {
    const expanded = accordionBranchForPath("airbuddy/marketing/meta-ads");

    expect(paths(toggleAccordionPath(expanded, "airbuddy/marketing"))).toEqual(["airbuddy"]);
    expect(paths(toggleAccordionPath(expanded, "airbuddy"))).toEqual([]);
  });
});

describe("sidebar width bounds", () => {
  it("clamps desktop sidebar width to the supported range", () => {
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(300.4)).toBe(300);
    expect(clampSidebarWidth(999)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("falls back to the default width for missing or invalid storage values", () => {
    expect(parseStoredSidebarWidth(null)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(parseStoredSidebarWidth("not-a-number")).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});

describe("sidebar module shortcut state", () => {
  it("migrates legacy open and closed values from the existing storage key", () => {
    expect(parseStoredModuleShortcut("open", "airbuddy/website")).toBe("airbuddy/website");
    expect(parseStoredModuleShortcut("closed", "airbuddy/website")).toBeNull();
    expect(parseStoredModuleShortcut(null, "airbuddy/website")).toBeNull();
  });

  it("migrates the just-shipped array format to one open module shortcut path", () => {
    const serialized = "[\"airbuddy/website\",\"indya\"]";

    expect(parseStoredModuleShortcut(serialized, "indya")).toBe("indya");
    expect(parseStoredModuleShortcut(serialized, "missing")).toBe("airbuddy/website");
    expect(parseStoredModuleShortcut("[]", "indya")).toBeNull();
  });

  it("persists one open module shortcut path", () => {
    expect(serializeStoredModuleShortcut("airbuddy/website")).toBe("airbuddy/website");
    expect(parseStoredModuleShortcut("airbuddy/website")).toBe("airbuddy/website");
    expect(serializeStoredModuleShortcut(null)).toBe("closed");
  });

  it("toggles one module shortcut path at a time", () => {
    const open = toggleModuleShortcutPath("airbuddy", "airbuddy/website");
    expect(open).toBe("airbuddy/website");
    expect(toggleModuleShortcutPath(open, "airbuddy/website")).toBeNull();
  });
});
