// E2E blocs fonctionnels (v2.26) : table d'enchantement (enchantements réels), enclume
// (fusion, réparation, nom), alambic et potions (bue, jetable), coffre de l'Ender, boîte de
// shulker qui garde son contenu, couvercle de coffre animé, distributeur / dropper / entonnoir
// (redstone), inventaire créatif sans blocs techniques.
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
const shot = (n) => page.screenshot({ path: `${OUT}/stations-${n}.png` });
// toucher d'une case de l'interface par sa clé (événements créés d'avance, comme un vrai écran)
const tapKey = (key) => page.locator(`[data-key="${key}"]`).evaluate((el) => { const evs = ['pointerdown', 'pointerup'].map((t) => new PointerEvent(t, { bubbles: true, pointerType: 'touch' })); for (const e of evs) el.dispatchEvent(e); });
const tapSel = (sel) => page.locator(sel).first().evaluate((el) => { const evs = ['pointerdown', 'pointerup'].map((t) => new PointerEvent(t, { bubbles: true, pointerType: 'touch' })); for (const e of evs) el.dispatchEvent(e); });

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'MEDIUM', renderDistance: 2, autoQuality: false, gfxV: 3 })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await G(() => window.__lecraft.createWorld('Stations', '777', 'survival', 'peaceful'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(800);
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const x = Math.floor(p.x), z = Math.floor(p.z), y = 100;
    s.runCommand(`/fill ${x - 9} ${y - 1} ${z - 9} ${x + 9} ${y - 1} ${z + 9} stone`);
    s.runCommand(`/fill ${x - 9} ${y} ${z - 9} ${x + 9} ${y + 5} ${z + 9} air`);
    s.runCommand('/time set day');
    p.body.setPos(x + 0.5, y, z + 0.5);
    window.__a = { x, y, z };
    window.__open = (bx, by, bz) => { s.interaction.targetMob = null; s.interaction.target = { x: bx, y: by, z: bz, nx: 0, ny: 1, nz: 0, block: s.world.getBlock(bx, by, bz), distance: 2, px: bx + 0.5, py: by + 1, pz: bz + 0.5 }; p.inventory.selected = 8; p.inventory.slots[8] = null; s.interaction.use(); };
  });

  // ---------- table d'enchantement ----------
  await G(() => {
    const s = window.__lecraft.session, p = s.player, { x, y, z } = window.__a;
    s.runCommand(`/setblock ${x} ${y} ${z - 4} enchanting_table`);
    // 15 bibliothèques en anneau à 2 blocs
    let n = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === 2 && n++ < 15) s.runCommand(`/setblock ${x + dx} ${y} ${z - 4 + dz} bookshelf`);
    p.level = 40;
    p.inventory.clear();
    p.inventory.add({ id: 'diamond_sword', count: 1, durability: 1561 });
    p.inventory.add({ id: 'lapis_lazuli', count: 10 });
    window.__open(x, y, z - 4);
  });
  await wait(500);
  const enchUi = await G(() => ({ ui: !!window.__lecraft.inventoryUI, buttons: document.querySelectorAll('[data-enchant]').length }));
  check('Table d’enchantement : interface (3 propositions)', enchUi.ui && enchUi.buttons === 3, JSON.stringify(enchUi));
  // épée et lapis posés avec les touchers (prendre puis poser)
  const swordSlot = await G(() => window.__lecraft.session.player.inventory.slots.findIndex((s) => s?.id === 'diamond_sword'));
  const lapisSlot = await G(() => window.__lecraft.session.player.inventory.slots.findIndex((s) => s?.id === 'lapis_lazuli'));
  await tapKey(`inv${swordSlot}`); await tapKey('ench_item');
  await tapKey(`inv${lapisSlot}`); await tapKey('ench_lapis');
  await wait(300);
  const offers = await G(() => { const st = window.__lecraft.inventoryUI.station; return { levels: st.offers.map((o) => o.level), on: [...document.querySelectorAll('[data-enchant]')].filter((b) => !b.classList.contains('off')).length, drawn: document.querySelectorAll('[data-enchant] canvas, [data-enchant] .gui-lapis').length }; });
  check('Propositions affichées avec niveaux (30 avec 15 bibliothèques)', offers.levels.length === 3 && offers.levels[2] === 30 && offers.on === 3 && offers.drawn >= 3, JSON.stringify(offers));
  await shot('01-enchant');
  await tapSel('[data-enchant="2"]');
  await wait(300);
  await G(() => window.__lecraft.closeInventory());
  const ench = await G(() => { const p = window.__lecraft.session.player; const st = p.inventory.slots.find((s) => s?.id === 'diamond_sword'); return { meta: st?.meta ?? null, level: p.level, lapis: p.inventory.count('lapis_lazuli') }; });
  check('Enchantement appliqué (niveaux et lapis dépensés)', !!ench.meta?.ench && Object.keys(ench.meta.ench).length >= 1 && ench.level === 37 && ench.lapis === 7, JSON.stringify(ench));
  const dmg = await G(() => {
    const s = window.__lecraft.session, p = s.player, { x, y, z } = window.__a;
    p.inventory.selected = p.inventory.slots.findIndex((st) => st?.id === 'diamond_sword');
    const st = p.inventory.selectedStack;
    st.meta = { ench: { sharpness: 5, fire_aspect: 2 } };
    const m = s.entities.spawnMob('cow', x + 0.5, y, z + 2.5, { persistent: true });
    s.entities.combat.cooldown = 0;
    const h0 = m.health;
    s.entities.combat.playerAttack(s, m);
    return { lost: h0 - m.health, fire: m.fireTime };
  });
  check('Tranchant V + Aura de feu : plus de dégâts, la créature brûle', dmg.lost >= 9 && dmg.fire > 0, JSON.stringify(dmg));
  await page.locator('.mc-hotbar').screenshot({ path: `${OUT}/stations-02-glint.png` }).catch(() => {});

  // ---------- enclume ----------
  await G(() => {
    const s = window.__lecraft.session, p = s.player, { x, y, z } = window.__a;
    s.runCommand(`/setblock ${x + 3} ${y} ${z} anvil`);
    p.inventory.clear();
    p.inventory.add({ id: 'iron_pickaxe', count: 1, durability: 50 });
    p.inventory.add({ id: 'enchanted_book', count: 1, meta: { ench: { efficiency: 4 } } });
    p.inventory.add({ id: 'iron_ingot', count: 2 });
    p.level = 20;
    window.__open(x + 3, y, z);
  });
  await wait(400);
  const pick = await G(() => window.__lecraft.session.player.inventory.slots.findIndex((s) => s?.id === 'iron_pickaxe'));
  const book = await G(() => window.__lecraft.session.player.inventory.slots.findIndex((s) => s?.id === 'enchanted_book'));
  await tapKey(`inv${pick}`); await tapKey('anvil_a');
  await tapKey(`inv${book}`); await tapKey('anvil_b');
  await page.locator('[data-anvil-name]').fill('Pioche du roi');
  await wait(300);
  await shot('03-anvil');
  await tapKey('anvil_out');
  await wait(200);
  const out = await G(() => { const ui = window.__lecraft.inventoryUI; return { carried: ui?.carried ?? null, level: window.__lecraft.session.player.level }; });
  check('Enclume : livre fusionné + renommage, niveaux dépensés', out.carried?.meta?.ench?.efficiency === 4 && out.carried?.meta?.name === 'Pioche du roi' && out.level < 20, JSON.stringify(out));
  await G(() => window.__lecraft.closeInventory());
  const repair = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const st = p.inventory.slots.find((x) => x?.id === 'iron_pickaxe');
    return { name: st?.meta?.name, eff: st?.meta?.ench?.efficiency };
  });
  check('Objet renommé et enchanté conservé dans l’inventaire', repair.name === 'Pioche du roi' && repair.eff === 4, JSON.stringify(repair));

  // ---------- alambic et potions ----------
  const brew = await G(async () => {
    const s = window.__lecraft.session, p = s.player, { x, y, z } = window.__a, w = s.world;
    s.runCommand(`/setblock ${x - 3} ${y} ${z} brewing_stand`);
    const b = w.getBrewing(x - 3, y, z);
    b.bottles = [{ id: 'potion', count: 1, meta: { potion: 'water' } }, { id: 'potion', count: 1, meta: { potion: 'water' } }, null];
    b.ingredient = { id: 'nether_wart', count: 1 };
    b.fuelItem = { id: 'blaze_powder', count: 1 };
    window.__open(x - 3, y, z);
    await new Promise((r) => setTimeout(r, 300));
    const ui = !!window.__lecraft.inventoryUI;
    // infusion de 20 s : avancée directement
    for (let i = 0; i < 30 && b.time <= 0; i++) await new Promise((r) => setTimeout(r, 100));
    const started = b.time > 0;
    b.time = 0.05;
    await new Promise((r) => setTimeout(r, 400));
    return { ui, started, bottles: b.bottles.map((x) => x?.meta?.potion ?? null) };
  });
  await shot('04-brewing');
  check('Alambic : interface, infusion lancée (poudre de blaze), potions étranges', brew.ui && brew.started && brew.bottles[0] === 'awkward' && brew.bottles[1] === 'awkward', JSON.stringify(brew));
  await G(() => window.__lecraft.closeInventory());
  const drink = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    p.inventory.clear();
    p.inventory.slots[0] = { id: 'potion', count: 1, meta: { potion: 'swiftness' } };
    p.inventory.selected = 0;
    s.interaction.target = null; s.interaction.targetMob = null;
    s.interaction.use();
    return { speed: p.effects.level('speed'), hand: p.inventory.slots[0]?.id };
  });
  check('Potion de rapidité bue : effet + fiole vide', drink.speed === 1 && drink.hand === 'glass_bottle', JSON.stringify(drink));
  const splash = await G(async () => {
    const s = window.__lecraft.session, p = s.player, { x, y, z } = window.__a;
    const m = s.entities.spawnMob('pig', x + 0.5, y, z - 2.5, { persistent: true });
    p.inventory.slots[1] = { id: 'splash_potion', count: 1, meta: { potion: 'slowness' } };
    p.inventory.selected = 1;
    p.yaw = 0; p.pitch = -0.9;
    s.interaction.target = null; s.interaction.targetMob = null;
    s.interaction.use();
    for (let i = 0; i < 40 && !m.effects.level('slowness'); i++) await new Promise((r) => setTimeout(r, 100));
    return { pig: m.effects.level('slowness'), left: p.inventory.count('splash_potion') };
  });
  check('Potion jetable : lancée, effet sur la créature proche', splash.pig >= 1 && splash.left === 0, JSON.stringify(splash));

  // ---------- coffre de l'Ender, couvercle animé, shulker ----------
  const ender = await G(async () => {
    const s = window.__lecraft.session, p = s.player, { x, y, z } = window.__a;
    s.runCommand(`/setblock ${x + 2} ${y} ${z + 3} ender_chest_block`);
    s.runCommand(`/setblock ${x - 2} ${y} ${z + 3} ender_chest_block`);
    p.enderChest.slots[0] = { id: 'diamond', count: 5 };
    window.__open(x - 2, y, z + 3);
    await new Promise((r) => setTimeout(r, 300));
    const seen = [...document.querySelectorAll('[data-key="chest0"]')].map((e) => e.dataset.sig).join();
    window.__lecraft.closeInventory();
    return { seen };
  });
  check('Coffre de l’Ender : inventaire personnel partagé', /diamond:5/.test(ender.seen), JSON.stringify(ender));
  const lid = await G(async () => {
    const s = window.__lecraft.session, p = s.player, { x, y, z } = window.__a;
    s.runCommand(`/setblock ${x} ${y} ${z + 3} chest`);
    p.body.setPos(x + 0.5, y, z + 0.5); p.yaw = Math.PI; p.pitch = -0.5;
    window.__open(x, y, z + 3);
    await new Promise((r) => setTimeout(r, 450));
    const open = s.world.getMeta(x, y, z + 3) & 128;
    const lids = s.chestLids.group.children.length;
    return { open, lids };
  });
  await G(() => window.__lecraft.closeInventory());
  await wait(80);
  await shot('05-chest-lid');
  await wait(700);
  const lidClosed = await G(() => { const s = window.__lecraft.session, { x, y, z } = window.__a; return { meta: s.world.getMeta(x, y, z + 3) & 128, lids: s.chestLids.group.children.length }; });
  check('Coffre : couvercle animé à l’ouverture puis refermé', lid.open === 128 && lid.lids === 1 && lidClosed.meta === 0 && lidClosed.lids === 0, JSON.stringify({ lid, lidClosed }));
  const shulker = await G(() => {
    const s = window.__lecraft.session, p = s.player, { x, y, z } = window.__a;
    s.runCommand(`/setblock ${x + 4} ${y} ${z + 3} white_shulker_box`);
    s.world.getChest(x + 4, y, z + 3).slots[3] = { id: 'emerald', count: 9 };
    p.inventory.clear();
    s.interaction.breakBlock(x + 4, y, z + 3, 'iron_pickaxe');
    const drops = s.entities.entities.filter((e) => e.kind === 'item' && Math.abs(e.x - x - 4.5) < 1.5 && Math.abs(e.z - z - 3.5) < 1.5);
    const box = drops.find((e) => e.itemId === 'white_shulker_box');
    const loose = drops.filter((e) => e.itemId === 'emerald').length;
    return { box: !!box, meta: box?.meta ?? null, loose };
  });
  check('Boîte de shulker cassée : garde son contenu (pas d’objets éparpillés)', shulker.box && shulker.meta?.items?.[3]?.id === 'emerald' && shulker.loose === 0, JSON.stringify(shulker));
  const replace = await G(() => {
    const s = window.__lecraft.session, p = s.player, { x, y, z } = window.__a;
    const it = s.entities.entities.find((e) => e.kind === 'item' && e.itemId === 'white_shulker_box');
    p.inventory.clear();
    p.inventory.slots[0] = { id: 'white_shulker_box', count: 1, meta: it.meta };
    p.inventory.selected = 0;
    it.removed = true;
    s.interaction.target = { x: x + 4, y: y - 1, z: z + 3, nx: 0, ny: 1, nz: 0, block: s.world.getBlock(x + 4, y - 1, z + 3), distance: 2, px: x + 4.5, py: y, pz: z + 3.5 };
    s.interaction.preview = s.interaction.computePlacement(s.interaction.target, window.__lecraft.debug.blockId('white_shulker_box'));
    s.interaction.use();
    return s.world.containerItems(x + 4, y, z + 3).map((i) => `${i.id}x${i.count}`).join() || s.world.getChest(x + 4, y, z + 3, false)?.slots.filter(Boolean).map((i) => `${i.id}x${i.count}`).join();
  });
  check('Boîte de shulker reposée : contenu restauré', /emeraldx9/.test(replace ?? ''), String(replace));

  // ---------- distributeur, dropper, entonnoir ----------
  const disp = await G(() => {
    const s = window.__lecraft.session, w = s.world, { x, y, z } = window.__a;
    s.runCommand(`/setblock ${x + 6} ${y} ${z - 6} dispenser`);
    const inv = w.getChest(x + 6, y, z - 6, true, 9);
    inv.slots[0] = { id: 'arrow', count: 3 };
    const before = s.entities.entities.filter((e) => e.kind === 'projectile').length;
    return { before, size: inv.size };
  });
  // impulsion : via l'interaction réelle du levier
  const fired = await G(async () => {
    const s = window.__lecraft.session, w = s.world, { x, y, z } = window.__a;
    const lv = window.__lecraft.debug.blockId('lever');
    w.setBlock(x + 6, y + 1, z - 6, lv, 0, false);
    s.interaction.target = { x: x + 6, y: y + 1, z: z - 6, nx: 0, ny: 1, nz: 0, block: lv, distance: 2, px: x + 6.5, py: y + 1.5, pz: z - 5.5 };
    s.interaction.targetMob = null;
    s.player.inventory.selected = 8; s.player.inventory.slots[8] = null;
    s.interaction.use();
    for (let i = 0; i < 30 && w.getChest(x + 6, y, z - 6, false).count('arrow') === 3; i++) await new Promise((r) => setTimeout(r, 100));
    const arrows = s.entities.entities.filter((e) => e.kind === 'projectile' && e.type === 'arrow').length;
    return { arrows, left: w.getChest(x + 6, y, z - 6, false).count('arrow'), powered: (w.getMeta(x + 6, y, z - 6) & 8) !== 0 };
  });
  check('Distributeur : 9 cases, tire une flèche sur impulsion de redstone', disp.size === 9 && fired.powered && fired.arrows >= 1 && fired.left === 2, JSON.stringify({ disp, fired }));
  const hop = await G(async () => {
    const s = window.__lecraft.session, w = s.world, { x, y, z } = window.__a;
    s.runCommand(`/setblock ${x - 6} ${y} ${z - 6} chest`);
    s.runCommand(`/setblock ${x - 6} ${y + 1} ${z - 6} hopper`);
    s.entities.spawnItem('cobblestone', 4, x - 5.5, y + 2.2, z - 5.5);
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150));
      if ((w.getChest(x - 6, y, z - 6, false)?.count('cobblestone') ?? 0) >= 4) break;
    }
    return { chest: w.getChest(x - 6, y, z - 6, false)?.count('cobblestone') ?? 0, hopperSize: w.getChest(x - 6, y + 1, z - 6, false)?.size };
  });
  check('Entonnoir : aspire les objets posés dessus et remplit le coffre dessous', hop.chest === 4 && hop.hopperSize === 5, JSON.stringify(hop));
  await G(() => { const s = window.__lecraft.session, { x, y, z } = window.__a; window.__open(x - 6, y + 1, z - 6); });
  await wait(300);
  const hopUi = await G(() => document.querySelectorAll('[data-key^="disp"]').length);
  check('Entonnoir : interface 5 cases', hopUi === 5, String(hopUi));
  await shot('06-hopper');
  await G(() => window.__lecraft.closeInventory());

  // ---------- inventaire créatif : pas de blocs techniques ----------
  await G(() => { const s = window.__lecraft.session; s.player.gameMode = 'creative'; window.__lecraft.openInventory('hand'); });
  await wait(300);
  await tapSel('.gui-btn');
  await wait(600);
  const keys = [];
  const tabs = await page.locator('.gui-tab').count();
  for (let t = 0; t < tabs; t++) {
    await tapSel(`.gui-tab >> nth=${t}`);
    await wait(250);
    keys.push(...(await G(() => [...document.querySelectorAll('[data-item]')].map((e) => e.dataset.item))));
  }
  const tech = keys.filter((k) => /^(repeater_on|comparator_on|cake_inner|redstone_dust_line0|piston_head|lightning_rod_on|white_candle_lit|vault_ominous)$/.test(k));
  check('Créatif : états et morceaux de blocs masqués (comme le jeu original)', keys.length > 800 && tech.length === 0 && keys.includes('repeater') && keys.includes('crimson_stem') && keys.includes('white_candle'), `${keys.length} objets ; techniques visibles : ${tech.join(',')}`);
  await shot('07-creative');
  await G(() => window.__lecraft.closeInventory());

  // ---------- touches du clavier personnalisables ----------
  await G(() => { window.__lecraft.showSettings(); });
  await wait(300);
  await page.getByText('Commandes...', { exact: true }).click();
  await wait(300);
  await page.getByText('Touches clavier...', { exact: true }).click();
  await wait(300);
  await page.locator('[data-key="forward"]').click();
  await wait(150);
  const waiting = await page.locator('[data-key="forward"]').textContent();
  await page.keyboard.press('KeyL');
  await wait(200);
  const bound = await G(() => ({ keys: window.__lecraft.settings.keys, label: document.querySelector('[data-key="forward"]')?.textContent, saved: JSON.parse(localStorage.getItem('lecraft.settings.v1')).keys }));
  check('Touches clavier : « Avancer » réassigné à L (enregistré)', /Appuyez/.test(waiting ?? '') && bound.keys?.forward === 'KeyL' && /L$/.test(bound.label ?? '') && bound.saved?.forward === 'KeyL', JSON.stringify(bound));
  await G(() => { const g = window.__lecraft; g.ui.clear(); g.keyboard.enabled = true; });
  await wait(200);
  const move = await G(async () => {
    const g = window.__lecraft;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', bubbles: true }));
    const l = g.input.moveY;
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyL', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
    const w = g.input.moveY;
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', bubbles: true }));
    const up = g.input.moveY;
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp', bubbles: true }));
    g.settings.keys = {};
    g.applySettings(false);
    return { l, w, up };
  });
  check('La nouvelle touche fait avancer (l’ancienne non, les flèches toujours)', move.l === 1 && move.w === 0 && move.up === 1, JSON.stringify(move));

  // ---------- langue ----------
  const en = await G(async () => {
    const g = window.__lecraft;
    g.settings.language = 'en';
    g.applySettings(false);
    g.showSettings();
    await new Promise((r) => setTimeout(r, 300));
    const texts = [...document.querySelectorAll('.mc-btn span, .mc-title')].map((e) => e.textContent);
    g.ui.back?.();
    g.openInventory('hand');
    await new Promise((r) => setTimeout(r, 300));
    const p = g.session.player;
    p.inventory.slots[0] = { id: 'diamond_sword', count: 1 };
    p.inventory.changed();
    await new Promise((r) => setTimeout(r, 200));
    g.closeInventory();
    g.settings.language = 'fr';
    g.applySettings(false);
    return { texts };
  });
  check('Langue English : menus traduits', en.texts.includes('Video Settings...') && en.texts.includes('Controls...') && en.texts.includes('Language: English'), en.texts.slice(0, 12).join(' | '));
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
