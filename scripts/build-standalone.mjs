import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

// GitHub Pages serves the app from /docs — keep that copy in lockstep.
const docsDir = path.join(root, 'docs');
await mkdir(docsDir, { recursive: true });
await writeFile(path.join(docsDir, 'index.html'), html);
console.log(`Created ${path.join(docsDir, 'index.html')} (GitHub Pages)`);
