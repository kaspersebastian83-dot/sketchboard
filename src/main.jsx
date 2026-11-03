import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Notebook from './Notebook.jsx';
import { loadMode, saveMode } from './notebook.js';
import notebookIcon from './assets/notebook-icon.svg?raw';
import { decodeShareHash } from './share.js';
import './styles.css';

const THEME_COLORS = { notebook: '#e7dccb', board: '#ffffff' };
const clearHash = () => history.replaceState(null, '', window.location.pathname + window.location.search);

// Whiteboard and notebook are two views of the same local-first workspace;
// the last one used is remembered. #notebook and #board (used by the installed
// app's shortcuts) open one directly.
function Root() {
  const [mode, setMode] = useState(() => {
    if (window.__sharedScene) return 'board';
    if (window.location.hash === '#notebook') return 'notebook';
    if (window.location.hash === '#board') { clearHash(); return 'board'; }
    return loadMode();
  });
  const updateReady = useUpdateReady();
  useEffect(() => { if (!window.__sharedScene) saveMode(mode); }, [mode]);
  useEffect(() => {
    document.title = mode === 'notebook' ? 'Sketchboard — Notebook' : 'Sketchboard — Hand-drawn whiteboard';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[mode]);
    // The notebook carries its own app icon; the whiteboard keeps the one from index.html.
    const link = document.querySelector('link[rel="icon"]');
    if (!link) return;
    if (!link.dataset.boardHref) link.dataset.boardHref = link.getAttribute('href');
    link.setAttribute('href', mode === 'notebook' ? `data:image/svg+xml,${encodeURIComponent(notebookIcon)}` : link.dataset.boardHref);
  }, [mode]);
  return (
    <>
      {mode === 'notebook'
        ? <Notebook onExit={() => { if (window.location.hash === '#notebook') clearHash(); setMode('board'); }} />
        : <App onOpenNotebook={() => setMode('notebook')} />}
      {updateReady && (
        <div className="app-update" role="status" data-testid="app-update">
          <span>A new version is ready</span>
          <button onClick={applyUpdate}>Reload</button>
        </div>
      )}
    </>
  );
}

// --- Offline app (service worker) ---------------------------------------------
// Only the GitHub Pages build ships a manifest + sw.js; the dev server and the
// double-click file never register one.
let waitingWorker = null;
const updateListeners = new Set();
const notifyUpdate = (worker) => { waitingWorker = worker; updateListeners.forEach((fn) => fn(true)); };

function useUpdateReady() {
  const [ready, setReady] = useState(Boolean(waitingWorker));
  useEffect(() => { updateListeners.add(setReady); return () => updateListeners.delete(setReady); }, []);
  return ready;
}

function applyUpdate() {
  if (!waitingWorker) { window.location.reload(); return; }
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  waitingWorker.postMessage('skip-waiting');
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(window.location.protocol)) return;
  if (!document.querySelector('link[rel="manifest"]')) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    // A worker already waiting means an update was downloaded on an earlier visit.
    if (registration.waiting && navigator.serviceWorker.controller) notifyUpdate(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        // Only an *update* needs a prompt; the very first install just starts working.
        if (worker.state === 'installed' && navigator.serviceWorker.controller) notifyUpdate(worker);
      });
    });
    // Long-running sessions (an app left open all day) still pick up updates.
    setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
  } catch { /* Offline support is a bonus; the app works without it. */ }
}

async function boot() {
  if (window.location.hash.startsWith('#share=')) {
    try {
      const scene = await decodeShareHash(window.location.hash.slice('#share='.length));
      window.__sharedScene = { ...scene, source: 'link' };
    } catch { /* A corrupt hash simply starts a normal canvas. */ }
  }
  const root = document.getElementById('root');
  root.innerHTML = '';
  createRoot(root).render(<Root />);
  if (document.readyState === 'complete') registerServiceWorker();
  else window.addEventListener('load', registerServiceWorker, { once: true });
}

boot();
