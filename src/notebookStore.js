// Notebook persistence in IndexedDB.
//
// localStorage is capped at ~5 MB, is shared with the whiteboard, and fails
// silently when full — fine for settings, not for a notebook. IndexedDB gets a
// share of the disk, stores structured data without JSON round-trips, and can
// be marked persistent so the browser won't evict it under storage pressure.
//
// Layout: one record per notebook (so a stroke only rewrites the notebook it
// changed) plus a small meta record with the active notebook id.

const DB_NAME = 'sketchboard';
const DB_VERSION = 1;
const NOTEBOOKS = 'notebooks';
const META = 'meta';
export const LEGACY_KEY = 'sketchboard-notebooks-v1';

let dbPromise = null;
let backend = null; // 'indexeddb' | 'localstorage'
const lastSaved = new Map(); // notebook id -> { nb, order } last written (identity check)
let lastActiveId = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOTEBOOKS)) db.createObjectStore(NOTEBOOKS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close(); // let a newer tab upgrade
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
});
const result = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function readLegacy() {
  try { return JSON.parse(localStorage.getItem(LEGACY_KEY)); } catch { return null; }
}

function remember(state) {
  lastSaved.clear();
  state.notebooks.forEach((nb, order) => lastSaved.set(nb.id, { nb, order }));
  lastActiveId = state.activeId;
}

// Returns the raw stored state ({ activeId, notebooks }) or null when empty.
// Moves an older localStorage notebook into IndexedDB on first run.
export async function readNotebooks() {
  try {
    const db = await openDb();
    const tx = db.transaction([NOTEBOOKS, META], 'readonly');
    const [notebooks, activeId] = await Promise.all([
      result(tx.objectStore(NOTEBOOKS).getAll()),
      result(tx.objectStore(META).get('activeId')),
    ]);
    backend = 'indexeddb';
    if (notebooks.length) {
      notebooks.sort((a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0));
      const state = { activeId, notebooks: notebooks.map(({ order, ...nb }) => nb) };
      remember(state);
      return state;
    }
    const legacy = readLegacy();
    if (legacy?.notebooks?.length) {
      await writeNotebooks(legacy);
      try { localStorage.removeItem(LEGACY_KEY); } catch { /* Keep it; harmless. */ }
      return legacy;
    }
    return null;
  } catch {
    // Private modes and some embedded browsers have no usable IndexedDB.
    backend = 'localstorage';
    return readLegacy();
  }
}

// Saves run one after another, so a slow write can never land after a newer one.
let chain = Promise.resolve();
export function writeNotebooks(state) {
  const run = chain.then(() => writeNow(state));
  chain = run.catch(() => {});
  return run;
}

// Writes only the notebooks whose object changed since the last save.
async function writeNow(state) {
  if (backend === 'localstorage') {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ version: 1, ...state }));
    return;
  }
  const db = await openDb();
  backend = 'indexeddb';
  const tx = db.transaction([NOTEBOOKS, META], 'readwrite');
  const store = tx.objectStore(NOTEBOOKS);
  const ids = new Set();
  state.notebooks.forEach((nb, order) => {
    ids.add(nb.id);
    const previous = lastSaved.get(nb.id);
    if (previous?.nb !== nb || previous.order !== order) store.put({ ...nb, order });
  });
  for (const id of lastSaved.keys()) if (!ids.has(id)) store.delete(id);
  if (state.activeId !== lastActiveId) tx.objectStore(META).put(state.activeId, 'activeId');
  await done(tx);
  remember(state);
}

export const storageBackend = () => backend;

// Ask the browser not to evict our data. Installed apps and frequently used
// sites are usually granted this without a prompt.
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

export async function storageInfo() {
  const info = { backend, persisted: false, usage: null, quota: null };
  try {
    if (navigator.storage?.persisted) info.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      info.usage = usage;
      info.quota = quota;
    }
  } catch { /* Estimates are optional. */ }
  return info;
}
