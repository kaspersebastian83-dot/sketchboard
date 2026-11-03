import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let html = await readFile(path.join(root, 'dist', 'index.html'), 'utf8');

const scriptMatch = html.match(/<script type="module" crossorigin src="([^"]+)"><\/script>/);
const styleMatch = html.match(/<link rel="stylesheet" crossorigin href="([^"]+)">/);
if (!scriptMatch || !styleMatch) throw new Error('Could not find the built JavaScript and CSS assets.');

const [javascript, css, fontLicense] = await Promise.all([
  readFile(path.join(root, 'dist', scriptMatch[1]), 'utf8'),
  readFile(path.join(root, 'dist', styleMatch[1]), 'utf8'),
  readFile(path.join(root, 'src', 'assets', 'fonts', 'OFL.txt'), 'utf8'),
]);

html = html
  // Insert the font license first, while </head> can only be the real tag —
  // the inlined bundle below may itself contain the literal string "</head>".
  .replace('</head>', `    <!-- Self-contained build: no server, network, or installation required. -->\n    <script type="text/plain" id="virgil-font-license">${fontLicense.replace(/<\/script/gi, '<\\/script')}</script>\n  </head>`)
  .replace(scriptMatch[0], () => `<script type="module">\n${javascript.replace(/<\/script/gi, '<\\/script')}\n</script>`)
  .replace(styleMatch[0], () => `<style>\n${css}\n</style>`);

const output = path.join(root, 'sketchboard.html');
await writeFile(output, html);
console.log(`Created ${output} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);

// GitHub Pages serves the app from /docs — keep that copy in lockstep, and make
// it an installable, offline-capable app (manifest, icons, service worker).
// The double-click sketchboard.html stays a plain file: service workers need http(s).
const docsDir = path.join(root, 'docs');
await mkdir(path.join(docsDir, 'icons'), { recursive: true });
const pwaHead = [
  '<link rel="manifest" href="./manifest.webmanifest" />',
  '<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-title" content="Sketchboard" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
].map((tag) => `    ${tag}`).join('\n');
const docsHtml = html.replace('<meta name="description"', () => `${pwaHead.trimStart()}\n    <meta name="description"`);
if (docsHtml === html) throw new Error('Could not insert the PWA tags into the page head.');
await writeFile(path.join(docsDir, 'index.html'), docsHtml);
const version = createHash('sha256').update(docsHtml).digest('hex').slice(0, 12);
const sw = (await readFile(path.join(root, 'pwa', 'sw.js'), 'utf8')).replace('__VERSION__', version);
await writeFile(path.join(docsDir, 'sw.js'), sw);
await copyFile(path.join(root, 'pwa', 'manifest.webmanifest'), path.join(docsDir, 'manifest.webmanifest'));
for (const icon of await readdir(path.join(root, 'pwa', 'icons'))) {
  await copyFile(path.join(root, 'pwa', 'icons', icon), path.join(docsDir, 'icons', icon));
}
await writeFile(path.join(docsDir, '.nojekyll'), '');
console.log(`Created ${path.join(docsDir, 'index.html')} (GitHub Pages, installable app, offline version ${version})`);
