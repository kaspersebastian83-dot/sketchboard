import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { decodeShareHash } from './share.js';
import './styles.css';

async function boot() {
  if (window.location.hash.startsWith('#share=')) {
    try {
      const scene = await decodeShareHash(window.location.hash.slice('#share='.length));
      window.__sharedScene = { ...scene, source: 'link' };
    } catch { /* A corrupt hash simply starts a normal canvas. */ }
  }
  const root = document.getElementById('root');
  root.innerHTML = '';
  createRoot(root).render(<App />);
}

boot();
