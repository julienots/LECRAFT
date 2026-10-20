// E2E recettes / minage du jeu original : recettes officielles fabriquées avec le vrai établi
// (grille + prise du résultat), propriétés des objets (piles, usure, combustibles) et temps de
// minage mesurés avec la vraie boucle de minage du joueur.
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
let failed = 0, total = 0;
const check = (n, ok, d = '') => { total++; if (!ok) failed++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const G = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);
const tapKey = (key) => page.locator(`[data-key="${key}"]`).evaluate((el) => { const evs = ['pointerdown', 'pointerup'].map((t) => new PointerEvent(t, { bubbles: true, pointerType: 'touch' })); for (const e of evs) el.dispatchEvent(e); });

// [motif, clé, résultat attendu, nombre]
const RECIPES = [
  [['# #', '###'], { '#': 'oak_planks' }, 'oak_boat', 1],
  [['###', '###', ' | '], { '#': 'spruce_planks', '|': 'stick' }, 'spruce_sign', 3],
  [['X X', 'X#X', 'X X'], { X: 'iron_ingot', '#': 'stick' }, 'rail', 16],
  [['III', ' i ', 'iii'], { I: 'iron_block', i: 'iron_ingot' }, 'anvil', 1],
  [['###', '# #', '###'], { '#': 'cobbled_deepslate' }, 'furnace', 1],
  [['XXX', ' # ', ' # '], { X: 'blackstone', '#': 'stick' }, 'stone_pickaxe', 1],
  [['PSP', 'P P', 'PSP'], { P: 'oak_planks', S: 'birch_slab' }, 'barrel', 1],
  [['GGG', 'GSG', 'OOO'], { G: 'glass', S: 'nether_star', O: 'obsidian' }, 'beacon', 1],
  [['#'], { '#': 'stripped_oak_wood' }, 'oak_planks', 4],
  [['AB'], { A: 'red_wool', B: 'blue_dye' }, 'blue_wool', 1],
];

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'MEDIUM', renderDistance: 2, autoQuality: false, gfxV: 3 })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await G(() => window.__lecraft.createWorld('Recettes', '4242', 'survival', 'peaceful'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(800);
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const x = Math.floor(p.x), z = Math.floor(p.z), y = 100;
    s.runCommand(`/fill ${x - 6} ${y - 1} ${z - 6} ${x + 6} ${y - 1} ${z + 6} stone`);
    s.runCommand(`/fill ${x - 6} ${y} ${z - 6} ${x + 6} ${y + 4} ${z + 6} air`);
    s.runCommand('/time set day');
    p.body.setPos(x + 0.5, y, z + 0.5);
    window.__a = { x, y, z };
    s.runCommand(`/setblock ${x} ${y} ${z - 2} crafting_table`);
  });
  await wait(600);

  // ---------- propriétés des objets (registre du jeu) ----------
  const props = await G(() => {
    const I = window.__lecraft.debug.registries.items;
    return {
      stack: ['ender_pearl', 'oak_sign', 'bucket', 'cake', 'water_bucket', 'white_shulker_box'].map((k) => I.maxStack(k)),
      dur: ['trident', 'fishing_rod', 'elytra', 'netherite_pickaxe', 'shield'].map((k) => I.maxDurability(k)),
      fuel: ['blaze_rod', 'cherry_planks', 'oak_boat', 'mangrove_slab', 'crimson_planks'].map((k) => I.get(k)?.burnTime ?? null),
      gapple: I.get('enchanted_golden_apple')?.food?.hunger ?? null,
    };
  });
  check('Piles (16 / 1)', JSON.stringify(props.stack) === '[16,16,16,1,1,1]', JSON.stringify(props.stack));
  check('Usures', JSON.stringify(props.dur) === '[250,64,432,2031,336]', JSON.stringify(props.dur));
  check('Combustibles', JSON.stringify(props.fuel) === '[120,15,60,7.5,null]', JSON.stringify(props.fuel));
  check('Pomme dorée enchantée comestible', props.gapple === 4);
  const hard = await G(() => {
    const B = window.__lecraft.debug.registries.blocks;
    return ['obsidian', 'deepslate_iron_ore', 'lantern', 'enchanting_table'].map((k) => { const b = B.byName(k); return `${b.hardness}/${b.tool}/${b.minTier}`; });
  });
  check('Dureté / outil / tier', JSON.stringify(hard) === JSON.stringify(['50/pickaxe/4', '4.5/pickaxe/2', '3.5/pickaxe/1', '5/pickaxe/1']), JSON.stringify(hard));

  // ---------- établi : recettes officielles avec la vraie grille ----------
  for (const [rows, key, item, count] of RECIPES) {
    await G(() => {
      const s = window.__lecraft.session, p = s.player, { x, y, z } = window.__a;
      if (window.__lecraft.inventoryUI) window.__lecraft.closeInventory?.();
      p.inventory.clear();
      s.interaction.targetMob = null;
      s.interaction.target = { x, y, z: z - 2, nx: 0, ny: 1, nz: 0, block: s.world.getBlock(x, y, z - 2), distance: 2, px: x + 0.5, py: y + 1, pz: z - 1.5 };
      p.inventory.selected = 8;
      p.inventory.slots[8] = null;
      s.interaction.use();
    });
    await wait(250);
    const res = await G(([rows, key]) => {
      const ui = window.__lecraft.inventoryUI;
      const g = ui?.grid;
      if (!g) return { err: 'pas d’établi' };
      g.slots.fill(null);
      rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== ' ' && (g.slots[y * 3 + x] = { id: key[ch], count: 1 })));
      ui.refresh?.();
      const r = g.result;
      return { id: r?.id ?? null, count: r?.count ?? 0 };
    }, [rows, key]);
    let taken = false;
    if (res.id === item) {
      await tapKey('result');
      await wait(150);
      taken = await G(([item]) => {
        const p = window.__lecraft.session.player;
        const inHand = p.inventory.cursor ?? window.__lecraft.inventoryUI?.held ?? null;
        return p.inventory.count(item) > 0 || inHand?.id === item || window.__lecraft.inventoryUI?.grid?.slots.every((s) => s === null);
      }, [item]);
    }
    check(`Établi : ${item} ×${count}`, res.id === item && res.count === count && taken, JSON.stringify(res));
  }
  await G(() => window.__lecraft.closeInventory?.());
  await wait(200);

  // ---------- temps de minage mesurés (boucle de minage réelle, pas de 0,05 s) ----------
  const MINE = [
    ['stone', undefined, 7.5], ['stone', 'wooden_pickaxe', 1.15], ['stone', 'golden_pickaxe', 0.2], ['dirt', 'wooden_shovel', 0.4],
    ['oak_log', undefined, 3], ['obsidian', 'diamond_pickaxe', 9.4], ['obsidian', 'iron_pickaxe', 41.7], ['deepslate', 'iron_pickaxe', 0.75],
  ];
  for (const [block, tool, expected] of MINE) {
    const r = await G(([block, tool]) => {
      const s = window.__lecraft.session, p = s.player, { x, y, z } = window.__a;
      p.creative = false;
      s.runCommand(`/setblock ${x + 2} ${y} ${z} ${block}`);
      p.inventory.clear();
      if (tool) p.inventory.slots[p.inventory.selected] = { id: tool, count: 1, durability: window.__lecraft.debug.registries.items.maxDurability(tool) };
      p.body.onGround = true;
      const it = s.interaction;
      it.miningKey = '';
      it.target = { x: x + 2, y, z, nx: -1, ny: 0, nz: 0, block: s.world.getBlock(x + 2, y, z), distance: 2, px: x + 2, py: y + 0.5, pz: z + 0.5 };
      let t = 0;
      while (s.world.getBlock(x + 2, y, z) !== 0 && t < 120) {
        it.mine(0.05, tool);
        t += 0.05;
      }
      return Math.round(t * 100) / 100;
    }, [block, tool]);
    check(`Minage ${block} ${tool ?? 'à la main'} ≈ ${expected} s`, Math.abs(r - expected) <= 0.06, `${r} s`);
  }
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
