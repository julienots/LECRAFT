// E2E de la dimension « Pâte à papier » : cadre de papier mâché, ouverture à la plume encrée,
// voyage, terrain de papier, créatures de papier, temple d'origami, retour à la surface.
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
let failed = 0, total = 0;
const check = (n, ok, d = '') => { total++; if (!ok) failed++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const G = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'MEDIUM', renderDistance: 4, autoQuality: false, gfxV: 2 })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await G(() => window.__lecraft.createWorld('Papier', 'papier1', 'survival', 'normal'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing', null, { timeout: 120000 });
  // cadre 4×5 de papier mâché devant le joueur (intérieur 2×3), plateforme dégagée
  const frame = await G(() => {
    const g = window.__lecraft, s = g.session, w = s.world, p = s.player, B = g.debug.registries.blocks;
    const PM = B.byName('papier_mache').id;
    const x0 = Math.floor(p.x) + 2, z = Math.floor(p.z) + 3, y = Math.floor(p.y);
    for (let dx = -2; dx <= 4; dx++) for (let dz = -5; dz <= 3; dz++) { w.setBlock(x0 + dx, y - 1, z + dz, B.byName('stone').id); for (let h = 0; h < 7; h++) w.setBlock(x0 + dx, y + h, z + dz, 0); }
    for (let i = -1; i <= 2; i++) { w.setBlock(x0 + i, y - 1, z, PM); w.setBlock(x0 + i, y + 3, z, PM); }
    for (let h = 0; h < 3; h++) { w.setBlock(x0 - 1, y + h, z, PM); w.setBlock(x0 + 2, y + h, z, PM); }
    p.inventory.add({ id: 'quill', count: 1, durability: 64 });
    p.inventory.selected = p.inventory.slots.findIndex((x) => x?.id === 'quill');
    // regarder le bas du cadre (face supérieure du papier mâché) puis utiliser la plume
    p.body.setPos(x0 + 0.5, y, z - 1);
    const ex = p.x, ey = p.y + p.eyeHeight, ez = p.z;
    const dx = x0 + 0.5 - ex, dy = y - 0.02 - ey, dz = z + 0.5 - ez;
    p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    s.interaction.update(0.016, []);
    const tg = s.interaction.target;
    s.interaction.use(false);
    let n = 0;
    for (let i = 0; i < 2; i++) for (let h = 0; h < 3; h++) if (w.getBlock(x0 + i, y + h, z) === B.byName('paper_portal').id) n++;
    return { n, x0, y, z, tg: tg && { x: tg.x, y: tg.y, z: tg.z, ny: tg.ny, b: B.get(tg.block).key }, held: p.inventory.selectedStack };
  });
  check('Plume encrée : le cadre de papier mâché s’ouvre (6 blocs de portail)', frame.n === 6, JSON.stringify(frame));
  await G((f) => { const p = window.__lecraft.session.player; p.yaw = Math.PI; p.pitch = 0; p.body.setPos(f.x0 + 1, f.y, f.z - 1.5); }, frame);
  await wait(800);
  await page.screenshot({ path: `${OUT}/paper-01-portail.png` });
  await G((f) => window.__lecraft.session.player.body.setPos(f.x0 + 1, f.y, f.z + 0.5), frame);
  await page.waitForFunction(() => window.__lecraft.session?.dimension === 'paper' && window.__lecraft.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 90000 });
  check('Voyage : arrivée dans la Pâte à papier', true);
  await wait(2500);
  const ground = await G(() => {
    const s = window.__lecraft.session, w = s.world, p = s.player, B = window.__lecraft.debug.registries.blocks;
    const keys = new Map();
    for (let dx = -10; dx <= 10; dx += 2) for (let dz = -10; dz <= 10; dz += 2) {
      const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + dz;
      const k = B.get(w.getBlock(x, w.heightAt(x, z), z)).key;
      keys.set(k, (keys.get(k) ?? 0) + 1);
    }
    const back = Math.max(...[...Array(5)].map((_, h) => Number(w.getBlock(Math.floor(p.x), Math.floor(p.y) + h, Math.floor(p.z)) === B.byName('paper_portal').id)));
    return { keys: Object.fromEntries(keys), biome: w.biomeAt(Math.floor(p.x), Math.floor(p.z)).name, portal: back };
  });
  const paperish = Object.entries(ground.keys).filter(([k]) => /paper|cardboard|origami|ink|confetti|lantern|tube|rose|tulip|daisy|papier/.test(k)).reduce((a, [, n]) => a + n, 0);
  const all = Object.values(ground.keys).reduce((a, n) => a + n, 0);
  check('Terrain de papier autour du joueur', paperish / all > 0.8, `${ground.biome} ${JSON.stringify(ground.keys)}`);
  check('Portail de retour construit à l’arrivée', ground.portal === 1);
  // créatures de papier
  await G(() => { const s = window.__lecraft.session; s.gamerules.doMobSpawning = true; });
  await page.waitForFunction(() => window.__lecraft.session.entities.mobs.filter((m) => ['paper_crane', 'origami_frog', 'scribble', 'crumpled_ball', 'paper_plane', 'cardboard_golem'].includes(m.def.key)).length >= 3, null, { timeout: 60000 }).catch(() => {});
  const mobs = await G(() => window.__lecraft.session.entities.mobs.map((m) => m.def.key));
  const paperMobs = mobs.filter((k) => ['paper_crane', 'origami_frog', 'scribble', 'crumpled_ball', 'paper_plane', 'cardboard_golem'].includes(k));
  check('Créatures de papier qui apparaissent (et aucune autre)', paperMobs.length >= 3 && paperMobs.length === mobs.filter((k) => !k.startsWith('bot:')).length, JSON.stringify(mobs));
  // vue d'ensemble
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    for (const m of s.entities.mobs.slice(0, 6)) m.body.setPos(p.x + (Math.random() - 0.5) * 8, p.y + 1, p.z - 6 - Math.random() * 4);
    s.entities.spawnMob('cardboard_golem', p.x + 3, p.y + 1, p.z - 8, { persistent: true });
    s.entities.spawnMob('paper_crane', p.x - 2, p.y + 3, p.z - 5, { persistent: true });
    p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(p.x, s.world.heightAt(Math.floor(p.x), Math.floor(p.z + 2)) + 7, p.z + 2); p.yaw = 0; p.pitch = -0.4;
  });
  await wait(3000);
  await page.screenshot({ path: `${OUT}/paper-02-monde.png` });
  // temple d'origami
  const temple = await G(async () => {
    const s = window.__lecraft.session, p = s.player;
    const r = await s.chunks.locate('paper_temple', p.x, p.z);
    if (r.found) { p.body.setPos(r.x + 0.5, 80, r.z - 22); p.yaw = Math.PI; p.pitch = -0.45; }
    return r;
  });
  check('Temple d’origami localisable', temple.found, JSON.stringify(temple));
  if (temple.found) {
    await page.waitForFunction(() => window.__lecraft.session.chunks.pendingCount === 0, null, { timeout: 30000 }).catch(() => {});
    await wait(2000);
    await page.screenshot({ path: `${OUT}/paper-03-temple.png` });
  }
  // retour
  await G(() => { const p = window.__lecraft.session.player; p.gameMode = 'survival'; p.body.flying = false; });
  await G(() => window.__lecraft.changeDimension('overworld', undefined, 'paper'));
  await page.waitForFunction(() => window.__lecraft.session?.dimension === 'overworld' && window.__lecraft.state === 'playing', null, { timeout: 90000 });
  check('Retour à la surface', true);
  check('Aucune erreur JavaScript', errors.length === 0, errors.slice(0, 4).join(' | '));
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await browser.close();
  console.log(`\n${total - failed}/${total} vérifications réussies`);
  process.exit(failed ? 1 : 0);
}
