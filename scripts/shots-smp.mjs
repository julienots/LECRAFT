// Capture d'une maison construite par un bot du serveur de survie (matériaux fournis, 2 min max).
import { chromium } from 'playwright';
const OUT = process.env.OUT ?? 'screenshots';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 } })).newPage();
const G = (f, a) => page.evaluate(f, a);
await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'MEDIUM', renderDistance: 4, autoQuality: false, gfxV: 2 })));
await page.goto(process.env.URL ?? 'http://localhost:4173/');
await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
await G(() => window.__lecraft.joinSmp());
await page.waitForFunction(() => window.__lecraft.session?.smp?.online.length >= 1, null, { timeout: 60000 });
const r = await G(async () => {
  const s = window.__lecraft.session, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  s.dayCycle.time = 0.05; s.gamerules.doDaylightCycle = false;
  const m = s.smp.online[0];
  Object.assign(m.p, { tier: 3, inv: { planks: 300, cobblestone: 200 } }); m.task = 'idle';
  const t0 = performance.now();
  for (let i = 0; i < 240 && !m.p.houseDone; i++) await sleep(500);
  return { done: m.p.houseDone, built: m.p.built, total: m.plan?.length, secs: Math.round((performance.now() - t0) / 1000), home: m.p.home, name: m.p.name };
});
console.log(JSON.stringify(r));
if (r.home) {
  const f = r.home.facing, [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][f];
  await G(([h, dx, dz]) => { const p = window.__lecraft.session.player; p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(h.x + dx * 10 + 0.5 + 4, h.y + 5, h.z + dz * 10 + 0.5 + 4); p.yaw = Math.atan2(-(dx * 10 + 4), -(dz * 10 + 4)) + Math.PI; p.pitch = -0.3; }, [r.home, dx, dz]);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/smp-house.png` });
}
await browser.close();
