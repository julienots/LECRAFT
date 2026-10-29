// E2E objets Java 1.21 ajoutés : blocs posés et photographiés (lits, bannières, têtes, coffres, pot
// décoré, cuivre ciré, dalles…), icônes (planche d'icônes), recettes fabriquées avec le vrai établi.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
mkdirSync(OUT, { recursive: true });
let failed = 0, total = 0;
const check = (n, ok, d = '') => { total++; if (!ok) failed++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const G = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);

const ROW1 = ['white_banner', 'red_banner', 'blue_banner', 'black_banner', 'skeleton_skull', 'zombie_head', 'creeper_head', 'player_head', 'piglin_head', 'dragon_head', 'decorated_pot', 'trapped_chest', 'copper_chest', 'oxidized_copper_chest', 'waxed_copper_lantern'];
const ROW2 = ['cut_sandstone_slab', 'smooth_red_sandstone_stairs', 'prismarine_brick_slab', 'resin_brick_wall', 'bamboo_mosaic_stairs', 'petrified_oak_slab', 'infested_stone_bricks', 'waxed_oxidized_copper', 'waxed_exposed_cut_copper', 'waxed_weathered_copper_grate', 'light_weighted_pressure_plate', 'heavy_weighted_pressure_plate', 'polished_blackstone_pressure_plate', 'suspicious_sand_0', 'spawner'];
const RECIPES = [
  [['###', 'XXX'], { '#': 'white_wool', X: 'oak_planks' }, 'white_bed', 1],
  [['AB'], { A: 'white_bed', B: 'lime_dye' }, 'lime_bed', 1],
  [['###', '###', ' | '], { '#': 'magenta_wool', '|': 'stick' }, 'magenta_banner', 1],
  [['AB'], { A: 'chest', B: 'tripwire_hook' }, 'trapped_chest', 1],
  [[' # ', '# #', ' # '], { '#': 'brick' }, 'decorated_pot', 1],
  [['CC', 'CC'], { C: 'waxed_copper_block' }, 'waxed_cut_copper', 4],
  [['AB'], { A: 'oxidized_copper_bulb', B: 'honeycomb' }, 'waxed_oxidized_copper_bulb', 1],
  [['###', '#C#', '###'], { '#': 'echo_shard', C: 'compass' }, 'recovery_compass', 1],
  [['~~ ', '~~ ', '  ~'], { '~': 'string' }, 'lead', 2],
  [['CCC', 'C#C', 'CCC'], { C: 'copper_ingot', '#': 'chest' }, 'copper_chest', 1],
];

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'MEDIUM', renderDistance: 2, autoQuality: false, gfxV: 3 })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await G(() => window.__lecraft.createWorld('Java', '4243', 'creative', 'peaceful'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(800);

  // ---------- registre : objets présents ----------
  const missing = await G(() => {
    const I = window.__lecraft.debug.registries.items;
    const keys = ['bedrock', 'farmland', 'dirt_path', 'spawner', 'snow', 'glow_lichen', 'amethyst_cluster', 'suspicious_sand', 'suspicious_gravel', 'dried_ghast', 'recovery_compass', 'tipped_arrow', 'trapped_chest', 'decorated_pot', 'waxed_copper_block', 'waxed_oxidized_lightning_rod', 'infested_deepslate', 'player_head', 'black_bed', 'white_banner', 'polished_blackstone_button'];
    return keys.filter((k) => !I.has(k) || I.get(k).hidden);
  });
  check('Objets Java présents dans l’inventaire créatif', missing.length === 0, missing.join(', '));

  // ---------- blocs posés ----------
  await G(([r1, r2]) => {
    const s = window.__lecraft.session, p = s.player;
    const x = Math.floor(p.x), z = Math.floor(p.z), y = 100;
    s.runCommand(`/fill ${x - 10} ${y - 1} ${z - 12} ${x + 10} ${y - 1} ${z + 4} stone`);
    s.runCommand(`/fill ${x - 10} ${y} ${z - 12} ${x + 10} ${y + 6} ${z + 4} air`);
    s.runCommand('/time set noon');
    r1.forEach((k, i) => s.runCommand(`/setblock ${x - 7 + i} ${y} ${z - 5} ${k}`));
    r2.forEach((k, i) => s.runCommand(`/setblock ${x - 7 + i} ${y} ${z - 8} ${k}`));
    ['white_bed', 'lime_bed', 'black_bed', 'light_blue_bed'].forEach((k, i) => s.runCommand(`/setblock ${x - 3 + i * 2} ${y} ${z - 11} ${k}`));
    p.body.setPos(x + 0.5, y + 1.5, z + 1.5);
    p.yaw = 0; p.pitch = -0.32;
    window.__a = { x, y, z };
  }, [ROW1, ROW2]);
  await wait(2500);
  const placed = await G(([r1, r2]) => {
    const s = window.__lecraft.session, B = window.__lecraft.debug.registries.blocks, { x, y, z } = window.__a;
    const bad = [];
    r1.forEach((k, i) => B.get(s.world.getBlock(x - 7 + i, y, z - 5)).key !== k && bad.push(k));
    r2.forEach((k, i) => B.get(s.world.getBlock(x - 7 + i, y, z - 8)).key !== k && bad.push(k));
    return bad;
  }, [ROW1, ROW2]);
  check('Nouveaux blocs posés', placed.length === 0, placed.join(', '));
  await page.screenshot({ path: `${OUT}/java-blocks.png` });
  await G(() => { const p = window.__lecraft.session.player, { x, y, z } = window.__a; p.body.setPos(x + 0.5, y + 1.2, z - 6.2); p.yaw = 0; p.pitch = -0.45; });
  await wait(1200);
  await page.screenshot({ path: `${OUT}/java-blocks-2.png` });

  // ---------- planche d'icônes ----------
  await G(() => {
    const keys = ['white_bed', 'red_bed', 'lime_bed', 'black_bed', 'shield', 'crossbow', 'clock', 'compass', 'recovery_compass', 'tipped_arrow', 'enchanted_golden_apple', 'light',
      'skeleton_skull', 'wither_skeleton_skull', 'zombie_head', 'creeper_head', 'player_head', 'piglin_head', 'dragon_head', 'red_banner', 'blue_banner', 'decorated_pot', 'trapped_chest', 'copper_chest',
      'weathered_copper_chest', 'waxed_copper_door', 'waxed_oxidized_copper_trapdoor', 'waxed_copper_lantern', 'waxed_exposed_copper_bulb', 'waxed_lightning_rod', 'waxed_cut_copper_stairs', 'snow', 'farmland', 'dirt_path', 'bedrock', 'spawner',
      'glow_lichen', 'amethyst_cluster', 'suspicious_sand', 'suspicious_gravel', 'dried_ghast', 'infested_cobblestone', 'polished_blackstone_button', 'heavy_weighted_pressure_plate', 'resin_brick_wall', 'bamboo_mosaic_slab', 'cut_red_sandstone_slab', 'petrified_oak_slab'];
    const d = document.createElement('div');
    d.id = 'iconsheet';
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#8b8b8b;display:flex;flex-wrap:wrap;align-content:flex-start;gap:4px;padding:6px';
    for (const k of keys) {
      const img = document.createElement('img');
      img.src = window.__lecraft.textures.iconURL(k);
      img.title = k;
      img.style.cssText = 'width:64px;height:64px;image-rendering:pixelated;background:#c6c6c6';
      d.append(img);
    }
    document.body.append(d);
  });
  await wait(500);
  await page.screenshot({ path: `${OUT}/java-icons.png` });
  await G(() => document.getElementById('iconsheet')?.remove());

  // ---------- établi : recettes Java avec la vraie grille ----------
  await G(() => { const s = window.__lecraft.session, { x, y, z } = window.__a; s.runCommand(`/setblock ${x} ${y} ${z - 2} crafting_table`); });
  await wait(300);
  const openTable = () => G(() => {
    const s = window.__lecraft.session, p = s.player, { x, y, z } = window.__a;
    if (window.__lecraft.inventoryUI) window.__lecraft.closeInventory?.();
    s.interaction.targetMob = null;
    s.interaction.target = { x, y, z: z - 2, nx: 0, ny: 1, nz: 0, block: s.world.getBlock(x, y, z - 2), distance: 2, px: x + 0.5, py: y + 1, pz: z - 1.5 };
    p.inventory.selected = 8;
    p.inventory.slots[8] = null;
    s.interaction.use();
  });
  for (const [rows, key, item, count] of RECIPES) {
    await openTable();
    await wait(250);
    const res = await G(([rows, key]) => {
      const ui = window.__lecraft.inventoryUI, g = ui?.grid;
      if (!g) return { err: 'pas d’établi' };
      g.slots.fill(null);
      rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== ' ' && (g.slots[y * 3 + x] = { id: key[ch], count: 1 })));
      const r = g.result;
      return { id: r?.id ?? null, count: r?.count ?? 0 };
    }, [rows, key]);
    check(`Établi : ${item} ×${count}`, res.id === item && res.count === count, JSON.stringify(res));
  }
  // flèches à effet : l'effet de la potion persistante est conservé
  await openTable();
  await wait(250);
  const tipped = await G(() => {
    const g = window.__lecraft.inventoryUI?.grid;
    if (!g) return null;
    g.slots.fill(null);
    for (let i = 0; i < 9; i++) g.slots[i] = i === 4 ? { id: 'lingering_potion', count: 1, meta: { potion: 'poison' } } : { id: 'arrow', count: 1 };
    const r = g.result;
    return r && `${r.id}×${r.count}:${r.meta?.potion}`;
  });
  check('Établi : flèches à effet (poison) ×8', tipped === 'tipped_arrow×8:poison', String(tipped));
  await G(() => window.__lecraft.closeInventory?.());
  check('Aucune erreur', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('exécution', false, String(e));
} finally {
  console.log(`${total - failed}/${total} vérifications réussies`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}
