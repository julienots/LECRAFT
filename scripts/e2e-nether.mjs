// E2E Nether : portail d'obsidienne allumé au briquet, passage (4 s), génération du Nether,
// ambiance, eau qui s'évapore, lit qui explose, créatures du Nether, forteresse, retour par le
// portail relié et persistance des blocs de chaque dimension.
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
const playing = () => page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session?.loaded, null, { timeout: 120000 });
const settle = () => page.waitForFunction(() => window.__lecraft.session.chunks.pendingCount === 0, null, { timeout: 90000 }).catch(() => {});

try {
  await page.addInitScript(() => {
    localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'LOW', renderDistance: 2, autoQuality: false }));
    window.I = (k) => window.__lecraft.debug.blockId(k);
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await G(() => window.__lecraft.createWorld('Nether', '31337', 'survival', 'normal'));
  await playing();
  await settle();
  await wait(800);

  // ---------- cadre d'obsidienne (intérieur 2×3) + briquet ----------
  const frame = await G(() => {
    const s = window.__lecraft.session, w = s.world, p = s.player;
    const x0 = Math.floor(p.x) + 3, z0 = Math.floor(p.z), y0 = Math.floor(p.y);
    s.runCommand(`/fill ${x0 - 3} ${y0 - 1} ${z0 - 3} ${x0 + 4} ${y0 - 1} ${z0 + 3} stone`);
    s.runCommand(`/fill ${x0 - 3} ${y0} ${z0 - 3} ${x0 + 4} ${y0 + 6} ${z0 + 3} air`);
    for (let i = -1; i <= 2; i++) { w.setBlock(x0 + i, y0, z0, I('obsidian')); w.setBlock(x0 + i, y0 + 4, z0, I('obsidian')); }
    for (let h = 1; h <= 3; h++) { w.setBlock(x0 - 1, y0 + h, z0, I('obsidian')); w.setBlock(x0 + 2, y0 + h, z0, I('obsidian')); }
    p.inventory.clear();
    p.inventory.add({ id: 'flint_and_steel', count: 1, durability: 64 });
    p.inventory.selected = 0;
    const it = s.interaction;
    it.target = { x: x0, y: y0, z: z0, nx: 0, ny: 1, nz: 0, block: I('obsidian'), distance: 2, px: x0 + 0.5, py: y0 + 1, pz: z0 + 0.5 };
    it.use();
    let n = 0;
    for (let h = 1; h <= 3; h++) for (let i = 0; i < 2; i++) if (w.getBlock(x0 + i, y0 + h, z0) === I('nether_portal')) n++;
    return { x0, y0, z0, n, reg: s.portals.overworld.length, dur: p.inventory.slots[0]?.durability };
  });
  check('Briquet dans un cadre d’obsidienne : portail allumé (6 blocs)', frame.n === 6 && frame.reg === 1, JSON.stringify(frame));
  // cadre incomplet : pas de portail, mais du feu
  const fire = await G((f) => {
    const s = window.__lecraft.session, w = s.world, it = s.interaction;
    it.target = { x: f.x0 + 4, y: f.y0 - 1, z: f.z0 + 2, nx: 0, ny: 1, nz: 0, block: I('stone'), distance: 2, px: 0, py: 0, pz: 0 };
    it.use();
    return w.getBlock(f.x0 + 4, f.y0, f.z0 + 2) === I('fire');
  }, frame);
  check('Briquet sur un bloc ordinaire : feu', fire);
  await page.screenshot({ path: `${OUT}/nether-01-portail.png` });

  // casser le cadre éteint le portail (on le reconstruit ensuite)
  const broke = await G((f) => {
    const s = window.__lecraft.session, w = s.world;
    w.setBlock(f.x0 - 1, f.y0 + 2, f.z0, 0);
    let n = 0;
    for (let h = 1; h <= 3; h++) for (let i = 0; i < 2; i++) if (w.getBlock(f.x0 + i, f.y0 + h, f.z0) === I('nether_portal')) n++;
    w.setBlock(f.x0 - 1, f.y0 + 2, f.z0, I('obsidian'));
    const it = s.interaction;
    it.target = { x: f.x0, y: f.y0, z: f.z0, nx: 0, ny: 1, nz: 0, block: I('obsidian'), distance: 2, px: 0, py: 0, pz: 0 };
    it.use();
    return n;
  }, frame);
  check('Casser le cadre éteint le portail', broke === 0);

  // ---------- passage vers le Nether ----------
  await G((f) => { const p = window.__lecraft.session.player; p.body.setPos(f.x0 + 1, f.y0 + 1, f.z0 + 0.5); p.body.vx = p.body.vz = 0; }, frame);
  await wait(2000);
  const mid = await G(() => ({ t: window.__lecraft.session.portalTime, fx: !document.querySelector('.portal-fx').classList.contains('hidden') }));
  check('Dans le portail : compte à rebours et voile violet', mid.t > 1 && mid.fx, JSON.stringify(mid));
  await page.waitForFunction(() => window.__lecraft.session?.dimension === 'nether', null, { timeout: 30000 });
  await playing();
  await settle();
  await wait(1500);
  const nether = await G(() => {
    const s = window.__lecraft.session, w = s.world, p = s.player;
    const x = Math.floor(p.x), z = Math.floor(p.z);
    let netherrack = 0, lava = 0;
    for (let dx = -16; dx <= 16; dx += 2) for (let dz = -16; dz <= 16; dz += 2) for (let y = 1; y < 127; y += 3) {
      const b = w.getBlock(x + dx, y, z + dz);
      if (b === I('netherrack')) netherrack++;
      if (b === I('lava') && y <= 31) lava++;
    }
    const u = window.__lecraft.renderer.materials.uniforms;
    return {
      dim: s.dimension, inPortal: w.getBlock(x, Math.floor(p.y), z) === I('nether_portal'), roof: w.getBlock(x, 127, z) === I('bedrock'), floor: w.getBlock(x, 0, z) === I('bedrock'),
      netherrack, lava, reg: s.portals.nether.length, daylight: u.uDaylight.value, ambient: u.uAmbient.value,
      fog: u.uFogColor?.value ? [u.uFogColor.value.r, u.uFogColor.value.g, u.uFogColor.value.b].map((v) => +v.toFixed(2)) : null,
      biome: s.world.biomeAt(x, z).key,
      coords: { x: p.x, z: p.z },
    };
  });
  check('Arrivée dans le Nether (portail créé, joueur dedans)', nether.dim === 'nether' && nether.inPortal && nether.reg === 1, JSON.stringify(nether));
  check('Coordonnées divisées par 8', Math.abs(nether.coords.x - (frame.x0 + 1) / 8) < 20 && Math.abs(nether.coords.z - frame.z0 / 8) < 20, JSON.stringify(nether.coords));
  check('Génération : netherrack, océan de lave sous y = 31, bedrock en haut et en bas', nether.netherrack > 200 && nether.lava > 5 && nether.roof && nether.floor, JSON.stringify({ n: nether.netherrack, l: nether.lava }));
  check('Ambiance : pas de lumière du jour, brouillard rouge du biome', nether.daylight === 0 && nether.ambient > 0.1 && (!nether.fog || nether.fog[0] >= nether.fog[2]), `${nether.biome} ${JSON.stringify(nether.fog)}`);
  await page.screenshot({ path: `${OUT}/nether-02-arrivee.png` });

  // vue d'ensemble : on se place hors du portail et on regarde le paysage
  await G(() => { const s = window.__lecraft.session, p = s.player; p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(p.x + 2.5, p.y + 6, p.z + 2.5); p.pitch = -0.35; p.yaw = 2.2; });
  await wait(1500);
  await page.screenshot({ path: `${OUT}/nether-03-paysage.png` });

  // ---------- eau, lit, bloc témoin ----------
  const rules = await G(() => {
    const s = window.__lecraft.session, w = s.world, p = s.player;
    const x = Math.floor(p.x), y = Math.floor(p.y) - 2, z = Math.floor(p.z) + 4;
    s.runCommand(`/fill ${x - 2} ${y} ${z - 2} ${x + 2} ${y} ${z + 2} netherrack`);
    s.runCommand(`/fill ${x - 2} ${y + 1} ${z - 2} ${x + 2} ${y + 3} ${z + 2} air`);
    p.inventory.clear();
    p.inventory.add({ id: 'water_bucket', count: 1 });
    p.inventory.selected = 0;
    p.gameMode = 'survival';
    const it = s.interaction;
    it.target = { x, y, z, nx: 0, ny: 1, nz: 0, block: I('netherrack'), distance: 2, px: 0, py: 0, pz: 0 };
    it.use();
    const water = w.getBlock(x, y + 1, z);
    const held = p.inventory.slots[0]?.id;
    window.__mark = { x, y: y + 1, z };
    // lit : explose
    w.setBlock(x - 1, y + 1, z - 1, I('red_bed'), 0);
    s.interaction.target = null;
    p.gameMode = 'creative';
    return { water, held, bedBefore: w.getBlock(x - 1, y + 1, z - 1) };
  });
  check('Seau d’eau : l’eau s’évapore (seau vidé)', rules.water === 0 && rules.held === 'bucket', JSON.stringify(rules));
  const bed = await G(() => {
    const s = window.__lecraft.session, m = window.__mark;
    const n0 = s.explosions.count;
    const x = m.x - 1, y = m.y, z = m.z - 1;
    s.interaction.target = { x, y, z, nx: 0, ny: 1, nz: 0, block: I('red_bed'), distance: 2, px: 0, py: 0, pz: 0 };
    s.player.sneaking = false;
    s.interaction.use();
    return { gone: s.world.getBlock(x, y, z) !== I('red_bed') };
  });
  check('Dormir dans le Nether : le lit explose', bed.gone, JSON.stringify(bed));
  // bloc témoin (doit persister dans le Nether), loin du cratère
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const m = { x: Math.floor(p.x) - 6, y: Math.floor(p.y), z: Math.floor(p.z) - 6 };
    s.world.setBlock(m.x, m.y, m.z, I('gold_block'));
    window.__mark = m;
  });

  // ---------- créatures du Nether ----------
  const mobs = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const out = {};
    ['zombified_piglin', 'zombified_piglin', 'ghast', 'magma_cube', 'blaze'].forEach((k, i) => {
      const m = s.entities.spawnMob(k, p.x - 4 + i * 2, p.y + (k === 'ghast' ? 6 : 0), p.z + 6, { persistent: true });
      out[k] = !!m && m.model.vanilla;
    });
    p.yaw = Math.PI; p.pitch = 0.1;
    return out;
  });
  check('Créatures : piglin zombifié, ghast, cube de magma, blaze (modèles vanilla)', Object.values(mobs).every(Boolean) && Object.keys(mobs).length === 4, JSON.stringify(mobs));
  await wait(1200);
  await page.screenshot({ path: `${OUT}/nether-04-creatures.png` });
  const anger = await G(() => {
    const s = window.__lecraft.session;
    const p0 = s.entities.mobs.find((m) => m.def.key === 'zombified_piglin' && m.persistent);
    const pigs = s.entities.mobs.filter((m) => m.def.key === 'zombified_piglin' && Math.hypot(m.x - p0.x, m.z - p0.z) < 10);
    const calm = pigs.every((m) => m.anger === 0);
    s.combat.damageMob(pigs[0], 1, { kind: 'player', fromPlayer: true, itemId: 'wooden_sword' });
    return { calm, angry: pigs.every((m) => m.anger > 0), n: pigs.length };
  });
  check('Piglins zombifiés neutres, puis toute la bande en colère si on en frappe un', anger.calm && anger.angry && anger.n >= 2, JSON.stringify(anger));
  const lavaSafe = await G(() => {
    const s = window.__lecraft.session, m = s.entities.mobs.find((x) => x.def.key === 'magma_cube');
    const h = m.health;
    s.combat.damageMob(m, 5, { kind: 'environment', fire: true });
    return m.health === h;
  });
  check('Créatures du Nether insensibles au feu', lavaSafe);
  await G(() => { const s = window.__lecraft.session; for (const m of s.entities.mobs) m.removed = true; });

  // ---------- forteresse ----------
  const fort = await G(async () => {
    const s = window.__lecraft.session, p = s.player;
    const r = await s.chunks.locate('fortress', p.x, p.z);
    return r;
  });
  check('Forteresse du Nether localisée', fort.found, JSON.stringify(fort));
  if (fort.found) {
    await G((f) => { const p = window.__lecraft.session.player; p.body.setPos(f.x + 0.5, 70, f.z + 0.5); p.body.flying = true; }, fort);
    await page.waitForFunction((f) => window.__lecraft.session.world.isLoaded(f.x, f.z), fort, { timeout: 60000 });
    await settle();
    await wait(800);
    const inside = await G((f) => {
      const w = window.__lecraft.session.world;
      let bricks = 0, spawner = false;
      for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) for (let y = 64; y <= 72; y++) {
        const b = w.getBlock(f.x + dx, y, f.z + dz);
        if (b === I('nether_bricks')) bricks++;
        if (b === I('spawner')) spawner = true;
      }
      return { bricks, spawner };
    }, fort);
    check('Forteresse : briques du Nether + générateur de blazes', inside.bricks > 100 && inside.spawner, JSON.stringify(inside));
    await G((f) => { const p = window.__lecraft.session.player; p.body.setPos(f.x + 0.5, 67, f.z + 5.5); p.yaw = 0; p.pitch = 0; }, fort);
    await wait(1200);
    await page.screenshot({ path: `${OUT}/nether-05-forteresse.png` });
  }

  // ---------- retour par le portail relié ----------
  await G(() => {
    const s = window.__lecraft.session, p = s.player, q = s.portals.nether[0];
    p.gameMode = 'survival'; p.body.flying = false;
    p.body.setPos(q.x + 0.5, q.y, q.z + 0.5);
  });
  await page.waitForFunction(() => window.__lecraft.session?.dimension === 'overworld', null, { timeout: 30000 });
  await playing();
  await settle();
  await wait(800);
  const back = await G((f) => {
    const s = window.__lecraft.session, p = s.player;
    return { dim: s.dimension, d: Math.hypot(p.x - (f.x0 + 1), p.z - f.z0), mark: s.world.getBlock(window.__markX ?? 0, 0, 0) };
  }, frame);
  check('Retour à la surface par le portail d’origine', back.dim === 'overworld' && back.d < 4, JSON.stringify(back));

  // ---------- re-départ : le bloc témoin du Nether est toujours là ----------
  await G((f) => { const p = window.__lecraft.session.player; p.body.setPos(f.x0 + 4, f.y0 + 1, f.z0 + 3); }, frame);
  // hors du portail : le blocage d'arrivée se lève au tick suivant (lent en rendu logiciel)
  await page.waitForFunction(() => !window.__lecraft.session.portalBlocked, null, { timeout: 10000 });
  await G((f) => { const p = window.__lecraft.session.player; p.body.setPos(f.x0 + 1, f.y0 + 1, f.z0 + 0.5); }, frame);
  await page.waitForFunction(() => window.__lecraft.session?.dimension === 'nether', null, { timeout: 30000 });
  await playing();
  await settle();
  await wait(500);
  const persisted = await G(() => {
    const s = window.__lecraft.session, m = window.__mark;
    return { gold: s.world.getBlock(m.x, m.y, m.z) === I('gold_block'), portals: s.portals.nether.length };
  });
  check('Nether sauvegardé : bloc posé retrouvé, même portail réutilisé', persisted.gold && persisted.portals === 1, JSON.stringify(persisted));
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
