#!/usr/bin/env node
/**
 * Serveur LeCraft autonome : relais multijoueur + le jeu lui-même (dossier dist/).
 *
 *   npm run build        # une fois, pour servir le jeu aux navigateurs
 *   npm run server       # port 25580 par défaut (PORT=… pour changer)
 *
 * Les joueurs du réseau local ouvrent http://<adresse-du-PC>:25580 dans leur navigateur, ou
 * saisissent <adresse-du-PC>:25580 dans Multijoueur › Ajouter un serveur (application Android).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachRelay } from './relay.mjs';

const PORT = Number(process.env.PORT) || 25580;
const NAME = process.env.LECRAFT_NAME || 'Serveur LeCraft';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };

const server = createServer();
const relay = attachRelay(server, { name: NAME });
server.on('request', async (req, res) => {
  if (relay.handle(req, res)) return;
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(ROOT, url === '/' ? 'index.html' : url));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(url === '/' ? 'Jeu non construit : lancez « npm run build » puis relancez le serveur. Le relais multijoueur fonctionne quand même.' : 'Introuvable');
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[LeCraft] ${NAME} — relais multijoueur prêt sur le port ${PORT}`);
  for (const list of Object.values(networkInterfaces()))
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) console.log(`[LeCraft]   adresse à saisir dans le jeu : ${a.address}:${PORT}   (navigateur : http://${a.address}:${PORT})`);
});
