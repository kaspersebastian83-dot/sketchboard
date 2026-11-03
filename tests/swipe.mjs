// Swipe to flip: real touch input (via Chromium's input protocol, so two-finger
// gestures are genuine multi-touch), plus mouse-drag on the desk and the wheel.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStore } from './notebook.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.NOTEBOOK_SHOTS || '';
const html = await readFile(path.join(root, 'sketchboard.html'));
const server = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(html));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const context = await browser.newContext({ viewport: { width: 820, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await expect(page.getByTestId('notebook')).toBeVisible();
  const cdp = await context.newCDPSession(page);

  const count = page.getByTestId('nb-page-count');
  const settled = () => expect(page.getByTestId('nb-flip')).toHaveCount(0);
  const elementsOn = async (index) => (await page.evaluate(readStore))?.notebooks[0].pages[index].elements.length ?? 0;
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  // Moves a set of fingers by (dx, dy) over `steps` frames, `ms` apart; `pause` holds still before lifting.
  async function swipe(starts, dy, { steps = 12, ms = 16, pause = 0, dx = 0, beforeLift } = {}) {
    await touch('touchStart', starts);
    for (let i = 1; i <= steps; i += 1) {
      await touch('touchMove', starts.map(([x, y]) => [x + (dx * i) / steps, y + (dy * i) / steps]));
      await page.waitForTimeout(ms);
    }
    if (beforeLift) await beforeLift();
    if (pause) await page.waitForTimeout(pause);
    await touch('touchEnd', []);
  }

  // Three pages, then back to page 1.
  await page.getByTestId('nb-add').click();
  await settled();
  await page.getByTestId('nb-add').click();
  await settled();
  await expect(count).toHaveText('3 / 3');
  await page.keyboard.press('ArrowLeft');
  await settled();
  await page.keyboard.press('ArrowLeft');
  await settled();
  await expect(count).toHaveText('1 / 3');

  const box = await page.getByTestId('nb-canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const low = box.y + box.height * 0.8;
  const high = box.y + box.height * 0.25;

  // One finger on the paper draws — it never flips.
  await swipe([[cx, low]], -240);
  await expect.poll(() => elementsOn(0)).toBe(1);
  await expect(count).toHaveText('1 / 3');
  await expect(page.getByRole('status')).toContainText('two fingers'); // one-time tip on the first finger stroke

  // Two fingers up: next page, and the half-started stroke from the first finger is dropped.
  await swipe([[cx - 40, low], [cx + 40, low]], -300, { beforeLift: async () => {
    // Mid-swipe the page is lifted part-way over the spiral.
    const angle = await page.evaluate(() => Number(/rotateX\(([-\d.]+)deg\)/.exec(document.querySelector('[data-testid=nb-flip]')?.style.transform || '')?.[1]));
    expect(angle).toBeGreaterThan(60);
    expect(angle).toBeLessThan(180);
    if (shots) await page.screenshot({ path: path.join(shots, 'nb-swipe-mid.png') });
  } });
  await settled();
  await expect(count).toHaveText('2 / 3');
  expect(await elementsOn(0)).toBe(1);
  expect(await elementsOn(1)).toBe(0);

  // A short, slow two-finger nudge drops back: no page change.
  await swipe([[cx - 40, low], [cx + 40, low]], -70, { steps: 10, ms: 20, pause: 150 });
  await settled();
  await expect(count).toHaveText('2 / 3');

  // A short but quick flick does turn the page.
  await swipe([[cx - 40, low], [cx + 40, low]], -90, { steps: 4, ms: 8 });
  await settled();
  await expect(count).toHaveText('3 / 3');

  // Last page: the pad gives a little, springs back, and says why.
  await swipe([[cx - 40, low], [cx + 40, low]], -200);
  await settled();
  await expect(count).toHaveText('3 / 3');
  await expect(page.getByRole('status')).toHaveText('Last page · tap ＋ to add one');
  await expect.poll(() => page.evaluate(() => document.querySelector('.nb-pad').style.transform)).toBe('');

  // Two fingers down: previous page.
  await swipe([[cx - 40, high], [cx + 40, high]], 320);
  await settled();
  await expect(count).toHaveText('2 / 3');

  // Sideways is not a flip.
  await swipe([[cx - 100, low], [cx + 0, low]], -20, { dx: 200 });
  await settled();
  await expect(count).toHaveText('2 / 3');

  // One finger on the desk beside the paper flips too.
  const deskX = box.x - 70;
  await swipe([[deskX, low]], -320);
  await settled();
  await expect(count).toHaveText('3 / 3');
  await swipe([[deskX, high]], 320);
  await settled();
  await expect(count).toHaveText('2 / 3');

  // So does a mouse drag on the desk.
  await page.mouse.move(deskX, low);
  await page.mouse.down();
  await page.mouse.move(deskX, low - 330, { steps: 14 });
  await page.mouse.up();
  await settled();
  await expect(count).toHaveText('3 / 3');

  // Wheel / trackpad: one page per gesture, however many events it sends.
  await page.mouse.move(cx, box.y + box.height / 2);
  for (let i = 0; i < 8; i += 1) { await page.mouse.wheel(0, -40); await page.waitForTimeout(20); }
  await settled();
  await expect(count).toHaveText('2 / 3');
  await page.waitForTimeout(350); // gesture over
  await page.mouse.wheel(0, -120);
  await settled();
  await expect(count).toHaveText('1 / 3');

  // Once a stylus has been used, one finger anywhere flips (fingers stop drawing)…
  const pen = (type, x, y) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen' });
  await pen('mousePressed', cx - 60, box.y + 120);
  for (let i = 1; i <= 8; i += 1) await pen('mouseMoved', cx - 60 + i * 12, box.y + 120 + i * 3);
  await pen('mouseReleased', cx + 36, box.y + 144);
  await expect.poll(() => elementsOn(0)).toBe(2);
  // …but not while the hand is still resting from writing (palm rejection).
  await swipe([[cx, low]], -300, { steps: 6 });
  await settled();
  await expect(count).toHaveText('1 / 3');
  await page.waitForTimeout(700);
  await swipe([[cx, low]], -300);
  await settled();
  await expect(count).toHaveText('2 / 3');
  expect(await elementsOn(0)).toBe(2);
  expect(await elementsOn(1)).toBe(0);

  expect(errors).toEqual([]);
  console.log('PASS: swipe up/down flips pages (two fingers, desk, stylus mode, mouse, wheel); drawing, nudges, edges and palms are handled.');
} finally {
  await browser.close();
  server.close();
}
