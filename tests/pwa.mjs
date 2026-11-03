// Installable/offline app: serves docs/ the way GitHub Pages does (under a
// sub-path), lets the service worker install, then kills the server and checks
// the app — and the notebook's saved ink — still open. Also checks the update
// prompt when a new version is deployed.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStore } from './notebook.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const BASE = '/sketchboard/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
let swOverride = null;

function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith(BASE)) { res.writeHead(404).end(); return; }
    let rel = url.pathname.slice(BASE.length) || 'index.html';
    try {
      let body = await readFile(path.join(root, rel));
      if (rel === 'sw.js' && swOverride) body = Buffer.from(swOverride(body.toString()));
      res.writeHead(200, { 'content-type': TYPES[path.extname(rel)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

let server = await startServer();
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  // Manifest and icons are reachable relative to the page.
  const manifest = await (await page.request.get(`${origin}${BASE}manifest.webmanifest`)).json();
  expect(manifest.display).toBe('standalone');
  for (const icon of [...manifest.icons, { src: 'icons/apple-touch-icon.png' }]) {
    expect((await page.request.get(`${origin}${BASE}${icon.src}`)).status()).toBe(200);
  }

  await page.goto(`${origin}${BASE}#notebook`);
  await expect(page.getByTestId('notebook')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  expect(await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.href)).toBe(`${origin}${BASE}manifest.webmanifest`);

  // Write something.
  const box = await page.getByTestId('nb-canvas').boundingBox();
  await page.mouse.move(box.x + 40, box.y + 90);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 130, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await page.evaluate(readStore))?.notebooks[0].pages[0].elements.length).toBe(1);

  // Server gone, network off: the app still opens, with the ink.
  await new Promise((resolve) => server.close(resolve));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('notebook')).toBeVisible();
  await page.getByTestId('nb-exit').click();
  await expect(page.getByTestId('tool-rectangle')).toBeVisible();
  await page.getByLabel('Main menu').click();
  await page.getByTestId('open-notebook').click();
  expect((await page.evaluate(readStore)).notebooks[0].pages[0].elements.length).toBe(1);

  // A new deploy: the page offers a reload instead of swapping mid-session.
  swOverride = (text) => text.replace(/const VERSION = '([^']+)'/, "const VERSION = 'next-$1'");
  server = await startServer(port);
  await context.setOffline(false);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await expect(page.getByTestId('app-update')).toBeVisible({ timeout: 15000 });
  await Promise.all([page.waitForEvent('load'), page.getByTestId('app-update').getByRole('button', { name: 'Reload' }).click()]);
  await expect(page.getByTestId('notebook')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).join(','))).toMatch(/^sketchboard-next-/);
  expect((await page.evaluate(readStore)).notebooks[0].pages[0].elements.length).toBe(1);

  expect(errors).toEqual([]);
  console.log('PASS: installable app works offline, keeps notebook data, and prompts for updates.');
} finally {
  await browser.close();
  server.close();
}
