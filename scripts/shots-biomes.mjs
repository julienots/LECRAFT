// Captures des biomes (graine 12345) pour vérifier la génération à l'œil.
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
const SPOTS = [['flower_forest', -424, -84], ['cherry_grove', 113, 212], ['badlands', 436, -652], ['birch_forest', 124, 102], ['stony_peaks', -245, 591], ['snowy_taiga', -296, -122], ['swamp', -143, 268], ['plains', 223, 183]];
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const G = (f, a) => page.evaluate(f, a);
await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'MEDIUM', renderDistance: 4, autoQuality: false, gfxV: 2 })));
await page.goto(URL);
await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
await G(() => window.__lecraft.createWorld('Biomes', '12345', 'creative', 'peaceful'));
await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
for (const [name, x, z] of SPOTS) {
  await G(([x, z]) => {
    const s = window.__lecraft.session, p = s.player;
    p.body.flying = true;
    p.body.setPos(x + 0.5, 110, z + 0.5);
    p.yaw = 0.6; p.pitch = -0.35;
    s.dayCycle.time = 0.3;
  }, [x, z]);
  await page.waitForTimeout(400);
  await page.waitForFunction(([x, z]) => window.__lecraft.session.world.getBlock(x, 0, z) > 0, [x, z], { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await G(([x, z]) => {
    const s = window.__lecraft.session, p = s.player;
    let y = 120;
    while (y > 1 && s.world.getBlock(Math.floor(x), y, Math.floor(z)) <= 0) y--;
    p.body.flying = true; p.body.setPos(x + 0.5, y + 14, z + 0.5); p.pitch = -0.45;
  }, [x, z]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/biome-${name}.png` });
  console.log('📸', name);
}
console.log(errors.length ? '❌ ' + errors.join('\n') : '✅ aucune erreur');
await browser.close();
