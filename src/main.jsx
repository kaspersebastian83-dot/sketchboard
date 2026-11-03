import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Notebook from './Notebook.jsx';
import { loadMode, saveMode } from './notebook.js';
import { decodeShareHash } from './share.js';
import './styles.css';

// Whiteboard and notebook are two views of the same local-first workspace;
// the last one used is remembered, and #notebook opens the pad directly.
function Root() {
  const [mode, setMode] = useState(() => {
    if (window.__sharedScene) return 'board';
    return window.location.hash === '#notebook' ? 'notebook' : loadMode();
  });
  useEffect(() => { if (!window.__sharedScene) saveMode(mode); }, [mode]);
  useEffect(() => {
    document.title = mode === 'notebook' ? 'Sketchboard — Notebook' : 'Sketchboard — Hand-drawn whiteboard';
  }, [mode]);
  return mode === 'notebook'
    ? <Notebook onExit={() => { if (window.location.hash === '#notebook') history.replaceState(null, '', window.location.pathname + window.location.search); setMode('board'); }} />
    : <App onOpenNotebook={() => setMode('notebook')} />;
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
}

boot();
