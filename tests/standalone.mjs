import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, offline: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.join(root, 'sketchboard.html')).href);
  await expect(page.getByText('A quiet canvas for loud ideas.')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('24px Virgil'))).toBe(true);

  await page.getByTestId('tool-rectangle').click();
  await page.mouse.move(430, 300);
  await page.mouse.down();
  await page.mouse.move(610, 430, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (globalThis.__ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1')), globalThis.__ws.boards.find((b) => b.id === globalThis.__ws.activeBoardId)).elements.length)).toBe(1);

  await page.getByTestId('tool-text').click();
  await page.mouse.click(450, 520);
  await page.locator('.text-editor').fill('Automatic wrapping keeps longer ideas easy to read');
  await page.locator('.text-editor').press('ControlOrMeta+B');
  await page.locator('.text-editor').press('ControlOrMeta+I');
  await page.locator('.text-editor').press('ControlOrMeta+Enter');
  await expect.poll(() => page.evaluate(() => (globalThis.__ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1')), globalThis.__ws.boards.find((b) => b.id === globalThis.__ws.activeBoardId)).elements.length)).toBe(2);
  await expect.poll(() => page.evaluate(() => {
    const element = (globalThis.__ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1')), globalThis.__ws.boards.find((b) => b.id === globalThis.__ws.activeBoardId)).elements.at(-1);
    return `${element.fontWeight}:${element.fontStyle}`;
  })).toBe('700:italic');
  await page.keyboard.press('ControlOrMeta+Shift+C');
  await expect.poll(() => page.evaluate(() => (globalThis.__ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1')), globalThis.__ws.boards.find((b) => b.id === globalThis.__ws.activeBoardId)).elements.at(-1).textAlign)).toBe('center');
  await page.getByLabel('Text size 48 pixels').click();
  await expect.poll(() => page.evaluate(() => (globalThis.__ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1')), globalThis.__ws.boards.find((b) => b.id === globalThis.__ws.activeBoardId)).elements.at(-1).fontSize)).toBe(48);
  await page.getByLabel('Line height 1.5').click();
  await expect.poll(() => page.evaluate(() => (globalThis.__ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1')), globalThis.__ws.boards.find((b) => b.id === globalThis.__ws.activeBoardId)).elements.at(-1).lineHeight)).toBe(1.5);
  expect(await page.evaluate(() => (globalThis.__ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1')), globalThis.__ws.boards.find((b) => b.id === globalThis.__ws.activeBoardId)).elements.at(-1).width)).toBe(260);

  await page.keyboard.press('ControlOrMeta+Shift+L');
  await expect.poll(() => page.evaluate(() => (globalThis.__ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1')), globalThis.__ws.boards.find((b) => b.id === globalThis.__ws.activeBoardId)).elements.at(-1).textAlign)).toBe('left');
  const handle = await page.evaluate(() => {
    const el = (globalThis.__ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1')), globalThis.__ws.boards.find((b) => b.id === globalThis.__ws.activeBoardId)).elements.at(-1);
    const natural = (line, fs) => line.length * fs * 0.57;
    const wrapLine = (line, fs, maxW) => {
      if (!maxW || natural(line, fs) <= maxW) return [line];
      const wrapped = [];
      let current = '';
      for (const word of line.split(' ')) {
        const candidate = current ? `${current} ${word}` : word;
        if (natural(candidate, fs) <= maxW || !current) {
          current = candidate;
          continue;
        }
        wrapped.push(current);
        current = word;
      }
      if (current) wrapped.push(current);
      return wrapped.length ? wrapped : [''];
    };
    const lines = el.text.split('\n').flatMap((line) => wrapLine(line, el.fontSize, el.width));
    const lineHeight = el.lineHeight || 1.25;
    const width = Math.max(24, ...lines.map((line) => natural(line, el.fontSize)));
    const height = Math.max(el.fontSize * lineHeight, lines.length * el.fontSize * lineHeight);
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return { x: rect.left + el.x + width, y: rect.top + el.y + height / 2 };
  });
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 80, handle.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (globalThis.__ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1')), globalThis.__ws.boards.find((b) => b.id === globalThis.__ws.activeBoardId)).elements.at(-1).width)).toBeGreaterThan(260);
  await page.keyboard.press('ControlOrMeta+Shift+C');
  await expect.poll(() => page.evaluate(() => (globalThis.__ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1')), globalThis.__ws.boards.find((b) => b.id === globalThis.__ws.activeBoardId)).elements.at(-1).textAlign)).toBe('center');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(root, 'tests', 'standalone-font.png') });

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /PNG image/ }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('sketchboard.png');
  const svgDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /SVG vector/ }).click();
  const svgDownload = await svgDownloadPromise;
  expect(svgDownload.suggestedFilename()).toBe('sketchboard.svg');
  const svg = await readFile(await svgDownload.path(), 'utf8');
  expect(svg).toContain('text-anchor="middle"');
  expect(svg).toContain('font-weight="700"');
  expect(svg).toContain('font-style="italic"');
  expect((svg.match(/<tspan/g) || []).length).toBeGreaterThan(1);

  // Sharing: a snapshot file carries the board and opens read-only, offline.
  await page.getByLabel('Close dialog').click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const snapshotPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Snapshot file/ }).click();
  const snapshotDownload = await snapshotPromise;
  expect(snapshotDownload.suggestedFilename()).toBe('sketchboard-board.html');
  const snapshotPath = path.join(root, 'tests', 'shared-snapshot.html');
  await snapshotDownload.saveAs(snapshotPath);
  const snapshotHtml = await readFile(snapshotPath, 'utf8');
  expect(snapshotHtml).toContain('window.__sharedScene');
  const guest = await context.newPage();
  await guest.goto(pathToFileURL(snapshotPath).href);
  await expect(guest.getByText("You're viewing a shared board")).toBeVisible();
  await guest.getByRole('button', { name: 'Save a copy' }).click();
  await expect.poll(() => guest.evaluate(() => (globalThis.__ws = JSON.parse(localStorage.getItem('sketchboard-workspace-v1')), globalThis.__ws.boards.find((b) => b.id === globalThis.__ws.activeBoardId))?.elements.length ?? 0)).toBe(2);
  await expect(guest.getByText("You're viewing a shared board")).toBeHidden();

  expect(errors).toEqual([]);
  console.log('PASS: standalone HTML opens offline, wraps and spaces handwritten text, persists locally, and exports PNG/SVG.');
} finally {
  await browser.close();
}
