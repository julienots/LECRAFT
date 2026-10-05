// Mesure CPU : temps de simulation par frame (hors rendu GPU) en marchant, coût du meshing, mémoire JS.
import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true })).newPage();
await page.addInitScript((q) => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: q, renderDistance: q === 'HIGH' ? 8 : q === 'MEDIUM' ? 5 : 3, autoQuality: false })), process.env.Q ?? 'MEDIUM');
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => window.__lecraft?.state === 'menu');
await page.getByText('Solo').first().click();
  await page.getByText('Créer un nouveau monde').first().click();
  await page.waitForTimeout(200);
await page.locator('.mc-screen').last().locator('input').nth(1).fill('839274928');
await page.locator('.mc-footer').last().getByText('Créer un nouveau monde').click();
await page.waitForFunction(() => window.__lecraft?.state === 'playing', null, { timeout: 120000 });
await page.waitForFunction(() => window.__lecraft.session.chunks.pendingCount === 0, null, { timeout: 120000 });
const r = await page.evaluate(async () => {
  const g = window.__lecraft, s = g.session;
  const upd = s.update.bind(s), rnd = g.renderer.render.bind(g.renderer);
  const tu = [], tr = [];
  s.update = (dt) => { const t = performance.now(); upd(dt); tu.push(performance.now() - t); };
  g.renderer.render = (e) => { const t = performance.now(); rnd(e); tr.push(performance.now() - t); };
  g.input.moveY = 1; g.input.sprint = true;
  await new Promise((res) => setTimeout(res, 15000));
  g.input.moveY = 0;
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const p95 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
  return { frames: tu.length, updateAvg: avg(tu).toFixed(2), updateP95: p95(tu).toFixed(2), renderAvgSoftware: avg(tr).toFixed(1), meshMs: s.chunks.stats.meshMs.toFixed(1), meshes: s.chunks.stats.meshCount, chunks: s.world.chunks.size, tris: g.renderer.gl.info.render.triangles, calls: g.renderer.gl.info.render.calls, heapMB: (performance.memory.usedJSHeapSize / 1048576).toFixed(0), dist: Math.hypot(s.player.x + 3.5, s.player.z - 7.5).toFixed(0) };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
