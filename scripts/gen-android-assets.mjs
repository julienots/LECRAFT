// Génère les icônes Android (legacy + adaptatives) et les splash screens à partir
// des textures procédurales du jeu, rendues dans Chromium. Usage : npm run build && npm run assets:android
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIST = 'dist';
const RES = 'android/app/src/main/res';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/')) p = join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 30000 });

const out = await page.evaluate(() => {
  const tm = window.__lecraft.textures;
  const logoImg = document.querySelector('.logo');
  const iso = tm.iconCanvas('grass'); // bloc d'herbe isométrique 32x32
  const pick = tm.iconCanvas('diamond_pickaxe');
  const mk = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingEnabled = false; draw(x, w, h); return c.toDataURL('image/png'); };
  const bg = (x, w, h, round) => {
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#5fa3ec'); g.addColorStop(1, '#2b5e9e');
    x.fillStyle = g;
    if (round) { x.beginPath(); x.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); x.fill(); }
    else { const r = w * 0.18; x.beginPath(); x.roundRect(0, 0, w, h, r); x.fill(); }
  };
  const block = (x, w, h, scale) => {
    const s = Math.floor((w * scale) / 32) || 1;
    const size = 32 * s;
    x.drawImage(iso, (w - size) / 2, (h - size) / 2 + s, size, size);
    x.drawImage(pick, (w - size) / 2 + size * 0.42, (h - size) / 2 + size * 0.38, size * 0.58, size * 0.58);
  };
  const icons = {};
  const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, s] of Object.entries(legacy)) {
    icons[`mipmap-${d}/ic_launcher.png`] = mk(s, s, (x, w, h) => { bg(x, w, h, false); block(x, w, h, 0.78); });
    icons[`mipmap-${d}/ic_launcher_round.png`] = mk(s, s, (x, w, h) => { bg(x, w, h, true); block(x, w, h, 0.7); });
    const f = Math.round(s * 2.25); // 108dp
    icons[`mipmap-${d}/ic_launcher_foreground.png`] = mk(f, f, (x, w, h) => block(x, w, h, 0.5));
  }
  const splash = (w, h) => mk(w, h, (x) => {
    x.fillStyle = '#10151c'; x.fillRect(0, 0, w, h);
    const lw = Math.min(w * 0.7, 900), lh = lw * (logoImg.naturalHeight / logoImg.naturalWidth);
    x.drawImage(logoImg, (w - lw) / 2, (h - lh) / 2 - h * 0.04, lw, lh);
    x.fillStyle = '#9aa6b8'; x.font = `${Math.round(Math.min(w, h) * 0.035)}px sans-serif`; x.textAlign = 'center';
    x.fillText('Chargement…', w / 2, (h + lh) / 2 + h * 0.05);
  });
  const sizes = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
  for (const [d, [w, h]] of Object.entries(sizes)) {
    icons[`drawable-port-${d}/splash.png`] = splash(w, h);
    icons[`drawable-land-${d}/splash.png`] = splash(h, w);
  }
  icons['drawable/splash.png'] = splash(480, 320);
  icons['web/icon.png'] = mk(192, 192, (x, w, h) => { bg(x, w, h, false); block(x, w, h, 0.78); });
  return icons;
});

for (const [path, url] of Object.entries(out)) {
  const target = path.startsWith('web/') ? join('public', path.slice(4)) : join(RES, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, Buffer.from(url.split(',')[1], 'base64'));
}
// fond de l'icône adaptative
writeFileSync(join(RES, 'values/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#3f80cc</color>\n</resources>\n`);
console.log(`${Object.keys(out).length} images générées`);
await browser.close();
server.close();
