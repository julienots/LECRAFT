// E2E gameplay : vérifie dans le jeu réel les systèmes avancés (agriculture, élevage, four,
// structures, coffres, liquides, météo, apparitions, boss à phases, libération mémoire).
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
let failed = 0, total = 0;
const check = (n, ok, d = '') => { total++; if (!ok) failed++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const G = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);
const settle = () => page.waitForFunction(() => window.__lecraft.session.chunks.pendingCount === 0, null, { timeout: 90000 }).catch(() => {});

try {
  await page.addInitScript(() => { window.I = (k) => window.__lecraft.debug.blockId(k); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu');
  await page.getByText('Solo').click();
  await page.getByText('Créer un nouveau monde').first().click();
  await wait(200);
  await page.locator('.mc-screen').last().locator('input').nth(1).fill('424242');
  await page.locator('.mc-footer').last().getByText('Créer un nouveau monde').click();
  await page.waitForFunction(() => window.__lecraft?.state === 'playing', null, { timeout: 120000 });
  await wait(1000);
  const geo0 = await G(() => window.__lecraft.renderer.gl.info.memory.geometries);
  const ids = await G(() => ({ farmland: I('farmland'), wheat: I('wheat'), water: I('water') }));

  // ---------- agriculture ----------
  const farm = await G(() => {
    const s = window.__lecraft.session, w = s.world, p = s.player;
    const x = Math.floor(p.x) + 2, z = Math.floor(p.z), y = Math.floor(p.y) - 1;
    s.dayCycle.time = 0.2;
    w.setBlock(x, y, z, I('dirt')); w.setBlock(x, y + 1, z, 0); w.setBlock(x, y + 2, z, 0);
    w.setBlock(x + 1, y, z, I('water'), 0); // eau à côté
    // houe sur la terre, puis graines (via les interactions réelles)
    p.inventory.clear();
    p.inventory.add({ id: 'wooden_hoe', count: 1, durability: 59 });
    p.inventory.add({ id: 'wheat_seeds', count: 5 });
    return { x, y, z };
  });
  await settle();
  await wait(800);
  const tilled = await G((f) => {
    const s = window.__lecraft.session, it = s.interaction;
    it.target = { x: f.x, y: f.y, z: f.z, nx: 0, ny: 1, nz: 0, block: I('dirt'), distance: 2, px: f.x + 0.5, py: f.y + 1, pz: f.z + 0.5 };
    s.player.inventory.selected = 0;
    it.use();
    const a = s.world.getBlock(f.x, f.y, f.z);
    it.target = { x: f.x, y: f.y, z: f.z, nx: 0, ny: 1, nz: 0, block: a, distance: 2, px: f.x + 0.5, py: f.y + 1, pz: f.z + 0.5 };
    s.player.inventory.selected = 1;
    it.use();
    return { soil: a, crop: s.world.getBlock(f.x, f.y + 1, f.z) };
  }, farm);
  check('Houe : terre → terre cultivable', tilled.soil === ids.farmland, JSON.stringify(tilled));
  check('Plantation de graines', tilled.crop === ids.wheat);
  const grown = await G((f) => {
    const s = window.__lecraft.session;
    // accélère le temps : ticks aléatoires ciblés sur la culture et la terre
    for (let i = 0; i < 400; i++) { s.ticker['randomTick'](s, f.x, f.y, f.z, I('farmland')); s.ticker['randomTick'](s, f.x, f.y + 1, f.z, I('wheat')); }
    return { meta: s.world.getMeta(f.x, f.y + 1, f.z), wet: s.world.getMeta(f.x, f.y, f.z) };
  }, farm);
  check('Croissance du blé (eau + lumière)', grown.meta === 7 && grown.wet === 1, JSON.stringify(grown));
  const harvest = await G((f) => { const s = window.__lecraft.session; s.interaction.breakBlock(f.x, f.y + 1, f.z, undefined); return s.entities.entities.filter((e) => e.kind === 'item').map((e) => e.itemId); }, farm);
  check('Récolte : blé + graines', harvest.includes('wheat') && harvest.includes('wheat_seeds'), harvest.join(','));

  // ---------- élevage ----------
  const breed = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const a = s.entities.spawnMob('cow', p.x + 3, p.y + 0.5, p.z + 1);
    const b = s.entities.spawnMob('cow', p.x + 3.5, p.y + 0.5, p.z + 1.5);
    return [a.feed(s, 'wheat'), b.feed(s, 'wheat')];
  });
  await wait(4000);
  const babies = await G(() => window.__lecraft.session.entities.mobs.filter((m) => m.def.key === 'cow' && m.baby).length);
  check('Nourrir → reproduction → bébé', breed.every(Boolean) && babies >= 1, `bébés : ${babies}`);
  await page.screenshot({ path: `${OUT}/gp-01-animals.png` });

  // ---------- four (via l'interface) ----------
  await G(() => {
    const g = window.__lecraft, s = g.session, p = s.player, inv = p.inventory;
    inv.add({ id: 'raw_iron', count: 3 }); inv.add({ id: 'coal', count: 1 });
    const x = Math.floor(p.x) + 1, y = Math.floor(p.y), z = Math.floor(p.z) + 1;
    s.world.setBlock(x, y, z, I('furnace'), 0);
    window.__furnace = { x, y, z };
    g.openInventory('furnace', window.__furnace);
  });
  await wait(300);
  // cases du fourneau : entrée 0, combustible 1, résultat 2, sac 3-29, barre 30-38
  const fslot = (n) => page.locator('.gui .gslot').nth(n);
  const ftap = async (loc) => { await loc.dispatchEvent('pointerdown'); await loc.dispatchEvent('pointerup'); await wait(80); };
  const invIdx = (id) => G((k) => window.__lecraft.session.player.inventory.slots.findIndex((x) => x?.id === k), id);
  const toGui = (i) => (i < 9 ? 30 + i : 3 + i - 9);
  await ftap(fslot(toGui(await invIdx('raw_iron'))));
  await ftap(fslot(0));
  await ftap(fslot(toGui(await invIdx('coal'))));
  await ftap(fslot(1));
  const loaded = await G(() => { const f = window.__lecraft.session.world.getFurnace(window.__furnace.x, window.__furnace.y, window.__furnace.z); return { input: f.input?.count, fuel: f.fuel?.id ?? (f.burn > 0 ? 'en combustion' : null) }; });
  check('Fourneau : entrée et combustible posés au curseur', loaded.input === 3 && (loaded.fuel === 'coal' || loaded.fuel === 'en combustion'), JSON.stringify(loaded));
  // accélère la cuisson (35 s simulées)
  const lit = await G(() => { const s = window.__lecraft.session; for (let i = 0; i < 700; i++) s['tickFurnaces'](0.05); const f = window.__furnace; return s.world.getBlock(f.x, f.y, f.z) === I('lit_furnace') || s.world.getFurnace(f.x, f.y, f.z).burn > 0; });
  check('Fourneau allumé pendant la cuisson', lit);
  await wait(300);
  await ftap(fslot(2));
  await ftap(fslot(2));
  await wait(200);
  const ingots = await G(() => window.__lecraft.session.player.inventory.count('iron_ingot'));
  check('Four : fonte du fer avec du charbon', ingots === 3, `lingots ${ingots}`);
  await page.screenshot({ path: `${OUT}/gp-02-furnace.png` });
  await page.keyboard.press('Escape');

  // ---------- structures & coffres ----------
  const dungeon = await G(() => window.__lecraft.debug.findStructure('dungeon'));
  check('Structure procédurale localisée (donjon)', !!dungeon, JSON.stringify(dungeon));
  if (dungeon) {
    await G((d) => { const dbg = window.__lecraft.debug; dbg.teleport(d.x, d.z); }, dungeon);
    await settle();
    await wait(1500);
    const sp = await G(() => { const s = window.__lecraft.session; return [...s.world.specials.values()].filter((e) => e.block === I('spawner')).length; });
    check('Cages à monstres enregistrées', sp > 0, `cages : ${sp}`);
    const chest = await G(() => {
      const s = window.__lecraft.session, w = s.world, p = s.player;
      for (const c of w.chunks.values()) for (let i = 0; i < c.blocks.length; i++) if (c.blocks[i] === I('chest') && (c.meta[i] >> 2) > 0) {
        const x = c.cx * 16 + (i & 15), z = c.cz * 16 + ((i >> 4) & 15), y = i >> 8;
        s.interaction.ensureChestLoot(x, y, z);
        const inv = w.getChest(x, y, z, false);
        return { x, y, z, items: inv.slots.filter(Boolean).map((t) => t.id) };
      }
      return null;
    });
    check('Coffre de structure avec butin', !!chest && chest.items.length > 0, chest ? chest.items.join(',') : 'aucun');
  }
  const village = await G(() => window.__lecraft.debug.findStructure('village'));
  check('Village localisable', !!village, JSON.stringify(village));

  // ---------- liquides ----------
  const flow = await G(() => {
    const s = window.__lecraft.session, w = s.world, p = s.player;
    const x = Math.floor(p.x) + 4, y = Math.floor(p.y) + 3, z = Math.floor(p.z) + 4;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) { w.setBlock(x + dx, y - 1, z + dz, I('stone')); w.setBlock(x + dx, y, z + dz, 0); }
    w.setBlock(x, y, z, I('water'), 0);
    return { x, y, z };
  });
  await wait(2500);
  const flowed = await G((f) => window.__lecraft.session.world.getBlock(f.x + 2, f.y, f.z), flow);
  check('Eau qui s’écoule dans le jeu', flowed === ids.water, `bloc à +2 : ${flowed}`);

  // ---------- lave ----------
  const lava = await G(() => {
    const s = window.__lecraft.session, w = s.world, p = s.player;
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    p.invulnerable = 0;
    const h = p.health;
    w.setBlock(x, y, z, I('lava'), 0);
    return h;
  });
  await wait(600);
  const hLava = await G(() => window.__lecraft.session.player.health);
  check('Lave : dégâts au contact', hLava < lava, `${lava} → ${hLava}`);
  await G(() => { const s = window.__lecraft.session, p = s.player; s.world.setBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), 0); p.health = p.maxHealth; });

  // ---------- météo ----------
  await G(() => { const s = window.__lecraft.session; const pos = window.__lecraft.debug.findBiome('plains'); window.__lecraft.debug.teleport(pos.x, pos.z); s.weather.state = 'storm'; s.weather.timer = 100; });
  await settle();
  await wait(6000);
  const wx = await G(() => { const s = window.__lecraft.session; return { i: s.weather.intensity, raining: s.raining(), vis: s.weatherFx.mesh.visible }; });
  check('Météo : orage / pluie', wx.i > 0.3 && wx.raining, JSON.stringify(wx));
  await page.screenshot({ path: `${OUT}/gp-03-rain.png` });
  await G(() => { const s = window.__lecraft.session; s.weather.state = 'clear'; s.weather.intensity = 0; });

  // ---------- nuit : apparitions de monstres ----------
  await G(() => { const s = window.__lecraft.session; s.dayCycle.time = 0.75; s.entities.entities.forEach((e) => (e.removed = true)); });
  let hostiles = 0;
  for (let i = 0; i < 30 && hostiles === 0; i++) { await wait(500); hostiles = await G(() => window.__lecraft.session.entities.count('hostile')); }
  check('Nuit : apparition naturelle de monstres', hostiles > 0, `monstres : ${hostiles}`);
  await page.screenshot({ path: `${OUT}/gp-04-night.png` });
  await G(() => { window.__lecraft.session.dayCycle.time = 0.2; });

  // ---------- boss ----------
  const lair = await G(() => window.__lecraft.debug.findStructure('golem_lair'));
  check('Repaire du golem localisé', !!lair, JSON.stringify(lair));
  if (lair) {
    await G((l) => { window.__lecraft.debug.teleport(l.x, l.z, 18); const s = window.__lecraft.session; s.player.body.flying = false; }, lair);
    await settle();
    let boss = null;
    for (let i = 0; i < 20 && !boss; i++) {
      await wait(500);
      boss = await G(() => { const s = window.__lecraft.session; const altar = [...s.world.specials.values()].find((e) => e.block === I('boss_altar')); if (altar) { s.player.body.setPos(altar.x + 0.5, altar.y + 1, altar.z - 4.5); s.player.gameMode = 'creative'; } const b = s.entities.activeBoss; return b ? { name: b.def.name, phase: b.phase } : null; });
    }
    check('Autel : le boss apparaît', !!boss, JSON.stringify(boss));
    if (boss) {
      await page.screenshot({ path: `${OUT}/gp-05-boss.png` });
      const ph = await G(() => { const s = window.__lecraft.session, b = s.entities.activeBoss; b.iframes = 0; s.combat.damageMob(b, b.def.health * 0.45, { kind: 'player', fromPlayer: true, itemId: 'iron_pickaxe' }); return b.health / b.def.health; });
      await wait(400);
      const phase = await G(() => window.__lecraft.session.entities.activeBoss?.phase);
      check('Boss : faiblesse (pioche ×2) et phase 2', phase >= 2, `santé ${(ph * 100).toFixed(0)} %, phase ${phase}`);
      const bar = await page.locator('.boss-bar:not(.hidden)').count();
      check('Barre de boss affichée', bar === 1);
      await G(() => { const s = window.__lecraft.session, b = s.entities.activeBoss; b.iframes = 0; s.combat.damageMob(b, 9999, { kind: 'player', fromPlayer: true }); });
      await wait(1500);
      const def = await G(() => ({ defeated: window.__lecraft.session.defeatedBosses.size, drops: window.__lecraft.session.entities.entities.filter((e) => e.kind === 'item').map((e) => e.itemId) }));
      check('Boss vaincu : enregistré + butin', def.defeated === 1 && def.drops.includes('golem_core'), JSON.stringify(def));
    }
  }

  // ---------- mémoire : quitter libère les ressources ----------
  await page.keyboard.press('Escape');
  await page.getByText('Sauvegarder et quitter').click();
  await page.waitForFunction(() => window.__lecraft.state === 'menu');
  await wait(500);
  const geo1 = await G(() => window.__lecraft.renderer.gl.info.memory.geometries);
  check('Libération des géométries WebGL en quittant', geo1 <= geo0 + 20, `avant ${geo0}, après ${geo1}`);
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
