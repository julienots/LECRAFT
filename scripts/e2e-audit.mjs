// E2E audit (v2.25) : support d'armure (pose, armure, reprise, rendu, sauvegarde, casse),
// armure portée par le joueur, tonneau (stockage + sauvegarde), contenu des fourneaux lâché à la
// casse, cisailles sur citrouille.
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
const shot = (n) => page.screenshot({ path: `${OUT}/audit-${n}.png` });

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'MEDIUM', renderDistance: 2, autoQuality: false })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await G(() => window.__lecraft.createWorld('Audit', '4242', 'survival', 'peaceful'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(800);
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const x = Math.floor(p.x), z = Math.floor(p.z), y = 100;
    s.runCommand(`/fill ${x - 8} ${y - 1} ${z - 8} ${x + 8} ${y - 1} ${z + 8} stone`);
    s.runCommand(`/fill ${x - 8} ${y} ${z - 8} ${x + 8} ${y + 5} ${z + 8} air`);
    s.runCommand('/time set day');
    p.body.setPos(x + 0.5, y, z + 0.5);
    p.yaw = 0; p.pitch = -0.2;
    window.__a = { x, y, z };
    window.__give = (id, n = 1) => { p.inventory.clear(); if (id) p.inventory.add({ id, count: n }); p.inventory.selected = 0; p.inventory.changed(); };
    window.__aim = (bx, by, bz, ny = 1) => { s.interaction.targetMob = null; s.interaction.target = { x: bx, y: by, z: bz, nx: 0, ny, nz: 0, block: s.world.getBlock(bx, by, bz), distance: 2, px: bx + 0.5, py: by + 1, pz: bz + 0.5 }; };
  });

  // ---------- support d'armure ----------
  const placed = await G(() => {
    const s = window.__lecraft.session, { x, y, z } = window.__a;
    window.__give('armor_stand');
    window.__aim(x, y - 1, z - 3);
    s.interaction.use();
    const st = s.entities.mobs.find((m) => m.def.key === 'armor_stand');
    return { ok: !!st, left: s.player.inventory.count('armor_stand'), pos: st ? [st.x, st.y, st.z] : null };
  });
  check('Support d’armure : posé sur un bloc (objet consommé)', placed.ok && placed.left === 0, JSON.stringify(placed));
  const equip = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const st = s.entities.mobs.find((m) => m.def.key === 'armor_stand');
    const put = (id) => { window.__give(id); s.interaction.target = null; s.interaction.targetMob = st; s.interaction.use(); };
    put('iron_chestplate'); put('diamond_helmet'); put('golden_leggings'); put('leather_boots');
    return { armor: Object.fromEntries(Object.entries(st.armor).map(([k, v]) => [k, v.id])), hand: p.inventory.selectedStack?.id ?? null };
  });
  check('Support d’armure : 4 pièces équipées', equip.armor.head === 'diamond_helmet' && equip.armor.chest === 'iron_chestplate' && equip.armor.legs === 'golden_leggings' && equip.armor.feet === 'leather_boots' && !equip.hand, JSON.stringify(equip));
  await wait(400);
  const meshes = await G(() => { const st = window.__lecraft.session.entities.mobs.find((m) => m.def.key === 'armor_stand'); let n = 0; for (const l of st.model.armorMeshes.values()) n += l.length; return n; });
  check('Support d’armure : armure affichée sur le modèle (calques)', meshes >= 9, `${meshes} pièces 3D`);
  await G(() => { const p = window.__lecraft.session.player, { x, y, z } = window.__a; p.body.setPos(x + 0.5, y, z + 1.5); p.yaw = 0; p.pitch = -0.15; });
  await wait(800);
  await shot('01-armor-stand');
  const back = await G(() => {
    const s = window.__lecraft.session;
    const st = s.entities.mobs.find((m) => m.def.key === 'armor_stand');
    window.__give(null);
    s.interaction.target = null; s.interaction.targetMob = st; s.interaction.use();
    return { helmet: s.player.inventory.count('diamond_helmet'), still: !!st.armor.head };
  });
  check('Support d’armure : main vide → la pièce revient dans l’inventaire', back.helmet === 1 && !back.still, JSON.stringify(back));

  // ---------- armure du joueur (vue extérieure) ----------
  const self = await G(async () => {
    const s = window.__lecraft.session, inv = s.player.inventory;
    inv.armor.head = { id: 'iron_helmet', count: 1 }; inv.armor.chest = { id: 'diamond_chestplate', count: 1 }; inv.changed();
    s.perspective = 2;
    await new Promise((r) => setTimeout(r, 600));
    const av = s.playerAvatar; let n = 0;
    if (av) for (const l of av.model.armorMeshes.values()) n += l.length;
    return n;
  });
  check('Armure du joueur visible en vue extérieure', self >= 4, `${self} pièces 3D`);
  await shot('02-player-armor');
  await G(() => { window.__lecraft.session.perspective = 0; });

  // ---------- tonneau ----------
  const barrel = await G(async () => {
    const s = window.__lecraft.session, g = window.__lecraft, { x, y, z } = window.__a;
    s.runCommand(`/setblock ${x + 2} ${y} ${z} barrel`);
    window.__give(null);
    window.__aim(x + 2, y, z, 0);
    s.interaction.use();
    await new Promise((r) => setTimeout(r, 300));
    const open = !!g.inventoryUI;
    s.world.getChest(x + 2, y, z).slots[4] = { id: 'diamond', count: 7 };
    g.closeInventory();
    return { open, items: s.world.containerItems(x + 2, y, z).length };
  });
  check('Tonneau : s’ouvre comme un coffre et garde ses objets', barrel.open && barrel.items === 1, JSON.stringify(barrel));

  // ---------- fourneau cassé : contenu rendu ----------
  const furnace = await G(() => {
    const s = window.__lecraft.session, { x, y, z } = window.__a;
    s.runCommand(`/setblock ${x - 2} ${y} ${z} furnace`);
    const f = s.world.getFurnace(x - 2, y, z);
    f.input = { id: 'raw_iron', count: 5 }; f.fuel = { id: 'coal', count: 3 };
    s.interaction.breakBlock(x - 2, y, z, 'stone_pickaxe');
    const items = s.entities.entities.filter((e) => e.kind === 'item' && Math.hypot(e.x - x + 1.5, e.z - z - 0.5) < 2).map((e) => `${e.itemId}x${e.count}`);
    return { items, state: s.world.furnaces.has(`${x - 2},${y},${z}`) };
  });
  check('Fourneau cassé : entrée et combustible lâchés (plus de perte)', furnace.items.includes('raw_ironx5') && furnace.items.includes('coalx3') && !furnace.state, JSON.stringify(furnace));

  // ---------- cisailles sur citrouille ----------
  const pumpkin = await G(() => {
    const s = window.__lecraft.session, { x, y, z } = window.__a;
    s.runCommand(`/setblock ${x} ${y} ${z + 3} pumpkin`);
    window.__give('shears');
    window.__aim(x, y, z + 3, 0);
    s.interaction.use();
    const id = s.world.getBlock(x, y, z + 3);
    return { carved: id === window.__lecraft.debug.blockId('carved_pumpkin'), seeds: s.entities.entities.some((e) => e.kind === 'item' && e.itemId === 'pumpkin_seeds') };
  });
  check('Cisailles sur citrouille : citrouille sculptée + graines', pumpkin.carved && pumpkin.seeds, JSON.stringify(pumpkin));

  // ---------- sauvegarde puis rechargement ----------
  await G(async () => {
    const g = window.__lecraft, meta = g.session.meta;
    await g.quitToMenu();
    await g.playWorld(meta);
  });
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(1500);
  const re = await G(() => {
    const s = window.__lecraft.session, { x, y, z } = window.__a;
    const st = s.entities.mobs.find((m) => m.def.key === 'armor_stand');
    return { stand: !!st, armor: st ? Object.values(st.armor).map((v) => v.id).sort() : [], barrel: s.world.containerItems(x + 2, y, z).map((i) => `${i.id}x${i.count}`) };
  });
  check('Rechargement : support d’armure et son armure conservés', re.stand && re.armor.join() === 'golden_leggings,iron_chestplate,leather_boots', JSON.stringify(re));
  check('Rechargement : contenu du tonneau conservé', re.barrel.join() === 'diamondx7', JSON.stringify(re.barrel));

  // ---------- casse du support ----------
  const broke = await G(() => {
    const s = window.__lecraft.session;
    const st = s.entities.mobs.find((m) => m.def.key === 'armor_stand');
    s.combat.damageMob(st, 5, { kind: 'player', fromPlayer: true });
    const drops = s.entities.entities.filter((e) => e.kind === 'item').map((e) => e.itemId).sort();
    return { gone: st.removed, drops };
  });
  check('Support d’armure cassé : rend le support et toute son armure', broke.gone && ['armor_stand', 'golden_leggings', 'iron_chestplate', 'leather_boots'].every((k) => broke.drops.includes(k)), JSON.stringify(broke));
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
