// Sonde de développement de l'interface : crée un monde puis exécute le code JS passé en argument
// (fichier) dans la page ; `shot(nom)` y est disponible via window.__shot.
// Usage : URL=... OUT=... node scripts/e2e-ui-probe.mjs fichier.js
import { chromium } from 'playwright';
import fs from 'fs';
const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
const W = +(process.env.W ?? 915), H = +(process.env.H ?? 412);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.exposeFunction('__shot', (n) => page.screenshot({ path: `${OUT}/${n}.png` }));
await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'LOW', renderDistance: 2, autoQuality: false, gfxV: 3 })));
await page.goto(URL);
await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
if (!process.env.MENU) {
  await page.evaluate((m) => window.__lecraft.createWorld('Probe', '4242', m, 'normal'), process.env.MODE ?? 'survival');
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await page.waitForTimeout(800);
}
const code = fs.readFileSync(process.argv[2], 'utf8');
const r = await page.evaluate(`(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const shot = (n) => window.__shot(n); ${code} })()`);
console.log(JSON.stringify(r, null, 1));
await browser.close();
