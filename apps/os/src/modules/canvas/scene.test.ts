import { describe, expect, it } from "vitest";

import { sanitizeSceneForInitialData, sanitizeSceneForStorage } from "./scene";

describe("canvas scene sanitization", () => {
  it("strips runtime-only appState before storage", async () => {
    const scene = await sanitizeSceneForStorage({
      elements: [{ id: "e1", type: "rectangle", x: 10, y: 20 }],
      appState: {
        collaborators: new Map([["socket-1", { username: "Rishi" }]]),
        cursorButton: "down",
        selectedElementIds: { e1: true },
        viewBackgroundColor: "#ffffff",
        gridModeEnabled: true,
      },
      files: {},
    });

    expect(scene.elements).toHaveLength(1);
    expect(scene.appState).toEqual({
      gridModeEnabled: true,
      viewBackgroundColor: "#ffffff",
    });
    expect("collaborators" in scene.appState).toBe(false);
    expect("cursorButton" in scene.appState).toBe(false);
    expect("selectedElementIds" in scene.appState).toBe(false);
  });

  it("repairs legacy rows with non-Map collaborators for initialData", async () => {
    const scene = await sanitizeSceneForInitialData({
      elements: [],
      appState: {
        collaborators: {},
        viewBackgroundColor: "#f4f4f4",
      },
      files: {},
    });

    expect(scene.appState.viewBackgroundColor).toBe("#f4f4f4");
    expect("collaborators" in scene.appState).toBe(false);
  });
});
