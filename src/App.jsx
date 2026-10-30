import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Menu, Lock, Unlock, MousePointer2, Hand, Square, Diamond, Circle, ArrowUpRight,
  Minus, Pencil, Type, Eraser, Undo2, Redo2, Library, Share2, Plus, HelpCircle,
  Sun, Moon, Trash2, Download, Upload, X, Check, Copy, Image as ImageIcon,
  FileJson, FileCode2, Grid3X3, Keyboard, ChevronDown, ArrowUpToLine, ArrowDownToLine,
  MoreHorizontal, RotateCcw, AlignLeft, AlignCenter, AlignRight, Bold, Italic,
  Group, Ungroup, AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, Link2, LayoutGrid,
  Mouse, Magnet, FileUp, Frame, Play, ChevronLeft, ChevronRight, Radio, Crown, LogOut, Users,
  GripVertical, Eye, Github,
} from 'lucide-react';
import {
  collabAvailable, generateName, generateRoomCode, liveRoomFromUrl, liveJoinUrl, connectCollab,
} from './collab.js';
import {
  uid, getBounds, elementBounds, hitTest, hitHandle, resizeElement, resizeSelection, selectionBounds, drawScene, sceneBounds,
  exportPng, exportSvg, SELECTION_COLOR, renderStats, bindPoint, rebindArrow, syncBoundArrows, pruneBindings, snapToGuides,
  STICKY_STATUSES, stickyBadgeCenter,
} from './engine.js';
import { encodeShareHash, buildSnapshotHtml } from './share.js';
import { loadWorkspace, saveWorkspace, importSceneToWorkspace } from './store.js';
import { parseTableText, buildChartElements } from './charts.js';
import { tablesFromSpreadsheet } from './import.js';

const DEFAULT_STYLE = {
  stroke: '#1e1e1e', background: 'transparent', fillStyle: 'hachure',
  strokeWidth: 2, roughness: 1, opacity: 100, fontSize: 24, textAlign: 'left', fontWeight: 400, fontStyle: 'normal', lineHeight: 1.25,
};
const TOOLS = [
  { id: 'hand', icon: Hand, label: 'Hand — pan canvas', key: 'H' },
  { id: 'selection', icon: MousePointer2, label: 'Selection', key: 'V' },
  { id: 'rectangle', icon: Square, label: 'Rectangle', key: 'R' },
  { id: 'diamond', icon: Diamond, label: 'Diamond', key: 'D' },
  { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'O' },
  { id: 'arrow', icon: ArrowUpRight, label: 'Arrow', key: 'A' },
  { id: 'line', icon: Minus, label: 'Line', key: 'L' },
  { id: 'frame', icon: Frame, label: 'Frame — named region', key: 'F' },
  { id: 'freedraw', icon: Pencil, label: 'Draw', key: 'P' },
  { id: 'text', icon: Type, label: 'Text', key: 'T' },
  { id: 'eraser', icon: Eraser, label: 'Eraser', key: 'E' },
];
const STROKE_COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00'];
const BACKGROUND_COLORS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99'];
const STICKY_COLORS = ['#ffec99', '#b2f2bb', '#a5d8ff', '#ffc9c9', '#e6c9ff'];
const TAG_COLORS = ['#2f9e44', '#1971c2', '#f08c00', '#9c36b5', '#e03131'];

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ToolButton({ tool, active, onClick, compact = false }) {
  const Icon = tool.icon;
  return (
    <button
      className={`tool-button ${active ? 'active' : ''} ${compact ? 'compact' : ''}`}
      title={`${tool.label} (${tool.key})`}
      aria-label={tool.label}
      aria-pressed={active}
      data-testid={`tool-${tool.id}`}
      onClick={onClick}
    >
      <Icon size={19} strokeWidth={1.8} />
      {!compact && <kbd>{tool.key}</kbd>}
    </button>
  );
}

function ColorSwatches({ colors, value, onChange, allowTransparent = false, label }) {
  return (
    <div className="swatches" role="group" aria-label={label}>
      {colors.map((color) => (
        <button
          key={color}
          className={`color-swatch ${value === color ? 'selected' : ''} ${color === 'transparent' ? 'transparent' : ''}`}
          style={{ '--swatch': color === 'transparent' ? '#fff' : color }}
          aria-label={`${label}: ${color}`}
          aria-pressed={value === color}
          onClick={() => onChange(color)}
        >
          {value === color && <Check size={14} color={color === 'transparent' || color === '#ffec99' ? '#1e1e1e' : '#fff'} />}
        </button>
      ))}
      <label className="color-swatch custom-color" title="Custom color">
        <input type="color" value={value === 'transparent' ? '#ffffff' : value} onChange={(e) => onChange(e.target.value)} aria-label={`Custom ${label}`} />
        <Plus size={15} />
      </label>
      {allowTransparent && <span className="swatch-note">Transparent</span>}
    </div>
  );
}

const HINTS_KEY = 'sketchboard-hints-v1';

function loadHints() {
  const defaults = { dismissed: false, zoomed: false, panned: false, editedText: false, snapped: false };
  try {
    const raw = localStorage.getItem(HINTS_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* Storage can be unavailable; stay quiet. */ }
  return defaults;
}

const ISLAND_POS_KEY = 'sketchboard-island-positions-v1';

function loadIslandPositions() {
  try {
    const raw = localStorage.getItem(ISLAND_POS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* Corrupt or unavailable storage: fall back to defaults. */ }
  return {};
}

export default function App() {
  const sharedInitial = typeof window !== 'undefined' && window.__sharedScene ? window.__sharedScene : null;
  const initialWorkspace = useRef(loadWorkspace()).current;
  const activeBoard = initialWorkspace.boards.find((b) => b.id === initialWorkspace.activeBoardId) || initialWorkspace.boards[0];
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [elements, setElementsState] = useState(sharedInitial ? sharedInitial.elements : activeBoard.elements);
  const elementsRef = useRef(elements);
  const [camera, setCamera] = useState(sharedInitial?.camera || activeBoard.camera || { x: 0, y: 0, zoom: 1 });
  const [theme, setTheme] = useState(sharedInitial?.theme || initialWorkspace.theme || 'light');
  const [sharedSource, setSharedSource] = useState(sharedInitial ? sharedInitial.source || 'snapshot' : null);
  const [shareUrl, setShareUrl] = useState('');
  const [tool, setTool] = useState('selection');
  const [toolLocked, setToolLocked] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [defaultStyle, setDefaultStyle] = useState(DEFAULT_STYLE);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [menuOpen, setMenuOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [grid, setGrid] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [textEditor, setTextEditor] = useState(null);
  const [marquee, setMarquee] = useState(null);
  const [toast, setToast] = useState('');
  const [cursor, setCursor] = useState('default');
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [boardQuery, setBoardQuery] = useState('');
  const [renameTarget, setRenameTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [guides, setGuides] = useState(null);
  const [chartEditor, setChartEditor] = useState(null);
  const [sheetPicker, setSheetPicker] = useState(null);
  const [framesOpen, setFramesOpen] = useState(false);
  const [frameQuery, setFrameQuery] = useState('');
  const [frameRename, setFrameRename] = useState(null);
  const [presentIndex, setPresentIndex] = useState(null);
  const [live, setLive] = useState(null); // { room, self, roster, hostId }
  const [livePanelOpen, setLivePanelOpen] = useState(false);
  const [liveCursors, setLiveCursors] = useState({}); // memberId -> { wx, wy }
  const [following, setFollowing] = useState(true);
  const liveConnRef = useRef(null);
  const liveRef = useRef(null);
  const followRef = useRef(true);
  const pendingRoomRef = useRef(null);
  const lastRemoteRef = useRef({ elements: null, camera: null });
  const lastHostCameraRef = useRef(null);
  const liveSendTimer = useRef(null);
  const cursorSentAt = useRef(0);
  const cameraRef = useRef(camera);
  const [hints, setHints] = useState(loadHints);
  // Zen is a per-board preference: boards remember whether they like a clean
  // desk, and starting a presentation borrows zen mode until the show is over.
  const [zenMode, setZenMode] = useState(() => Boolean(activeBoard?.zen));
  const zenBeforePresentRef = useRef(false);
  // Movable UI islands: once a bar has been dragged off its default dock it
  // gets an explicit {x, y} that is applied inline and persisted per device.
  const [islandPos, setIslandPos] = useState(loadIslandPositions);
  const islandPosRef = useRef(islandPos);
  const islandDragRef = useRef(null);
  const presentationRef = useRef(null);
  const laserRef = useRef(null);
  const laserTrailRef = useRef([]);
  const [inkMode, setInkMode] = useState(false);
  const inkRef = useRef(null);
  const inkStrokesRef = useRef([]);
  const inkDrawingRef = useRef(null);
  const suppressClickRef = useRef(false);
  const renameInputRef = useRef(null);
  const workspaceRef = useRef(initialWorkspace);
  const sharedView = sharedSource !== null;
  const canvasRef = useRef(null);
  const appRef = useRef(null);
  const interaction = useRef(null);
  const fileInputRef = useRef(null);
  const toastTimer = useRef(null);
  const flyRaf = useRef(null);

  const updateElements = useCallback((next) => {
    elementsRef.current = next;
    setElementsState(next);
  }, []);

  const notify = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }, []);

  // Snapshot of the workspace with the live board's current scene written in.
  const flushWorkspace = useCallback((ws) => ({
    ...ws,
    theme,
    boards: ws.boards.map((b) => b.id === ws.activeBoardId ? { ...b, elements: elementsRef.current, camera, updatedAt: Date.now() } : b),
  }), [theme, camera]);

  const setZenPreference = useCallback((zen) => {
    setZenMode(zen);
    const flushed = flushWorkspace(workspaceRef.current);
    const next = { ...flushed, boards: flushed.boards.map((b) => (b.id === flushed.activeBoardId ? { ...b, zen } : b)) };
    workspaceRef.current = next;
    saveWorkspace(next);
    setWorkspace(next);
  }, [flushWorkspace]);

  const resetBoardView = useCallback(() => {
    setSelectedIds([]);
    setPast([]);
    setFuture([]);
    setTextEditor(null);
  }, []);

  const markHint = useCallback((key) => {
    setHints((prev) => {
      if (prev[key]) return prev;
      const next = { ...prev, [key]: true };
      try { localStorage.setItem(HINTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const dismissHints = useCallback(() => {
    setHints((prev) => {
      const next = { ...prev, dismissed: true };
      try { localStorage.setItem(HINTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Leaving a show hands zen mode back to whatever it was before the curtain
  // rose — auto-clean never overwrites the user's own preference.
  const exitPresentation = useCallback(() => {
    setPresentIndex(null);
    setZenMode(zenBeforePresentRef.current);
  }, []);

  const switchBoard = useCallback((id) => {
    const current = workspaceRef.current;
    if (id === current.activeBoardId) { setBoardsOpen(false); return; }
    const target = current.boards.find((b) => b.id === id);
    if (!target) return;
    const flushed = flushWorkspace(current);
    const next = { ...flushed, activeBoardId: id };
    workspaceRef.current = next;
    saveWorkspace(next);
    setWorkspace(next);
    updateElements(target.elements);
    setCamera(target.camera || { x: 0, y: 0, zoom: 1 });
    resetBoardView();
    setZenMode(Boolean(target.zen));
    setBoardsOpen(false);
    setBoardQuery('');
    exitPresentation();
  }, [flushWorkspace, updateElements, resetBoardView, exitPresentation]);

  const createBoard = useCallback(() => {
    const flushed = flushWorkspace(workspaceRef.current);
    const board = {
      id: uid(), name: 'Untitled board', elements: [], camera: { x: 0, y: 0, zoom: 1 }, createdAt: Date.now(), updatedAt: Date.now(),
    };
    const next = { ...flushed, activeBoardId: board.id, boards: [...flushed.boards, board] };
    workspaceRef.current = next;
    saveWorkspace(next);
    setWorkspace(next);
    updateElements([]);
    setCamera({ x: 0, y: 0, zoom: 1 });
    resetBoardView();
    setZenMode(false);
    setBoardQuery('');
    setBoardsOpen(true);
    notify(`Board “${board.name}” created`);
  }, [flushWorkspace, updateElements, resetBoardView, notify]);

  const doRename = useCallback((name) => {
    const trimmed = (name || '').trim();
    setModal(null);
    if (!trimmed || !renameTarget) { setRenameTarget(null); return; }
    const next = flushWorkspace(workspaceRef.current);
    next.boards = next.boards.map((b) => b.id === renameTarget ? { ...b, name: trimmed } : b);
    workspaceRef.current = next;
    saveWorkspace(next);
    setWorkspace(next);
    setRenameTarget(null);
    notify(`Renamed to “${trimmed}”`);
  }, [renameTarget, flushWorkspace, notify]);

  const doDelete = useCallback(() => {
    setModal(null);
    const target = deleteTarget;
    setDeleteTarget(null);
    const current = workspaceRef.current;
    if (!target || current.boards.length < 2) return;
    const remaining = current.boards.filter((b) => b.id !== target);
    let next = { ...flushWorkspace(current), boards: remaining };
    if (current.activeBoardId === target) {
      const successor = remaining[0];
      next = { ...next, activeBoardId: successor.id };
      workspaceRef.current = next;
      saveWorkspace(next);
      setWorkspace(next);
      updateElements(successor.elements);
      setCamera(successor.camera || { x: 0, y: 0, zoom: 1 });
      resetBoardView();
    } else {
      workspaceRef.current = next;
      saveWorkspace(next);
      setWorkspace(next);
    }
    notify('Board deleted');
  }, [deleteTarget, flushWorkspace, updateElements, resetBoardView, notify]);

  // Open a board from the panel; with an active query, jump to the first matching
  // text element — switching boards if needed, centering it, and selecting it.
  const openBoard = useCallback((board) => {
    const query = boardQuery.trim().toLowerCase();
    const match = query ? board.elements.find((el) => el.type === 'text' && (el.text || '').toLowerCase().includes(query)) : null;
    if (match) {
      if (board.id !== workspaceRef.current.activeBoardId) switchBoard(board.id);
      else { setBoardsOpen(false); setBoardQuery(''); }
      const bounds = elementBounds(match);
      const centerX = bounds.x + bounds.w / 2;
      const centerY = bounds.y + bounds.h / 2;
      setCamera((prev) => ({ x: size.width / 2 - centerX * prev.zoom, y: size.height / 2 - centerY * prev.zoom, zoom: prev.zoom }));
      setSelectedIds([match.id]);
    } else {
      switchBoard(board.id);
    }
  }, [boardQuery, switchBoard, size.width, size.height]);

  const commit = useCallback((updater) => {
    const before = elementsRef.current;
    const next = typeof updater === 'function' ? updater(before) : updater;
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    setPast((items) => [...items.slice(-79), before]);
    setFuture([]);
    updateElements(next);
  }, [updateElements]);

  const finishHistory = useCallback((before) => {
    if (!before || JSON.stringify(before) === JSON.stringify(elementsRef.current)) return;
    setPast((items) => [...items.slice(-79), before]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    if (!past.length) return;
    const current = elementsRef.current;
    const previous = past[past.length - 1];
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [current, ...items]);
    updateElements(previous);
    setSelectedIds([]);
  }, [past, updateElements]);

  const redo = useCallback(() => {
    if (!future.length) return;
    const current = elementsRef.current;
    const next = future[0];
    setFuture((items) => items.slice(1));
    setPast((items) => [...items, current]);
    updateElements(next);
    setSelectedIds([]);
  }, [future, updateElements]);

  const makeElement = useCallback((type, x, y, width = 0, height = 0, overrides = {}) => ({
    id: uid(), type, x, y, width, height, ...defaultStyle, ...overrides,
  }), [defaultStyle]);

  // Flush the live elements/camera/theme into the active board whenever they change.
  // The workspace lives in a ref so drawing never triggers an extra render pass;
  // it is mirrored into state only while the boards panel is open.
  useEffect(() => {
    if (sharedView) return;
    const current = workspaceRef.current;
    const next = {
      ...current,
      theme,
      boards: current.boards.map((b) => b.id === current.activeBoardId ? { ...b, elements, camera, updatedAt: Date.now() } : b),
    };
    workspaceRef.current = next;
    saveWorkspace(next);
    if (boardsOpen) setWorkspace(next);
  }, [elements, camera, theme, sharedView, boardsOpen]);

  useEffect(() => {
    window.__renderStats = renderStats;
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => { window.__selectedIds = selectedIds; }, [selectedIds]);
  useEffect(() => { window.__camera = camera; }, [camera]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => drawScene(canvas, elements, {
      width: size.width,
      height: size.height,
      camera,
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      selectedIds,
      background: theme === 'dark' ? '#141414' : '#ffffff',
    });
    render();
    // Canvas text must be redrawn once the embedded handwritten font is ready.
    document.fonts.ready.then(render);
  }, [elements, camera, size, selectedIds, theme]);

  // --- Minimap -------------------------------------------------------------
  const MINIMAP_W = 208;
  const MINIMAP_H = 144;
  const MINIMAP_PAD = 14;
  const minimapRef = useRef(null);
  const minimapDrag = useRef(false);
  const [minimapOpen, setMinimapOpen] = useState(true);

  const minimapTransform = useCallback((items) => {
    const b = sceneBounds(items);
    const bw = Math.max(1, b.w);
    const bh = Math.max(1, b.h);
    const scale = Math.min((MINIMAP_W - MINIMAP_PAD * 2) / bw, (MINIMAP_H - MINIMAP_PAD * 2) / bh);
    return {
      scale,
      ox: (MINIMAP_W - bw * scale) / 2 - b.x * scale,
      oy: (MINIMAP_H - bh * scale) / 2 - b.y * scale,
    };
  }, []);

  useEffect(() => {
    if (!minimapOpen || sharedView) return;
    const canvas = minimapRef.current;
    if (!canvas) return;
    const { scale, ox, oy } = minimapTransform(elements);
    drawScene(canvas, elements, {
      width: MINIMAP_W,
      height: MINIMAP_H,
      camera: { x: ox, y: oy, zoom: scale },
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      selectedIds: [],
      background: theme === 'dark' ? '#1b1b1f' : '#fbfbfc',
    });
    const ctx = canvas.getContext('2d');
    const pr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    const left = -camera.x / camera.zoom;
    const top = -camera.y / camera.zoom;
    const vw = size.width / camera.zoom;
    const vh = size.height / camera.zoom;
    const vx = left * scale + ox;
    const vy = top * scale + oy;
    ctx.strokeStyle = '#6698ff';
    ctx.fillStyle = theme === 'dark' ? 'rgba(102, 152, 255, 0.10)' : 'rgba(102, 152, 255, 0.08)';
    ctx.lineWidth = 1.5;
    const vwpx = vw * scale;
    const vhpx = vh * scale;
    if (vwpx < MINIMAP_W * 4 && vhpx < MINIMAP_H * 4) {
      ctx.fillRect(vx, vy, vwpx, vhpx);
      ctx.strokeRect(vx, vy, vwpx, vhpx);
    } else {
      // Viewport is enormous compared to content (deep zoom-out) — just outline the visible frame edge.
      ctx.beginPath();
      ctx.rect(Math.max(0, vx), Math.max(0, vy), Math.min(vwpx, MINIMAP_W), Math.min(vhpx, MINIMAP_H));
      ctx.stroke();
    }
  }, [elements, camera, size, theme, minimapOpen, sharedView, minimapTransform]);

  const minimapJump = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * (MINIMAP_W / rect.width);
    const my = (event.clientY - rect.top) * (MINIMAP_H / rect.height);
    const { scale, ox, oy } = minimapTransform(elementsRef.current);
    const wx = (mx - ox) / scale;
    const wy = (my - oy) / scale;
    setCamera((prev) => ({ ...prev, x: size.width / 2 - wx * prev.zoom, y: size.height / 2 - wy * prev.zoom }));
  }, [size, minimapTransform]);

  const zoomAt = useCallback((screenX, screenY, requestedZoom) => {
    markHint('zoomed');
    setCamera((prev) => {
      const zoom = Math.max(0.02, Math.min(32, requestedZoom));
      const worldX = (screenX - prev.x) / prev.zoom;
      const worldY = (screenY - prev.y) / prev.zoom;
      return { x: screenX - worldX * zoom, y: screenY - worldY * zoom, zoom };
    });
  }, [markHint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event) => {
      event.preventDefault();
      if (flyRaf.current) { cancelAnimationFrame(flyRaf.current); flyRaf.current = null; }
      pauseFollowing();
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) {
        // Shift+wheel pans horizontally (wheel) or tracks two-finger swipes.
        markHint('panned');
        setCamera((prev) => ({ ...prev, x: prev.x - (event.deltaY || event.deltaX) }));
        return;
      }
      // Plain wheel or pinch (ctrl+wheel) zooms toward the cursor; deltaX still pans sideways.
      const k = event.deltaMode === 1 ? 0.05 : 0.0025;
      zoomAt(sx, sy, camera.zoom * Math.exp(-event.deltaY * k));
      if (event.deltaX) setCamera((prev) => ({ ...prev, x: prev.x - event.deltaX }));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [camera.zoom, zoomAt]);

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    commit((items) => pruneBindings(items.filter((el) => !selectedIds.includes(el.id))));
    setSelectedIds([]);
  }, [selectedIds, commit]);

  const voteOn = useCallback((id, delta) => {
    commit((items) => items.map((el) => (el.id === id ? { ...el, votes: Math.max(0, (el.votes || 0) + delta) } : el)));
  }, [commit]);

  const updateStickyRect = useCallback((updater) => {
    const selected = elementsRef.current.filter((el) => selectedIds.includes(el.id));
    const text = selected.find((el) => el.sticky && el.type === 'text');
    const rect = selected.find((el) => el.sticky && el.type === 'rectangle')
      || (text?.groupId ? elementsRef.current.find((el) => el.sticky && el.type === 'rectangle' && el.groupId === text.groupId) : undefined);
    if (!rect) return;
    commit((items) => items.map((el) => (el.id === rect.id ? updater(el) : el)));
  }, [selectedIds, commit]);

  const duplicateSelected = useCallback(() => {
    const sources = elementsRef.current.filter((el) => selectedIds.includes(el.id));
    if (!sources.length) return;
    const groupMap = new Map();
    const idMap = new Map();
    const copies = sources.map((el) => {
      let groupId = el.groupId;
      if (groupId) {
        if (!groupMap.has(groupId)) groupMap.set(groupId, uid());
        groupId = groupMap.get(groupId);
      }
      const copy = { ...el, id: uid(), groupId, x: el.x + 18, y: el.y + 18 };
      idMap.set(el.id, copy.id);
      return copy;
    });
    const rebound = copies.map((el) => {
      if (el.type !== 'arrow') return el;
      const remap = (binding) => (binding && idMap.has(binding.id) ? { ...binding, id: idMap.get(binding.id) } : undefined);
      return { ...el, startBinding: remap(el.startBinding), endBinding: remap(el.endBinding) };
    });
    commit((items) => [...items, ...rebound]);
    setSelectedIds(rebound.map((el) => el.id));
  }, [selectedIds, commit]);

  const groupSelected = useCallback(() => {
    if (selectedIds.length < 2) return;
    const groupId = uid();
    commit((items) => items.map((el) => selectedIds.includes(el.id) ? { ...el, groupId } : el));
    notify('Grouped — click any member to select the whole group');
  }, [selectedIds, commit, notify]);

  const ungroupSelected = useCallback(() => {
    if (!selectedIds.length) return;
    commit((items) => items.map((el) => selectedIds.includes(el.id) ? { ...el, groupId: undefined } : el));
    notify('Ungrouped');
  }, [selectedIds, commit, notify]);

  const alignSelected = useCallback((mode) => {
    if (selectedIds.length < 2) return;
    const selected = elementsRef.current.filter((el) => selectedIds.includes(el.id));
    const bounds = selected.map((el) => getBounds(el));
    const minX = Math.min(...bounds.map((b) => b.x));
    const maxX = Math.max(...bounds.map((b) => b.x + b.w));
    const minY = Math.min(...bounds.map((b) => b.y));
    const maxY = Math.max(...bounds.map((b) => b.y + b.h));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    commit((items) => {
      const next = items.map((el) => {
        if (!selectedIds.includes(el.id)) return el;
        const b = getBounds(el);
        let dx = 0;
        let dy = 0;
        if (mode === 'left') dx = minX - b.x;
        if (mode === 'centerH') dx = centerX - (b.x + b.w / 2);
        if (mode === 'right') dx = maxX - (b.x + b.w);
        if (mode === 'top') dy = minY - b.y;
        if (mode === 'middle') dy = centerY - (b.y + b.h / 2);
        if (mode === 'bottom') dy = maxY - (b.y + b.h);
        if (!dx && !dy) return el;
        const movedEl = { ...el, x: el.x + dx, y: el.y + dy };
        return movedEl.type === 'arrow' ? { ...movedEl, startBinding: undefined, endBinding: undefined } : movedEl;
      });
      return syncBoundArrows(next);
    });
  }, [selectedIds, commit]);

  const fitToScreen = useCallback((items = elementsRef.current) => {
    if (!items.length) {
      setCamera({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const b = sceneBounds(items);
    const zoom = Math.max(0.02, Math.min(1.5, (size.width - 180) / Math.max(1, b.w), (size.height - 180) / Math.max(1, b.h)));
    setCamera({ x: size.width / 2 - (b.x + b.w / 2) * zoom, y: size.height / 2 - (b.y + b.h / 2) * zoom, zoom });
  }, [size]);

  const applyTextFormatting = useCallback((key, value) => {
    setDefaultStyle((style) => ({ ...style, [key]: value }));
    const textIds = elementsRef.current.filter((el) => selectedIds.includes(el.id) && el.type === 'text').map((el) => el.id);
    if (textIds.length) {
      commit((items) => items.map((el) => textIds.includes(el.id) ? { ...el, [key]: value } : el));
    }
  }, [selectedIds, commit]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
      if (event.code === 'Space' && !typing) {
        event.preventDefault();
        setSpacePressed(true);
      }
      if (sharedView && !['Escape', '+', '-', '='].includes(event.key)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const activeText = elementsRef.current.find((el) => selectedIds.includes(el.id) && el.type === 'text');
      const textContextNow = tool === 'text' || Boolean(activeText);
      const alignedValue = { l: 'left', c: 'center', r: 'right' }[key];
      if (textContextNow && mod && event.shiftKey && alignedValue) {
        event.preventDefault();
        applyTextFormatting('textAlign', alignedValue);
        return;
      }
      if (textContextNow && mod && key === 'b') {
        event.preventDefault();
        applyTextFormatting('fontWeight', (activeText?.fontWeight ?? defaultStyle.fontWeight ?? 400) === 700 ? 400 : 700);
        return;
      }
      if (textContextNow && mod && key === 'i') {
        event.preventDefault();
        applyTextFormatting('fontStyle', (activeText?.fontStyle ?? defaultStyle.fontStyle ?? 'normal') === 'italic' ? 'normal' : 'italic');
        return;
      }
      if (typing) return;
      if (mod && key === 'o') { event.preventDefault(); fileInputRef.current?.click(); return; }
      if (mod && event.shiftKey && key === 'e') { event.preventDefault(); setModal('export'); return; }
      if (mod && event.shiftKey && key === 'd') { event.preventDefault(); setTheme((current) => current === 'dark' ? 'light' : 'dark'); return; }
      if (mod && key === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if (mod && key === 'y') { event.preventDefault(); redo(); return; }
      if (mod && key === 'a') {
        event.preventDefault();
        setSelectedIds(elementsRef.current.map((el) => el.id));
        setTool('selection');
        return;
      }
      if (mod && key === 'g') {
        event.preventDefault();
        event.shiftKey ? ungroupSelected() : groupSelected();
        return;
      }
      if (mod && key === 'f') { event.preventDefault(); setFramesOpen((open) => !open); return; }
      if (mod && key === 'd') { event.preventDefault(); duplicateSelected(); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && !sheetPicker) { event.preventDefault(); deleteSelected(); return; }
      if (event.key === 'Escape') {
        if (zenMode) { setZenPreference(false); return; }
        setSelectedIds([]);
        setMenuOpen(false);
        setLibraryOpen(false);
        setBoardsOpen(false);
        setFramesOpen(false);
        setFrameRename(null);
        exitPresentation();
        setGuides(null);
        setModal(null);
        setChartEditor(null);
        setSheetPicker(null);
        return;
      }
      if (key === 'z' && !mod && presentIndex === null) {
        event.preventDefault();
        setZenPreference(!zenMode);
        return;
      }
      if (event.key === '?') { setModal('help'); return; }
      if (event.key === '+' || event.key === '=') { zoomAt(size.width / 2, size.height / 2, camera.zoom * 1.2); return; }
      if (event.key === '-') { zoomAt(size.width / 2, size.height / 2, camera.zoom / 1.2); return; }
      if (event.code === 'Digit1' && event.shiftKey) { fitToScreen(); pauseFollowing(); return; }
      if (selectedIds.length && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const delta = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -delta : event.key === 'ArrowRight' ? delta : 0;
        const dy = event.key === 'ArrowUp' ? -delta : event.key === 'ArrowDown' ? delta : 0;
        commit((items) => syncBoundArrows(items.map((el) => {
          if (!selectedIds.includes(el.id)) return el;
          const movedEl = { ...el, x: el.x + dx, y: el.y + dy };
          return movedEl.type === 'arrow' ? { ...movedEl, startBinding: undefined, endBinding: undefined } : movedEl;
        })));
        return;
      }
      const match = TOOLS.find((item) => item.key.toLowerCase() === key);
      if (match && !mod) setTool(match.id);
    };
    const onKeyUp = (event) => { if (event.code === 'Space') setSpacePressed(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [undo, redo, duplicateSelected, deleteSelected, selectedIds, commit, zoomAt, fitToScreen, size, camera.zoom, tool, defaultStyle, applyTextFormatting, zenMode, presentIndex, setZenPreference, exitPresentation]);

  // Presentation overlay owns the keyboard while it is up: keep it focused so
  // its onKeyDown (arrows, Space, Esc) receives keys even after the Present
  // button that opened it is hidden by the presenting class.
  useEffect(() => {
    if (presentIndex !== null) presentationRef.current?.focus();
  }, [presentIndex]);

  // Laser pointer: while presenting, a red dot with a short fading trail follows
  // the mouse on a screen-space overlay canvas (it never touches the scene).
  // The same loop paints ephemeral ink strokes (world-space points projected
  // through the live camera, so ink glides with the board during transitions
  // and fades out ~4.5 s after each stroke).
  const LASER_TRAIL_MS = 700;
  const LASER_IDLE_MS = 1400;
  const INK_FADE_START = 2500;
  const INK_FADE_MS = 4500;
  useEffect(() => {
    if (presentIndex === null) return undefined;
    const canvas = laserRef.current;
    const inkCanvas = inkRef.current;
    if (!canvas || !inkCanvas) return undefined;
    const ctx = canvas.getContext('2d');
    const inkCtx = inkCanvas.getContext('2d');
    let raf = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
      inkCanvas.width = canvas.width;
      inkCanvas.height = canvas.height;
    };
    resize();
    window.addEventListener('resize', resize);
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const now = performance.now();
      const trail = laserTrailRef.current;
      while (trail.length && now - trail[0].t > LASER_TRAIL_MS) trail.shift();
      if (trail.length) {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 1; i < trail.length; i += 1) {
          const age = 1 - (now - trail[i].t) / LASER_TRAIL_MS;
          ctx.strokeStyle = `rgba(224, 49, 49, ${(age * 0.85).toFixed(3)})`;
          ctx.lineWidth = 1.5 + age * 2.5;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.stroke();
        }
        const last = trail[trail.length - 1];
        const idle = now - last.t;
        const dotAlpha = idle < LASER_IDLE_MS ? 1 : Math.max(0, 1 - (idle - LASER_IDLE_MS) / 450);
        if (dotAlpha > 0) {
          ctx.globalAlpha = dotAlpha;
          ctx.shadowColor = 'rgba(224, 49, 49, 0.85)';
          ctx.shadowBlur = 14;
          ctx.fillStyle = '#e03131';
          ctx.beginPath();
          ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      // Ephemeral ink: project world-space points through the live camera.
      inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
      const strokes = inkStrokesRef.current;
      for (let s = strokes.length - 1; s >= 0; s -= 1) {
        if (now - strokes[s].points[strokes[s].points.length - 1].t > INK_FADE_MS) strokes.splice(s, 1);
      }
      if (strokes.length) {
        const cam = cameraRef.current;
        inkCtx.save();
        inkCtx.scale(dpr, dpr);
        inkCtx.lineCap = 'round';
        inkCtx.lineJoin = 'round';
        inkCtx.lineWidth = 3.5;
        for (const stroke of strokes) {
          const pts = stroke.points;
          for (let i = 1; i < pts.length; i += 1) {
            const age = now - pts[i - 1].t;
            const alpha = age <= INK_FADE_START ? 1 : Math.max(0, 1 - (age - INK_FADE_START) / (INK_FADE_MS - INK_FADE_START));
            if (alpha <= 0) continue;
            inkCtx.strokeStyle = `rgba(247, 103, 7, ${alpha.toFixed(3)})`;
            inkCtx.beginPath();
            inkCtx.moveTo(pts[i - 1].x * cam.zoom + cam.x, pts[i - 1].y * cam.zoom + cam.y);
            inkCtx.lineTo(pts[i].x * cam.zoom + cam.x, pts[i].y * cam.zoom + cam.y);
            inkCtx.stroke();
          }
        }
        inkCtx.restore();
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      laserTrailRef.current = [];
      inkStrokesRef.current = [];
      inkDrawingRef.current = null;
    };
  }, [presentIndex]);

  const addLaserPoint = (event) => {
    if (inkDrawingRef.current) return;
    const trail = laserTrailRef.current;
    const now = performance.now();
    const last = trail[trail.length - 1];
    // A fresh stroke after the pointer idled: drop the stale trail first.
    if (last && now - last.t > LASER_IDLE_MS) trail.length = 0;
    if (last && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 3) return;
    trail.push({ x: event.clientX, y: event.clientY, t: now });
    if (trail.length > 60) trail.shift();
  };

  // --- Movable UI islands ---------------------------------------------------
  // Every floating bar carries a small grip; dragging it lifts the bar off its
  // default dock into a persisted {x, y}. Main menu → Reset panel positions
  // restores the default layout.
  const clampIsland = useCallback((x, y, w, h) => ({
    x: Math.min(Math.max(x, 60 - w), size.width - 60),
    y: Math.min(Math.max(y, 0), size.height - 48),
  }), [size]);

  const setIslandPosition = useCallback((next) => {
    islandPosRef.current = next;
    setIslandPos(next);
    try { localStorage.setItem(ISLAND_POS_KEY, JSON.stringify(next)); } catch { /* stay quiet */ }
  }, []);

  const islandGripDown = (event, id) => {
    if (event.button !== 0) return;
    const island = event.currentTarget.closest('[data-island]');
    if (!island) return;
    const rect = island.getBoundingClientRect();
    islandDragRef.current = { id, pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top, w: rect.width, h: rect.height };
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const islandGripMove = (event) => {
    const drag = islandDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const { x, y } = clampIsland(event.clientX - drag.dx, event.clientY - drag.dy, drag.w, drag.h);
    setIslandPosition({ ...islandPosRef.current, [drag.id]: { x, y } });
  };

  const islandGripUp = (event) => {
    if (islandDragRef.current?.pointerId === event.pointerId) islandDragRef.current = null;
  };

  const resetIslandPositions = useCallback(() => {
    islandDragRef.current = null;
    setIslandPosition({});
  }, [setIslandPosition]);

  // Keep floated islands on screen when the window shrinks.
  useEffect(() => {
    const next = { ...islandPosRef.current };
    let changed = false;
    for (const [id, pos] of Object.entries(next)) {
      const clamped = clampIsland(pos.x, pos.y, 200, 60);
      if (clamped.x !== pos.x || clamped.y !== pos.y) { next[id] = clamped; changed = true; }
    }
    if (changed) setIslandPosition(next);
  }, [size, clampIsland, setIslandPosition]);

  const islandStyle = (id, base) => {
    const pos = islandPos[id];
    if (!pos) return base;
    return { ...base, left: pos.x, top: pos.y, transform: 'none', right: 'auto', bottom: 'auto' };
  };

  const islandGrip = (id, label) => (
    <span
      className="island-grip"
      role="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      data-island-grip
      onPointerDown={(event) => islandGripDown(event, id)}
      onPointerMove={islandGripMove}
      onPointerUp={islandGripUp}
      onPointerCancel={islandGripUp}
    ><GripVertical size={13} /></span>
  );

  // --- Live collaboration --------------------------------------------------
  useEffect(() => { cameraRef.current = camera; }, [camera]);
  useEffect(() => { liveRef.current = live; }, [live]);

  // Remote state always replaces the board (last writer wins); the CAMERA is
  // applied only when it comes from the session host (or the welcome snapshot)
  // AND this client is following — a guest's own panning must never yank the
  // presenter or other guests.
  const applyRemoteState = useCallback((state, applyCamera) => {
    if (!state?.elements) return;
    lastRemoteRef.current = { elements: state.elements, camera: state.camera };
    setElementsState(state.elements);
    setPast([]);
    setFuture([]);
    setSelectedIds([]);
    if (applyCamera && state.camera && followRef.current) setCamera(state.camera);
  }, []);

  const leaveLive = useCallback((announce = true) => {
    liveConnRef.current?.send({ t: 'cursor-clear' });
    liveConnRef.current?.close();
    liveConnRef.current = null;
    liveRef.current = null;
    pendingRoomRef.current = null;
    lastRemoteRef.current = { elements: null, camera: null };
    lastHostCameraRef.current = null;
    followRef.current = true;
    setLive(null);
    setLiveCursors({});
    setLivePanelOpen(false);
    setFollowing(true);
    const url = new URL(window.location.href);
    url.searchParams.delete('live');
    window.history.replaceState(null, '', url.pathname + url.search);
    if (announce) notify('Left the live session');
  }, [notify]);

  const joinLive = useCallback((room) => {
    if (liveConnRef.current || !collabAvailable) return;
    pendingRoomRef.current = room;
    const name = generateName();
    liveConnRef.current = connectCollab({
      room,
      name,
      onOpen: () => notify(`Live session "${room}" — you're ${name}`),
      onClose: () => {
        if (liveRef.current) {
          notify('Live session disconnected');
          leaveLive(false);
        } else {
          notify('Live sharing unavailable here — run the app with its dev server');
        }
        setLivePanelOpen(false);
      },
      onMessage: (msg) => {
        if (msg.t === 'welcome') {
          const joinRoom = pendingRoomRef.current || room;
          const url = new URL(window.location.href);
          url.searchParams.set('live', joinRoom);
          window.history.replaceState(null, '', url.pathname + url.search);
          liveRef.current = { room: joinRoom, self: { id: msg.id, name: msg.name, color: msg.color }, roster: msg.roster, hostId: msg.hostId };
          setLive(liveRef.current);
          if (msg.state) applyRemoteState(msg.state, true);
        } else if (msg.t === 'roster') {
          setLive((prev) => {
            if (!prev) return prev;
            const next = { ...prev, roster: msg.roster, hostId: msg.hostId };
            liveRef.current = next;
            return next;
          });
          setLiveCursors((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const id of Object.keys(next)) {
              if (!msg.roster.some((m) => m.id === id)) { delete next[id]; changed = true; }
            }
            return changed ? next : prev;
          });
        } else if (msg.t === 'state') {
          const session = liveRef.current;
          if (!session || msg.from === session.self.id) return;
          const fromHost = msg.from === session.hostId;
          if (fromHost) {
            lastHostCameraRef.current = msg.camera;
            window.__lastHostCamera = msg.camera;
          }
          applyRemoteState(msg, fromHost);
        } else if (msg.t === 'cursor') {
          setLiveCursors((prev) => ({ ...prev, [msg.from]: { wx: msg.wx, wy: msg.wy } }));
        } else if (msg.t === 'cursor-clear') {
          setLiveCursors((prev) => {
            if (!(msg.from in prev)) return prev;
            const next = { ...prev };
            delete next[msg.from];
            return next;
          });
        }
      },
    });
  }, [applyRemoteState, leaveLive, notify]);

  const startLive = useCallback(() => {
    setLivePanelOpen(true);
    joinLive(generateRoomCode());
  }, [joinLive]);

  const pauseFollowing = useCallback(() => {
    if (!liveRef.current || !followRef.current) return;
    followRef.current = false;
    setFollowing(false);
    notify('Following paused — press Follow to rejoin the presenter');
  }, [notify]);

  const resumeFollowing = useCallback(() => {
    followRef.current = true;
    setFollowing(true);
    if (lastHostCameraRef.current) setCamera(lastHostCameraRef.current);
  }, []);

  // Join a session from a shared link (?live=<room>).
  useEffect(() => {
    const room = liveRoomFromUrl();
    if (room) joinLive(room);
  }, [joinLive]);

  // Broadcast local changes (debounced). Changes applied FROM a remote peer
  // carry the exact same element array reference, so the guard below consumes
  // them instead of echoing — that reference check is also what prevents
  // infinite ping-pong between peers.
  useEffect(() => {
    if (!liveRef.current) return undefined;
    // Consume whatever came FROM a remote peer (same object references) so it
    // isn't echoed back — the two guards are independent: a remote elements
    // update must not swallow a local camera move, and vice versa.
    const elementsFromRemote = lastRemoteRef.current.elements === elements;
    const cameraFromRemote = lastRemoteRef.current.camera === camera;
    if (elementsFromRemote) lastRemoteRef.current.elements = null;
    if (cameraFromRemote) lastRemoteRef.current.camera = null;
    if (elementsFromRemote && cameraFromRemote) return undefined;
    if (liveSendTimer.current) clearTimeout(liveSendTimer.current);
    liveSendTimer.current = setTimeout(() => {
      liveConnRef.current?.send({ t: 'state', elements: elementsRef.current, camera: cameraRef.current, ts: Date.now() });
    }, 150);
    return () => clearTimeout(liveSendTimer.current);
  }, [elements, camera, live]);

  // Broadcast our pointer as a board-space cursor (throttled).
  useEffect(() => {
    if (!live) return undefined;
    const onMove = (event) => {
      const now = performance.now();
      if (now - cursorSentAt.current < 55) return;
      if (event.target.closest('button, input, .island, .presentation, .live-popover')) return;
      cursorSentAt.current = now;
      const cam = cameraRef.current;
      liveConnRef.current?.send({ t: 'cursor', wx: (event.clientX - cam.x) / cam.zoom, wy: (event.clientY - cam.y) / cam.zoom });
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [live]);

  const screenPoint = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const worldPoint = (screen) => ({ x: (screen.x - camera.x) / camera.zoom, y: (screen.y - camera.y) / camera.zoom });

  // Fly the camera to a world-space bounds with a short ease-out animation.
  // Cancelled by any pointer press or wheel zoom (see onPointerDown / onWheel).
  const flyToBounds = (b) => {
    if (flyRaf.current) cancelAnimationFrame(flyRaf.current);
    const startCam = camera;
    const targetZoom = Math.min(1.5, Math.max(0.1, Math.min(size.width / (b.w + 160), size.height / (b.h + 160))));
    const targetX = size.width / 2 - (b.x + b.w / 2) * targetZoom;
    const targetY = size.height / 2 - (b.y + b.h / 2) * targetZoom;
    const started = performance.now();
    const duration = 320;
    const step = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const ease = 1 - (1 - t) ** 3;
      setCamera({
        zoom: startCam.zoom + (targetZoom - startCam.zoom) * ease,
        x: startCam.x + (targetX - startCam.x) * ease,
        y: startCam.y + (targetY - startCam.y) * ease,
      });
      flyRaf.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    flyRaf.current = requestAnimationFrame(step);
  };

  // Push/slide transition between presentation frames: the camera glides
  // straight from the current view to the incoming frame with an ease-in-out
  // curve — gentle acceleration and deceleration, so the board slides across
  // instead of the jump-stop feel of the regular ease-out fly. Rapid steps
  // chain: the next glide starts from wherever the camera is right now.
  const transitionToFrame = (b) => {
    if (flyRaf.current) { cancelAnimationFrame(flyRaf.current); flyRaf.current = null; }
    const startCam = camera;
    const targetZoom = Math.min(1.5, Math.max(0.1, Math.min(size.width / (b.w + 160), size.height / (b.h + 160))));
    const targetX = size.width / 2 - (b.x + b.w / 2) * targetZoom;
    const targetY = size.height / 2 - (b.y + b.h / 2) * targetZoom;
    const started = performance.now();
    const duration = 480;
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - started) / duration);
      const e = easeInOut(t);
      setCamera({
        zoom: startCam.zoom + (targetZoom - startCam.zoom) * e,
        x: startCam.x + (targetX - startCam.x) * e,
        y: startCam.y + (targetY - startCam.y) * e,
      });
      flyRaf.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    flyRaf.current = requestAnimationFrame(step);
  };

  const commitFrameRename = () => {
    if (!frameRename) return;
    const value = frameRename.value.trim();
    if (value) commit((items) => items.map((el) => (el.id === frameRename.id ? { ...el, name: value } : el)));
    setFrameRename(null);
  };

  const onPointerDown = (event) => {
    if (textEditor) return;
    if (event.button === 2 && sharedView) return;
    event.preventDefault();
    canvasRef.current.setPointerCapture(event.pointerId);
    const screen = screenPoint(event);
    const point = worldPoint(screen);
    setMenuOpen(false);
    setLibraryOpen(false);
    setBoardsOpen(false);
    setFramesOpen(false);
    if (flyRaf.current) { cancelAnimationFrame(flyRaf.current); flyRaf.current = null; }
    const before = elementsRef.current;
    if (sharedView) {
      interaction.current = { type: 'pan', start: screen, camera };
      setCursor('grabbing');
      return;
    }
    // Voting dots: click a sticky's badge to add a vote, right-click to take one back.
    if ((event.button === 0 && tool === 'selection') || event.button === 2) {
      const badgeHit = [...before].reverse().find((el) => {
        if (!el.sticky || el.type !== 'rectangle') return false;
        if (!(el.votes > 0 || selectedIds.includes(el.id))) return false;
        const c = stickyBadgeCenter(el);
        const r = 14 / camera.zoom;
        return Math.abs(point.x - c.x) <= r && Math.abs(point.y - c.y) <= r;
      });
      if (badgeHit) {
        voteOn(badgeHit.id, event.button === 2 ? -1 : 1);
        const ids = badgeHit.groupId ? before.filter((el) => el.groupId === badgeHit.groupId).map((el) => el.id) : [badgeHit.id];
        setSelectedIds(ids);
        return;
      }
    }
    if (event.button === 1 || event.button === 2 || tool === 'hand' || spacePressed) {
      markHint('panned');
      pauseFollowing();
      interaction.current = { type: 'pan', start: screen, camera };
      setCursor('grabbing');
      return;
    }
    if (tool === 'selection') {
      const handle = hitHandle(screen, before, selectedIds, camera);
      if (handle) {
        if (selectedIds.length === 1) {
          const el = before.find((item) => item.id === selectedIds[0]);
          interaction.current = { type: 'resize', before, id: el.id, handle, original: el };
        } else {
          interaction.current = {
            type: 'resize-multi',
            before,
            handle,
            originals: before.filter((el) => selectedIds.includes(el.id)).map((el) => ({ ...el })),
            bounds: selectionBounds(before, selectedIds),
          };
        }
        return;
      }
      const hit = [...before].reverse().find((el) => el.type !== 'frame' && hitTest(el, point, 7 / camera.zoom));
      if (hit) {
        const hitGroup = hit.groupId ? before.filter((el) => el.groupId === hit.groupId).map((el) => el.id) : [hit.id];
        const groupSelected = hitGroup.length > 1 && hitGroup.every((id) => selectedIds.includes(id));
        let ids;
        if (event.shiftKey) {
          ids = groupSelected
            ? selectedIds.filter((id) => !hitGroup.includes(id))
            : [...new Set([...selectedIds, ...hitGroup])];
          setSelectedIds(ids);
          if (!ids.includes(hit.id)) { interaction.current = null; return; }
        } else if (groupSelected) {
          ids = [hit.id];
          setSelectedIds(ids);
        } else if (!selectedIds.includes(hit.id)) {
          ids = hitGroup;
          setSelectedIds(ids);
        } else {
          ids = selectedIds;
        }
        interaction.current = { type: 'move', before, start: point, originals: before.filter((el) => ids.includes(el.id)).map((el) => ({ ...el })) };
      } else {
        // No content element hit — frames take the click only on their name
        // chip or border ring (see hitTest), so this check is safe to run last.
        const frameHit = [...before].reverse().find((el) => el.type === 'frame' && hitTest(el, point, 7 / camera.zoom));
        if (frameHit) {
          if (event.shiftKey) {
            const ids = selectedIds.includes(frameHit.id)
              ? selectedIds.filter((id) => id !== frameHit.id)
              : [...selectedIds, frameHit.id];
            setSelectedIds(ids);
            interaction.current = null;
            return;
          }
          setSelectedIds([frameHit.id]);
          interaction.current = { type: 'move', before, start: point, originals: [{ ...frameHit }] };
          return;
        }
        if (!event.shiftKey) setSelectedIds([]);
        interaction.current = { type: 'marquee', before, start: point, screenStart: screen, shift: event.shiftKey, initialSelection: selectedIds };
      }
      return;
    }
    if (tool === 'eraser') {
      const hit = [...before].reverse().find((el) => hitTest(el, point, 10 / camera.zoom));
      updateElements(hit ? pruneBindings(before.filter((el) => el.id !== hit.id)) : before);
      interaction.current = { type: 'erase', before };
      setSelectedIds([]);
      return;
    }
    if (tool === 'text') {
      setTextEditor({ id: null, x: point.x, y: point.y, value: '', width: 260 });
      return;
    }
    setSelectedIds([]);
    const el = makeElement(tool, point.x, point.y);
    if (tool === 'freedraw') el.points = [[0, 0]];
    if (tool === 'frame') el.name = `Frame ${before.filter((item) => item.type === 'frame').length + 1}`;
    updateElements([...before, el]);
    interaction.current = { type: 'create', before, id: el.id, start: point, tool };
  };

  const onPointerMove = (event) => {
    const screen = screenPoint(event);
    const point = worldPoint(screen);
    const active = interaction.current;
    if (!active) {
      if (tool === 'selection') {
        const handle = hitHandle(screen, elementsRef.current, selectedIds, camera);
        setCursor(handle ? ({ nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', e: 'ew-resize' })[handle] : 'default');
      }
      return;
    }
    if (active.type === 'pan') {
      setCamera({ ...active.camera, x: active.camera.x + screen.x - active.start.x, y: active.camera.y + screen.y - active.start.y });
      return;
    }
    if (active.type === 'move') {
      const dx = point.x - active.start.x;
      const dy = point.y - active.start.y;
      const moved = active.originals.map((original) => ({ ...original, x: original.x + dx, y: original.y + dy }));
      const movedIds = new Set(moved.map((el) => el.id));
      const snap = snapToGuides(moved, elementsRef.current, camera.zoom);
      const adjusted = (snap.dx || snap.dy)
        ? moved.map((el) => ({ ...el, x: el.x + snap.dx, y: el.y + snap.dy }))
        : moved;
      // Dragging a frame carries whatever lived inside it when the drag began
      // (by center point), including nested frames — that is what makes frames
      // nest for free. Children are snapshotted once from the pre-drag scene:
      // recomputing them from the live scene would re-apply the delta on every
      // pointermove, since carried children are rewritten there each time.
      const movedFrames = adjusted.filter((el) => el.type === 'frame');
      if (movedFrames.length && !active.carried) {
        active.carried = active.before.filter((el) => {
          if (movedIds.has(el.id)) return false;
          const b = elementBounds(el);
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          return active.originals.some((f) => f.type === 'frame'
            && cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height);
        }).map((el) => ({ ...el }));
      }
      const carried = (active.carried || []).map((el) => ({ ...el, x: el.x + dx + snap.dx, y: el.y + dy + snap.dy }));
      const carriedById = new Map(carried.map((el) => [el.id, el]));
      const next = elementsRef.current.map((el) => {
        if (carriedById.has(el.id)) return carriedById.get(el.id);
        if (!movedIds.has(el.id)) return el;
        const item = adjusted.find((candidate) => candidate.id === el.id);
        // Dragging an arrow itself detaches it; shapes keep arrows glued along.
        return item.type === 'arrow' ? { ...item, startBinding: undefined, endBinding: undefined } : item;
      });
      updateElements(syncBoundArrows(next));
      setGuides(snap.guides.length ? snap.guides : null);
      if (snap.guides.length) markHint('snapped');
      return;
    }
    if (active.type === 'resize') {
      updateElements(elementsRef.current.map((el) => {
        if (el.id !== active.id) return el;
        const resized = resizeElement(active.original, active.handle, point, event.shiftKey);
        return resized.type === 'arrow' ? rebindArrow(resized, elementsRef.current) : resized;
      }));
      return;
    }
    if (active.type === 'resize-multi') {
      const scaled = resizeSelection(active.originals, active.handle, point, active.bounds, event.shiftKey);
      updateElements(elementsRef.current.map((el) => {
        const item = scaled.find((candidate) => candidate.id === el.id);
        if (!item) return el;
        return item.type === 'arrow' ? { ...item, startBinding: undefined, endBinding: undefined } : item;
      }));
      return;
    }
    if (active.type === 'marquee') {
      setMarquee({ start: active.screenStart, current: screen, startWorld: active.start, currentWorld: point });
      return;
    }
    if (active.type === 'erase') {
      const hit = [...elementsRef.current].reverse().find((el) => hitTest(el, point, 10 / camera.zoom));
      if (hit) updateElements(pruneBindings(elementsRef.current.filter((el) => el.id !== hit.id)));
      return;
    }
    if (active.type === 'create') {
      updateElements(elementsRef.current.map((el) => {
        if (el.id !== active.id) return el;
        if (active.tool === 'freedraw') {
          const nextPoint = [point.x - el.x, point.y - el.y];
          const last = el.points[el.points.length - 1];
          if (Math.hypot(nextPoint[0] - last[0], nextPoint[1] - last[1]) < 1.5 / camera.zoom) return el;
          return { ...el, points: [...el.points, nextPoint] };
        }
        return { ...el, width: point.x - active.start.x, height: point.y - active.start.y };
      }));
    }
  };

  const onPointerUp = () => {
    const active = interaction.current;
    if (!active) return;
    if (active.type === 'marquee' && marquee) {
      const x = Math.min(marquee.startWorld.x, marquee.currentWorld.x);
      const y = Math.min(marquee.startWorld.y, marquee.currentWorld.y);
      const w = Math.abs(marquee.currentWorld.x - marquee.startWorld.x);
      const h = Math.abs(marquee.currentWorld.y - marquee.startWorld.y);
      const ids = elementsRef.current.filter((el) => {
        const b = elementBounds(el);
        if (el.type === 'frame') return b.x >= x && b.y >= y && b.x + b.w <= x + w && b.y + b.h <= y + h;
        return b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y;
      }).map((el) => el.id);
      const merged = new Set(active.shift ? [...active.initialSelection, ...ids] : ids);
      for (const el of elementsRef.current) {
        if (el.groupId && merged.has(el.id)) {
          elementsRef.current.forEach((mate) => { if (mate.groupId === el.groupId) merged.add(mate.id); });
        }
      }
      setSelectedIds([...merged]);
      setMarquee(null);
    }
    if (active.type === 'create') {
      const created = elementsRef.current.find((el) => el.id === active.id);
      const b = created ? getBounds(created) : null;
      const tooSmall = active.tool !== 'freedraw' && active.tool !== 'frame' && b.w < 2 && b.h < 2;
      if (!created || tooSmall) {
        updateElements(active.before);
      } else {
        if (active.tool === 'frame' && b.w < 2 && b.h < 2) {
          // A plain click with the frame tool drops a default-sized region.
          updateElements(elementsRef.current.map((el) => (el.id === created.id ? { ...el, width: 640, height: 480 } : el)));
        }
        if (active.tool === 'arrow') {
          const startBinding = bindPoint(elementsRef.current, { x: created.x, y: created.y }, [created.id]);
          const endBinding = bindPoint(elementsRef.current, { x: created.x + created.width, y: created.y + created.height }, [created.id]);
          if (startBinding || endBinding) {
            updateElements(elementsRef.current.map((el) => el.id === created.id ? { ...el, startBinding, endBinding } : el));
          }
        }
        setSelectedIds([active.id]);
        if (!toolLocked && active.tool !== 'freedraw') setTool('selection');
      }
    }
    finishHistory(active.before);
    interaction.current = null;
    setGuides(null);
    setCursor(tool === 'hand' || spacePressed ? 'grab' : 'default');
  };

  const onDoubleClick = (event) => {
    if (sharedView) return;
    const point = worldPoint(screenPoint(event));
    const chartHit = [...elementsRef.current].reverse().find((el) => el.chart && hitTest(el, point, 8 / camera.zoom));
    if (chartHit) {
      setChartEditor({ chartId: chartHit.chartId, type: chartHit.chart.type, table: stringifyTable(chartHit.chart.table) });
      return;
    }
    const hit = [...elementsRef.current].reverse().find((el) => el.type === 'text' && hitTest(el, point, 8 / camera.zoom));
    if (hit) { markHint('editedText'); setTextEditor({ id: hit.id, x: hit.x, y: hit.y, value: hit.text, width: hit.width || 260 }); return; }
    const frameHit = [...elementsRef.current].reverse().find((el) => el.type === 'frame' && hitTest(el, point, 8 / camera.zoom));
    if (frameHit) { setFrameRename({ id: frameHit.id, value: frameHit.name || '' }); return; }
    const onElement = elementsRef.current.some((el) => hitTest(el, point, 4 / camera.zoom));
    if (!onElement && (tool === 'selection' || tool === 'hand')) createSticky(point);
  };

  // A sticky note is a solid square plus a grouped text element; double-clicking
  // empty canvas drops one and opens the editor so you can type right away.
  const stickyColorIndex = useRef(0);
  const createSticky = (point) => {
    const color = STICKY_COLORS[stickyColorIndex.current % STICKY_COLORS.length];
    stickyColorIndex.current += 1;
    const groupId = uid();
    const noteSize = 240;
    const pad = 18;
    const rect = makeElement('rectangle', point.x - noteSize / 2, point.y - noteSize / 2, noteSize, noteSize, {
      roughness: 1, stroke: color, strokeWidth: 2, background: color, fillStyle: 'solid', groupId, sticky: true,
    });
    const text = makeElement('text', rect.x + pad, rect.y + pad, 0, 0, {
      roughness: 1, stroke: '#1e1e1e', strokeWidth: 2, text: '', width: noteSize - pad * 2, fontSize: 20, groupId, sticky: true,
    });
    commit((items) => [...items, rect, text]);
    setSelectedIds([rect.id, text.id]);
    markHint('editedText');
    setTextEditor({ id: text.id, x: text.x, y: text.y, value: '', width: text.width });
    notify('Sticky note — type away, ⌘ Enter to finish');
  };

  const commitText = () => {
    if (!textEditor) return;
    const value = textEditor.value.trimEnd();
    const wrapWidth = textEditor.width || 260;
    if (value.trim()) {
      if (textEditor.id) {
        commit((items) => items.map((el) => el.id === textEditor.id ? { ...el, text: value, width: wrapWidth } : el));
        setSelectedIds([textEditor.id]);
      } else {
        const el = makeElement('text', textEditor.x, textEditor.y, 0, 0, { text: value, width: wrapWidth });
        commit((items) => [...items, el]);
        setSelectedIds([el.id]);
      }
      setTool('selection');
    } else if (textEditor.id) {
      commit((items) => items.filter((el) => el.id !== textEditor.id));
    }
    setTextEditor(null);
  };

  const selectedElements = elements.filter((el) => selectedIds.includes(el.id));
  const currentStyle = selectedElements.length === 1 ? selectedElements[0] : defaultStyle;
  // A sticky's status/tags/votes live on its rectangle; when only the text is
  // selected (right after typing, for instance), resolve the rect via the group.
  const stickyRect = !sharedView ? (() => {
    const direct = selectedElements.find((el) => el.sticky && el.type === 'rectangle');
    if (direct) return direct;
    const text = selectedElements.find((el) => el.sticky && el.type === 'text');
    if (!text?.groupId) return undefined;
    return elements.find((el) => el.sticky && el.type === 'rectangle' && el.groupId === text.groupId);
  })() : undefined;
  const applyStyle = (key, value) => {
    setDefaultStyle((style) => ({ ...style, [key]: value }));
    if (selectedIds.length) commit((items) => items.map((el) => selectedIds.includes(el.id) ? { ...el, [key]: value } : el));
  };

  const reorder = (direction) => {
    commit((items) => {
      const next = [...items];
      const selected = next.filter((el) => selectedIds.includes(el.id));
      const rest = next.filter((el) => !selectedIds.includes(el.id));
      return direction === 'front' ? [...rest, ...selected] : [...selected, ...rest];
    });
  };

  const saveJson = () => {
    const payload = JSON.stringify({ type: 'sketchboard', version: 1, elements: elementsRef.current }, null, 2);
    downloadBlob(new Blob([payload], { type: 'application/json' }), 'sketchboard.sketch');
    notify('Canvas saved as a .sketch file');
  };

  const copyShareLink = async () => {
    const encoded = await encodeShareHash({ elements: elementsRef.current, camera, theme });
    const link = `${window.location.href.split('#')[0]}#share=${encoded}`;
    setShareUrl(link);
    try {
      await navigator.clipboard.writeText(link);
      notify('Link copied — anyone with it can view this board');
    } catch { notify('Copy the link below'); }
  };

  const saveSnapshot = () => {
    const html = buildSnapshotHtml({ elements: elementsRef.current, camera, theme }, { dev: import.meta.env.DEV });
    if (!html) {
      notify('Snapshots ship with the downloaded app');
      return;
    }
    downloadBlob(new Blob([html], { type: 'text/html' }), 'sketchboard-board.html');
    notify('Snapshot downloaded — send it to anyone');
  };

  const saveSharedCopy = () => {
    importSceneToWorkspace({ elements: elementsRef.current, camera, theme });
    setSharedSource(null);
    notify('Saved to your canvas — happy editing');
  };

  const openMyCanvas = () => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    window.location.reload();
  };

  const savePng = async () => {
    await document.fonts.load('24px Virgil');
    const blob = await exportPng(elementsRef.current, theme === 'dark' ? '#141414' : '#ffffff');
    if (blob) downloadBlob(blob, 'sketchboard.png');
    notify('PNG exported');
  };

  const saveSvg = () => {
    const svg = exportSvg(elementsRef.current, theme === 'dark' ? '#141414' : '#ffffff');
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'sketchboard.svg');
    notify('SVG exported');
  };

  const importJson = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const imported = Array.isArray(data) ? data : data.elements;
      if (!Array.isArray(imported) || imported.some((el) => !el.id || !el.type)) throw new Error('Invalid file');
      commit(pruneBindings(imported.map((el) => ({ ...DEFAULT_STYLE, ...el }))));
      setSelectedIds([]);
      setTimeout(() => fitToScreen(imported), 50);
      notify(`Opened ${file.name}`);
    } catch { notify('That file could not be opened'); }
    event.target.value = '';
    setMenuOpen(false);
  };

  const insertTemplate = (kind) => {
    const cx = (size.width / 2 - camera.x) / camera.zoom;
    const cy = (size.height / 2 - camera.y) / camera.zoom;
    const base = { ...defaultStyle, roughness: 1 };
    let items = [];
    if (kind === 'flow') {
      items = [
        makeElement('rectangle', cx - 240, cy - 45, 160, 90, { ...base, background: '#a5d8ff' }),
        makeElement('diamond', cx + 50, cy - 65, 150, 130, { ...base, background: '#ffec99' }),
        makeElement('arrow', cx - 76, cy, 120, 0, base),
        makeElement('text', cx - 215, cy - 15, 0, 0, { ...base, text: 'Start here', fontSize: 22 }),
        makeElement('text', cx + 87, cy - 12, 0, 0, { ...base, text: 'Idea?', fontSize: 22 }),
      ];
    } else if (kind === 'note') {
      items = [
        makeElement('rectangle', cx - 120, cy - 100, 240, 200, { ...base, background: '#ffec99', fillStyle: 'solid' }),
        makeElement('text', cx - 91, cy - 55, 0, 0, { ...base, text: 'A thought worth\nremembering…', fontSize: 25 }),
      ];
    } else {
      items = [
        makeElement('ellipse', cx - 110, cy - 110, 220, 220, { ...base, background: '#b2f2bb' }),
        makeElement('ellipse', cx - 70, cy - 70, 140, 140, { ...base, background: '#ffffff', fillStyle: 'solid' }),
        makeElement('text', cx - 58, cy - 13, 0, 0, { ...base, text: 'Big idea', fontSize: 23 }),
      ];
    }
    commit((existing) => [...existing, ...items]);
    setSelectedIds(items.map((el) => el.id));
    setLibraryOpen(false);
    setTool('selection');
  };

  // Paste-to-chart: a copied spreadsheet range becomes a hand-drawn chart of
  // native elements, tagged with a shared chartId so it can be regenerated.
  const insertChart = useCallback((table, type = 'bar', chartId = uid(), at = null, source = 'Pasted a table', sheetName = undefined, fileName = undefined) => {
    const cx = at?.x ?? (size.width / 2 - camera.x) / camera.zoom;
    const cy = at?.y ?? (size.height / 2 - camera.y) / camera.zoom;
    const groupId = uid();
    const items = buildChartElements(table, {
      type, x: cx - 280, y: cy - 190, w: 560, h: 380, make: makeElement, groupId, chartId, sheetName, fileName,
    });
    commit((existing) => [...existing, ...items]);
    setSelectedIds(items.map((el) => el.id));
    setTool('selection');
    notify(`${source} — chart drawn. Double-click it to edit the data`);
  }, [size, camera, makeElement, commit, notify]);

  // Bulk import: one chart per sheet, laid out in a row centered on the drop point.
  const insertCharts = useCallback((sheets, at, source, fileName = undefined) => {
    const cx = at?.x ?? (size.width / 2 - camera.x) / camera.zoom;
    const cy = at?.y ?? (size.height / 2 - camera.y) / camera.zoom;
    const gap = 48;
    const items = sheets.flatMap((sheet, i) => buildChartElements(sheet.table, {
      type: 'bar',
      x: cx + (i - (sheets.length - 1) / 2) * (560 + gap) - 280,
      y: cy - 190,
      w: 560, h: 380,
      make: makeElement, groupId: uid(), chartId: uid(), sheetName: sheet.name, fileName,
    }));
    commit((existing) => [...existing, ...items]);
    setSelectedIds(items.map((el) => el.id));
    setTool('selection');
    notify(`${source} — ${sheets.length} charts drawn. Double-click one to edit its data`);
  }, [size, camera, makeElement, commit, notify]);

  // Regenerate an existing chart in place from a new table (update-from-file).
  // Keeps the chart's id, group, type and exact box; only the data changes.
  // sheetName === null clears the link (used for CSV updates); fileName always
  // reflects the most recent file the data came from.
  const updateChartFromTable = useCallback((chartId, table, sheetName, fileName, source) => {
    const existing = elementsRef.current.filter((el) => el.chartId === chartId);
    if (!existing.length) return;
    const spec = existing.find((el) => el.chart)?.chart || {};
    const box = spec.box || { x: existing[0].x, y: existing[0].y, w: 560, h: 380 };
    const items = buildChartElements(table, {
      type: spec.type || 'bar',
      x: box.x, y: box.y, w: box.w, h: box.h,
      make: makeElement, groupId: existing[0].groupId || uid(), chartId,
      sheetName: sheetName === null ? undefined : (sheetName ?? spec.sheetName),
      fileName: fileName ?? spec.fileName,
    });
    commit((all) => [...all.filter((el) => el.chartId !== chartId), ...items]);
    setSelectedIds(items.map((el) => el.id));
    setTool('selection');
    notify(`${source} — chart updated in place`);
  }, [makeElement, commit, notify]);

  // Detach a chart from its source file: future drops no longer match or
  // update it by sheet name.
  const unlinkChart = useCallback((chartId) => {
    commit((all) => all.map((el) => (el.chartId === chartId && el.chart
      ? { ...el, chart: { ...el.chart, sheetName: undefined, fileName: undefined } }
      : el)));
    notify('Chart unlinked — dropping that file will no longer update it');
  }, [commit, notify]);

  // The chart whose bounds contain a world point, if any (used to detect
  // update-from-file drops).
  const chartAtPoint = useCallback((point) => {
    const groups = new Map();
    for (const el of elementsRef.current) {
      if (!el.chartId) continue;
      if (!groups.has(el.chartId)) groups.set(el.chartId, { spec: el.chart, x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
      const g = groups.get(el.chartId);
      if (el.chart) g.spec = el.chart;
      g.x1 = Math.min(g.x1, el.x); g.y1 = Math.min(g.y1, el.y);
      g.x2 = Math.max(g.x2, el.x + (el.width || 0)); g.y2 = Math.max(g.y2, el.y + (el.height || 0));
    }
    for (const [chartId, g] of groups) {
      if (point.x >= g.x1 - 8 && point.x <= g.x2 + 8 && point.y >= g.y1 - 8 && point.y <= g.y2 + 8) return { chartId, spec: g.spec };
    }
    return null;
  }, []);

  useEffect(() => {
    const onPaste = (event) => {
      if (sharedView || textEditor || modal || chartEditor || sheetPicker) return;
      const text = event.clipboardData?.getData('text/plain');
      if (!text) return;
      const table = parseTableText(text);
      if (!table) return;
      event.preventDefault();
      insertChart(table);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [sharedView, textEditor, modal, chartEditor, sheetPicker, insertChart]);

  // Drag-and-drop import: dropping a .csv/.tsv or .xlsx file on the board
  // charts its first sheet, centered on the drop point.
  const fileDragDepth = useRef(0);
  const [fileDrag, setFileDrag] = useState(false);
  useEffect(() => {
    const hasFiles = (event) => event.dataTransfer?.types?.includes('Files');
    const onDragEnter = (event) => {
      if (!hasFiles(event)) return;
      fileDragDepth.current += 1;
      setFileDrag(true);
      event.preventDefault();
    };
    const onDragOver = (event) => { if (hasFiles(event)) event.preventDefault(); };
    const onDragLeave = () => {
      fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
      if (!fileDragDepth.current) setFileDrag(false);
    };
    const onDrop = async (event) => {
      fileDragDepth.current = 0;
      setFileDrag(false);
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      event.preventDefault();
      if (sharedView || textEditor || modal || chartEditor || sheetPicker) return;
      const name = file.name.toLowerCase();
      const at = {
        x: (event.clientX - camera.x) / camera.zoom,
        y: (event.clientY - camera.y) / camera.zoom,
      };
      const isSpreadsheet = name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt') || file.type.startsWith('text/');
      // Update-from-file: dropping data onto an existing chart refreshes that
      // chart in place instead of creating a new one.
      const target = isSpreadsheet ? chartAtPoint(at) : null;
      const finish = (table, sheetName) => {
        if (!table) { notify(`No chartable data found in ${file.name}`); return; }
        if (target) updateChartFromTable(target.chartId, table, sheetName ?? null, file.name, `Dropped ${file.name}${sheetName ? ` · ${sheetName}` : ''}`);
        else insertChart(table, 'bar', uid(), at, `Dropped ${file.name}${sheetName ? ` · ${sheetName}` : ''}`, sheetName, file.name);
      };
      try {
        if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
          const sheets = tablesFromSpreadsheet(await file.arrayBuffer());
          if (!sheets.length) { notify(`No chartable data found in ${file.name}`); return; }
          const match = target?.spec?.sheetName ? sheets.find((s) => s.name === target.spec.sheetName) : null;
          if (match) finish(match.table, match.name);
          else if (sheets.length === 1) finish(sheets[0].table, sheets[0].name);
          else if (target) setSheetPicker({ fileName: file.name, at, sheets, updateChartId: target.chartId });
          else setSheetPicker({ fileName: file.name, at, sheets });
        } else if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt') || file.type.startsWith('text/')) {
          finish(parseTableText(await file.text()));
        } else {
          notify('Drop a .csv, .tsv, or .xlsx file to draw a chart');
        }
      } catch {
        notify(`Could not read ${file.name}`);
      }
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [sharedView, textEditor, modal, chartEditor, sheetPicker, camera, insertChart, chartAtPoint, updateChartFromTable, notify]);

  const applyChart = () => {
    if (!chartEditor) return;
    const { chartId, type } = chartEditor;
    const table = numericizeTable(chartEditor.table);
    const existing = elementsRef.current.filter((el) => el.chartId === chartId);
    const anchor = existing.find((el) => el.chart);
    const box = anchor?.chart?.box || null;
    const cx = box ? box.x + box.w / 2 : (size.width / 2 - camera.x) / camera.zoom;
    const cy = box ? box.y + box.h / 2 : (size.height / 2 - camera.y) / camera.zoom;
    const items = buildChartElements(table, {
      type, x: cx - 280, y: cy - 190, w: 560, h: 380,
      make: makeElement, groupId: existing[0]?.groupId || uid(), chartId,
      sheetName: anchor?.chart?.sheetName, fileName: anchor?.chart?.fileName,
    });
    commit((all) => [...all.filter((el) => el.chartId !== chartId), ...items]);
    setSelectedIds(items.map((el) => el.id));
    setChartEditor(null);
    notify('Chart updated');
  };

  // While editing, values are strings so typing "12." doesn't fight the input;
  // they are coerced back to numbers when the chart is rebuilt.
  const stringifyTable = (table) => ({
    ...table,
    series: table.series.map((s) => ({ ...s, values: s.values.map((v) => String(v)) })),
  });
  const numericizeTable = (table) => ({
    ...table,
    series: table.series.map((s, i) => ({
      ...s,
      name: s.name || `Series ${i + 1}`,
      values: s.values.map((v) => {
        const n = parseFloat(String(v).replace(/[$,%\s]/g, ''));
        return Number.isNaN(n) ? 0 : n;
      }),
    })),
  });
  const updateChartTable = (mutate) => setChartEditor((prev) => (prev ? { ...prev, table: mutate(prev.table) } : prev));

  const textContext = tool === 'text' || selectedElements.some((el) => el.type === 'text');
  const boardQueryTrimmed = boardQuery.trim().toLowerCase();
  const boardMatches = (b) => {
    if (!boardQueryTrimmed) return true;
    if (b.name.toLowerCase().includes(boardQueryTrimmed)) return true;
    return b.elements.some((el) => el.type === 'text' && (el.text || '').toLowerCase().includes(boardQueryTrimmed));
  };
  const boardMatchCount = (b) => boardQueryTrimmed
    ? b.elements.filter((el) => el.type === 'text' && (el.text || '').toLowerCase().includes(boardQueryTrimmed)).length
    : 0;
  const visibleBoards = workspace.boards.filter(boardMatches);
  const frameQueryTrimmed = frameQuery.trim().toLowerCase();
  const visibleFrames = elements.filter((el) => el.type === 'frame' && (!frameQueryTrimmed || (el.name || '').toLowerCase().includes(frameQueryTrimmed)));
  // Presentation order: reading order — rows top to bottom, frames left to
  // right within a row (frames whose centers are within 100px share a row).
  const framesSorted = [...elements.filter((el) => el.type === 'frame')].sort((a, b) => {
    const ay = a.y + a.height / 2;
    const by = b.y + b.height / 2;
    if (Math.abs(ay - by) > 100) return ay - by;
    return (a.x + a.width / 2) - (b.x + b.width / 2);
  });
  const stepPresentation = (delta) => {
    if (!framesSorted.length) {
      notify('Draw a frame first — presentations walk through your frames');
      return;
    }
    // Opening the show borrows zen mode for a clean first frame; the previous
    // desk state comes back when the curtain falls (see exitPresentation).
    if (presentIndex === null) {
      zenBeforePresentRef.current = zenMode;
      if (!zenMode) setZenMode(true);
    }
    const nextIndex = presentIndex === null ? 0 : (presentIndex + delta + framesSorted.length) % framesSorted.length;
    setPresentIndex(nextIndex);
    transitionToFrame(getBounds(framesSorted[nextIndex]));
  };
  const showProperties = selectedIds.length > 0 || !['selection', 'hand', 'eraser'].includes(tool);
  const canvasBackground = theme === 'dark' ? '#141414' : '#ffffff';
  const editorPosition = textEditor ? { left: textEditor.x * camera.zoom + camera.x, top: textEditor.y * camera.zoom + camera.y } : null;

  // Linked-file badge: exactly one chart selected and it tracks a file — show
  // what it tracks, hovering above the chart's live bounds.
  const selectedChart = (() => {
    if (sharedView) return null;
    const selected = elements.filter((el) => selectedIds.includes(el.id) && el.chartId);
    if (!selected.length || !selected.every((el) => el.chartId === selected[0].chartId)) return null;
    const spec = selected.find((el) => el.chart)?.chart;
    if (!spec?.fileName) return null;
    const b = selectionBounds(selected, selectedIds);
    return b ? { chartId: selected[0].chartId, spec, bounds: b } : null;
  })();

  return (
    <main ref={appRef} className={`app ${theme} ${grid ? 'with-grid' : ''} ${presentIndex !== null ? 'presenting' : ''} ${zenMode ? 'zen' : ''}`} style={{ '--canvas-bg': canvasBackground }}>
      <canvas
        ref={canvasRef}
        className={`drawing-canvas tool-${tool} ${spacePressed ? 'space-pan' : ''}`}
        style={{ cursor: cursor !== 'default' ? cursor : undefined, width: size.width, height: size.height }}
        aria-label="Drawing canvas"
        data-testid="canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
      {grid && <div className="grid-overlay" style={{ backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }} />}

      {!sharedView && live && Object.entries(liveCursors).map(([id, point]) => {
        const member = live.roster.find((m) => m.id === id);
        if (!member || id === live.self.id) return null;
        return (
          <div key={id} className="remote-cursor" style={{ left: point.wx * camera.zoom + camera.x, top: point.wy * camera.zoom + camera.y, '--live': member.color }} aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 7-6.5 1.5L9 18 5 3z" /></svg>
            <span className="remote-cursor-name">{member.name}</span>
          </div>
        );
      })}

      {live && !livePanelOpen && (
        <button className="live-indicator" onClick={() => setLivePanelOpen(true)} aria-label="Open live session panel">
          <span className="live-dot" />
          <Users size={13} />
          {live.roster.length}
        </button>
      )}

      {live && livePanelOpen && (
        <section className="live-popover island" role="dialog" aria-label="Live session">
          <div className="live-popover-head">
            <span className="live-dot" />
            <strong>Live session</strong>
            <button className="plain-icon" aria-label="Close live panel" onClick={() => setLivePanelOpen(false)}><X size={14} /></button>
          </div>
          <label className="live-link-row">
            <span>Join link</span>
            <div>
              <input readOnly value={liveJoinUrl(live.room)} aria-label="Join link" onFocus={(event) => event.target.select()} />
              <button
                className="plain-icon"
                aria-label="Copy join link"
                onClick={() => {
                  const link = liveJoinUrl(live.room);
                  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(() => notify('Join link copied')).catch(() => notify(link));
                  else notify(link);
                }}
              ><Copy size={14} /></button>
            </div>
          </label>
          <ul className="live-roster" aria-label="Participants">
            {live.roster.map((m) => (
              <li key={m.id}>
                <span className="live-swatch" style={{ '--live': m.color }} />
                <span className="live-name">{m.name}{m.id === live.self.id ? ' (you)' : ''}</span>
                {m.id === live.hostId && <Crown size={13} className="live-host" aria-label="Host" />}
              </li>
            ))}
          </ul>
          <button className="live-leave" onClick={() => leaveLive()}><LogOut size={13} /> Leave session</button>
        </section>
      )}

      {live && !sharedView && !following && (
        <button className="follow-chip" onClick={resumeFollowing}>
          <MousePointer2 size={13} />
          Follow {live.roster.find((m) => m.id === live.hostId)?.name || 'presenter'}
        </button>
      )}

      {fileDrag && (
        <div className="file-drop-overlay" aria-hidden="true">
          <FileUp size={38} strokeWidth={1.6} />
          <strong>Drop to draw a chart</strong>
          <span>.csv &nbsp;.tsv &nbsp;.xlsx</span>
        </div>
      )}

      {!elements.length && !textEditor && (
        <div className="onboarding" aria-hidden="true">
          <div className="welcome-title">Sketchboard</div>
          <p>A quiet canvas for loud ideas.</p>
          <span>Everything stays in your browser. Just start drawing.</span>
          <div className="hint hint-menu">
            <span>Your work is saved<br />locally, automatically</span>
            <svg viewBox="0 0 130 85"><path d="M115 74 C82 75, 82 18, 25 16" /><path d="M34 8 L23 16 L34 25" /></svg>
          </div>
          <div className="hint hint-tools">
            <svg viewBox="0 0 120 100"><path d="M10 90 C40 82, 25 26, 66 15" /><path d="M55 15 L67 14 L69 27" /></svg>
            <span>Pick a tool and make a mark</span>
          </div>
          <div className="hint hint-help">
            <span>Shortcuts, if you like them</span>
            <svg viewBox="0 0 110 75"><path d="M10 12 C36 8, 76 20, 82 60" /><path d="M73 51 L83 62 L93 51" /></svg>
          </div>
        </div>
      )}

      <div className="top-left" data-island="top-left" style={islandStyle('top-left')}>
        {islandGrip('top-left', 'Drag menu bar to move')}
        <button className={`island icon-button ${menuOpen ? 'pressed' : ''}`} aria-label="Main menu" aria-expanded={menuOpen} onClick={() => { setMenuOpen(!menuOpen); setBoardsOpen(false); }}>
          <Menu size={21} />
        </button>
        {menuOpen && (
          <div className="menu island" data-testid="main-menu">
            <button onClick={() => fileInputRef.current?.click()}><Upload size={17} /><span>Open…</span><kbd>⌘O</kbd></button>
            <button onClick={() => { saveJson(); setMenuOpen(false); }}><Download size={17} /><span>Save to file</span></button>
            <button onClick={() => { setModal('export'); setMenuOpen(false); }}><ImageIcon size={17} /><span>Export image…</span><kbd>⇧⌘E</kbd></button>
            <div className="menu-separator" />
            <button onClick={() => { setGrid(!grid); }}><Grid3X3 size={17} /><span>Canvas grid</span>{grid && <Check size={15} />}</button>
            <button onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); }}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}<span>{theme === 'dark' ? 'Light' : 'Dark'} mode</span><kbd>⇧⌘D</kbd></button>
            <button onClick={() => { setModal('help'); setMenuOpen(false); }}><Keyboard size={17} /><span>Keyboard shortcuts</span><kbd>?</kbd></button>
            <button onClick={() => { resetIslandPositions(); setMenuOpen(false); }}><AlignStartVertical size={17} /><span>Reset panel positions</span></button>
            <button onClick={() => { setZenPreference(true); setMenuOpen(false); }}><Eye size={17} /><span>Zen mode</span><kbd>Z</kbd></button>
            <div className="menu-separator" />
            <button className="danger" onClick={() => { setModal('reset'); setMenuOpen(false); }}><Trash2 size={17} /><span>Reset the canvas</span></button>
            <div className="local-note"><span className="status-dot" />Local-first · saved automatically</div>
          </div>
        )}
        {!sharedView && (
          <>
            <button className={`island boards-button ${boardsOpen ? 'pressed' : ''}`} aria-label="Boards" aria-expanded={boardsOpen} onClick={() => { setBoardsOpen(!boardsOpen); setMenuOpen(false); setFramesOpen(false); }}>
              <LayoutGrid size={17} />
              <span>Boards</span>
            </button>
            {boardsOpen && (
              <div className="boards-panel island" data-testid="boards-panel">
                <div className="board-search-row">
                  <input
                    className="board-search"
                    placeholder="Search boards…"
                    aria-label="Search boards"
                    value={boardQuery}
                    onChange={(event) => setBoardQuery(event.target.value)}
                  />
                  <button className="board-new" aria-label="New board" title="New board" onClick={createBoard}>
                    <Plus size={16} />
                  </button>
                </div>
                <div className="board-list">
                  {visibleBoards.map((b) => {
                    const matches = boardMatchCount(b);
                    return (
                      <div key={b.id} className={`board-item ${b.id === workspace.activeBoardId ? 'active' : ''}`}>
                        <button
                          className="board-main"
                          title={boardQueryTrimmed && matches > 0 ? `Jump to the match in “${b.name}”` : `Open “${b.name}”`}
                          onClick={() => openBoard(b)}
                        >
                          <span className="board-name">{b.name}</span>
                          <span className="board-meta">
                            {b.elements.length} {b.elements.length === 1 ? 'element' : 'elements'}
                            {boardQueryTrimmed && matches > 0 ? ` · ${matches} match${matches === 1 ? '' : 'es'}` : ''}
                          </span>
                        </button>
                        <button className="plain-icon board-icon" aria-label={`Rename board ${b.name}`} title="Rename" onClick={() => { setRenameTarget(b.id); setModal('rename'); }}>
                          <Pencil size={14} />
                        </button>
                        <button
                          className="plain-icon board-icon board-delete"
                          aria-label={`Delete board ${b.name}`}
                          title={workspace.boards.length < 2 ? 'You need at least one board' : 'Delete'}
                          disabled={workspace.boards.length < 2}
                          onClick={() => { setDeleteTarget(b.id); setModal('delete'); }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                  {!visibleBoards.length && <div className="board-empty">No boards match “{boardQuery}”.</div>}
                </div>
              </div>
            )}
          </>
        )}
        {!sharedView && (
          <>
            <button className={`island boards-button ${framesOpen ? 'pressed' : ''}`} aria-label="Frames" aria-expanded={framesOpen} onClick={() => { setFramesOpen(!framesOpen); setMenuOpen(false); setBoardsOpen(false); }}>
              <Frame size={17} />
              <span>Frames</span>
            </button>
            {framesOpen && (
              <div className="boards-panel frames-panel island" data-testid="frames-panel">
                <div className="board-search-row">
                  <input
                    className="board-search"
                    placeholder="Find a frame…"
                    aria-label="Search frames"
                    value={frameQuery}
                    onChange={(event) => setFrameQuery(event.target.value)}
                  />
                </div>
                <div className="board-list">
                  {visibleFrames.map((f) => (
                    <div key={f.id} className="board-item">
                      <button
                        className="board-main"
                        title={`Fly to “${f.name}”`}
                        onClick={() => { setFramesOpen(false); setFrameQuery(''); flyToBounds(getBounds(f)); }}
                      >
                        <span className="board-name">{f.name}</span>
                        <span className="board-meta">{Math.round(f.width)} × {Math.round(f.height)}</span>
                      </button>
                    </div>
                  ))}
                  {!visibleFrames.length && <div className="board-empty">No frames match “{frameQuery}”.</div>}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="toolbar island" role="toolbar" aria-label="Drawing tools" data-island="toolbar" style={islandStyle('toolbar')}>
        {islandGrip('toolbar', 'Drag toolbar to move')}
        <button className={`tool-button lock-button ${toolLocked ? 'active' : ''}`} title={toolLocked ? 'Unlock tool switching' : 'Keep selected tool active'} aria-label="Lock tool" aria-pressed={toolLocked} onClick={() => setToolLocked(!toolLocked)}>
          {toolLocked ? <Lock size={17} /> : <Unlock size={17} />}
        </button>
        <div className="toolbar-divider" />
        {TOOLS.map((item) => <ToolButton key={item.id} tool={item} active={tool === item.id} onClick={() => { setTool(item.id); setTextEditor(null); }} />)}
        <div className="toolbar-divider more-divider" />
        <button className="tool-button more-tools" aria-label="More tools"><MoreHorizontal size={19} /></button>
      </div>

      <div className="top-right" data-island="top-right" style={islandStyle('top-right')}>
        <button className={`island labeled-button library-button ${libraryOpen ? 'pressed' : ''}`} onClick={() => setLibraryOpen(!libraryOpen)} aria-label="Library" aria-expanded={libraryOpen}><Library size={17} /><span>Library</span></button>
        <button className="share-button" onClick={() => { setShareUrl(''); setModal('share'); }} aria-label="Share"><Share2 size={16} /><span>Share</span></button>
        {!sharedView && <button className="island labeled-button present-button" onClick={() => stepPresentation(1)} aria-label="Present" title="Walk through your frames"><Play size={15} /><span>Present</span></button>}
        <button className="island labeled-button" onClick={() => setModal('export')} aria-label="Export"><Download size={16} /><span>Export</span></button>
        {islandGrip('top-right', 'Drag action bar to move')}
      </div>

      {sharedView && (
        <div className="shared-banner" role="status">
          <span className="shared-dot" />
          <span>You're viewing a shared board — read-only.</span>
          <button className="shared-primary" onClick={saveSharedCopy}>Save a copy</button>
          {sharedSource === 'link' && <button className="shared-secondary" onClick={openMyCanvas}>Open my canvas</button>}
        </div>
      )}

      {showProperties && (
        <section className="properties island" aria-label="Element styles" data-island="properties" style={islandStyle('properties')}>
          {islandGrip('properties', 'Drag style panel to move')}
          {selectedIds.length === 1 && selectedElements[0]?.type === 'frame' && (
            <div className="property-row"><span>Name</span><input className="frame-name-input" aria-label="Frame name" value={selectedElements[0].name || ''} onChange={(event) => { const id = selectedElements[0].id; commit((items) => items.map((el) => (el.id === id ? { ...el, name: event.target.value } : el))); }} /></div>
          )}
          {stickyRect && (
            <>
              <div className="property-row"><span>Status</span>
                <div className="segmented status-controls">
                  <button className={!stickyRect.status ? 'selected' : ''} onClick={() => updateStickyRect((el) => ({ ...el, status: undefined }))} aria-label="No status" title="No status"><span className="status-none">–</span></button>
                  {STICKY_STATUSES.map((s) => <button key={s.id} className={stickyRect.status === s.id ? 'selected' : ''} onClick={() => updateStickyRect((item) => ({ ...item, status: s.id }))} aria-label={s.label} title={s.label}><span className="status-dot" style={{ '--dot': s.color }} /></button>)}
                </div>
              </div>
              <div className="property-row"><span>Votes</span>
                <div className="vote-controls">
                  <button onClick={() => voteOn(stickyRect.id, 1)} aria-label="Add vote" title="Add a voting dot — or click the badge on the note; right-click the badge to take one back"><Plus size={15} /></button>
                  <output aria-label="Vote count">{stickyRect.votes || 0}</output>
                </div>
              </div>
              <div className="property-row"><span>Tags</span>
                <div className="tag-editor">
                  {(stickyRect.tags || []).map((tag) => (
                    <span key={tag.id} className="tag-chip" style={{ background: `${tag.color}22`, borderColor: `${tag.color}77`, color: tag.color }}>
                      {tag.label}
                      <button aria-label={`Remove tag ${tag.label}`} title="Remove tag" onClick={() => updateStickyRect((el) => ({ ...el, tags: (el.tags || []).filter((t) => t.id !== tag.id) }))}><X size={10} /></button>
                    </span>
                  ))}
                  <input
                    className="tag-input"
                    placeholder="Add tag…"
                    aria-label="Add tag"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        const label = event.currentTarget.value.trim();
                        if (label) {
                          updateStickyRect((el) => ({ ...el, tags: [...(el.tags || []), { id: uid(), label, color: TAG_COLORS[(el.tags || []).length % TAG_COLORS.length] }] }));
                          event.currentTarget.value = '';
                        }
                      }
                    }}
                  />
                </div>
              </div>
            </>
          )}
          <div className="property-row"><span>Stroke</span><ColorSwatches colors={STROKE_COLORS} value={currentStyle.stroke} onChange={(value) => applyStyle('stroke', value)} label="Stroke color" /></div>
          {textContext && (
            <>
              <div className="property-row"><span>Font size</span><div className="segmented text-size-controls">{[16, 20, 24, 32, 48].map((size) => <button key={size} className={currentStyle.fontSize === size ? 'selected' : ''} onClick={() => applyStyle('fontSize', size)} aria-label={`Text size ${size} pixels`} title={`${size}px`}><span>{size}</span></button>)}</div></div>
              <div className="property-row"><span>Line spacing</span><div className="segmented line-height-controls">{[1, 1.25, 1.5, 2].map((height) => <button key={height} className={(currentStyle.lineHeight || 1.25) === height ? 'selected' : ''} onClick={() => applyStyle('lineHeight', height)} aria-label={`Line height ${height}`} title={`${height}×`}><span>{height}</span></button>)}</div></div>
              <div className="property-row"><span>Align</span><div className="segmented alignment-controls">{[
                { value: 'left', icon: AlignLeft, label: 'Align left' },
                { value: 'center', icon: AlignCenter, label: 'Align center' },
                { value: 'right', icon: AlignRight, label: 'Align right' },
              ].map(({ value, icon: AlignIcon, label }) => <button key={value} className={(currentStyle.textAlign || 'left') === value ? 'selected' : ''} onClick={() => applyStyle('textAlign', value)} aria-label={label} aria-pressed={(currentStyle.textAlign || 'left') === value} title={label}><AlignIcon size={16} /></button>)}</div></div>
              <div className="property-row"><span>Style</span><div className="segmented font-style-controls">
                <button className={(currentStyle.fontWeight || 400) === 700 ? 'selected' : ''} onClick={() => applyStyle('fontWeight', (currentStyle.fontWeight || 400) === 700 ? 400 : 700)} aria-label="Bold" aria-pressed={(currentStyle.fontWeight || 400) === 700} title="Bold"><Bold size={15} /></button>
                <button className={(currentStyle.fontStyle || 'normal') === 'italic' ? 'selected' : ''} onClick={() => applyStyle('fontStyle', (currentStyle.fontStyle || 'normal') === 'italic' ? 'normal' : 'italic')} aria-label="Italic" aria-pressed={(currentStyle.fontStyle || 'normal') === 'italic'} title="Italic"><Italic size={15} /></button>
              </div></div>
            </>
          )}
          {!['line', 'arrow', 'freedraw', 'text'].includes(tool) && !['line', 'arrow', 'freedraw', 'text'].includes(selectedElements[0]?.type) && (
            <div className="property-row"><span>Background</span><ColorSwatches colors={BACKGROUND_COLORS} value={currentStyle.background} onChange={(value) => applyStyle('background', value)} label="Background color" allowTransparent /></div>
          )}
          {!['line', 'arrow', 'freedraw', 'text'].includes(tool) && !['line', 'arrow', 'freedraw', 'text'].includes(selectedElements[0]?.type) && (
            <div className="property-row"><span>Fill</span><div className="segmented three"><button className={currentStyle.fillStyle === 'hachure' ? 'selected' : ''} onClick={() => applyStyle('fillStyle', 'hachure')} title="Hachure"><span className="fill-icon hachure" /></button><button className={currentStyle.fillStyle === 'cross-hatch' ? 'selected' : ''} onClick={() => applyStyle('fillStyle', 'cross-hatch')} title="Cross-hatch"><span className="fill-icon cross" /></button><button className={currentStyle.fillStyle === 'solid' ? 'selected' : ''} onClick={() => applyStyle('fillStyle', 'solid')} title="Solid"><span className="fill-icon solid" /></button></div></div>
          )}
          <div className="property-row"><span>Stroke width</span><div className="segmented three">{[1, 2, 4].map((width) => <button key={width} className={currentStyle.strokeWidth === width ? 'selected' : ''} onClick={() => applyStyle('strokeWidth', width)} aria-label={`Stroke width ${width}`}><span className={`stroke-sample width-${width}`} /></button>)}</div></div>
          <div className="property-row"><span>Roughness</span><div className="segmented three">{[0, 1, 2].map((roughness) => <button key={roughness} className={currentStyle.roughness === roughness ? 'selected' : ''} onClick={() => applyStyle('roughness', roughness)} aria-label={`Roughness ${roughness}`}><svg viewBox="0 0 28 20"><path className={`rough-${roughness}`} d={roughness === 0 ? 'M3 16 L25 4' : roughness === 1 ? 'M3 15 Q13 1 25 5' : 'M3 14 Q8 3 14 8 T25 3'} /></svg></button>)}</div></div>
          <div className="property-row opacity-row"><span>Opacity</span><input aria-label="Opacity" type="range" min="10" max="100" step="10" value={currentStyle.opacity} onChange={(e) => applyStyle('opacity', Number(e.target.value))} /><output>{currentStyle.opacity}%</output></div>
          {selectedIds.length > 1 && (
            <div className="property-row"><span>Align objects</span><div className="segmented object-align-controls">{[
              { mode: 'left', icon: AlignStartVertical, label: 'Align left edges' },
              { mode: 'centerH', icon: AlignCenterVertical, label: 'Center horizontally' },
              { mode: 'right', icon: AlignEndVertical, label: 'Align right edges' },
              { mode: 'top', icon: AlignStartHorizontal, label: 'Align top edges' },
              { mode: 'middle', icon: AlignCenterHorizontal, label: 'Center vertically' },
              { mode: 'bottom', icon: AlignEndHorizontal, label: 'Align bottom edges' },
            ].map(({ mode, icon: AlignIcon, label }) => <button key={mode} onClick={() => alignSelected(mode)} aria-label={label} title={label}><AlignIcon size={16} /></button>)}</div></div>
          )}
          {selectedIds.length > 0 && <><div className="property-separator" /><div className="property-row layers-row"><span>Layers</span><div><button onClick={() => reorder('back')} title="Send to back" aria-label="Send to back"><ArrowDownToLine size={17} /></button><button onClick={() => reorder('front')} title="Bring to front" aria-label="Bring to front"><ArrowUpToLine size={17} /></button></div></div><div className="property-row actions-row"><span>Actions</span><div>
            {selectedIds.length > 1 && <button onClick={groupSelected} title="Group selection (⌘G)" aria-label="Group selection"><Group size={16} /></button>}
            {selectedElements.some((el) => el.groupId) && <button onClick={ungroupSelected} title="Ungroup selection (⇧⌘G)" aria-label="Ungroup selection"><Ungroup size={16} /></button>}
            <button onClick={duplicateSelected} title="Duplicate" aria-label="Duplicate selected"><Copy size={16} /></button><button onClick={deleteSelected} title="Delete" aria-label="Delete selected"><Trash2 size={16} /></button></div></div></>}
        </section>
      )}

      {libraryOpen && (
        <aside className="library-panel island">
          <div className="panel-heading"><div><span className="eyebrow">STARTER LIBRARY</span><h2>A little head start</h2></div><button className="plain-icon" onClick={() => setLibraryOpen(false)} aria-label="Close library"><X size={18} /></button></div>
          <p>Drop a hand-drawn building block onto your canvas.</p>
          <button className="template" onClick={() => insertTemplate('flow')}><svg viewBox="0 0 100 58"><rect x="4" y="16" width="34" height="26" rx="3" /><path d="M64 8 L88 29 L64 50 L40 29 Z" /><path d="M39 29 L46 29 M42 25 L46 29 L42 33" /></svg><span><strong>Quick flow</strong><small>2 shapes + an arrow</small></span><Plus size={16} /></button>
          <button className="template" onClick={() => insertTemplate('note')}><svg viewBox="0 0 100 58"><path d="M24 5 L78 7 L75 53 L20 50 Z" fill="#ffec99" /><path d="M32 20 L65 20 M32 29 L58 29 M32 38 L62 38" /></svg><span><strong>Sticky note</strong><small>For a thought in progress</small></span><Plus size={16} /></button>
          <button className="template" onClick={() => insertTemplate('target')}><svg viewBox="0 0 100 58"><circle cx="50" cy="29" r="25" fill="#b2f2bb" /><circle cx="50" cy="29" r="15" /><circle cx="50" cy="29" r="3" /></svg><span><strong>Idea target</strong><small>Keep the big idea centered</small></span><Plus size={16} /></button>
          <div className="library-foot">Personal library stays on this device.</div>
        </aside>
      )}

      <div className="bottom-left" data-island="bottom-left" style={islandStyle('bottom-left')}>
        {islandGrip('bottom-left', 'Drag controls to move')}
        <div className="island zoom-controls">
          <button aria-label="Zoom out" onClick={() => zoomAt(size.width / 2, size.height / 2, camera.zoom / 1.2)}><Minus size={17} /></button>
          <button className="zoom-value" title="Fit to screen" onClick={() => fitToScreen()}>{Math.round(camera.zoom * 100)}%</button>
          <button aria-label="Zoom in" onClick={() => zoomAt(size.width / 2, size.height / 2, camera.zoom * 1.2)}><Plus size={17} /></button>
        </div>
        <div className="island history-controls">
          <button aria-label="Undo" disabled={!past.length} onClick={undo}><Undo2 size={18} /></button>
          <button aria-label="Redo" disabled={!future.length} onClick={redo}><Redo2 size={18} /></button>
        </div>
      </div>

      {!sharedView && (minimapOpen ? (
        <div className="minimap-wrap island" data-testid="minimap-wrap">
          <div className="minimap-head">
            <span>Overview</span>
            <button className="plain-icon" aria-label="Hide minimap" onClick={() => setMinimapOpen(false)}><ChevronDown size={15} /></button>
          </div>
          <canvas
            ref={minimapRef}
            className="minimap"
            width={MINIMAP_W}
            height={MINIMAP_H}
            aria-label="Canvas overview — click or drag to move, double-click to fit everything"
            onPointerDown={(event) => { minimapDrag.current = true; event.currentTarget.setPointerCapture(event.pointerId); minimapJump(event); }}
            onPointerMove={(event) => { if (minimapDrag.current) minimapJump(event); }}
            onDoubleClick={() => fitToScreen()}
            onPointerUp={() => { minimapDrag.current = false; }}
            onPointerCancel={() => { minimapDrag.current = false; }}
          />
        </div>
      ) : (
        <button className="minimap-toggle island icon-button" aria-label="Show minimap" title="Show overview map" onClick={() => setMinimapOpen(true)}><LayoutGrid size={18} /></button>
      ))}

      <div className="bottom-right">
        <button className="island icon-button" aria-label="Help and shortcuts" onClick={() => setModal('help')}><HelpCircle size={19} /></button>
        <button className="island icon-button" aria-label="Toggle color theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
      </div>

      {!sharedView && !hints.dismissed && (!(hints.zoomed && hints.panned) || !(hints.editedText && hints.snapped)) && (
        <div className={`gesture-hints island${hints.zoomed && hints.panned ? ' advanced' : ''}`} role="status" aria-label={hints.zoomed && hints.panned ? 'Advanced hints' : 'Getting started hints'}>
          {!(hints.zoomed && hints.panned) ? (<>
            <span className={hints.zoomed ? 'gesture-hint done' : 'gesture-hint'}><Mouse size={14} />Scroll to zoom</span>
            <span className={hints.panned ? 'gesture-hint done' : 'gesture-hint'}><Hand size={14} />Right-drag to pan</span>
          </>) : (<>
            <span className={hints.editedText ? 'gesture-hint done' : 'gesture-hint'}><Type size={14} />Double-click to edit text</span>
            <span className={hints.snapped ? 'gesture-hint done' : 'gesture-hint'}><Magnet size={14} />Drag near an edge to snap</span>
          </>)}
          <button className="plain-icon" aria-label="Dismiss hints" onClick={dismissHints}><X size={13} /></button>
        </div>
      )}

      {zenMode && (
        <div className="zen-hint" aria-hidden="true">Zen — press <kbd>Z</kbd> or <kbd>Esc</kbd> to bring the UI back</div>
      )}

      <button className="reset-view" title="Reset camera" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })}><RotateCcw size={14} />Reset view</button>

      {textEditor && (
        <textarea
          className="text-editor"
          autoFocus
          value={textEditor.value}
          placeholder="Type something…"
          style={{
            ...editorPosition,
            color: textEditor.id ? elements.find((el) => el.id === textEditor.id)?.stroke : currentStyle.stroke,
            fontSize: (textEditor.id ? elements.find((el) => el.id === textEditor.id)?.fontSize : currentStyle.fontSize) * camera.zoom,
            textAlign: (textEditor.id ? elements.find((el) => el.id === textEditor.id)?.textAlign : currentStyle.textAlign) || 'left',
            fontWeight: (textEditor.id ? elements.find((el) => el.id === textEditor.id)?.fontWeight : currentStyle.fontWeight) || 400,
            fontStyle: (textEditor.id ? elements.find((el) => el.id === textEditor.id)?.fontStyle : currentStyle.fontStyle) || 'normal',
            lineHeight: (textEditor.id ? elements.find((el) => el.id === textEditor.id)?.lineHeight : currentStyle.lineHeight) || 1.25,
            width: Math.max(180, (textEditor.width || 260) * camera.zoom),
          }}
          onChange={(event) => setTextEditor({ ...textEditor, value: event.target.value })}
          onPointerUp={(event) => setTextEditor({ ...textEditor, width: Math.max(180, event.currentTarget.offsetWidth / camera.zoom) })}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); setTextEditor(null); }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); commitText(); }
          }}
        />
      )}

      {frameRename && (() => {
        const target = elements.find((el) => el.id === frameRename.id);
        if (!target) return null;
        return (
          <input
            className="frame-rename"
            style={{
              left: (target.x + 10) * camera.zoom + camera.x,
              top: (target.y - 18) * camera.zoom + camera.y,
              height: 24 * camera.zoom,
              fontSize: 15 * camera.zoom,
              width: Math.max(120, (frameRename.value.length + 3) * 9 * camera.zoom),
            }}
            value={frameRename.value}
            aria-label="Frame name"
            autoFocus
            onFocus={(event) => event.target.select()}
            onChange={(event) => setFrameRename({ ...frameRename, value: event.target.value })}
            onBlur={commitFrameRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); commitFrameRename(); }
              if (event.key === 'Escape') { event.preventDefault(); setFrameRename(null); }
            }}
          />
        );
      })()}
      {marquee && <div className="marquee" style={{ left: Math.min(marquee.start.x, marquee.current.x), top: Math.min(marquee.start.y, marquee.current.y), width: Math.abs(marquee.current.x - marquee.start.x), height: Math.abs(marquee.current.y - marquee.start.y) }} />}      {guides && guides.map((guide, index) => guide.axis === 'v'
        ? <div key={`g${index}`} className="snap-guide v" style={{ left: guide.position * camera.zoom + camera.x }} />
        : <div key={`g${index}`} className="snap-guide h" style={{ top: guide.position * camera.zoom + camera.y }} />)}
      {selectedChart && (
        <div className="chart-badge" role="note" aria-label="Chart source"
          style={{ left: (selectedChart.bounds.x + selectedChart.bounds.w / 2) * camera.zoom + camera.x, top: selectedChart.bounds.y * camera.zoom + camera.y }}
          title="This chart tracks a spreadsheet — drop that file onto it to refresh the data">
          <Link2 size={11} />
          <span className="chart-badge-label">{selectedChart.spec.fileName}{selectedChart.spec.sheetName ? ` · ${selectedChart.spec.sheetName}` : ''}</span>
          <button className="chart-badge-unlink" aria-label="Unlink chart from file" onClick={() => unlinkChart(selectedChart.chartId)}><X size={11} /></button>
        </div>
      )}
      <input ref={fileInputRef} type="file" accept=".sketch,.json,application/json" hidden onChange={importJson} />
      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}

      {modal && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
          <section className={`modal ${modal === 'help' ? 'help-modal' : ''}`} role="dialog" aria-modal="true" aria-label={modal === 'export' ? 'Export canvas' : modal === 'share' ? 'Share canvas' : modal === 'help' ? 'Keyboard shortcuts' : modal === 'rename' ? 'Rename board' : modal === 'delete' ? 'Delete board' : 'Reset canvas'}>
            <button className="modal-close plain-icon" aria-label="Close dialog" onClick={() => setModal(null)}><X size={20} /></button>
            {modal === 'export' && <>
              <span className="modal-symbol"><Share2 size={22} /></span>
              <span className="eyebrow">TAKE YOUR IDEAS WITH YOU</span>
              <h2>Export your canvas</h2>
              <p className="modal-intro">A crisp image for sharing, an editable vector, or a file you can open again later.</p>
              <div className="export-options">
                <button onClick={savePng}><ImageIcon size={23} /><span><strong>PNG image</strong><small>High-resolution, with background</small></span><Download size={17} /></button>
                <button onClick={saveSvg}><FileCode2 size={23} /><span><strong>SVG vector</strong><small>Editable and infinitely scalable</small></span><Download size={17} /></button>
                <button onClick={saveJson}><FileJson size={23} /><span><strong>Sketch file</strong><small>Reopen and keep editing</small></span><Download size={17} /></button>
              </div>
              <div className="export-meta">{elements.length} {elements.length === 1 ? 'element' : 'elements'} · Local-first · No account needed</div>
            </>}
            {modal === 'share' && <>
              <span className="modal-symbol"><Share2 size={22} /></span>
              <span className="eyebrow">NO SERVERS, NO ACCOUNTS</span>
              <h2>Share your canvas</h2>
              <p className="modal-intro">Anyone can open it — on any device, even offline. Viewers get a read-only copy they can save as their own.</p>
              <div className="export-options">
                <button onClick={copyShareLink}><Link2 size={23} /><span><strong>Copy link</strong><small>The whole board travels inside the URL</small></span><Copy size={17} /></button>
                <button onClick={saveSnapshot}><FileCode2 size={23} /><span><strong>Snapshot file</strong><small>A self-contained HTML to send or keep</small></span><Download size={17} /></button>
              </div>
              {shareUrl && <input className="share-link" readOnly value={shareUrl} aria-label="Share link" onFocus={(event) => event.target.select()} />}
              {collabAvailable && !live && <>
                <div className="share-divider"><span>or work together live</span></div>
                <div className="export-options">
                  <button onClick={() => { setModal(null); startLive(); }}><Radio size={23} /><span><strong>Live session</strong><small>Same-network guests join a link — cursors, edits and your camera stay in sync</small></span><Play size={17} /></button>
                </div>
              </>}
            </>}
            {modal === 'help' && <>
              <span className="eyebrow">WORK AT THE SPEED OF THOUGHT</span><h2>Keyboard shortcuts</h2>
              <div className="shortcuts">
                {[['Select', 'V'], ['Pan canvas', 'H, Space or right-drag'], ['Rectangle / Diamond', 'R / D'], ['Ellipse / Arrow', 'O / A'], ['Draw / Text', 'P / T'], ['Frame', 'F'], ['Find frame / jump to', '⌘ F'], ['Erase', 'E'], ['Bold / Italic', '⌘ B / ⌘ I'], ['Align left / center / right', '⇧ ⌘ L / C / R'], ['Group / Ungroup', '⌘ G / ⇧ ⌘ G'], ['Undo / Redo', '⌘ Z / ⇧ ⌘ Z'], ['Duplicate', '⌘ D'], ['Select all', '⌘ A'], ['Delete selection', 'Delete'], ['Zoom at cursor', 'Scroll'], ['Zoom in / out', '+ / −'], ['Zoom to fit', '⇧ 1'], ['Pan sideways', '⇧ Scroll'], ['Nudge selection', 'Arrow keys'], ['Sticky note', 'Double-click canvas'], ['Finish text', '⌘ Enter'], ['Zen mode', 'Z']].map(([label, key]) => <div key={label}><span>{label}</span><kbd>{key}</kbd></div>)}
              </div>
              <p className="help-tip"><strong>Little tips:</strong> scroll to zoom toward your cursor, drag with the middle or right mouse button (or hold <kbd>Space</kbd>) to pan, and double-click the overview map to fit everything. Press <kbd>F</kbd> and drag to draw a frame — a named region that carries whatever you put inside it when dragged; double-click its name to rename, and press <kbd>⌘ F</kbd> to jump between frames. Sticky notes can wear a status dot, carry tags, and collect voting dots for retrospectives — click a note's badge to vote, right-click to take one back. Draw frames around your topics and press Present for a clean full-screen walkthrough — frames glide from one to the next with a slide as you click or press the arrow keys, move the mouse to point with a laser, press <kbd>I</kbd> to scribble fading ink over the frame, <kbd>Esc</kbd> to leave. The floating bars each have a small grip you can drag to rearrange them — the Main menu can reset their positions. Press <kbd>Z</kbd> for zen mode, a clean desk with nothing but the canvas — each board remembers its own preference, and starting a presentation borrows zen for a clean first frame, handing your desk back when the show ends. <kbd>Z</kbd> or <kbd>Esc</kbd> brings everything back. In a live session, guests follow your view and can point back at the board with their own cursors while you present. Paste cells copied from Excel or Sheets — or drop a .csv / .xlsx file on the board — to draw a chart, then double-click the chart to edit its numbers. Drop a file onto an existing chart to refresh its data in place. For live working sessions, Share → Live session starts a room on your network — guests join the link and everyone's cursors, edits, and the presenter's camera stay in sync. Hold <kbd>Shift</kbd> while resizing to preserve proportions, or while selecting to choose multiple elements. Drag a box around elements to select them — a grouped element pulls its whole group along. Click a selected group again to edit one member on its own.</p>
              <a className="github-link" href="https://github.com/kaspersebastian83-dot/sketchboard" target="_blank" rel="noreferrer"><Github size={15} />Star Sketchboard on GitHub</a>
            </>}
            {modal === 'rename' && <>
              <span className="eyebrow">BOARDS</span>
              <h2>Rename board</h2>
              <input
                ref={renameInputRef}
                className="share-link"
                defaultValue={workspace.boards.find((b) => b.id === renameTarget)?.name || ''}
                aria-label="Board name"
                autoFocus
                onFocus={(event) => event.target.select()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') doRename(event.currentTarget.value);
                  if (event.key === 'Escape') { setModal(null); setRenameTarget(null); }
                }}
              />
              <div className="modal-actions">
                <button className="secondary-button" onClick={() => { setModal(null); setRenameTarget(null); }}>Cancel</button>
                <button className="primary-button" onClick={() => doRename(renameInputRef.current?.value || '')}>Rename</button>
              </div>
            </>}
            {modal === 'delete' && <>
              <span className="modal-symbol danger-symbol"><Trash2 size={22} /></span>
              <h2>Delete this board?</h2>
              <p className="modal-intro">“{workspace.boards.find((b) => b.id === deleteTarget)?.name}” and everything on it will be removed for good.</p>
              <div className="modal-actions">
                <button className="secondary-button" onClick={() => { setModal(null); setDeleteTarget(null); }}>Cancel</button>
                <button className="danger-button" onClick={doDelete}>Delete board</button>
              </div>
            </>}
            {modal === 'reset' && <>
              <span className="modal-symbol danger-symbol"><Trash2 size={22} /></span><h2>Start with a clean canvas?</h2><p className="modal-intro">This removes every element from this browser. You can undo it afterward.</p>
              <div className="modal-actions"><button className="secondary-button" onClick={() => setModal(null)}>Keep sketching</button><button className="danger-button" onClick={() => { commit([]); setSelectedIds([]); setModal(null); setCamera({ x: 0, y: 0, zoom: 1 }); notify('Canvas reset'); }}>Reset canvas</button></div>
            </>}
          </section>
        </div>
      )}

      {chartEditor && (() => {
        const table = chartEditor.table;
        const columns = `minmax(96px, 1.2fr) repeat(${table.series.length}, minmax(72px, 1fr))`;
        return (
          <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setChartEditor(null); }}>
            <section className="modal chart-modal" role="dialog" aria-modal="true" aria-label="Edit chart data">
              <button className="modal-close plain-icon" aria-label="Close dialog" onClick={() => setChartEditor(null)}><X size={20} /></button>
              <span className="eyebrow">CHART DATA</span>
              <h2>Edit the chart</h2>
              <p className="modal-intro">The numbers behind the drawing. Switch the type any time.</p>
              <div className="chart-types" role="group" aria-label="Chart type">
                {[['bar', 'Bar'], ['line', 'Line'], ['pie', 'Pie']].map(([id, label]) => (
                  <button key={id} className={chartEditor.type === id ? 'pressed' : ''} aria-pressed={chartEditor.type === id} onClick={() => setChartEditor({ ...chartEditor, type: id })}>{label}</button>
                ))}
              </div>
              <div className="chart-grid">
                <div className="chart-row" style={{ gridTemplateColumns: columns }}>
                  <input className="chart-cell chart-head" value={table.headers[0]} placeholder="Label" aria-label="Label column header" onChange={(event) => updateChartTable((t) => ({ ...t, headers: [event.target.value, ...t.headers.slice(1)] }))} />
                  {table.series.map((s, si) => (
                    <input key={si} className="chart-cell chart-head" value={s.name} aria-label={`Series ${si + 1} name`} onChange={(event) => updateChartTable((t) => ({ ...t, series: t.series.map((x, xi) => (xi === si ? { ...x, name: event.target.value } : x)) }))} />
                  ))}
                </div>
                {table.categories.map((category, ri) => (
                  <div className="chart-row" key={ri} style={{ gridTemplateColumns: columns }}>
                    <input className="chart-cell" value={category} aria-label={`Row ${ri + 1} label`} onChange={(event) => updateChartTable((t) => ({ ...t, categories: t.categories.map((c, ci) => (ci === ri ? event.target.value : c)) }))} />
                    {table.series.map((s, si) => (
                      <input key={si} className="chart-cell" value={s.values[ri] ?? ''} inputMode="decimal" aria-label={`Row ${ri + 1} series ${si + 1}`} onChange={(event) => updateChartTable((t) => ({ ...t, series: t.series.map((x, xi) => (xi === si ? { ...x, values: x.values.map((v, vi) => (vi === ri ? event.target.value : v)) } : x)) }))} />
                    ))}
                  </div>
                ))}
              </div>
              <div className="chart-row-actions">
                <button className="secondary-button" onClick={() => updateChartTable((t) => ({ ...t, categories: [...t.categories, `Item ${t.categories.length + 1}`], series: t.series.map((s) => ({ ...s, values: [...s.values, '0'] })) }))}>Add row</button>
                <button className="secondary-button" onClick={() => updateChartTable((t) => ({ ...t, headers: [...t.headers, `Series ${t.series.length + 1}`], series: [...t.series, { name: `Series ${t.series.length + 1}`, values: t.categories.map(() => '0') }] }))}>Add series</button>
              </div>
              <div className="modal-actions">
                <button className="secondary-button" onClick={() => setChartEditor(null)}>Cancel</button>
                <button className="primary-button" onClick={applyChart}>Update chart</button>
              </div>
            </section>
          </div>
        );
      })()}

      {sheetPicker && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSheetPicker(null); }}>
          <section className="modal sheet-modal" role="dialog" aria-modal="true" aria-label="Choose a sheet">
            <button className="modal-close plain-icon" aria-label="Close dialog" onClick={() => setSheetPicker(null)}><X size={20} /></button>
            <span className="eyebrow">SPREADSHEET IMPORT</span>
            <h2>Pick a sheet</h2>
            <p className="modal-intro">{sheetPicker.fileName} holds {sheetPicker.sheets.length} sheets with data. {sheetPicker.updateChartId ? 'Which one should replace the data of the chart underneath?' : 'Which one should become the chart?'}</p>
            <div className="sheet-list">
              {sheetPicker.sheets.map((sheet) => (
                <button key={sheet.name} className="sheet-option" onClick={() => {
                  setSheetPicker(null);
                  if (sheetPicker.updateChartId) updateChartFromTable(sheetPicker.updateChartId, sheet.table, sheet.name, sheetPicker.fileName, `Dropped ${sheetPicker.fileName} · ${sheet.name}`);
                  else insertChart(sheet.table, 'bar', uid(), sheetPicker.at, `Dropped ${sheetPicker.fileName} · ${sheet.name}`, sheet.name, sheetPicker.fileName);
                }}>
                  <span className="sheet-name">{sheet.name}</span>
                  <span className="sheet-meta">{sheet.table.categories.length} {sheet.table.categories.length === 1 ? 'row' : 'rows'} · {sheet.table.series.length} series</span>
                </button>
              ))}
            </div>
            {!sheetPicker.updateChartId && (
              <div className="modal-actions">
                <button className="secondary-button" onClick={() => { setSheetPicker(null); insertCharts(sheetPicker.sheets, sheetPicker.at, `Dropped ${sheetPicker.fileName}`, sheetPicker.fileName); }}>Chart all sheets</button>
              </div>
            )}
          </section>
        </div>
      )}

      {presentIndex !== null && (
        <div
          className={`presentation${inkMode ? ' ink-mode' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="Presentation mode"
          tabIndex={-1}
          ref={presentationRef}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            stepPresentation(1);
          }}
          onPointerDown={(event) => {
            if (!inkMode || event.button !== 0) return;
            event.stopPropagation();
            const cam = cameraRef.current;
            const point = { x: (event.clientX - cam.x) / cam.zoom, y: (event.clientY - cam.y) / cam.zoom, t: performance.now() };
            const stroke = { points: [point] };
            inkStrokesRef.current.push(stroke);
            inkDrawingRef.current = stroke;
          }}
          onPointerMove={(event) => {
            addLaserPoint(event);
            const stroke = inkDrawingRef.current;
            if (!stroke) return;
            const cam = cameraRef.current;
            const last = stroke.points[stroke.points.length - 1];
            const world = { x: (event.clientX - cam.x) / cam.zoom, y: (event.clientY - cam.y) / cam.zoom };
            if (Math.hypot(world.x - last.x, world.y - last.y) * cam.zoom < 3) return;
            stroke.points.push({ ...world, t: performance.now() });
            if (stroke.points.length > 200) stroke.points.shift();
          }}
          onPointerUp={() => {
            const stroke = inkDrawingRef.current;
            if (!stroke) return;
            inkDrawingRef.current = null;
            suppressClickRef.current = stroke.points.length > 1;
          }}
          onKeyDown={(event) => {
            // Let buttons keep their own Space/Enter behavior.
            if (event.target.closest('button') && (event.key === ' ' || event.key === 'Enter')) return;
            if (event.key === 'i' || event.key === 'I') {
              if (event.target.closest('button')) return;
              event.preventDefault();
              event.stopPropagation();
              setInkMode((mode) => !mode);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              if (inkMode) setInkMode(false);
              else exitPresentation();
              return;
            }
            const forward = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(event.key);
            const backward = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(event.key);
            if (forward || backward) {
              event.preventDefault();
              event.stopPropagation();
              stepPresentation(forward ? 1 : -1);
            }
          }}
        >
          <canvas ref={inkRef} className="ink-canvas" aria-hidden="true" />
          <canvas ref={laserRef} className="laser-canvas" aria-hidden="true" />
          <div className="presentation-bar" onClick={(event) => event.stopPropagation()}>
            <button className="plain-icon" aria-label="Previous frame" title="Previous frame" onClick={() => stepPresentation(-1)}><ChevronLeft size={18} /></button>
            <div className="presentation-title">
              <strong>{framesSorted[presentIndex]?.name || 'Frame'}</strong>
              <span>{presentIndex + 1} of {framesSorted.length}</span>
            </div>
            <button className="plain-icon" aria-label="Next frame" title="Next frame" onClick={() => stepPresentation(1)}><ChevronRight size={18} /></button>
            <button
              className={`plain-icon ink-button${inkMode ? ' active' : ''}`}
              aria-label="Ink annotations"
              aria-pressed={inkMode}
              title="Ink annotations — fading ink (I)"
              onClick={() => setInkMode((mode) => !mode)}
            ><Pencil size={17} /></button>
            <button className="plain-icon presentation-exit" aria-label="Exit presentation" title="Exit (Esc)" onClick={exitPresentation}><X size={18} /></button>
          </div>
          <div className="presentation-hint" aria-hidden="true">Click or press → for the next frame · move the mouse for the laser pointer · I for fading ink · Esc to exit</div>
        </div>
      )}
    </main>
  );
}
