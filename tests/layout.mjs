// Top bar layout: the left group (menu, Notebook, Boards, Frames), the drawing
// toolbar and the right group must never overlap, from small phones to wide desktops.
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIDTHS = [320, 360, 375, 390, 430, 640, 700, 800, 900, 960, 979, 980, 1024, 1100, 1280, 1340, 1360, 1440, 1479, 1480, 1600, 1920];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const failures = [];
try {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    await context.addInitScript(() => localStorage.setItem('sketchboard-mode-v1', 'board'));
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.join(root, 'sketchboard.html')).href);
    await page.waitForSelector('[data-testid=open-notebook-bar]');
    await page.evaluate(() => document.fonts.ready);
    const clashes = await page.evaluate(() => {
      const visible = (selector) => [...document.querySelectorAll(selector)].filter((el) => el.offsetParent).map((el) => el.getBoundingClientRect());
      const groups = { left: visible('.top-left > button'), toolbar: visible('.toolbar'), right: visible('.top-right > button, .top-right > div > button') };
      const overlaps = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      return [['left', 'toolbar'], ['left', 'right'], ['toolbar', 'right']]
        .filter(([x, y]) => groups[x].some((a) => groups[y].some((b) => overlaps(a, b))))
        .map((pair) => pair.join(' vs '));
    });
    const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (clashes.length || scrolls) failures.push(`${width}px: ${[...clashes, scrolls ? 'horizontal scroll' : ''].filter(Boolean).join(', ')}`);
    await context.close();
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`FAIL: top bar overlaps at\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`PASS: top bar fits without overlaps at ${WIDTHS.length} widths (${WIDTHS[0]}–${WIDTHS.at(-1)}px).`);
