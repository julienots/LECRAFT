// Visite visuelle : capture plusieurs biomes et structures (qualité HIGH).
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'HIGH', renderDistance: 6, autoQuality: false, fpsCap: 60, shadows: 'blob+ao', clouds: true, resolutionScale: 1, particles: 'high', waterQuality: 'animated' })));
await page.goto(URL);
await page.waitForFunction(() => window.__lecraft?.state === 'menu');
await page.getByText('Nouveau monde').first().click();
await page.locator('input[type=text]').nth(1).fill(process.env.SEED ?? '839274928');
await page.getByText('Créer le monde').click();
await page.waitForFunction(() => window.__lecraft?.state === 'playing', null, { timeout: 120000 });
const G = (f, a) => page.evaluate(f, a);
const settle = async () => {
  await page.waitForTimeout(800);
  await page.waitForFunction(() => window.__lecraft.session.chunks.pendingCount === 0, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);
};
const targets = (process.env.BIOMES ?? 'plains,forest,desert,jungle,savanna,swamp,mountain,taiga,tundra,ice_zone,dense_forest,ocean').split(',');
for (const b of targets) {
  const pos = await G((k) => window.__lecraft.debug.findBiome(k), b);
  if (!pos) { console.log('introuvable', b); continue; }
  await G(([x, z]) => { const d = window.__lecraft.debug; d.teleport(x, z); d.setTime(0.15); const p = window.__lecraft.session.player; p.pitch = -0.15; p.yaw = 0.8; p.body.flying = true; }, [pos.x, pos.z]);
  await G(() => { const p = window.__lecraft.session.player; p.body.setPos(p.x, p.y + 6, p.z); });
  await settle();
  await page.screenshot({ path: `${OUT}/tour-${b}.png` });
  console.log('ok', b, pos);
}
for (const st of (process.env.STRUCTS ?? 'village,tower,temple').split(',').filter(Boolean)) {
  const pos = await G((k) => window.__lecraft.debug.findStructure(k), st);
  if (!pos) { console.log('structure introuvable', st); continue; }
  await G(([x, z]) => { const d = window.__lecraft.debug; d.teleport(x - 14, z - 14); d.setTime(0.15); const p = window.__lecraft.session.player; p.body.flying = true; p.body.setPos(p.x, p.y + 10, p.z); p.yaw = Math.PI * 0.75 + Math.PI; p.pitch = -0.45; }, [pos.x, pos.z]);
  await settle();
  await page.screenshot({ path: `${OUT}/tour-${st}.png` });
  console.log('ok', st, pos);
}
console.log('fps', await G(() => window.__lecraft.hud.currentFps), 'erreurs', errs.slice(0, 5));
await browser.close();
