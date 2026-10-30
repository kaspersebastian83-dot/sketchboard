// Workspace storage: multiple boards in one localStorage key, with migration
// from the original single-scene format.

const LEGACY_KEY = 'sketchboard-scene-v1';
const WORKSPACE_KEY = 'sketchboard-workspace-v1';

function emptyBoard(name) {
  return { id: `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`, name, elements: [], camera: { x: 0, y: 0, zoom: 1 }, createdAt: Date.now(), updatedAt: Date.now() };
}

export function loadWorkspace() {
  try {
    const raw = JSON.parse(localStorage.getItem(WORKSPACE_KEY));
    if (raw?.version === 2 && Array.isArray(raw.boards) && raw.boards.length && raw.boards.every((b) => b.id && Array.isArray(b.elements))) {
      return { version: 2, activeBoardId: raw.boards.some((b) => b.id === raw.activeBoardId) ? raw.activeBoardId : raw.boards[0].id, theme: raw.theme || 'light', boards: raw.boards };
    }
  } catch { /* Fall through to legacy migration or a fresh workspace. */ }
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (legacy?.elements) {
      const board = { ...emptyBoard('My first board'), elements: legacy.elements, camera: legacy.camera || { x: 0, y: 0, zoom: 1 } };
      return { version: 2, activeBoardId: board.id, theme: legacy.theme || 'light', boards: [board] };
    }
  } catch { /* Start fresh below. */ }
  const board = emptyBoard('My first board');
  return { version: 2, activeBoardId: board.id, theme: 'light', boards: [board] };
}

export function saveWorkspace(workspace) {
  try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace)); } catch { /* Storage can be full or disabled. */ }
}

// Write a standalone scene (e.g. a shared board being saved) into the active board.
export function importSceneToWorkspace(scene) {
  const workspace = loadWorkspace();
  const next = {
    ...workspace,
    theme: scene.theme || workspace.theme,
    boards: workspace.boards.map((b) => b.id === workspace.activeBoardId
      ? { ...b, elements: scene.elements, camera: scene.camera || b.camera, updatedAt: Date.now() }
      : b),
  };
  saveWorkspace(next);
  return next;
}
