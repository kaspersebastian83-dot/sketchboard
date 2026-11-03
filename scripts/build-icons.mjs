// Renders the PWA icon set from src/assets/notebook-icon.svg. Run once after
// changing the icon (needs Playwright's Chromium): node scripts/build-icons.mjs
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(path.join(root, 'src', 'assets', 'notebook-icon.svg'), 'utf8');
const BG = '<rect width="512" height="512" rx="116" fill="url(#bg)"/>';
if (!source.includes(BG)) throw new Error('Icon background rect not found');

// Full-bleed variants: the OS applies its own mask, so the square is filled
// edge to edge and the notebook is scaled into the safe zone.
const fullBleed = (scale) => source
  .replace(BG, `<rect width="512" height="512" fill="url(#bg)"/><g transform="translate(256 256) scale(${scale}) translate(-256 -256)">`)
  .replace('</svg>', '</g></svg>');

const icons = [
  { file: 'icon-192.png', size: 192, svg: source },
  { file: 'icon-512.png', size: 512, svg: source },
  { file: 'maskable-512.png', size: 512, svg: fullBleed(0.8) },
  { file: 'apple-touch-icon.png', size: 180, svg: fullBleed(0.94) },
];

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const icon of icons) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    const svg = icon.svg.replace('<svg ', `<svg width="${icon.size}" height="${icon.size}" `);
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.screenshot({ path: path.join(root, 'pwa', 'icons', icon.file), omitBackground: true });
    await page.close();
    console.log(`pwa/icons/${icon.file}`);
  }
} finally {
  await browser.close();
}
