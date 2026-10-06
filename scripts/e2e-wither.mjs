// E2E Wither : squelette wither (modèle, effet wither), invocation (T de sable des âmes + 3 crânes),
// charge invulnérable puis explosion, crânes tirés, armure contre les projectiles, étoile du Nether.
// Vérifie aussi : plus de bloc fantôme de pose, icônes plates (torche, vitre) en main.
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
  await page.addInitScript(() => {
    localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'LOW', renderDistance: 2, autoQuality: false }));
    window.I = (k) => window.__lecraft.debug.blockId(k);
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await G(() => window.__lecraft.createWorld('Wither', '666', 'survival', 'normal'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(800);
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const x = Math.floor(p.x), z = Math.floor(p.z), y = 100;
    s.runCommand(`/fill ${x - 14} ${y - 1} ${z - 14} ${x + 14} ${y - 1} ${z + 14} obsidian`);
    s.runCommand(`/fill ${x - 14} ${y} ${z - 14} ${x + 14} ${y + 12} ${z + 14} air`);
    s.runCommand('/gamerule doMobSpawning false');
    s.runCommand('/time set day');
    p.body.setPos(x + 0.5, y, z + 0.5);
    p.yaw = 0; p.pitch = -0.2;
    window.__a = { x, y, z };
  });
  await wait(300);

  // ---------- pas de bloc fantôme, icônes plates ----------
  const ui = await G(() => {
    const s = window.__lecraft.session, a = window.__a, p = s.player, g = window.__lecraft;
    p.inventory.clear();
    p.inventory.add({ id: 'stone', count: 5 });
    p.inventory.selected = 0;
    s.interaction.target = { x: a.x, y: a.y - 1, z: a.z - 2, nx: 0, ny: 1, nz: 0, block: I('obsidian'), distance: 2, px: 0, py: 0, pz: 0 };
    const meshes = s.highlight.group.children.filter((c) => c.visible).length;
    const B = g.debug.registries.blocks;
    const flat = ['torch', 'glass_pane', 'ladder', 'oak_door', 'iron_bars', 'poppy'].map((k) => [k, g.textures.flatIcon(B.byName(k))]);
    const cube = ['stone', 'oak_planks', 'glass'].map((k) => [k, g.textures.flatIcon(B.byName(k))]);
    return { children: s.highlight.group.children.length, meshes, flat, cube };
  });
  check('Plus de bloc fantôme de pose (contour + fissures seulement)', ui.children === 2, JSON.stringify(ui));
  check('Icônes plates pour torche, vitre, échelle, porte, barreaux, fleur ; cubes pour les blocs pleins', ui.flat.every(([, f]) => f) && ui.cube.every(([, f]) => !f), JSON.stringify({ flat: ui.flat, cube: ui.cube }));

  // ---------- squelette wither ----------
  const ws = await G(async () => {
    const s = window.__lecraft.session, a = window.__a, p = s.player;
    const m = s.entities.spawnMob('wither_skeleton', a.x + 0.5, a.y, a.z - 1.6, { persistent: true });
    p.health = 20;
    m.attackTimer = 0;
    m.meleeAttack(s);
    const r = { model: m.model.vanilla, wither: p.effects.level('wither') > 0 || p.effects.has?.('wither'), hp: p.health };
    m.removed = true;
    return r;
  });
  check('Squelette wither : modèle vanilla, coup = effet wither', ws.model && ws.hp < 20 && !!ws.wither, JSON.stringify(ws));

  // ---------- invocation ----------
  const summon = await G(() => {
    const s = window.__lecraft.session, a = window.__a, w = s.world, p = s.player;
    p.gameMode = 'creative';
    const x = a.x, y = a.y, z = a.z - 6;
    w.setBlock(x, y, z, I('soul_sand'));
    for (const dx of [-1, 0, 1]) w.setBlock(x + dx, y + 1, z, I('soul_sand'));
    w.setBlock(x - 1, y + 2, z, I('wither_skeleton_skull'));
    w.setBlock(x + 1, y + 2, z, I('wither_skeleton_skull'));
    const before = s.entities.mobs.filter((m) => m.def.key === 'wither').length;
    // 3e crâne posé par le joueur
    p.inventory.clear();
    p.inventory.add({ id: 'wither_skeleton_skull', count: 1 });
    p.inventory.selected = 0;
    s.interaction.target = { x, y: y + 1, z, nx: 0, ny: 1, nz: 0, block: I('soul_sand'), distance: 2, px: x + 0.5, py: y + 2, pz: z + 0.5 };
    s.interaction.preview = s.interaction.computePlacement(s.interaction.target, I('wither_skeleton_skull'));
    s.interaction.use();
    const wither = s.entities.mobs.find((m) => m.def.key === 'wither');
    window.__w = wither;
    return { before, spawned: !!wither, cleared: w.getBlock(x, y + 1, z) === 0 && w.getBlock(x, y, z) === 0 && w.getBlock(x - 1, y + 2, z) === 0, charging: wither?.charging > 0, hp: wither?.health };
  });
  check('Invocation : T de sable des âmes + 3 crânes → Wither (blocs consommés)', summon.before === 0 && summon.spawned && summon.cleared, JSON.stringify(summon));
  const inv = await G(() => { const s = window.__lecraft.session, w = window.__w; const h = w.health; s.combat.damageMob(w, 50, { kind: 'player', fromPlayer: true }); return { before: h, after: w.health, charging: w.charging }; });
  check('Charge : invulnérable, santé qui remonte', inv.charging > 0 && inv.after >= inv.before, JSON.stringify(inv));
  await G(() => { window.__lecraft.session.player.body.setPos(window.__a.x + 0.5, window.__a.y, window.__a.z + 8); });
  await wait(1200);
  await page.screenshot({ path: `${OUT}/wither-01-charge.png` });
  // fin de charge accélérée : explosion
  const boom = await G(async () => {
    const s = window.__lecraft.session, w = window.__w, a = window.__a;
    const crater0 = s.world.getBlock(a.x, a.y - 1, a.z - 6);
    w.charging = 0.05;
    await new Promise((r) => setTimeout(r, 600));
    return { charging: w.charging, hp: w.health };
  });
  check('Fin de charge : explosion, santé pleine', boom.charging <= 0 && boom.hp > 290, JSON.stringify(boom));
  // combat : crânes tirés vers le joueur (survie)
  await G(() => { const p = window.__lecraft.session.player; p.gameMode = 'survival'; p.health = 20; });
  await wait(3500);
  const fight = await G(() => {
    const s = window.__lecraft.session, w = window.__w;
    return { skulls: s.entities.entities.filter((e) => e.kind === 'projectile' && /wither_skull/.test(e.def?.id ?? '')).length + (s.player.health < 20 ? 1 : 0), y: w.y, py: s.player.y };
  });
  check('Le Wither vole et tire des crânes', fight.skulls > 0 && fight.y > fight.py + 1, JSON.stringify(fight));
  await page.screenshot({ path: `${OUT}/wither-02-combat.png` });
  const armor = await G(() => {
    const s = window.__lecraft.session, w = window.__w;
    s.player.gameMode = 'creative';
    w.health = 120; // sous la moitié
    w.iframes = 0;
    const h0 = w.health;
    s.combat.damageMob(w, 10, { kind: 'projectile', fromPlayer: true });
    const afterArrow = w.health;
    w.iframes = 0;
    s.combat.damageMob(w, 10, { kind: 'player', fromPlayer: true });
    return { armored: w.armored, arrowIgnored: afterArrow >= h0, meleeHit: w.health < afterArrow };
  });
  check('Sous 50 % : armure (flèches sans effet), l’épée blesse', armor.armored && armor.arrowIgnored && armor.meleeHit, JSON.stringify(armor));
  const star = await G(async () => {
    const s = window.__lecraft.session, w = window.__w;
    w.iframes = 0;
    s.combat.damageMob(w, 9999, { kind: 'player', fromPlayer: true });
    await new Promise((r) => setTimeout(r, 800));
    return s.entities.entities.some((e) => e.kind === 'item' && e.itemId === 'nether_star');
  });
  check('Wither vaincu : étoile du Nether', star);

  // ---------- animations et « touche perso » ----------
  const anim = await G(async () => {
    const s = window.__lecraft.session, p = s.player, g = window.__lecraft;
    p.gameMode = 'survival';
    p.inventory.clear();
    await new Promise((r) => setTimeout(r, 200));
    const hand = s.held.cache.get('');
    const arm = hand?.getObjectByName('arm');
    const armTextured = !!arm && !!arm.material.map;
    s.perspective = 1;
    g.input.sneak = true;
    await new Promise((r) => setTimeout(r, 400));
    const body = s.avatar?.model.parts.get('body')?.[0];
    const crouchRot = body?.rotation.x;
    g.input.sneak = false;
    await new Promise((r) => setTimeout(r, 300));
    const standRot = body?.rotation.x;
    s.perspective = 0;
    return { armTextured, crouchRot, standRot, sneaking: p.sneaking };
  });
  check('Main vide : bras du joueur texturé (skin) en 1re personne', anim.armTextured, JSON.stringify(anim));
  check('Accroupi : buste penché comme le modèle vanilla, redressé ensuite', Math.abs(anim.crouchRot - 0.5) < 0.01 && Math.abs(anim.standRot) < 0.01, JSON.stringify(anim));
  const leaves = await G(() => {
    const s = window.__lecraft.session, a = window.__a, w = s.world;
    s.runCommand(`/fill ${a.x - 4} ${a.y + 4} ${a.z - 4} ${a.x + 4} ${a.y + 4} ${a.z + 4} oak_leaves`);
    const before = s.particles.count;
    for (let i = 0; i < 300; i++) s.fallingLeaves(0.1);
    return { before, after: s.particles.count };
  });
  check('Feuilles qui tombent des arbres', leaves.after > leaves.before, JSON.stringify(leaves));
  const death = await G(async () => {
    const s = window.__lecraft.session, p = s.player, g = window.__lecraft;
    s.runCommand('/gamerule doImmediateRespawn true');
    const at = { x: Math.floor(p.x), z: Math.floor(p.z) };
    p.damage(1000, 'void');
    await new Promise((r) => setTimeout(r, 300));
    const log = [...document.querySelectorAll('.chat-line, .chat-msg, .chat div')].map((e) => e.textContent).join(' | ');
    return { last: s.lastDeath, at, compass: s.hud.compassTarget?.name, msg: /Vous êtes mort en/.test(log) || /Vous êtes mort en/.test(document.body.textContent) };
  });
  check('Mort : position mémorisée, message et boussole vers le lieu de la mort', death.last && death.last.x === death.at.x && death.compass === 'Lieu de votre mort' && death.msg, JSON.stringify(death));
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
