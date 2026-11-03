import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, BookOpen, Check, ChevronLeft, ChevronRight, Download, Eraser, FilePlus2, Grid3X3,
  Highlighter, Pencil, Plus, Redo2, Scissors, Trash2, Type, Undo2, Upload, X,
} from 'lucide-react';
import { uid, hitTest } from './engine.js';
import {
  PAGE_W, PAGE_H, GRID, PAPERS, loadNotebooks, saveNotebooks, newNotebook, newPage, paintPage, pageToDataUrl,
  serializeBackup, parseBackup, mergeNotebooks,
} from './notebook.js';
import { requestPersistence, storageInfo } from './notebookStore.js';

const INKS = [
  { color: '#1e1e1e', label: 'Black' },
  { color: '#1971c2', label: 'Blue' },
  { color: '#e03131', label: 'Red' },
  { color: '#2f9e44', label: 'Green' },
  { color: '#6b6b6b', label: 'Pencil' },
];
const MARKERS = [
  { color: '#ffd43b', label: 'Yellow' },
  { color: '#8ce99a', label: 'Green' },
  { color: '#ff8787', label: 'Pink' },
  { color: '#74c0fc', label: 'Blue' },
];
const WIDTHS = [
  { id: 'fine', width: 1.6, label: 'Fine' },
  { id: 'medium', width: 2.6, label: 'Medium' },
  { id: 'bold', width: 4.2, label: 'Bold' },
];
const TOOLS = [
  { id: 'pen', icon: Pencil, label: 'Pen', key: 'P' },
  { id: 'highlighter', icon: Highlighter, label: 'Highlighter', key: 'H' },
  { id: 'text', icon: Type, label: 'Text', key: 'T' },
  { id: 'eraser', icon: Eraser, label: 'Eraser', key: 'E' },
];
const TEXT_SIZE = 18;
const HIGHLIGHT_WIDTH = 14;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function Spiral({ scale, width }) {
  const coils = [];
  for (let x = GRID / 2; x < PAGE_W; x += GRID) coils.push(x);
  const s = scale;
  return (
    <svg className="nb-spiral" width={width} height={36 * s} viewBox={`0 0 ${width} ${36 * s}`} aria-hidden="true">
      <defs>
        <linearGradient id="nb-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6dc8a" />
          <stop offset="0.5" stopColor="#c99a2e" />
          <stop offset="1" stopColor="#8f6a17" />
        </linearGradient>
      </defs>
      {coils.map((x) => (
        <g key={x} transform={`translate(${x * s} 0)`}>
          <circle cx="0" cy={17 * s} r={3.3 * s} fill="#2b231b" opacity="0.8" />
          <rect x={-3.4 * s} y={-1 * s} width={6.8 * s} height={31 * s} rx={3.4 * s} fill="none" stroke="url(#nb-gold)" strokeWidth={2.5 * s} />
          <path d={`M ${-1.1 * s} ${1.5 * s} L ${-1.1 * s} ${27 * s}`} stroke="#fff6cf" strokeOpacity="0.55" strokeWidth={0.9 * s} strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

// Storage is asynchronous (IndexedDB), so the pad appears once it has loaded.
export default function Notebook({ onExit }) {
  const [initial, setInitial] = useState(null);
  useEffect(() => {
    let alive = true;
    loadNotebooks().then((loaded) => alive && setInitial(loaded));
    return () => { alive = false; };
  }, []);
  if (!initial) return <div className="nb-app" data-testid="notebook-loading" />;
  return <NotebookView initialState={initial} onExit={onExit} />;
}

const formatBytes = (bytes) => (bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

function NotebookView({ initialState, onExit }) {
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const nb = state.notebooks.find((n) => n.id === state.activeId);
  const page = nb.pages[nb.current];

  const [tool, setTool] = useState('pen');
  const [ink, setInk] = useState(INKS[0].color);
  const [marker, setMarker] = useState(MARKERS[0].color);
  const [width, setWidth] = useState(WIDTHS[1].width);
  const [editor, setEditor] = useState(null); // { id, x, y, width, value }
  const editorRef = useRef(null);
  const [flip, setFlip] = useState(null); // { dir, src, target }
  const flipRef = useRef(false);
  const [panel, setPanel] = useState(null); // 'notebooks' | 'paper' | 'tear' | null
  const [renaming, setRenaming] = useState(false);
  const [toast, setToast] = useState('');
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [fontsEpoch, setFontsEpoch] = useState(0);
  const [, bump] = useState(0);

  const canvasRef = useRef(null);
  const drawRef = useRef(null);
  const penSeen = useRef(false);
  const histRef = useRef(new Map());
  const toastTimer = useRef(null);

  // --- Layout ------------------------------------------------------------------
  const narrow = size.w < 720;
  const availW = size.w - (narrow ? 36 : 80);
  const availH = size.h - (narrow ? 196 : 168);
  const scale = clamp(Math.min(availW / PAGE_W, availH / PAGE_H), 0.45, 2.2);
  const W = Math.floor(PAGE_W * scale);
  const H = Math.floor(PAGE_H * scale);
  const dpr = Math.min(3, window.devicePixelRatio || 1);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    let alive = true;
    document.fonts?.load(`${TEXT_SIZE}px Virgil`).then(() => alive && setFontsEpoch((n) => n + 1)).catch(() => {});
    return () => { alive = false; };
  }, []);

  // --- Persistence -------------------------------------------------------------
  // A failed save is never silent: a banner stays up until a save succeeds.
  const [saveError, setSaveError] = useState(null);
  const [storage, setStorage] = useState(null);
  const persist = useCallback((next) => saveNotebooks(next).then(
    () => setSaveError(null),
    (error) => setSaveError(error?.name === 'QuotaExceededError' ? 'This device is out of storage space.' : 'Your latest changes could not be saved.'),
  ), []);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return undefined; }
    const timer = setTimeout(() => persist(state), 250);
    return () => clearTimeout(timer);
  }, [state, persist]);
  useEffect(() => {
    const flush = () => persist(stateRef.current);
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [persist]);
  const refreshStorage = useCallback(() => { storageInfo().then(setStorage); }, []);
  useEffect(() => {
    // Installed apps are usually granted persistent storage silently; in a plain
    // tab the panel offers a button instead, since Firefox asks the user.
    if (isInstalled()) requestPersistence().finally(refreshStorage);
    else refreshStorage();
  }, [refreshStorage]);
  const protectStorage = async () => {
    const granted = await requestPersistence();
    refreshStorage();
    showToast(granted ? 'Notebooks are protected from cleanup' : 'The browser declined. Installing the app usually helps.');
  };

  const patchNotebook = useCallback((id, fn) => {
    setState((s) => ({ ...s, notebooks: s.notebooks.map((n) => (n.id === id ? { ...fn(n), updatedAt: Date.now() } : n)) }));
  }, []);
  const setElements = useCallback((pageId, elements) => {
    patchNotebook(stateRef.current.activeId, (n) => ({ ...n, pages: n.pages.map((p) => (p.id === pageId ? { ...p, elements } : p)) }));
  }, [patchNotebook]);
  const setCurrent = useCallback((index) => {
    patchNotebook(stateRef.current.activeId, (n) => ({ ...n, current: index }));
  }, [patchNotebook]);
  const currentPage = () => {
    const s = stateRef.current;
    const n = s.notebooks.find((item) => item.id === s.activeId);
    return n.pages[n.current];
  };
  const showToast = (message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  };

  // --- History (per page, in memory) ---------------------------------------------
  const historyOf = (pageId) => {
    let h = histRef.current.get(pageId);
    if (!h) { h = { past: [], future: [] }; histRef.current.set(pageId, h); }
    return h;
  };
  const record = (pageId, before) => {
    const h = historyOf(pageId);
    h.past.push(before);
    if (h.past.length > 100) h.past.shift();
    h.future = [];
    bump((n) => n + 1);
  };
  const undo = () => {
    const h = historyOf(page.id);
    if (!h.past.length) return;
    h.future.push(page.elements);
    setElements(page.id, h.past.pop());
    bump((n) => n + 1);
  };
  const redo = () => {
    const h = historyOf(page.id);
    if (!h.future.length) return;
    h.past.push(page.elements);
    setElements(page.id, h.future.pop());
    bump((n) => n + 1);
  };
  const hist = historyOf(page.id);

  // --- Painting ------------------------------------------------------------------
  const visibleElements = editor?.id ? page.elements.filter((el) => el.id !== editor.id) : page.elements;
  useEffect(() => {
    if (canvasRef.current) paintPage(canvasRef.current, visibleElements, { scale, pixelRatio: dpr, paper: nb.paper });
  }, [visibleElements, scale, dpr, nb.paper, fontsEpoch, flip]);

  // --- Text ----------------------------------------------------------------------
  const openEditor = (next) => { editorRef.current = next; setEditor(next); };
  const commitText = () => {
    const ed = editorRef.current;
    if (!ed) return;
    editorRef.current = null;
    setEditor(null);
    const target = currentPage();
    const value = ed.value.trimEnd();
    const existing = ed.id ? target.elements.find((el) => el.id === ed.id) : null;
    if (!value) {
      if (existing) {
        record(target.id, target.elements);
        setElements(target.id, target.elements.filter((el) => el.id !== ed.id));
      }
      return;
    }
    if (existing && existing.text === value) return;
    record(target.id, target.elements);
    if (existing) {
      setElements(target.id, target.elements.map((el) => (el.id === ed.id ? { ...el, text: value } : el)));
    } else {
      setElements(target.id, [...target.elements, {
        id: uid(), type: 'text', x: ed.x, y: ed.y, width: ed.width, height: 0, text: value,
        stroke: ink, background: 'transparent', fillStyle: 'solid', strokeStyle: 'solid', strokeWidth: 1, roughness: 0, opacity: 100,
        fontSize: TEXT_SIZE, textAlign: 'left', fontWeight: 400, fontStyle: 'normal', lineHeight: 1.25,
      }]);
    }
  };
  const cancelText = () => { editorRef.current = null; setEditor(null); };
  const editorInput = useRef(null);
  useEffect(() => {
    const el = editorInput.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [editor?.value, editor?.id, scale]);

  // --- Pages ---------------------------------------------------------------------
  const snapshot = (elements) => pageToDataUrl(elements, nb.paper, scale, dpr);
  const goTo = (index) => {
    if (flipRef.current || index < 0 || index >= nb.pages.length || index === nb.current) return;
    commitText();
    setPanel(null);
    const dir = index > nb.current ? 'next' : 'prev';
    if (reducedMotion()) { setCurrent(index); return; }
    flipRef.current = { dir, target: index };
    const src = snapshot(dir === 'next' ? currentPage().elements : nb.pages[index].elements);
    if (dir === 'next') setCurrent(index);
    setFlip({ dir, src, target: index });
  };
  const endFlip = () => {
    const active = flipRef.current;
    if (!active) return;
    flipRef.current = null;
    if (active.dir === 'prev') setCurrent(active.target);
    setFlip(null);
  };
  useEffect(() => {
    if (!flip) return undefined;
    const timer = setTimeout(endFlip, 1200); // safety net if the animation never reports back
    return () => clearTimeout(timer);
  }, [flip]);

  const addPage = () => {
    if (flipRef.current) return;
    commitText();
    setPanel(null);
    const fresh = newPage();
    const index = nb.current + 1;
    const src = reducedMotion() ? null : snapshot(page.elements);
    patchNotebook(nb.id, (n) => ({ ...n, pages: [...n.pages.slice(0, index), fresh, ...n.pages.slice(index)], current: index }));
    if (src) { flipRef.current = { dir: 'next', target: index }; setFlip({ dir: 'next', src, target: index }); }
  };
  const tearOff = () => {
    if (flipRef.current) return;
    commitText();
    setPanel(null);
    const src = reducedMotion() ? null : snapshot(page.elements);
    histRef.current.delete(page.id);
    if (nb.pages.length === 1) {
      patchNotebook(nb.id, (n) => ({ ...n, pages: [{ ...n.pages[0], elements: [] }] }));
    } else {
      patchNotebook(nb.id, (n) => {
        const pages = n.pages.filter((p) => p.id !== page.id);
        return { ...n, pages, current: Math.min(n.current, pages.length - 1) };
      });
    }
    if (src) { flipRef.current = { dir: 'next', target: nb.current }; setFlip({ dir: 'next', src, target: nb.current }); }
    showToast(nb.pages.length === 1 ? 'Page cleared' : 'Page torn off');
  };

  // --- Notebooks -----------------------------------------------------------------
  const createNotebook = () => {
    commitText();
    const fresh = newNotebook(`Notebook ${state.notebooks.length + 1}`, nb.paper);
    setState((s) => ({ ...s, activeId: fresh.id, notebooks: [...s.notebooks, fresh] }));
    setPanel(null);
  };
  const openNotebook = (id) => { commitText(); setState((s) => ({ ...s, activeId: id })); setPanel(null); };
  const removeNotebook = (id) => {
    setState((s) => {
      if (s.notebooks.length === 1) return s;
      const notebooks = s.notebooks.filter((n) => n.id !== id);
      return { ...s, notebooks, activeId: s.activeId === id ? notebooks[0].id : s.activeId };
    });
  };
  const renameNotebook = (name) => patchNotebook(nb.id, (n) => ({ ...n, name: name.trim() || n.name }));

  const backupInput = useRef(null);
  const backupAll = () => {
    const blob = new Blob([serializeBackup(stateRef.current)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sketchboard-notebooks-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast('Backup saved');
  };
  const restoreFrom = async (file) => {
    if (!file) return;
    try {
      const incoming = parseBackup(await file.text());
      const merged = mergeNotebooks(stateRef.current.notebooks, incoming);
      setState((s) => ({ ...s, notebooks: mergeNotebooks(s.notebooks, incoming).notebooks }));
      showToast(merged.added ? `Restored ${merged.added} ${merged.added === 1 ? 'notebook' : 'notebooks'}` : 'Nothing new in that backup');
    } catch (error) {
      showToast(error.message || 'Could not read that file');
    }
  };

  const downloadPage = () => {
    const link = document.createElement('a');
    link.href = pageToDataUrl(page.elements, nb.paper, 3, 2);
    link.download = `${nb.name.replace(/[^\w-]+/g, '-')}-page-${nb.current + 1}.png`;
    link.click();
    showToast('Page saved as PNG');
  };

  // --- Pointer input ---------------------------------------------------------------
  const worldPoint = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / scale, 0, PAGE_W), y: clamp((event.clientY - rect.top) / scale, 0, PAGE_H) };
  };
  const eraseAt = (p) => {
    const active = drawRef.current;
    const hit = [...active.elements].reverse().find((el) => hitTest(el, p, 10 / scale));
    if (!hit) return;
    if (!active.recorded) { record(active.pageId, active.elements); active.recorded = true; }
    active.elements = active.elements.filter((el) => el.id !== hit.id);
    setElements(active.pageId, active.elements);
  };
  const onPointerDown = (event) => {
    if (flipRef.current || event.button > 0) return;
    if (event.pointerType === 'pen') penSeen.current = true;
    if (event.pointerType === 'touch' && penSeen.current) return; // palm rejection once a stylus has been used
    setPanel(null);
    if (editorRef.current) commitText();
    const p = worldPoint(event);
    if (tool === 'text') {
      const target = currentPage();
      const hit = [...target.elements].reverse().find((el) => el.type === 'text' && hitTest(el, p, 6 / scale));
      openEditor(hit
        ? { id: hit.id, x: hit.x, y: hit.y, width: hit.width, value: hit.text }
        : { id: null, x: p.x, y: p.y, width: Math.max(120, PAGE_W - p.x - 14), value: '' });
      event.preventDefault();
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'eraser') {
      drawRef.current = { type: 'erase', pageId: page.id, elements: page.elements, recorded: false };
      eraseAt(p);
      return;
    }
    const highlighting = tool === 'highlighter';
    const el = {
      id: uid(), type: 'freedraw', x: p.x, y: p.y, width: 0, height: 0, points: [[0, 0]],
      stroke: highlighting ? marker : ink, background: 'transparent', fillStyle: 'solid', strokeStyle: 'solid',
      strokeWidth: highlighting ? HIGHLIGHT_WIDTH : width, roughness: 0, opacity: highlighting ? 40 : 100,
    };
    if (!highlighting) el.pressures = [event.pressure || 0.5];
    record(page.id, page.elements);
    drawRef.current = { type: 'stroke', pageId: page.id, base: page.elements, el, last: p };
    setElements(page.id, [...page.elements, el]);
  };
  const onPointerMove = (event) => {
    const active = drawRef.current;
    if (!active) return;
    const samples = event.nativeEvent.getCoalescedEvents?.() || [event.nativeEvent];
    if (active.type === 'erase') {
      for (const sample of samples) eraseAt(worldPoint(sample));
      return;
    }
    let { el } = active;
    let changed = false;
    for (const sample of samples) {
      const p = worldPoint(sample);
      if (Math.hypot(p.x - active.last.x, p.y - active.last.y) < 0.6) continue;
      el = {
        ...el,
        points: [...el.points, [p.x - el.x, p.y - el.y]],
        ...(el.pressures ? { pressures: [...el.pressures, sample.pressure || 0.5] } : {}),
      };
      active.last = p;
      changed = true;
    }
    if (!changed) return;
    active.el = el;
    setElements(active.pageId, [...active.base, el]);
  };
  const onPointerUp = () => { drawRef.current = null; };

  // --- Keyboard --------------------------------------------------------------------
  const keyHandler = useRef(null);
  keyHandler.current = (event) => {
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (mod) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); goTo(nb.current + 1); return; }
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); goTo(nb.current - 1); return; }
    const hotkey = TOOLS.find((item) => item.key.toLowerCase() === event.key.toLowerCase());
    if (hotkey) { commitText(); setTool(hotkey.id); }
  };
  useEffect(() => {
    const listener = (event) => keyHandler.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const colors = tool === 'highlighter' ? MARKERS : INKS; // text uses the ink colors too
  const activeColor = tool === 'highlighter' ? marker : ink;
  const setColor = (color) => (tool === 'highlighter' ? setMarker(color) : setInk(color));
  const lastPage = nb.current === nb.pages.length - 1;

  return (
    <div className="nb-app" data-testid="notebook">
      <header className="nb-top">
        <button className="nb-chip" onClick={() => { commitText(); onExit(); }} data-testid="nb-exit"><ArrowLeft size={16} /><span>Whiteboard</span></button>
        {renaming ? (
          <input
            className="nb-title-input"
            aria-label="Notebook name"
            defaultValue={nb.name}
            autoFocus
            onBlur={(event) => { renameNotebook(event.target.value); setRenaming(false); }}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setRenaming(false); }}
          />
        ) : (
          <button className="nb-title" onClick={() => setRenaming(true)} title="Rename notebook" data-testid="nb-title">{nb.name}</button>
        )}
        <button className={`nb-chip ${panel === 'notebooks' ? 'on' : ''}`} onClick={() => { if (panel !== 'notebooks') refreshStorage(); setPanel(panel === 'notebooks' ? null : 'notebooks'); }} data-testid="nb-notebooks"><BookOpen size={16} /><span>Notebooks</span></button>
      </header>

      {panel === 'notebooks' && (
        <div className="nb-panel nb-notebooks" data-testid="nb-notebook-list">
          {state.notebooks.map((item) => (
            <div key={item.id} className={`nb-book ${item.id === nb.id ? 'on' : ''}`}>
              <button className="nb-book-open" onClick={() => openNotebook(item.id)}>
                <span className="nb-book-cover" aria-hidden="true" />
                <span className="nb-book-name">{item.name}</span>
                <span className="nb-book-meta">{item.pages.length} {item.pages.length === 1 ? 'page' : 'pages'}</span>
              </button>
              {state.notebooks.length > 1 && (
                <button className="nb-icon small" aria-label={`Delete ${item.name}`} onClick={() => removeNotebook(item.id)}><Trash2 size={14} /></button>
              )}
            </div>
          ))}
          <button className="nb-book new" onClick={createNotebook} data-testid="nb-new-notebook"><Plus size={16} /><span>New notebook</span></button>
          <div className="nb-backup">
            <button onClick={backupAll} data-testid="nb-backup"><Download size={15} /><span>Back up all</span></button>
            <button onClick={() => backupInput.current?.click()} data-testid="nb-restore"><Upload size={15} /><span>Restore…</span></button>
            <input ref={backupInput} type="file" accept="application/json,.json" hidden data-testid="nb-restore-input" onChange={(event) => { restoreFrom(event.target.files?.[0]); event.target.value = ''; }} />
          </div>
          {storage && (
            <div className="nb-storage" data-testid="nb-storage">
              <span className={`nb-storage-dot ${storage.persisted ? 'ok' : ''}`} />
              <span>
                {storage.backend === 'localstorage' ? 'Saved in basic browser storage' : 'Saved on this device'}
                {storage.usage != null && ` · ${formatBytes(storage.usage)}`}
                <br />
                {storage.persisted ? 'Protected from automatic cleanup' : 'Not protected from cleanup yet'}
              </span>
              {!storage.persisted && <button onClick={protectStorage} data-testid="nb-protect">Protect</button>}
            </div>
          )}
        </div>
      )}

      <main className="nb-desk">
        <div className="nb-pad" style={{ width: W, height: H }}>
          <div className="nb-cover" aria-hidden="true" />
          <div className="nb-stage" style={{ width: W, height: H }}>
            <canvas
              ref={canvasRef}
              className={`nb-canvas tool-${tool}`}
              data-testid="nb-canvas"
              style={{ width: W, height: H }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {editor && (
              <textarea
                ref={editorInput}
                className="nb-text-editor"
                data-testid="nb-text-editor"
                aria-label="Page text"
                autoFocus
                rows={1}
                value={editor.value}
                style={{
                  left: editor.x * scale,
                  top: editor.y * scale - TEXT_SIZE * 0.125 * scale,
                  width: editor.width * scale,
                  fontSize: TEXT_SIZE * scale,
                  color: ink,
                }}
                onChange={(event) => openEditor({ ...editor, value: event.target.value })}
                onBlur={commitText}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') { event.preventDefault(); cancelText(); }
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); commitText(); }
                }}
              />
            )}
            {flip && (
              <div className={`nb-flip ${flip.dir}`} data-testid="nb-flip" onAnimationEnd={endFlip}>
                <img className="nb-flip-face" src={flip.src} alt="" draggable={false} />
                <div className="nb-flip-face nb-flip-back" />
              </div>
            )}
          </div>
          <Spiral scale={scale} width={W} />
          <div className="nb-count" data-testid="nb-page-count">{nb.current + 1} / {nb.pages.length}</div>
        </div>
      </main>

      {toast && <div className="nb-toast" role="status">{toast}</div>}
      {saveError && (
        <div className="nb-save-error" role="alert" data-testid="nb-save-error">
          <span>{saveError} Back up now so nothing is lost.</span>
          <button onClick={backupAll}>Back up</button>
          <button onClick={() => persist(stateRef.current)}>Retry</button>
        </div>
      )}

      <footer className="nb-toolbar" data-testid="nb-toolbar">
        <div className="nb-group">
          {TOOLS.map(({ id, icon: Icon, label, key }) => (
            <button key={id} className={`nb-icon ${tool === id ? 'on' : ''}`} aria-label={label} aria-pressed={tool === id} title={`${label} (${key})`} data-testid={`nb-tool-${id}`} onClick={() => { commitText(); setTool(id); }}>
              <Icon size={19} />
            </button>
          ))}
        </div>
        {/* Hidden rather than removed, so the toolbar never changes size and the page never jumps. */}
        <div className="nb-group" style={tool === 'eraser' ? { visibility: 'hidden' } : undefined} aria-hidden={tool === 'eraser'}>
          {colors.map(({ color, label }) => (
            <button key={color} className={`nb-swatch ${activeColor === color ? 'on' : ''}`} style={{ background: color }} aria-label={label} aria-pressed={activeColor === color} tabIndex={tool === 'eraser' ? -1 : 0} onClick={() => setColor(color)} />
          ))}
        </div>
        <div className="nb-group" style={tool === 'pen' ? undefined : { visibility: 'hidden' }} aria-hidden={tool !== 'pen'}>
          {WIDTHS.map((item) => (
            <button key={item.id} className={`nb-icon ${width === item.width ? 'on' : ''}`} aria-label={`${item.label} stroke`} aria-pressed={width === item.width} tabIndex={tool === 'pen' ? 0 : -1} onClick={() => setWidth(item.width)}>
              <span className="nb-dot" style={{ width: item.width * 2 + 3, height: item.width * 2 + 3 }} />
            </button>
          ))}
        </div>
        <div className="nb-group">
          <button className="nb-icon" aria-label="Undo" title="Undo" disabled={!hist.past.length} onClick={undo}><Undo2 size={18} /></button>
          <button className="nb-icon" aria-label="Redo" title="Redo" disabled={!hist.future.length} onClick={redo}><Redo2 size={18} /></button>
        </div>
        <div className="nb-group">
          <button className="nb-icon" aria-label="Previous page" title="Previous page (←)" data-testid="nb-prev" disabled={nb.current === 0} onClick={() => goTo(nb.current - 1)}><ChevronLeft size={19} /></button>
          <button className="nb-icon" aria-label="Next page" title="Next page (→)" data-testid="nb-next" disabled={lastPage} onClick={() => goTo(nb.current + 1)}><ChevronRight size={19} /></button>
          <button className="nb-icon" aria-label="New page" title="New page" data-testid="nb-add" onClick={addPage}><FilePlus2 size={18} /></button>
        </div>
        <div className="nb-group">
          <div className="nb-menu-anchor">
            <button className={`nb-icon ${panel === 'paper' ? 'on' : ''}`} aria-label="Paper style" title="Paper style" data-testid="nb-paper" onClick={() => setPanel(panel === 'paper' ? null : 'paper')}><Grid3X3 size={18} /></button>
            {panel === 'paper' && (
              <div className="nb-popover" data-testid="nb-paper-menu">
                {PAPERS.map((paper) => (
                  <button key={paper.id} className={nb.paper === paper.id ? 'on' : ''} data-testid={`nb-paper-${paper.id}`} onClick={() => { patchNotebook(nb.id, (n) => ({ ...n, paper: paper.id })); setPanel(null); }}>
                    <span>{paper.label}</span>{nb.paper === paper.id && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="nb-icon" aria-label="Save page as PNG" title="Save page as PNG" onClick={downloadPage}><Download size={18} /></button>
          <div className="nb-menu-anchor">
            <button className={`nb-icon ${panel === 'tear' ? 'on' : ''}`} aria-label={nb.pages.length === 1 ? 'Clear page' : 'Tear off page'} title={nb.pages.length === 1 ? 'Clear page' : 'Tear off page'} data-testid="nb-tear" onClick={() => setPanel(panel === 'tear' ? null : 'tear')}><Scissors size={18} /></button>
            {panel === 'tear' && (
              <div className="nb-popover nb-confirm" data-testid="nb-tear-confirm">
                <span>{nb.pages.length === 1 ? 'Clear this page?' : 'Tear off this page?'}</span>
                <div>
                  <button onClick={() => setPanel(null)} aria-label="Keep page"><X size={14} /></button>
                  <button className="danger" onClick={tearOff} data-testid="nb-tear-yes" aria-label="Confirm"><Check size={14} /></button>
                </div>
              </div>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
