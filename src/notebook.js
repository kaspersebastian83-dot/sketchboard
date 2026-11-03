// Notebook storage and paper rendering. A notebook is a pocket pad of A6 pages;
// every page holds ordinary sketchboard elements (freedraw, text), so the
// existing drawing engine renders the ink and this module only adds the paper.

import { uid, drawScene } from './engine.js';

export const PAGE_W = 420; // A6 portrait: 105 x 148 mm at 4 units per mm
export const PAGE_H = 592;
export const GRID = 20; // 5 mm squares
export const PAPERS = [
  { id: 'grid', label: 'Grid' },
  { id: 'dots', label: 'Dots' },
  { id: 'lines', label: 'Lines' },
  { id: 'blank', label: 'Blank' },
];

const KEY = 'sketchboard-notebooks-v1';
const MODE_KEY = 'sketchboard-mode-v1';

export const newPage = () => ({ id: uid(), elements: [] });

export function newNotebook(name = 'Pocket notes', paper = 'grid') {
  return { id: `nb-${uid()}`, name, paper, pages: [newPage()], current: 0, createdAt: Date.now(), updatedAt: Date.now() };
}

export function loadNotebooks() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw?.version === 1 && Array.isArray(raw.notebooks) && raw.notebooks.length
      && raw.notebooks.every((n) => n.id && Array.isArray(n.pages) && n.pages.length && n.pages.every((p) => p.id && Array.isArray(p.elements)))) {
      const activeId = raw.notebooks.some((n) => n.id === raw.activeId) ? raw.activeId : raw.notebooks[0].id;
      return { version: 1, activeId, notebooks: raw.notebooks.map((n) => ({ ...n, current: Math.min(Math.max(0, n.current || 0), n.pages.length - 1) })) };
    }
  } catch { /* Fall through to a fresh notebook. */ }
  const first = newNotebook();
  return { version: 1, activeId: first.id, notebooks: [first] };
}

export function saveNotebooks(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* Storage can be full or disabled. */ }
}

export function loadMode() {
  try { return localStorage.getItem(MODE_KEY) === 'notebook' ? 'notebook' : 'board'; } catch { return 'board'; }
}

export function saveMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* Not critical. */ }
}

// --- Paper ----------------------------------------------------------------------

const PAPER_COLOR = '#fbf6e8';
const RULE_COLOR = 'rgba(96, 128, 112, 0.30)';
const DOT_COLOR = 'rgba(96, 112, 104, 0.55)';

function paintPaper(ctx, scale, paper) {
  ctx.fillStyle = PAPER_COLOR;
  ctx.fillRect(0, 0, PAGE_W * scale, PAGE_H * scale);
  if (paper === 'blank') return;
  const top = 34; // leave room below the spiral holes
  ctx.save();
  ctx.scale(scale, scale);
  if (paper === 'dots') {
    ctx.fillStyle = DOT_COLOR;
    for (let x = GRID; x < PAGE_W; x += GRID) {
      for (let y = top; y < PAGE_H - 10; y += GRID) {
        ctx.beginPath();
        ctx.arc(x, y, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    ctx.strokeStyle = RULE_COLOR;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let y = top; y < PAGE_H - 6; y += GRID) {
      ctx.moveTo(0, y);
      ctx.lineTo(PAGE_W, y);
    }
    if (paper === 'grid') {
      for (let x = GRID; x < PAGE_W; x += GRID) {
        ctx.moveTo(x, top);
        ctx.lineTo(x, PAGE_H);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

let inkLayer = null;

// Draws paper, then the page's ink on top. The ink is rendered on white and
// multiplied in, so the printed grid shows through the pen like on real paper.
export function paintPage(canvas, elements, { scale, pixelRatio = 1, paper = 'grid' }) {
  const width = Math.max(1, Math.floor(PAGE_W * scale));
  const height = Math.max(1, Math.floor(PAGE_H * scale));
  if (canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio)) {
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  paintPaper(ctx, scale, paper);
  if (!elements.length) return;
  if (!inkLayer) inkLayer = document.createElement('canvas');
  drawScene(inkLayer, elements, { width, height, camera: { x: 0, y: 0, zoom: scale }, pixelRatio, background: '#ffffff' });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(inkLayer, 0, 0);
  ctx.restore();
}

export function pageToDataUrl(elements, paper, scale = 1, pixelRatio = 2) {
  const canvas = document.createElement('canvas');
  paintPage(canvas, elements, { scale, pixelRatio, paper });
  return canvas.toDataURL('image/png');
}

// --- Backup ---------------------------------------------------------------------
// A plain JSON file with every notebook, so pages can be kept safe or moved
// between devices and browsers.

const BACKUP_APP = 'sketchboard-notebooks';

export function serializeBackup(state) {
  return JSON.stringify({ app: BACKUP_APP, version: 1, exportedAt: new Date().toISOString(), notebooks: state.notebooks }, null, 1);
}

const validPage = (p) => p && typeof p.id === 'string' && Array.isArray(p.elements);

export function parseBackup(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('That file is not a notebook backup.'); }
  if (raw?.app !== BACKUP_APP || !Array.isArray(raw.notebooks)) throw new Error('That file is not a notebook backup.');
  const notebooks = raw.notebooks
    .filter((n) => n && typeof n.id === 'string' && Array.isArray(n.pages) && n.pages.length && n.pages.every(validPage))
    .map((n) => ({
      id: n.id,
      name: String(n.name || 'Notebook').slice(0, 80),
      paper: PAPERS.some((paper) => paper.id === n.paper) ? n.paper : 'grid',
      pages: n.pages.map((p) => ({ id: p.id, elements: p.elements })),
      current: Math.min(Math.max(0, n.current || 0), n.pages.length - 1),
      createdAt: n.createdAt || Date.now(),
      updatedAt: n.updatedAt || Date.now(),
    }));
  if (!notebooks.length) throw new Error('No notebooks found in that file.');
  return notebooks;
}

// Adds imported notebooks next to the existing ones. A notebook that is already
// here unchanged is skipped; one that was edited since gets imported as a copy
// so nothing on this device is ever overwritten.
export function mergeNotebooks(existing, incoming) {
  const added = [];
  let skipped = 0;
  for (const nb of incoming) {
    const same = existing.find((e) => e.id === nb.id);
    if (!same) { added.push(nb); continue; }
    if (JSON.stringify(same.pages) === JSON.stringify(nb.pages) && same.name === nb.name) { skipped += 1; continue; }
    added.push({ ...nb, id: `nb-${uid()}`, name: `${nb.name} (imported)` });
  }
  return { notebooks: [...existing, ...added], added: added.length, skipped };
}
