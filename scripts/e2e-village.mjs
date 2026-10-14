// E2E villages : chaque maison a une vraie porte (deux moitiés, tournée vers la rue, qui s'ouvre),
// chaque lit est dans une pièce close accessible par une porte, et les métiers ont leur bloc.
// Captures dans OUT (vue aérienne + façades).
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
const SEED = process.env.SEED ?? '12345';
// BIOMES : biomes où chercher le village le plus proche ; VILLAGES=« nom:x,z;nom:x,z » : villages imposés
const BIOMES = (process.env.BIOMES ?? 'spawn,desert,savanna,taiga,snowy_taiga').split(',');
const FIXED = process.env.VILLAGES ? process.env.VILLAGES.split(';').map((e) => { const [n, c] = e.split(':'); const [x, z] = c.split(',').map(Number); return { n, x, z }; }) : null;
const SHOTS = process.env.SHOTS !== '0';
let failed = 0, total = 0;
const check = (n, ok, d = '') => { total++; if (!ok) failed++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const G = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);

// analyse d'un village chargé (exécutée dans la page)
function analyze(v) {
  const s = window.__lecraft.session, w = s.world, R = window.__lecraft.debug.registries.blocks;
  const key = (b) => (b > 0 ? R.get(b).key : 'air');
  const shape = (b) => (b > 0 ? R.get(b).shape : '');
  const solid = (x, y, z) => { const b = w.getBlock(x, y, z); return b > 0 && R.solid[b] === 1 && shape(b) !== 'door'; };
  const DIR = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  let cy = 120;
  while (cy > 1 && !solid(v.x, cy, v.z)) cy--;
  const doors = [], beds = [], counts = {};
  const JOBS = ['bell', 'lectern', 'composter', 'smoker', 'blast_furnace', 'smithing_table', 'grindstone', 'cartography_table', 'brewing_stand', 'barrel', 'fletching_table', 'cauldron', 'water_cauldron', 'stonecutter', 'loom', 'hay_block', 'bookshelf', 'red_bed', 'glass_pane', 'dirt_path', 'lantern', 'flower_pot', 'wheat', 'carrots', 'potatoes', 'farmland', 'campfire', 'anvil'];
  for (let x = v.x - 48; x <= v.x + 48; x++)
    for (let z = v.z - 48; z <= v.z + 48; z++)
      for (let y = Math.max(1, cy - 16); y <= cy + 24; y++) {
        const b = w.getBlock(x, y, z);
        if (b <= 0) continue;
        const k = key(b);
        if (JOBS.includes(k)) counts[k] = (counts[k] ?? 0) + 1;
        if (shape(b) === 'door' && !(w.getMeta(x, y, z) & 8)) doors.push({ x, y, z, k, m: w.getMeta(x, y, z) });
        if (k === 'red_bed' && !(w.getMeta(x, y, z) & 4)) beds.push({ x, y, z });
      }
  const bad = [];
  for (const d of doors) {
    const up = w.getBlock(d.x, d.y + 1, d.z), um = w.getMeta(d.x, d.y + 1, d.z);
    const [dx, dz] = DIR[d.m & 3];
    const why = [];
    if (key(up) !== d.k || !(um & 8) || (um & 3) !== (d.m & 3)) why.push(`moitié haute ${key(up)}:${um}`);
    if (!solid(d.x, d.y - 1, d.z)) why.push('pas de sol sous la porte');
    for (const [s, n] of [[-1, 'devant'], [1, 'derrière']]) {
      const x = d.x + dx * s, z = d.z + dz * s;
      if (solid(x, d.y, z) || solid(x, d.y + 1, z)) why.push(`${n} bouché (${key(w.getBlock(x, d.y, z))}/${key(w.getBlock(x, d.y + 1, z))})`);
      else if (!solid(x, d.y - 1, z) && !solid(x, d.y - 2, z)) why.push(`${n} : vide sous le pas`);
    }
    // vers la rue : un chemin à moins de 6 blocs devant la porte
    let path = false;
    const PATHS = ['dirt_path', 'smooth_sandstone', 'cut_sandstone', 'oak_planks', 'spruce_planks', 'acacia_planks'];
    for (let s = 1; s <= 6 && !path; s++) for (let yy = d.y - 4; yy <= d.y; yy++) if (PATHS.includes(key(w.getBlock(d.x - dx * s, yy, d.z - dz * s)))) path = true;
    if (!path) why.push('pas de chemin devant');
    if (why.length) bad.push({ ...d, why });
  }
  // chaque lit : pièce close (inondation à hauteur de lit) qui touche au moins une porte
  const rooms = [];
  for (const bd of beds) {
    const seen = new Set(), q = [], doorsHit = new Set();
    let escaped = false;
    for (const [dx, dz] of DIR) q.push([bd.x + dx, bd.z + dz]);
    while (q.length && !escaped) {
      const [x, z] = q.pop(), k = x + ',' + z;
      if (seen.has(k)) continue;
      seen.add(k);
      const b = w.getBlock(x, bd.y, z);
      if (shape(b) === 'door') { doorsHit.add(k); continue; }
      if (solid(x, bd.y, z) || key(b) === 'red_bed') continue;
      if (Math.abs(x - bd.x) > 14 || Math.abs(z - bd.z) > 14) { escaped = true; break; }
      for (const [dx, dz] of DIR) q.push([x + dx, z + dz]);
    }
    rooms.push({ x: bd.x, y: bd.y, z: bd.z, doors: doorsHit.size, escaped });
  }
  return { cy, doors, bad, beds: beds.length, rooms, counts };
}

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'LOW', renderDistance: 4, autoQuality: false })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await G((s) => window.__lecraft.createWorld('Villages', s, 'creative', 'peaceful'), SEED);
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  const done = new Set();
  let n = 0;
  for (const biome of FIXED ? FIXED.map((f) => f.n) : BIOMES) {
    const fixed = FIXED?.find((f) => f.n === biome);
    const v = fixed ? { x: fixed.x, z: fixed.z } : await G((biome) => {
      const L = window.__lecraft, p = L.session.player;
      if (biome !== 'spawn') {
        const b = L.debug.findBiome(biome, 6000);
        if (!b) return null;
        p.body.setPos(b.x + 0.5, 120, b.z + 0.5);
      }
      return L.debug.findStructure('village');
    }, biome);
    if (!v || done.has(v.x + ',' + v.z)) { console.log(`· ${biome} : pas de nouveau village`); continue; }
    done.add(v.x + ',' + v.z);
    n++;
    await G((v) => { const p = window.__lecraft.session.player; p.body.flying = true; p.body.setPos(v.x + 0.5, 120, v.z + 0.5); }, v);
    await page.waitForFunction((v) => { const w = window.__lecraft.session.world; return [[-40, -40], [40, -40], [-40, 40], [40, 40], [0, 0]].every(([dx, dz]) => w.getBlock(v.x + dx, 1, v.z + dz) > 0); }, v, { timeout: 90000, polling: 500 }).catch(() => console.log('  (chargement partiel)'));
    await wait(1500);
    const a = await G(analyze, v);
    console.log(`village ${n} (${biome}) en ${v.x},${v.z} : ${a.doors.length} portes, ${a.beds} lits`, JSON.stringify(a.counts));
    check(`[${biome}] au moins 3 portes`, a.doors.length >= 3, `${a.doors.length}`);
    check(`[${biome}] portes complètes, posées au sol, dégagées des deux côtés, chemin devant`, a.bad.length === 0, JSON.stringify(a.bad.slice(0, 6)));
    const shut = a.rooms.filter((r) => r.escaped || r.doors === 0);
    check(`[${biome}] chaque lit est dans une pièce close avec une porte`, a.beds > 0 && shut.length === 0, `${a.beds} lits ; problèmes : ${JSON.stringify(shut.slice(0, 6))}`);
    // ouverture de toutes les portes avec la vraie interaction
    const opened = await G((doors) => {
      const s = window.__lecraft.session, w = s.world, p = s.player;
      let ok = 0;
      for (const d of doors) {
        p.inventory.clear();
        s.interaction.target = { x: d.x, y: d.y + 1, z: d.z, nx: 0, ny: 0, nz: 1, block: w.getBlock(d.x, d.y + 1, d.z), distance: 2, px: d.x + 0.5, py: d.y + 1.5, pz: d.z + 1 };
        s.interaction.preview = null;
        s.interaction.use();
        const open = (w.getMeta(d.x, d.y, d.z) & 4) && (w.getMeta(d.x, d.y + 1, d.z) & 4);
        s.interaction.use();
        const closed = !(w.getMeta(d.x, d.y, d.z) & 4);
        if (open && closed) ok++;
      }
      return ok;
    }, a.doors);
    check(`[${biome}] toutes les portes s’ouvrent et se referment`, opened === a.doors.length, `${opened}/${a.doors.length}`);
    if (biome === 'spawn' || process.env.ALLJOBS) {
      const jobs = ['bell', 'lectern', 'composter', 'smoker', 'blast_furnace', 'cartography_table', 'brewing_stand', 'barrel', 'fletching_table', 'cauldron', 'water_cauldron', 'stonecutter', 'loom', 'smithing_table', 'grindstone'];
      const present = jobs.filter((k) => a.counts[k]);
      check(`[${biome}] blocs de métier variés (≥ 4)`, present.length >= 4, present.join(','));
    }
    if (SHOTS) {
      const tag = biome;
      await G(([v, cy]) => { const s = window.__lecraft.session, p = s.player; p.body.flying = true; p.body.setPos(v.x + 0.5, cy + 40, v.z + 26.5); p.yaw = 0; p.pitch = -0.95; s.dayCycle.time = 0.3; }, [v, a.cy]);
      await wait(3000);
      await page.screenshot({ path: `${OUT}/village-${tag}-air.png` });
      await G(([v, cy]) => { const s = window.__lecraft.session, p = s.player; p.body.flying = true; p.body.setPos(v.x + 0.5, cy + 4, v.z + 2.5); p.yaw = Math.PI; p.pitch = -0.25; s.dayCycle.time = 0.3; }, [v, a.cy]);
      await wait(2500);
      await page.screenshot({ path: `${OUT}/village-${tag}-street.png` });
      const fronts = a.doors.slice(0, 3);
      for (let i = 0; i < fronts.length; i++) {
        const d = fronts[i];
        await G((d) => {
          const s = window.__lecraft.session, p = s.player;
          const DIR = [[0, 1], [-1, 0], [0, -1], [1, 0]], YAW = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];
          const [dx, dz] = DIR[d.m & 3];
          p.body.flying = true; p.body.setPos(d.x - dx * 6 + 0.5, d.y + 1.2, d.z - dz * 6 + 0.5); p.yaw = YAW[d.m & 3]; p.pitch = -0.08; s.dayCycle.time = 0.3;
        }, d);
        await wait(1800);
        await page.screenshot({ path: `${OUT}/village-${tag}-door${i}.png` });
      }
    }
  }
  check('au moins un village analysé', n >= 1, `${n}`);
} catch (e) {
  check('exécution', false, String(e?.stack ?? e));
}
check('aucune erreur de page', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`${total - failed}/${total} vérifications OK`);
await browser.close();
process.exit(failed ? 1 : 0);
