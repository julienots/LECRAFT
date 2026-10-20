// Captures de toutes les interfaces (HUD, écrans, conteneurs) pour comparaison visuelle avec le
// jeu original. Usage : URL=http://localhost:4173/ OUT=dossier W=915 H=412 node scripts/e2e-ui-shots.mjs
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
const W = +(process.env.W ?? 915), H = +(process.env.H ?? 412);
const TAG = process.env.TAG ?? `${W}`;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const G = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (n) => {
  if (ONLY && !ONLY.test(n)) return;
  await page.screenshot({ path: `${OUT}/ui-${TAG}-${n}.png` });
};
const tapKey = (key) => page.locator(`[data-key="${key}"]`).evaluate((el) => { for (const t of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerType: 'mouse' })); });

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'LOW', renderDistance: 2, autoQuality: false, gfxV: 3 })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await wait(1500);
  await shot('menu');
  await G(() => window.__lecraft.showNewWorld());
  await wait(400);
  await shot('newworld');
  await G(() => window.__lecraft.back());
  await G(() => window.__lecraft.showSettings());
  await wait(400);
  await shot('settings');
  await G(() => window.__lecraft.back());
  await G(() => window.__lecraft.createWorld('UI', '4242', 'survival', 'normal'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(1200);
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const x = Math.floor(p.x), z = Math.floor(p.z), y = 100;
    s.runCommand(`/fill ${x - 6} ${y - 1} ${z - 6} ${x + 6} ${y - 1} ${z + 6} stone`);
    s.runCommand(`/fill ${x - 6} ${y} ${z - 6} ${x + 6} ${y + 4} ${z + 6} air`);
    s.runCommand('/time set day');
    p.body.setPos(x + 0.5, y, z + 0.5);
    window.__a = { x, y, z };
    p.inventory.clear();
    const add = (id, count = 1, extra = {}) => p.inventory.add({ id, count, ...extra });
    add('diamond_sword', 1, { durability: 900, meta: { ench: { sharpness: 3 } } });
    add('stone', 64); add('oak_planks', 23); add('bread', 5); add('iron_pickaxe', 1, { durability: 100 }); add('torch', 32);
    add('golden_apple', 2); add('cobblestone', 64); add('coal', 9);
    add('oak_log', 12); add('iron_ingot', 7); add('stick', 30);
    p.inventory.armor.head = { id: 'iron_helmet', count: 1, durability: 165 };
    p.inventory.armor.chest = { id: 'iron_chestplate', count: 1, durability: 240 };
    p.inventory.changed();
    p.level = 27; p.xp = Math.floor(p.xpToNext * 0.6);
    p.health = 13; p.hunger = 15;
    p.inventory.selected = 0;
  });
  await wait(800);
  await shot('hud');
  await G(() => { const p = window.__lecraft.session.player; p.inventory.selected = 1; });
  await wait(300);
  await shot('hud-itemname');
  await G(() => { const s = window.__lecraft.session; s.player.air = 130; window.__lecraft.hud.setBoss('Dragon de l\'Ender', 0.6, 1); window.__bossOrig = window.__lecraft.hud.setBoss; window.__lecraft.hud.setBoss = () => {}; window.__lecraft.hud.showTitle('Bienvenue', 'title'); window.__lecraft.hud.showTitle('sous-titre', 'subtitle'); window.__lecraft.hud.showTitle('§eBarre d\'action', 'actionbar'); });
  await wait(400);
  await shot('hud-air-boss-title');
  await G(() => { const s = window.__lecraft.session; s.player.air = 300; window.__lecraft.hud.setBoss = window.__bossOrig; window.__lecraft.hud.setBoss(null); window.__lecraft.hud.showTitle('', 'title'); s.player.effects.add('poison', 30, 0); s.player.effects.add('hunger', 30, 0); s.player.effects.add('absorption', 30, 1); s.player.absorption = 8; });
  await wait(400);
  await shot('hud-poison');
  await G(() => { const s = window.__lecraft.session, p = s.player; p.effects.remove?.('poison'); p.effects.remove?.('hunger'); p.absorption = 0; p.health = 13; p.invulnerable = 0; p.damage(3, 'generic'); });
  await wait(250);
  await shot('hud-blink');
  await G(() => { const s = window.__lecraft.session, p = s.player; p.health = 3; p.saturation = 0; p.hunger = 6; p.effects.add('regeneration', 30, 0); s.entities.combat.cooldown = 0.6; });
  await wait(150);
  await shot('hud-low-regen-cooldown');
  await G(() => { const s = window.__lecraft.session, p = s.player; p.effects.remove?.('regeneration'); p.health = 20; p.hunger = 20; p.saturation = 5; window.__lecraft.hud.toast('🏆 Vétéran — Atteindre le niveau 10.', 'achievement'); window.__lecraft.hud.setDebug(true); });
  await wait(900);
  await shot('hud-f3');
  await G(() => window.__lecraft.hud.setDebug(false));
  // inventaire de survie
  await G(() => window.__lecraft.openInventory('hand'));
  await wait(500);
  await shot('inv');
  for (const id of ['diamond_sword', 'iron_pickaxe', 'golden_apple']) {
    await G((id) => { const ui = window.__lecraft.inventoryUI; const i = window.__lecraft.session.player.inventory.slots.findIndex((s) => s?.id === id); ui.showTooltip(ui.slots.find((s) => s.key === `inv${i}`)); }, id);
    await wait(200);
    await shot(`inv-tooltip-${id}`);
  }
  await G(() => { const ui = window.__lecraft.inventoryUI; ui.showTooltip(ui.slots.find((s) => s.key === 'armor_head')); });
  await wait(200);
  await shot('inv-tooltip-helmet');
  await G(() => window.__lecraft.closeInventory());
  const station = async (block, name) => {
    await G((b) => {
      const s = window.__lecraft.session, p = s.player, { x, y, z } = window.__a;
      s.runCommand(`/setblock ${x} ${y} ${z - 3} ${b}`);
      s.interaction.targetMob = null;
      s.interaction.target = { x, y, z: z - 3, nx: 0, ny: 0, nz: 1, block: s.world.getBlock(x, y, z - 3), distance: 2, px: x + 0.5, py: y + 0.5, pz: z - 2 };
      p.inventory.selected = 8; p.inventory.slots[8] = null; p.sneaking = false;
      s.interaction.use();
    }, block);
    await wait(500);
    await shot(name);
    await G(() => window.__lecraft.closeInventory());
    await wait(100);
  };
  await station('crafting_table', 'table');
  // fourneau en marche
  await G(() => {
    const s = window.__lecraft.session, { x, y, z } = window.__a;
    s.runCommand(`/setblock ${x} ${y} ${z - 3} furnace`);
    const f = s.world.getFurnace(x, y, z - 3);
    f.input = { id: 'iron_ore', count: 3 }; f.fuel = { id: 'coal', count: 4 }; f.burn = 5; f.burnMax = 8; f.cook = 5; f.output = { id: 'iron_ingot', count: 2 };
  });
  await station('furnace', 'furnace');
  await station('chest', 'chest');
  await station('enchanting_table', 'enchant');
  // table d'enchantement avec une épée et du lapis
  await G(() => { const s = window.__lecraft.session, p = s.player; p.level = 30; p.inventory.add({ id: 'iron_sword', count: 1, durability: 250 }); p.inventory.add({ id: 'lapis_lazuli', count: 2 }); });
  await G(() => { const { x, y, z } = window.__a; window.__lecraft.openInventory('enchant', { x, y, z: z - 3 }); });
  await wait(400);
  await G(() => { const ui = window.__lecraft.inventoryUI, st = ui.station, inv = window.__lecraft.session.player.inventory; const i = inv.slots.findIndex((x) => x?.id === 'iron_sword'); st.item = inv.slots[i]; inv.slots[i] = null; const j = inv.slots.findIndex((x) => x?.id === 'lapis_lazuli'); st.lapis = inv.slots[j]; inv.slots[j] = null; inv.changed(); ui.refresh(); });
  await wait(300);
  await shot('enchant-offers');
  await G(() => window.__lecraft.closeInventory());
  await station('anvil', 'anvil');
  await G(() => { const s = window.__lecraft.session; s.runCommand(`/setblock ${window.__a.x} ${window.__a.y} ${window.__a.z - 3} anvil`); const { x, y, z } = window.__a; window.__lecraft.openInventory('anvil', { x, y, z: z - 3 }); });
  await wait(400);
  await G(() => { const ui = window.__lecraft.inventoryUI, st = ui.station, inv = window.__lecraft.session.player.inventory; const i = inv.slots.findIndex((x) => x?.id === 'iron_pickaxe'); st.a = inv.slots[i]; inv.slots[i] = null; st.b = { id: 'iron_ingot', count: 2 }; inv.changed(); ui.refresh(); });
  await wait(300);
  await shot('anvil-repair');
  await G(() => window.__lecraft.closeInventory());
  await G(() => {
    const s = window.__lecraft.session, { x, y, z } = window.__a;
    s.runCommand(`/setblock ${x} ${y} ${z - 3} brewing_stand`);
    const b = s.world.getBrewing(x, y, z - 3);
    b.bottles[0] = { id: 'potion', count: 1 }; b.ingredient = { id: 'nether_wart', count: 3 }; b.fuel = 12; b.time = 9;
  });
  await station('brewing_stand', 'brewing');
  await station('blast_furnace', 'blast-furnace');
  await station('dispenser', 'dispenser');
  await station('hopper', 'hopper');
  await station('ender_chest', 'ender');
  await station('barrel', 'barrel');
  await station('shulker_box', 'shulker');
  // créatif
  await G(() => { window.__lecraft.session.runCommand('/gamemode creative'); });
  await wait(300);
  await shot('hud-creative');
  await G(() => window.__lecraft.openInventory('hand'));
  await wait(500);
  await shot('creative');
  await G(() => window.__lecraft.closeInventory());
  await G(() => { window.__lecraft.session.runCommand('/gamemode survival'); });
  // chat, pause, mort
  await G(() => window.__lecraft.openChat(''));
  await wait(400);
  await shot('chat');
  await page.keyboard.press('Escape');
  await wait(300);
  await G(() => window.__lecraft.pause());
  await wait(400);
  await shot('pause');
  await G(() => window.__lecraft.resume());
  await wait(300);
  await G(() => { const p = window.__lecraft.session.player; p.damage ? p.damage(100, 'generic') : (p.health = 0); });
  await wait(1500);
  await shot('death');
  console.log('errors:', errors.slice(0, 5));
} catch (e) {
  console.error(e);
  await page.screenshot({ path: `${OUT}/ui-${TAG}-error.png` });
  process.exitCode = 1;
} finally {
  await browser.close();
}
