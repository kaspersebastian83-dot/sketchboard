// Sharing: encode a scene into a URL hash, or bake it into a self-contained
// snapshot of the running standalone HTML. Both open read-only with a
// "save a copy" escape hatch — no server, no account.

export async function encodeShareHash(scene) {
  const json = JSON.stringify({ type: 'sketchboard', version: 1, elements: scene.elements, camera: scene.camera, theme: scene.theme });
  const bytes = new TextEncoder().encode(json);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const byte of compressed) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeShareHash(encoded) {
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const scene = JSON.parse(await new Response(stream).text());
  if (!scene || !Array.isArray(scene.elements)) throw new Error('Invalid share link');
  return scene;
}

export function buildSnapshotHtml(scene, { dev = false } = {}) {
  if (dev || typeof document === 'undefined') return null;
  // Inject right before the inlined module bundle so the payload runs first.
  // (A naive "</head>" match would hit the bundle's own source text instead.)
  const bundle = [...document.querySelectorAll('script[type="module"]')].find((script) => !script.src);
  if (!bundle) return null;
  const source = document.documentElement.outerHTML;
  const marker = '<script type="module">';
  const at = source.indexOf(marker);
  if (at === -1) return null;
  const payload = JSON.stringify({ ...scene, source: 'snapshot' }).replace(/</g, '\\u003c');
  const tag = `<script>window.__sharedScene = ${payload};</script>`;
  return source.slice(0, at) + tag + source.slice(at);
}
