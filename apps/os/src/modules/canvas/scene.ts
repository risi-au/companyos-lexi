type CanvasScene = {
  type?: unknown;
  version?: unknown;
  source?: unknown;
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

export const EMPTY_CANVAS_SCENE: CanvasScene = {
  elements: [],
  appState: {},
  files: {},
};

const DATABASE_APP_STATE_KEYS = new Set([
  "gridModeEnabled",
  "viewBackgroundColor",
  "gridSize",
  "gridStep",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonClone<T>(value: T, fallback: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return fallback;
  }
}

function sanitizeAppStateFallback(appState: unknown): Record<string, unknown> {
  if (!isRecord(appState)) {
    return {};
  }

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(appState)) {
    if (DATABASE_APP_STATE_KEYS.has(key)) {
      clean[key] = value;
    }
  }

  return jsonClone(clean, {});
}

function sanitizeSceneFallback(scene: unknown): CanvasScene {
  const input = isRecord(scene) ? scene : {};
  const elements = Array.isArray(input.elements) ? jsonClone(input.elements, []) : [];
  const files = isRecord(input.files) ? jsonClone(input.files, {}) : {};

  return {
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.version !== undefined ? { version: input.version } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    elements,
    appState: sanitizeAppStateFallback(input.appState),
    files,
  };
}

function sanitizeSerializedScene(scene: unknown): CanvasScene {
  const input = isRecord(scene) ? scene : {};
  const appState = isRecord(input.appState) ? jsonClone(input.appState, {}) : {};
  delete appState.collaborators;

  return {
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.version !== undefined ? { version: input.version } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    elements: Array.isArray(input.elements) ? jsonClone(input.elements, []) : [],
    appState,
    files: isRecord(input.files) ? jsonClone(input.files, {}) : {},
  };
}

export async function sanitizeSceneForStorage(scene: unknown): Promise<CanvasScene> {
  const fallback = sanitizeSceneFallback(scene);
  const input = isRecord(scene) ? scene : {};
  const elements = Array.isArray(input.elements) ? input.elements : [];
  const appState = isRecord(input.appState) ? input.appState : {};
  const files = isRecord(input.files) ? input.files : {};

  try {
    const { serializeAsJSON } = await import("@excalidraw/excalidraw");
    const serialized = serializeAsJSON(
      elements as never,
      appState as never,
      files as never,
      "database"
    );

    return sanitizeSerializedScene(JSON.parse(serialized));
  } catch {
    return fallback;
  }
}

export async function sanitizeSceneForInitialData(scene: unknown): Promise<CanvasScene> {
  const storageScene = await sanitizeSceneForStorage(scene);

  try {
    const { restore } = await import("@excalidraw/excalidraw");
    const restored = restore(storageScene as never, null, null, {
      refreshDimensions: false,
      repairBindings: true,
    });

    return sanitizeSerializedScene({
      ...storageScene,
      elements: restored.elements,
      files: restored.files,
    });
  } catch {
    return storageScene;
  }
}
