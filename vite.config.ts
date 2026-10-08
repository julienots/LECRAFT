import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
// @ts-expect-error module JavaScript du relais (sans types)
import { attachRelay } from './server/relay.mjs';

/** Relais multijoueur servi par le serveur de développement (npm run dev) : même adresse que le jeu. */
function lecraftRelay(): Plugin {
  return {
    name: 'lecraft-relay',
    configureServer(server) {
      if (!server.httpServer) return;
      const relay = attachRelay(server.httpServer, { name: 'LeCraft (dev)' });
      server.middlewares.use((req, res, next) => (relay.handle(req, res) ? undefined : next()));
    },
    configurePreviewServer(server) {
      const relay = attachRelay(server.httpServer, { name: 'LeCraft (aperçu)' });
      server.middlewares.use((req, res, next) => (relay.handle(req, res) ? undefined : next()));
    },
  };
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Build entièrement relatif : les fichiers sont servis depuis le WebView Capacitor (hors ligne).
export default defineConfig({
  base: './',
  plugins: [lecraftRelay()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    sourcemap: false,
  },
  worker: { format: 'es' },
  server: { host: true, port: 5173 },
});
