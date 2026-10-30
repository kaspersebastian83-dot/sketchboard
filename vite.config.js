import { defineConfig } from 'vite';
import { attachCollabServer } from './server/collab.mjs';

// The standalone HTML build has no server to collaborate through, so the
// client compiles live sharing away entirely.
const standalone = process.env.SKETCHBOARD_STANDALONE === '1';

export default defineConfig({
  define: {
    __SKETCHBOARD_COLLAB__: standalone ? 'false' : 'true',
  },
  build: {
    // Keep the handwritten font inside the CSS so standalone HTML stays offline-capable.
    assetsInlineLimit: 100000,
  },
  plugins: [
    {
      name: 'sketchboard-collab',
      configureServer(server) {
        if (standalone) return;
        if (server.httpServer) attachCollabServer(server.httpServer);
      },
    },
  ],
});
