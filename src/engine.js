import rough from 'roughjs/bundled/rough.esm.js';

export const SELECTION_COLOR = '#6698ff';
export const FONT_FAMILY = '"Virgil", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

const seedFromId = (id) => [...id].reduce((sum, char) => sum + char.charCodeAt(0), 1);
const naturalTextWidth = (line, fontSize) => line.length * fontSize * 0.57;

function wrapTextLine(line, fontSize, maxWidth) {
  if (!maxWidth || naturalTextWidth(line, fontSize) <= maxWidth) return [line];
  const words = line.split(' ');
  const wrapped = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (naturalTextWidth(candidate, fontSize) <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    wrapped.push(current);
    current = word;
  }
  if (current) wrapped.push(current);
  return wrapped.length ? wrapped : [''];
}

function getTextLines(el) {
  const wrapWidth = el.width || 0;
  return (el.text || '').split('\n').flatMap((line) => wrapTextLine(line, el.fontSize, wrapWidth));
}

export function getBounds(el) {
  if (el.type === 'freedraw') {
    const xs = el.points.map((p) => p[0] + el.x);
    const ys = el.points.map((p) => p[1] + el.y);
    const minX = Math.min(...xs, el.x);
    const minY = Math.min(...ys, el.y);
    return { x: minX, y: minY, w: Math.max(...xs, el.x) - minX, h: Math.max(...ys, el.y) - minY };
  }
  if (el.type === 'text') {
    const lines = getTextLines(el);
    const lineHeight = el.lineHeight || 1.25;
    const width = Math.max(24, ...lines.map((line) => naturalTextWidth(line, el.fontSize)));
    const height = Math.max(el.fontSize * lineHeight, lines.length * el.fontSize * lineHeight);
    if (el.textAlign === 'center') return { x: el.x - width / 2, y: el.y, w: width, h: height };
    if (el.textAlign === 'right') return { x: el.x - width, y: el.y, w: width, h: height };
    return { x: el.x, y: el.y, w: width, h: height };
  }
  return {
    x: Math.min(el.x, el.x + el.width),
    y: Math.min(el.y, el.y + el.height),
    w: Math.abs(el.width),
    h: Math.abs(el.height),
  };
}

// --- Image elements ---------------------------------------------------------
// Images are stored as data URLs on the element itself (so boards persist and
// the standalone build stays offline), decoded through a shared cache. Decoding
// is async, so the cache notifies listeners when a bitmap becomes paintable
// and the app re-renders; until then elements draw a dashed placeholder.

const imageCache = new Map();
const imageListeners = new Set();

export function onImageReady(listener) {
  imageListeners.add(listener);
  return () => imageListeners.delete(listener);
}

export function getImage(src) {
  let entry = imageCache.get(src);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false };
    img.onload = () => {
      entry.ready = true;
      imageListeners.forEach((listener) => listener(src));
    };
    img.src = src;
    if (imageCache.size > 400) imageCache.clear();
    imageCache.set(src, entry);
  }
  return entry;
}

export async function awaitImages(elements) {
  const pending = elements.filter((el) => el.type === 'image' && el.src).map((el) => getImage(el.src).img);
  await Promise.all(pending.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => {}))));
}

function drawImageElement(ctx, el) {
  const b = getBounds(el);
  const { img, ready } = getImage(el.src);
  if (ready && img.naturalWidth > 0) {
    ctx.drawImage(img, b.x, b.y, b.w, b.h);
    return;
  }
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(140,140,160,0.7)';
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(140,140,160,0.85)';
  ctx.font = `13px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(el.name || 'image', b.x + b.w / 2, b.y + b.h / 2);
  ctx.restore();
}

// Elements are updated immutably, so a per-id cache invalidated by object
// identity is always correct and lets crowded scenes skip recomputation.
export const renderStats = { generated: 0, reused: 0, culled: 0, boundsComputed: 0, boundsReused: 0 };

const boundsCache = new Map();

export function elementBounds(el) {
  const cached = boundsCache.get(el.id);
  if (cached && cached.el === el) {
    renderStats.boundsReused += 1;
    return cached.bounds;
  }
  const bounds = getBounds(el);
  if (boundsCache.size > 6000) boundsCache.clear();
  boundsCache.set(el.id, { el, bounds });
  renderStats.boundsComputed += 1;
  return bounds;
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function hitTest(el, point, slop = 8) {
  const b = getBounds(el);
  if (el.type === 'frame') {
    // Frames only take clicks on their name chip or the border ring, so the
    // content inside stays fully clickable. This runs before the padded
    // early-out below because the chip lives above the frame's bounds.
    const onTitle = point.x >= b.x - 4 && point.x <= b.x + b.w + 4 && point.y >= b.y - 26 && point.y <= b.y + 6;
    if (onTitle) return true;
    const inOuter = point.x >= b.x - 5 && point.x <= b.x + b.w + 5 && point.y >= b.y - 5 && point.y <= b.y + b.h + 5;
    if (!inOuter) return false;
    const onEdge = Math.min(Math.abs(point.x - b.x), Math.abs(point.x - (b.x + b.w))) <= 5
      || Math.min(Math.abs(point.y - b.y), Math.abs(point.y - (b.y + b.h))) <= 5;
    return onEdge;
  }
  const pad = slop + (el.strokeWidth || 2);
  if (point.x < b.x - pad || point.x > b.x + b.w + pad || point.y < b.y - pad || point.y > b.y + b.h + pad) return false;
  if (el.type === 'line' || el.type === 'arrow') {
    return distanceToSegment(point, { x: el.x, y: el.y }, { x: el.x + el.width, y: el.y + el.height }) <= pad;
  }
  if (el.type === 'freedraw') {
    for (let i = 1; i < el.points.length; i += 1) {
      const a = { x: el.x + el.points[i - 1][0], y: el.y + el.points[i - 1][1] };
      const c = { x: el.x + el.points[i][0], y: el.y + el.points[i][1] };
      if (distanceToSegment(point, a, c) <= pad) return true;
    }
    return el.points.length < 2;
  }
  if (el.type === 'ellipse' && el.background === 'transparent') {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const normalized = ((point.x - cx) ** 2) / Math.max(1, (b.w / 2) ** 2) + ((point.y - cy) ** 2) / Math.max(1, (b.h / 2) ** 2);
    return normalized > 0.55 && normalized < 1.45;
  }
  return true;
}

export function selectionBounds(elements, selectedIds) {
  const selected = elements.filter((item) => selectedIds.includes(item.id));
  if (!selected.length) return null;
  const bounds = selected.map(elementBounds);
  const x = Math.min(...bounds.map((b) => b.x));
  const y = Math.min(...bounds.map((b) => b.y));
  return { x, y, w: Math.max(...bounds.map((b) => b.x + b.w)) - x, h: Math.max(...bounds.map((b) => b.y + b.h)) - y };
}

export function hitHandle(screenPoint, elements, selectedIds, camera) {
  if (!selectedIds.length) return null;
  const handlePoints = (b, inset) => ({
    nw: { x: b.x - inset, y: b.y - inset },
    ne: { x: b.x + b.w + inset, y: b.y - inset },
    sw: { x: b.x - inset, y: b.y + b.h + inset },
    se: { x: b.x + b.w + inset, y: b.y + b.h + inset },
  });
  let handles;
  if (selectedIds.length > 1) {
    const b = selectionBounds(elements, selectedIds);
    if (!b) return null;
    handles = handlePoints(b, 5 / camera.zoom);
  } else {
    const el = elements.find((item) => item.id === selectedIds[0]);
    if (!el) return null;
    const b = getBounds(el);
    handles = el.type === 'text' ? { e: { x: b.x + b.w, y: b.y + b.h / 2 } } : handlePoints(b, 5 / camera.zoom);
  }
  for (const [key, point] of Object.entries(handles)) {
    const sx = point.x * camera.zoom + camera.x;
    const sy = point.y * camera.zoom + camera.y;
    if (Math.abs(screenPoint.x - sx) <= 8 && Math.abs(screenPoint.y - sy) <= 8) return key;
  }
  return null;
}

function scaleElement(el, bx, by, sx, sy) {
  const x = bx + (el.x - bx) * sx;
  const y = by + (el.y - by) * sy;
  if (el.type === 'freedraw') {
    return { ...el, x, y, points: el.points.map(([px, py]) => [px * sx, py * sy]) };
  }
  if (el.type === 'text') {
    return { ...el, x, y, fontSize: Math.max(10, el.fontSize * sy), width: el.width ? el.width * sx : el.width };
  }
  return { ...el, x, y, width: el.width * sx, height: el.height * sy };
}

export function resizeSelection(originals, handle, point, bounds, keepAspect = false) {
  let left = bounds.x;
  let top = bounds.y;
  let right = bounds.x + bounds.w;
  let bottom = bounds.y + bounds.h;
  if (handle.includes('w')) left = Math.min(point.x, right - 10);
  if (handle.includes('e')) right = Math.max(point.x, left + 10);
  if (handle.includes('n')) top = Math.min(point.y, bottom - 10);
  if (handle.includes('s')) bottom = Math.max(point.y, top + 10);
  if (keepAspect && bounds.w > 0 && bounds.h > 0) {
    const ratio = bounds.w / bounds.h;
    const newW = right - left;
    const newH = bottom - top;
    if (newW / newH > ratio) {
      if (handle.includes('w')) left = right - newH * ratio; else right = left + newH * ratio;
    } else if (handle.includes('n')) top = bottom - newW / ratio; else bottom = top + newW / ratio;
  }
  const sx = (right - left) / bounds.w;
  const sy = (bottom - top) / bounds.h;
  return originals.map((el) => scaleElement(el, left, top, sx, sy));
}

export function resizeElement(el, handle, point, keepAspect = false) {
  if (el.type === 'freedraw') return { ...el };
  if (el.type === 'text') {
    if (handle !== 'e') return { ...el };
    const original = getBounds(el);
    return { ...el, width: Math.max(80, point.x - original.x) };
  }
  const original = getBounds(el);
  let left = original.x;
  let top = original.y;
  let right = original.x + original.w;
  let bottom = original.y + original.h;
  if (handle.includes('w')) left = point.x;
  if (handle.includes('e')) right = point.x;
  if (handle.includes('n')) top = point.y;
  if (handle.includes('s')) bottom = point.y;
  let w = Math.max(2, right - left);
  let h = Math.max(2, bottom - top);
  // Images always keep their aspect ratio — squashing a photo is never wanted.
  if ((keepAspect || el.type === 'image') && original.w && original.h) {
    const ratio = original.w / original.h;
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    if (handle.includes('w')) left = right - w;
    if (handle.includes('n')) top = bottom - h;
  }
  return { ...el, x: left, y: top, width: w, height: h };
}

function roughOptions(el) {
  return {
    seed: seedFromId(el.id),
    stroke: el.stroke,
    strokeWidth: el.strokeWidth,
    roughness: el.roughness,
    bowing: el.roughness === 0 ? 0 : 1.4,
    fill: el.background === 'transparent' ? undefined : el.background,
    fillStyle: el.fillStyle,
    fillWeight: Math.max(1, el.strokeWidth / 2),
    hachureGap: 5 + el.strokeWidth,
  };
}

function shapeSpecs(el) {
  const opts = roughOptions(el);
  const { x, y, width: w, height: h } = el;
  if (el.type === 'rectangle') return [{ method: 'rectangle', args: [x, y, w, h], opts: { ...opts, preserveVertices: false } }];
  if (el.type === 'ellipse') return [{ method: 'ellipse', args: [x + w / 2, y + h / 2, Math.abs(w), Math.abs(h)], opts }];
  if (el.type === 'diamond') {
    return [{ method: 'polygon', args: [[[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]], opts }];
  }
  if (el.type === 'line') return [{ method: 'line', args: [x, y, x + w, y + h], opts }];
  if (el.type === 'arrow') {
    const endX = x + w;
    const endY = y + h;
    const angle = Math.atan2(h, w);
    const headLength = Math.min(28, Math.max(12, Math.hypot(w, h) / 4));
    const left = [endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6)];
    const right = [endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6)];
    return [
      { method: 'line', args: [x, y, endX, endY], opts },
      { method: 'line', args: [endX, endY, left[0], left[1]], opts },
      { method: 'line', args: [endX, endY, right[0], right[1]], opts },
    ];
  }
  if (el.type === 'freedraw') {
    const points = el.points.map((p) => [p[0] + el.x, p[1] + el.y]);
    if (points.length === 1) return [{ method: 'circle', args: [points[0][0], points[0][1], el.strokeWidth * 1.5], opts: { ...opts, fill: el.stroke, fillStyle: 'solid' } }];
    const filled = el.background && el.background !== 'transparent';
    return [{ method: 'curve', args: [points], opts: { ...opts, fill: filled ? el.background : undefined, fillStyle: el.fillStyle || 'solid', roughness: Math.min(el.roughness, 0.7) } }];
  }
  return [];
}

function makeShapes(rc, el) {
  return shapeSpecs(el).map((spec) => rc[spec.method](...spec.args, spec.opts));
}

// Canvas drawables are cached per element identity: regenerating rough.js
// geometry is the expensive part of rendering, and elements are immutable.
const drawableCache = new Map();

function shapesFor(rc, sourceEl, background) {
  const key = `${sourceEl.id}|${background}`;
  const cached = drawableCache.get(key);
  if (cached && cached.source === sourceEl) {
    renderStats.reused += cached.drawables.length;
    return cached.drawables;
  }
  const drawables = shapeSpecs(themedElement(sourceEl, background)).map((spec) => rc.generator[spec.method](...spec.args, spec.opts));
  if (drawableCache.size > 6000) drawableCache.clear();
  drawableCache.set(key, { source: sourceEl, drawables });
  renderStats.generated += drawables.length;
  return drawables;
}

function drawText(ctx, el) {
  ctx.save();
  ctx.globalAlpha = el.opacity / 100;
  ctx.fillStyle = el.stroke;
  ctx.font = `${el.fontStyle || 'normal'} ${el.fontWeight || 400} ${el.fontSize}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'top';
  const lines = getTextLines(el);
  const lineHeight = el.lineHeight || 1.25;
  const width = Math.max(24, ...lines.map((line) => naturalTextWidth(line, el.fontSize)));
  ctx.textAlign = el.textAlign || 'left';
  const anchorX = el.textAlign === 'center' ? el.x + width / 2 : el.textAlign === 'right' ? el.x + width : el.x;
  lines.forEach((line, index) => ctx.fillText(line, anchorX, el.y + index * el.fontSize * lineHeight));
  ctx.restore();
}

function drawSelection(ctx, elements, selectedIds, camera, pixelRatio) {
  if (!selectedIds.length) return;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  const drawCornerHandles = (x, y, w, h) => {
    ctx.setLineDash([]);
    for (const [hx, hy] of [[x - 5, y - 5], [x + w + 5, y - 5], [x - 5, y + h + 5], [x + w + 5, y + h + 5]]) {
      ctx.fillRect(hx - 4, hy - 4, 8, 8);
      ctx.strokeRect(hx - 4, hy - 4, 8, 8);
    }
    ctx.setLineDash([5, 4]);
  };
  if (selectedIds.length > 1) {
    const b = selectionBounds(elements, selectedIds);
    if (!b) return;
    const x = b.x * camera.zoom + camera.x;
    const y = b.y * camera.zoom + camera.y;
    const w = b.w * camera.zoom;
    const h = b.h * camera.zoom;
    ctx.strokeRect(x - 5, y - 5, w + 10, h + 10);
    drawCornerHandles(x, y, w, h);
    ctx.setLineDash([]);
    return;
  }
  for (const id of selectedIds) {
    const el = elements.find((item) => item.id === id);
    if (!el) continue;
    const b = elementBounds(el);
    const x = b.x * camera.zoom + camera.x;
    const y = b.y * camera.zoom + camera.y;
    const w = b.w * camera.zoom;
    const h = b.h * camera.zoom;
    ctx.strokeRect(x - 5, y - 5, w + 10, h + 10);
    if (el.type === 'text') {
      const hx = x + w + 5;
      const hy = y + h / 2;
      ctx.setLineDash([]);
      ctx.fillRect(hx - 4, hy - 4, 8, 8);
      ctx.strokeRect(hx - 4, hy - 4, 8, 8);
      ctx.setLineDash([5, 4]);
    } else if (el.type !== 'freedraw') {
      drawCornerHandles(x, y, w, h);
    }
  }
  ctx.setLineDash([]);
}

function themedElement(el, background) {
  return background === '#141414' && el.stroke === '#1e1e1e' ? { ...el, stroke: '#e8e8eb' } : el;
}

// Retrospective statuses a sticky note can wear. Colors double as the tag
// palette, so a board full of notes stays readable at a glance.
export const STICKY_STATUSES = [
  { id: 'well', label: 'Went well', color: '#2f9e44' },
  { id: 'improve', label: 'To improve', color: '#e03131' },
  { id: 'question', label: 'Question', color: '#1971c2' },
  { id: 'action', label: 'Action item', color: '#f08c00' },
];

// Badge anchor points in world coordinates — App.jsx hit-tests the same math.
export function stickyStatusCenter(el) {
  const b = getBounds(el);
  return { x: b.x + b.w - 14, y: b.y + 14 };
}
export function stickyBadgeCenter(el) {
  const b = getBounds(el);
  return { x: b.x + b.w - 14, y: b.y + 40 };
}

function drawStickyExtras(ctx, el, background, selectedIds = []) {
  const dark = background === '#141414';
  const b = getBounds(el);
  ctx.save();
  ctx.globalAlpha = (el.opacity ?? 100) / 100;
  const status = STICKY_STATUSES.find((s) => s.id === el.status);
  if (status) {
    const c = stickyStatusCenter(el);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = status.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = dark ? '#141414' : '#ffffff';
    ctx.stroke();
  }
  const votes = el.votes || 0;
  const selected = selectedIds.includes(el.id);
  if (votes > 0 || selected) {
    const c = stickyBadgeCenter(el);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 12, 0, Math.PI * 2);
    if (votes > 0) {
      ctx.fillStyle = dark ? '#232329' : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(140,140,160,0.55)';
      ctx.stroke();
      ctx.fillStyle = '#f03e66';
      ctx.font = `700 13px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(votes), c.x, c.y + 0.5);
    } else {
      // A fresh note shows a dashed target so the vote spot is discoverable.
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(140,140,160,0.6)';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(140,140,160,0.75)';
      ctx.font = `15px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', c.x, c.y + 0.5);
    }
  }
  if (el.tags?.length) {
    let x = b.x + 10;
    const y = b.y + b.h + 8;
    ctx.font = `11.5px ${FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const tag of el.tags.slice(0, 6)) {
      const label = tag.label.length > 16 ? `${tag.label.slice(0, 15)}…` : tag.label;
      const w = ctx.measureText(label).width + 14;
      ctx.beginPath();
      ctx.roundRect(x, y, w, 20, 6);
      ctx.fillStyle = `${tag.color}22`;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `${tag.color}77`;
      ctx.stroke();
      ctx.fillStyle = tag.color;
      ctx.fillText(label, x + 7, y + 10.5);
      x += w + 6;
    }
  }
  ctx.restore();
}

function drawFrame(ctx, el, background) {
  const dark = background === '#141414';
  const radius = 8;
  ctx.save();
  ctx.globalAlpha = (el.opacity ?? 100) / 100;
  // Tinted body with a subtle border — drawn flat on purpose, so frames read
  // as "paper regions" rather than sketch strokes.
  ctx.beginPath();
  ctx.roundRect(el.x, el.y, el.width, el.height, radius);
  ctx.fillStyle = dark ? 'rgba(255,255,255,0.03)' : 'rgba(100,110,140,0.05)';
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.22)' : 'rgba(60,70,100,0.25)';
  ctx.stroke();
  // Name chip riding above the top-left edge.
  const name = el.name || 'Frame';
  ctx.font = `15px ${FONT_FAMILY}`;
  const label = name.length > 40 ? `${name.slice(0, 39)}…` : name;
  const textW = ctx.measureText(label).width;
  const chipH = 24;
  const chipX = el.x + 10;
  const chipY = el.y - 18;
  ctx.beginPath();
  ctx.roundRect(chipX, chipY, textW + 16, chipH, 7);
  ctx.fillStyle = dark ? '#232329' : '#ffffff';
  ctx.fill();
  ctx.fillStyle = dark ? '#c9c9d4' : '#5a5f73';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, chipX + 8, chipY + chipH / 2 + 0.5);
  ctx.restore();
}

export function drawScene(canvas, elements, options) {
  const { width, height, camera, pixelRatio = 1, selectedIds = [], background = '#ffffff' } = options;
  if (canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio)) {
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(pixelRatio * camera.zoom, 0, 0, pixelRatio * camera.zoom, pixelRatio * camera.x, pixelRatio * camera.y);
  const rc = rough.canvas(canvas);
  // World-space viewport expanded by a margin, for culling off-screen work.
  const viewLeft = -camera.x / camera.zoom;
  const viewTop = -camera.y / camera.zoom;
  const viewRight = viewLeft + width / camera.zoom;
  const viewBottom = viewTop + height / camera.zoom;
  const margin = 40 + 20 / camera.zoom;
  // Frames render first, behind all content.
  for (const sourceEl of elements) {
    if (sourceEl.type !== 'frame') continue;
    const b = elementBounds(sourceEl);
    if (b.x > viewRight + margin || b.x + b.w < viewLeft - margin || b.y > viewBottom + margin || b.y + b.h < viewTop - margin) continue;
    drawFrame(ctx, sourceEl, background);
  }
  for (const sourceEl of elements) {
    const b = elementBounds(sourceEl);
    if (b.x > viewRight + margin || b.x + b.w < viewLeft - margin || b.y > viewBottom + margin || b.y + b.h < viewTop - margin) {
      renderStats.culled += 1;
      continue;
    }
    ctx.save();
    ctx.globalAlpha = sourceEl.opacity / 100;
    if (sourceEl.type === 'image') drawImageElement(ctx, sourceEl);
    else if (sourceEl.type === 'text') drawText(ctx, themedElement(sourceEl, background));
    else for (const drawable of shapesFor(rc, sourceEl, background)) rc.draw(drawable);
    ctx.restore();
  }
  // Sticky-note extras ride on top of the note itself: status dot, vote badge,
  // tag chips, and a faint vote target while a fresh note is selected.
  for (const sourceEl of elements) {
    if (!sourceEl.sticky || sourceEl.type !== 'rectangle') continue;
    const hasExtras = sourceEl.status || sourceEl.votes > 0 || sourceEl.tags?.length || selectedIds.includes(sourceEl.id);
    if (!hasExtras) continue;
    const b = elementBounds(sourceEl);
    if (b.x > viewRight + margin || b.x + b.w < viewLeft - margin || b.y > viewBottom + margin || b.y + b.h < viewTop - margin) continue;
    drawStickyExtras(ctx, sourceEl, background, selectedIds);
  }
  drawSelection(ctx, elements, selectedIds, camera, pixelRatio);
}

export function sceneBounds(elements) {
  if (!elements.length) return { x: 0, y: 0, w: 800, h: 600 };
  const bounds = elements.map(elementBounds);
  const minX = Math.min(...bounds.map((b) => b.x));
  const minY = Math.min(...bounds.map((b) => b.y));
  const maxX = Math.max(...bounds.map((b) => b.x + b.w));
  const maxY = Math.max(...bounds.map((b) => b.y + b.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export async function exportPng(elements, background = '#ffffff') {
  // Raster exports must wait for every bitmap to decode, or freshly pasted
  // images would come out as placeholders.
  await awaitImages(elements);
  const b = sceneBounds(elements);
  const padding = 40;
  const scale = Math.min(2, 6000 / Math.max(1, b.w + padding * 2), 6000 / Math.max(1, b.h + padding * 2));
  const canvas = document.createElement('canvas');
  const width = Math.max(1, b.w + padding * 2);
  const height = Math.max(1, b.h + padding * 2);
  drawScene(canvas, elements, {
    width,
    height,
    pixelRatio: scale,
    camera: { x: padding - b.x, y: padding - b.y, zoom: 1 },
    background,
  });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export function exportSvg(elements, background = '#ffffff') {
  const b = sceneBounds(elements);
  const padding = 40;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('xmlns', ns);
  svg.setAttribute('width', b.w + padding * 2);
  svg.setAttribute('height', b.h + padding * 2);
  svg.setAttribute('viewBox', `0 0 ${b.w + padding * 2} ${b.h + padding * 2}`);
  const bg = document.createElementNS(ns, 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', background);
  svg.appendChild(bg);
  const rc = rough.svg(svg);
  const group = document.createElementNS(ns, 'g');
  group.setAttribute('transform', `translate(${padding - b.x} ${padding - b.y})`);
  svg.appendChild(group);
  for (const sourceEl of elements) {
    const el = themedElement(sourceEl, background);
    const item = document.createElementNS(ns, 'g');
    item.setAttribute('opacity', el.opacity / 100);
    if (el.type === 'frame') {
      const dark = background === '#141414';
      const body = document.createElementNS(ns, 'rect');
      body.setAttribute('x', el.x);
      body.setAttribute('y', el.y);
      body.setAttribute('width', el.width);
      body.setAttribute('height', el.height);
      body.setAttribute('rx', 8);
      body.setAttribute('fill', dark ? 'rgba(255,255,255,0.03)' : 'rgba(100,110,140,0.05)');
      body.setAttribute('stroke', dark ? 'rgba(255,255,255,0.22)' : 'rgba(60,70,100,0.25)');
      body.setAttribute('stroke-width', 1.25);
      item.appendChild(body);
      const name = el.name || 'Frame';
      const label = name.length > 40 ? `${name.slice(0, 39)}…` : name;
      const chip = document.createElementNS(ns, 'rect');
      const chipW = Math.max(40, label.length * 8 + 16);
      chip.setAttribute('x', el.x + 10);
      chip.setAttribute('y', el.y - 18);
      chip.setAttribute('width', chipW);
      chip.setAttribute('height', 24);
      chip.setAttribute('rx', 7);
      chip.setAttribute('fill', dark ? '#232329' : '#ffffff');
      item.appendChild(chip);
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', el.x + 18);
      text.setAttribute('y', el.y - 4);
      text.setAttribute('font-size', 15);
      text.setAttribute('font-family', 'Virgil, Segoe Print, Comic Sans MS, cursive');
      text.setAttribute('fill', dark ? '#c9c9d4' : '#5a5f73');
      text.textContent = label;
      item.appendChild(text);
    } else if (el.type === 'text') {
      const text = document.createElementNS(ns, 'text');
      const lines = getTextLines(el);
      const lineHeight = el.lineHeight || 1.25;
      const width = Math.max(24, ...lines.map((line) => naturalTextWidth(line, el.fontSize)));
      const align = el.textAlign || 'left';
      const anchorX = align === 'center' ? el.x + width / 2 : align === 'right' ? el.x + width : el.x;
      text.setAttribute('x', anchorX);
      text.setAttribute('y', el.y);
      text.setAttribute('text-anchor', align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start');
      text.setAttribute('fill', el.stroke);
      text.setAttribute('font-size', el.fontSize);
      text.setAttribute('font-family', 'Virgil, Segoe Print, Comic Sans MS, cursive');
      if (el.fontWeight && el.fontWeight !== 400) text.setAttribute('font-weight', el.fontWeight);
      if (el.fontStyle && el.fontStyle !== 'normal') text.setAttribute('font-style', el.fontStyle);
      lines.forEach((line, index) => {
        const span = document.createElementNS(ns, 'tspan');
        span.setAttribute('x', anchorX);
        span.setAttribute('y', el.y + (index + 0.85) * el.fontSize * lineHeight);
        span.textContent = line;
        text.appendChild(span);
      });
      item.appendChild(text);
    } else if (el.type === 'image') {
      const b = getBounds(el);
      const node = document.createElementNS(ns, 'image');
      node.setAttribute('href', el.src);
      node.setAttribute('x', b.x);
      node.setAttribute('y', b.y);
      node.setAttribute('width', b.w);
      node.setAttribute('height', b.h);
      node.setAttribute('preserveAspectRatio', 'none');
      item.appendChild(node);
    } else {
      makeShapes(rc, el).forEach((shape) => item.appendChild(shape));
    }
    group.appendChild(item);
  }
  return new XMLSerializer().serializeToString(svg);
}

// --- Smart arrow bindings -------------------------------------------------
// An arrow endpoint dropped near a shape binds to it: the binding stores the
// shape id and the endpoint's offset from the shape's anchor corner. The
// arrow's geometry is materialized from bindings whenever shapes move.

export const BINDABLE_TYPES = ['rectangle', 'diamond', 'ellipse'];
const BIND_PADDING = 10;

// Find the nearest bindable shape to a point (within BIND_PADDING of its
// edge, or inside it). Returns { id, dx, dy } or undefined.
export function bindPoint(items, point, excludeIds = []) {
  let best = null;
  let bestDistance = Infinity;
  for (const el of items) {
    if (!BINDABLE_TYPES.includes(el.type) || excludeIds.includes(el.id)) continue;
    const b = getBounds(el);
    if (point.x < b.x - BIND_PADDING || point.x > b.x + b.w + BIND_PADDING
      || point.y < b.y - BIND_PADDING || point.y > b.y + b.h + BIND_PADDING) continue;
    const clampedX = Math.max(b.x, Math.min(point.x, b.x + b.w));
    const clampedY = Math.max(b.y, Math.min(point.y, b.y + b.h));
    const distance = Math.hypot(point.x - clampedX, point.y - clampedY);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = el;
    }
  }
  return best ? { id: best.id, dx: point.x - best.x, dy: point.y - best.y } : undefined;
}

// Attach both endpoints of an arrow to whatever shapes they are near.
export function rebindArrow(arrow, items) {
  const others = items.filter((el) => el.id !== arrow.id);
  return {
    ...arrow,
    startBinding: bindPoint(others, { x: arrow.x, y: arrow.y }),
    endBinding: bindPoint(others, { x: arrow.x + arrow.width, y: arrow.y + arrow.height }),
  };
}

// Re-resolve every bound arrow's geometry from its bindings and the current
// positions of the shapes it is attached to. Absolute and idempotent, so it
// is safe to call on every live pointer-move during a drag.
export function syncBoundArrows(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return items.map((el) => {
    if (el.type !== 'arrow' || (!el.startBinding && !el.endBinding)) return el;
    let start = { x: el.x, y: el.y };
    let end = { x: el.x + el.width, y: el.y + el.height };
    if (el.startBinding && byId.has(el.startBinding.id)) {
      const target = byId.get(el.startBinding.id);
      start = { x: target.x + el.startBinding.dx, y: target.y + el.startBinding.dy };
    }
    if (el.endBinding && byId.has(el.endBinding.id)) {
      const target = byId.get(el.endBinding.id);
      end = { x: target.x + el.endBinding.dx, y: target.y + el.endBinding.dy };
    }
    return { ...el, x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
  });
}

// Drop bindings that point at elements no longer in the scene.
export function pruneBindings(items) {
  const ids = new Set(items.map((el) => el.id));
  return items.map((el) => {
    if (el.type !== 'arrow') return el;
    const startBinding = el.startBinding && ids.has(el.startBinding.id) ? el.startBinding : undefined;
    const endBinding = el.endBinding && ids.has(el.endBinding.id) ? el.endBinding : undefined;
    if (startBinding === el.startBinding && endBinding === el.endBinding) return el;
    return { ...el, startBinding, endBinding };
  });
}

// --- Alignment guides -----------------------------------------------------
// While dragging a selection, snap its edges and center lines to the edges
// and centers of everything else on the canvas, and report which guide lines
// are active so the UI can draw them. Pure and cheap enough for every
// pointer-move during a drag.

export function snapToGuides(moving, items, zoom) {
  const bounds = selectionBounds(moving, moving.map((el) => el.id));
  if (!bounds) return { dx: 0, dy: 0, guides: [] };
  const movedIds = new Set(moving.map((el) => el.id));
  // Arrows bound to the moving set derive their geometry from it — exclude
  // them as candidates or the shape snaps to its own arrow (feedback loop).
  const others = items.filter((el) => !movedIds.has(el.id) && (el.type !== 'arrow' || !(
    (el.startBinding && movedIds.has(el.startBinding.id)) ||
    (el.endBinding && movedIds.has(el.endBinding.id))
  )));
  if (!others.length) return { dx: 0, dy: 0, guides: [] };
  const threshold = 6 / zoom;
  const vLines = new Set();
  const hLines = new Set();
  for (const el of others) {
    const b = getBounds(el);
    vLines.add(b.x); vLines.add(b.x + b.w / 2); vLines.add(b.x + b.w);
    hLines.add(b.y); hLines.add(b.y + b.h / 2); hLines.add(b.y + b.h);
  }
  const probesV = [bounds.x, bounds.x + bounds.w / 2, bounds.x + bounds.w];
  const probesH = [bounds.y, bounds.y + bounds.h / 2, bounds.y + bounds.h];
  let dx = 0;
  let dy = 0;
  let bestX = threshold + 1;
  for (const line of vLines) {
    for (const probe of probesV) {
      const delta = line - probe;
      if (Math.abs(delta) <= threshold && Math.abs(delta) < bestX) { bestX = Math.abs(delta); dx = delta; }
    }
  }
  let bestY = threshold + 1;
  for (const line of hLines) {
    for (const probe of probesH) {
      const delta = line - probe;
      if (Math.abs(delta) <= threshold && Math.abs(delta) < bestY) { bestY = Math.abs(delta); dy = delta; }
    }
  }
  // Snapping by less than half a screen pixel is invisible and only drags
  // coordinates into fractional noise (measured-text guides often sit
  // fractionally off an edge), so round such adjustments away.
  if (Math.abs(dx) < 0.5 / zoom) dx = 0;
  if (Math.abs(dy) < 0.5 / zoom) dy = 0;
  const guides = [];
  for (const line of vLines) {
    if (probesV.some((probe) => Math.abs(line - probe - dx) < 0.6)) guides.push({ axis: 'v', position: line });
  }
  for (const line of hLines) {
    if (probesH.some((probe) => Math.abs(line - probe - dy) < 0.6)) guides.push({ axis: 'h', position: line });
  }
  return { dx, dy, guides };
}
