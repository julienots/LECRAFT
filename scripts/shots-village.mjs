// Captures d'un village (vue aérienne et rue) pour vérifier la génération à l'œil.
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
const SEED = process.env.SEED ?? '12345';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const G = (f, a) => page.evaluate(f, a);
await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'MEDIUM', renderDistance: 4, autoQuality: false, gfxV: 2 })));
await page.goto(URL);
await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
await G((s) => window.__lecraft.createWorld('Village', s, 'creative', 'peaceful'), SEED);
await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
const v = process.env.VX ? { x: +process.env.VX, z: +process.env.VZ } : await G(() => window.__lecraft.debug.findStructure('village'));
console.log('village', JSON.stringify(v));
const views = [['air', 0, 45, 22, 0.0, -1.1], ['street', 0, 4, 12, 0.0, -0.15], ['side', 14, 6, 14, 0.8, -0.3]];
for (const [name, dx, dy, dz, yaw, pitch] of views) {
  await G(([v, dx, dz]) => { const p = window.__lecraft.session.player; p.body.flying = true; p.body.setPos(v.x + dx + 0.5, 110, v.z + dz + 0.5); }, [v, dx, dz]);
  await page.waitForFunction(([x, z]) => window.__lecraft.session.world.getBlock(x, 0, z) > 0, [v.x, v.z], { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await G(([v, dx, dy, dz, yaw, pitch]) => {
    const s = window.__lecraft.session, p = s.player;
    let y = 120;
    while (y > 1 && s.world.getBlock(v.x + dx, y, v.z + dz) <= 0) y--;
    p.body.flying = true; p.body.setPos(v.x + dx + 0.5, y + dy, v.z + dz + 0.5); p.yaw = yaw; p.pitch = pitch; s.dayCycle.time = 0.3;
  }, [v, dx, dy, dz, yaw, pitch]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/village-${name}.png` });
}
console.log(errors.length ? '❌ ' + errors.join('\n') : '✅ aucune erreur');
await browser.close();
