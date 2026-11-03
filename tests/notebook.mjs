import { chromium, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Runs in the page: { activeId, notebooks } from IndexedDB, in notebook order.
export const readStore = () => new Promise((resolve) => {
  const open = indexedDB.open('sketchboard');
  open.onerror = () => resolve(null);
  open.onupgradeneeded = () => { open.transaction.abort(); resolve(null); };
  open.onsuccess = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('notebooks')) { db.close(); resolve(null); return; }
    const tx = db.transaction(['notebooks', 'meta']);
    const all = tx.objectStore('notebooks').getAll();
    const active = tx.objectStore('meta').get('activeId');
    tx.oncomplete = () => {
      db.close();
      const notebooks = all.result.sort((a, b) => a.order - b.order);
      resolve(notebooks.length ? { activeId: active.result, notebooks } : null);
    };
  };
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.NOTEBOOK_SHOTS || '';
if (isMain) {
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 420, height: 860 }, offline: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.join(root, 'sketchboard.html')).href);
  await expect(page.getByText('A quiet canvas for loud ideas.')).toBeVisible();

  // Migration: a notebook saved by the older localStorage version moves into
  // IndexedDB on first open, and the old key is freed for the whiteboard.
  await page.evaluate(() => localStorage.setItem('sketchboard-notebooks-v1', JSON.stringify({
    version: 1, activeId: 'nb-old', notebooks: [{ id: 'nb-old', name: 'Old pad', paper: 'lines', current: 0, pages: [{ id: 'p-old', elements: [] }] }],
  })));
  await page.getByLabel('Main menu').click();
  await page.getByTestId('open-notebook').click();
  await expect(page.getByTestId('nb-title')).toHaveText('Old pad');
  expect((await page.evaluate(readStore)).notebooks[0].name).toBe('Old pad');
  expect(await page.evaluate(() => localStorage.getItem('sketchboard-notebooks-v1'))).toBe(null);
  // Start the real run from an empty store.
  await page.getByTestId('nb-exit').click();
  await page.evaluate(() => new Promise((resolve) => { const r = indexedDB.deleteDatabase('sketchboard'); r.onsuccess = r.onerror = r.onblocked = resolve; }));
  await page.reload();
  await expect(page.getByText('A quiet canvas for loud ideas.')).toBeVisible();

  // Open the notebook from the main menu.
  await page.getByLabel('Main menu').click();
  await page.getByTestId('open-notebook').click();
  await expect(page.getByTestId('notebook')).toBeVisible();
  await expect(page.getByTestId('nb-page-count')).toHaveText('1 / 1');

  // Reads what is actually on disk (IndexedDB). Saves are debounced, so an
  // empty store just means "not written yet".
  const EMPTY = { notebooks: [{ name: '', paper: '', pages: [{ elements: [] }] }, { name: '' }] };
  const read = async () => (await page.evaluate(readStore)) || EMPTY;
  const canvas = page.getByTestId('nb-canvas');
  const box = await canvas.boundingBox();
  expect(Math.abs(box.height / box.width - 592 / 420)).toBeLessThan(0.02); // A6 proportions

  // Pen stroke.
  await page.mouse.move(box.x + 40, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 120, { steps: 12 });
  await page.mouse.move(box.x + 220, box.y + 90, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await read()).notebooks[0].pages[0].elements.length).toBe(1);
  expect((await read()).notebooks[0].pages[0].elements[0].type).toBe('freedraw');

  // Text.
  await page.getByTestId('nb-tool-text').click();
  await page.mouse.click(box.x + 40, box.y + 200);
  await page.getByTestId('nb-text-editor').fill('Probe 14: Chlorid 7 µg/cm²');
  await page.getByTestId('nb-text-editor').press('ControlOrMeta+Enter');
  await expect.poll(async () => (await read()).notebooks[0].pages[0].elements.length).toBe(2);

  // Highlighter.
  await page.getByTestId('nb-tool-highlighter').click();
  await page.mouse.move(box.x + 36, box.y + 214);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 214, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await read()).notebooks[0].pages[0].elements.length).toBe(3);

  // Undo / redo.
  await page.getByLabel('Undo').click();
  await expect.poll(async () => (await read()).notebooks[0].pages[0].elements.length).toBe(2);
  await page.getByLabel('Redo').click();
  await expect.poll(async () => (await read()).notebooks[0].pages[0].elements.length).toBe(3);

  // Eraser removes the pen stroke (and switching tools must not move the page).
  await page.getByTestId('nb-tool-eraser').click();
  expect(await canvas.boundingBox()).toEqual(box);
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 110, box.y + 104, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await read()).notebooks[0].pages[0].elements.length).toBe(2);

  if (shots) await page.screenshot({ path: path.join(shots, 'nb-page1.png') });

  // New page flips; page count and navigation follow.
  await page.getByTestId('nb-add').click();
  await expect(page.getByTestId('nb-page-count')).toHaveText('2 / 2');
  if (shots) { await page.waitForTimeout(250); await page.screenshot({ path: path.join(shots, 'nb-flip.png') }); }
  await expect(page.getByTestId('nb-flip')).toHaveCount(0);
  await page.getByTestId('nb-prev').click();
  await expect(page.getByTestId('nb-flip')).toHaveCount(0);
  await expect(page.getByTestId('nb-page-count')).toHaveText('1 / 2');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('nb-page-count')).toHaveText('2 / 2');
  await expect(page.getByTestId('nb-flip')).toHaveCount(0);

  // Paper style applies to the whole notebook.
  await page.getByTestId('nb-paper').click();
  await page.getByTestId('nb-paper-dots').click();
  await expect.poll(async () => (await read()).notebooks[0].paper).toBe('dots');

  // Tear off page 2 (it was empty); back to a single page.
  await page.getByTestId('nb-tear').click();
  await page.getByTestId('nb-tear-yes').click();
  await expect(page.getByTestId('nb-page-count')).toHaveText('1 / 1');
  await expect(page.getByTestId('nb-flip')).toHaveCount(0);

  // A second notebook, then reload: everything persists and the notebook reopens.
  await page.getByTestId('nb-notebooks').click();
  await page.getByTestId('nb-new-notebook').click();
  await expect.poll(async () => (await read()).notebooks.length).toBe(2);
  await page.getByTestId('nb-title').click();
  await page.getByLabel('Notebook name').fill('Brandschaden Nord');
  await page.getByLabel('Notebook name').press('Enter');
  await expect.poll(async () => (await read()).notebooks[1].name).toBe('Brandschaden Nord');
  await page.reload();
  await expect(page.getByTestId('notebook')).toBeVisible();
  await expect(page.getByTestId('nb-title')).toHaveText('Brandschaden Nord');
  await page.getByTestId('nb-notebooks').click();
  await page.locator('.nb-book-open', { hasText: 'Pocket notes' }).click();
  await expect(page.getByTestId('nb-page-count')).toHaveText('1 / 1');
  expect((await read()).notebooks[0].pages[0].elements.length).toBe(2);

  // Backup: download everything, then restore an edited copy of one notebook.
  await page.getByTestId('nb-notebooks').click();
  await expect(page.getByTestId('nb-storage')).toContainText('Saved on this device');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('nb-backup').click()]);
  const backup = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'));
  expect(backup.app).toBe('sketchboard-notebooks');
  expect(backup.notebooks.length).toBe(2);
  // Same backup again: nothing new, nothing duplicated.
  await page.getByTestId('nb-restore-input').setInputFiles({ name: 'same.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByRole('status')).toHaveText('Nothing new in that backup');
  expect((await read()).notebooks.length).toBe(2);
  // An edited copy comes in as a separate notebook; existing ones are never overwritten.
  backup.notebooks[0].pages[0].elements = [];
  await page.getByTestId('nb-restore-input').setInputFiles({ name: 'edited.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect.poll(async () => (await read()).notebooks.length).toBe(3);
  expect((await read()).notebooks[0].pages[0].elements.length).toBe(2);
  expect((await read()).notebooks[2].name).toContain('(imported)');
  // Garbage is rejected with a message.
  await page.getByTestId('nb-restore-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByRole('status')).toHaveText('That file is not a notebook backup.');
  expect((await read()).notebooks.length).toBe(3);
  await page.keyboard.press('Escape');

  // Back to the whiteboard.
  await page.getByTestId('nb-exit').click();
  await expect(page.getByTestId('tool-rectangle')).toBeVisible();

  expect(errors).toEqual([]);
  console.log('notebook tests passed');
} finally {
  await browser.close();
}
}
