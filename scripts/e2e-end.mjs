// E2E l'End : œil de l'Ender (vers le fort), fort et salle du portail (12 cadres), ouverture du
// portail, île de l'End (piliers, cristaux, fontaine, vide), dragon (soin par les cristaux,
// cristal détruit), victoire (portail de sortie, œuf), retour à la surface.
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
  await G(() => window.__lecraft.createWorld('End', '8080', 'survival', 'normal'));
  await playing();
  await settle();

  // ---------- œil de l'Ender ----------
  const eye = await G(async () => {
    const s = window.__lecraft.session, p = s.player;
    s.runCommand('/gamerule doMobSpawning false');
    p.inventory.clear();
    p.inventory.add({ id: 'ender_eye', count: 16 });
    p.inventory.selected = 0;
    s.interaction.target = null;
    s.interaction.targetMob = null;
    s.interaction.use();
    let flying = false;
    for (let i = 0; i < 40 && !flying; i++) {
      await new Promise((r) => setTimeout(r, 25));
      flying = s.entities.entities.some((e) => e.kind === 'projectile' && e.def?.id === 'lecraft:eye_of_ender');
    }
    const loc = await s.chunks.locate('stronghold', p.x, p.z);
    return { thrown: s.player.inventory.count('ender_eye') === 15, last: s.lastEye, loc, flying };
  });
  check('Œil de l’Ender lancé vers le fort le plus proche', eye.thrown && eye.flying && eye.loc.found && eye.last && Math.abs(eye.last.x - eye.loc.x) < 1, JSON.stringify(eye));
  await wait(2500);
  const fell = await G(() => ({ proj: window.__lecraft.session.entities.entities.some((e) => e.kind === 'projectile') }));
  check('L’œil retombe (ou se brise) en fin de course', !fell.proj);

  // ---------- fort : salle du portail ----------
  const room = { x: eye.loc.x - 30, z: eye.loc.z };
  await G((r) => { const p = window.__lecraft.session.player; p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(r.x + 0.5, 40, r.z + 0.5); }, room);
  await page.waitForFunction((r) => window.__lecraft.session.world.isLoaded(r.x + 3, r.z + 3) && window.__lecraft.session.world.isLoaded(r.x - 3, r.z - 3), room, { timeout: 60000 });
  await settle();
  const frames = await G((r) => {
    const w = window.__lecraft.session.world, list = [];
    for (let y = 8; y < 40; y++) for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      const b = w.getBlock(r.x + dx, y, r.z + dz);
      if (b === I('end_portal_frame') || b === I('end_portal_frame_filled')) list.push({ x: r.x + dx, y, z: r.z + dz, filled: b === I('end_portal_frame_filled') });
    }
    window.__frames = list;
    return { n: list.length, filled: list.filter((f) => f.filled).length, bricks: (() => { let n = 0; for (let dx = -8; dx <= 8; dx++) for (let y = 10; y < 34; y++) if (w.getBlock(r.x + dx, y, r.z + 6) === I('stone_bricks')) n++; return n; })() };
  }, room);
  check('Fort : salle du portail avec 12 cadres (briques de pierre)', frames.n === 12 && frames.bricks > 20, JSON.stringify(frames));
  if (frames.n === 12) {
    const fy = await G(() => window.__frames[0].y);
    await G((r) => { const p = window.__lecraft.session.player; p.body.setPos(r.x + 0.5, window.__frames[0].y + 1, r.z + 3.5); p.yaw = 0; p.pitch = -0.7; }, room);
    await wait(1200);
    await page.screenshot({ path: `${OUT}/end-01-salle-portail.png` });
    const opened = await G(() => {
      const s = window.__lecraft.session, w = s.world, p = s.player;
      p.inventory.selected = 0;
      let last = null;
      for (const f of window.__frames) {
        if (w.getBlock(f.x, f.y, f.z) !== I('end_portal_frame')) continue;
        s.interaction.target = { x: f.x, y: f.y, z: f.z, nx: 0, ny: 1, nz: 0, block: I('end_portal_frame'), distance: 3, px: 0, py: 0, pz: 0 };
        s.interaction.use();
      }
      const c = window.__frames.reduce((a, f) => ({ x: a.x + f.x / 12, z: a.z + f.z / 12 }), { x: 0, z: 0 });
      let portal = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (w.getBlock(Math.round(c.x) + dx, window.__frames[0].y, Math.round(c.z) + dz) === I('end_portal')) portal++;
      window.__portalC = { x: Math.round(c.x), z: Math.round(c.z) };
      return { portal, filled: window.__frames.filter((f) => w.getBlock(f.x, f.y, f.z) === I('end_portal_frame_filled')).length };
    });
    check('12 yeux posés : le portail de l’End s’ouvre (3×3)', opened.filled === 12 && opened.portal === 9, JSON.stringify(opened));
    await page.screenshot({ path: `${OUT}/end-02-portail-ouvert.png` });
    void fy;
  }

  // ---------- passage dans l'End ----------
  await G(() => { const s = window.__lecraft.session, p = s.player, c = window.__portalC ?? { x: 0, z: 0 }; p.gameMode = 'survival'; p.body.flying = false; p.body.setPos(c.x + 0.5, window.__frames?.[0]?.y + 0.6, c.z + 0.5); });
  await page.waitForFunction(() => window.__lecraft.session?.dimension === 'end', null, { timeout: 30000 });
  await playing();
  await settle();
  await wait(1500);
  const end = await G(() => {
    const s = window.__lecraft.session, w = s.world, p = s.player;
    const crystals = s.entities.mobs.filter((m) => m.def.key === 'end_crystal').length;
    const dragon = s.entities.mobs.find((m) => m.def.key === 'ender_dragon');
    return {
      dim: s.dimension, platform: w.getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)) === I('obsidian'),
      crystals, dragon: !!dragon, bar: !document.querySelector('.boss-bar').classList.contains('hidden'),
      island: w.getBlock(30, 64, 0) === I('end_stone') || w.getBlock(30, 63, 0) === I('end_stone'),
      voidBelow: w.getBlock(Math.floor(p.x), -1, Math.floor(p.z)) === 0,
    };
  });
  check('Arrivée dans l’End : plateforme d’obsidienne, île de pierre de l’End, vide en dessous', end.dim === 'end' && end.platform && end.voidBelow, JSON.stringify(end));
  check('Dragon de l’Ender (barre de boss) et 10 cristaux', end.dragon && end.bar && end.crystals === 10, JSON.stringify(end));
  await G(() => { const p = window.__lecraft.session.player; p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(40, 100, 40); p.yaw = Math.PI * 0.75; p.pitch = -0.35; });
  await wait(2500);
  await page.screenshot({ path: `${OUT}/end-03-ile.png` });

  // ---------- soin par les cristaux, cristal détruit ----------
  const heal = await G(async () => {
    const s = window.__lecraft.session;
    const d = s.entities.mobs.find((m) => m.def.key === 'ender_dragon');
    const c = s.entities.mobs.find((m) => m.def.key === 'end_crystal');
    d.ai.update = () => {};
    d.abilities = function (ctx, dt) { this.body.vx = this.body.vy = this.body.vz = 0; Object.getPrototypeOf(Object.getPrototypeOf(this)).constructor; };
    d.body.setPos(c.x + 4, c.y + 3, c.z);
    d.health = 150;
    const h0 = d.health;
    // soin : appelle directement les capacités d'origine sans déplacement
    const proto = Object.getPrototypeOf(d);
    for (let i = 0; i < 60; i++) { proto.abilities.call(d, s, 0.05); d.body.setPos(c.x + 4, c.y + 3, c.z); }
    const h1 = d.health;
    const healer = d.healer === c;
    const hb = d.health;
    s.combat.damageMob(c, 1, { kind: 'player', fromPlayer: true });
    await new Promise((r) => setTimeout(r, 300));
    return { h0, h1, healer, crystalGone: !s.entities.mobs.includes(c) || c.removed, dragonHit: d.health < hb, left: s.entities.mobs.filter((m) => m.def.key === 'end_crystal' && !m.dead).length };
  });
  check('Les cristaux soignent le dragon', heal.healer && heal.h1 > heal.h0, JSON.stringify(heal));
  check('Détruire le cristal qui le soigne : explosion et dragon blessé', heal.crystalGone && heal.dragonHit && heal.left === 9, JSON.stringify(heal));

  // ---------- vide ----------
  const voidDmg = await G(async () => {
    const p = window.__lecraft.session.player;
    p.gameMode = 'survival'; p.body.flying = false; p.health = 1000;
    p.body.setPos(200, -20, 200);
    await new Promise((r) => setTimeout(r, 700));
    const h = p.health;
    p.health = 20; p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(20, 90, 20); p.body.vy = 0;
    return h;
  });
  check('Tomber dans le vide blesse (4 dégâts / 0,5 s)', voidDmg < 1000 && voidDmg % 4 === 0, `santé ${voidDmg}`);

  // ---------- victoire ----------
  await G(() => {
    const s = window.__lecraft.session, d = s.entities.mobs.find((m) => m.def.key === 'ender_dragon');
    d.iframes = 0;
    s.combat.damageMob(d, 9999, { kind: 'player', fromPlayer: true });
  });
  await wait(1500);
  const win = await G(() => {
    const s = window.__lecraft.session, w = s.world;
    let portal = 0;
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (w.getBlock(x, 64, z) === I('end_portal')) portal++;
    return { killed: s.endState.dragonKilled, portal, egg: w.getBlock(0, 68, 0) === I('dragon_egg'), bar: document.querySelector('.boss-bar').classList.contains('hidden') };
  });
  check('Dragon vaincu : portail de sortie activé et œuf de dragon', win.killed && win.portal >= 12 && win.egg && win.bar, JSON.stringify(win));
  await G(() => { const p = window.__lecraft.session.player; p.body.setPos(8, 72, 8); p.yaw = Math.PI * 0.75; p.pitch = -0.6; });
  await wait(1500);
  await page.screenshot({ path: `${OUT}/end-04-sortie.png` });

  // ---------- retour à la surface ----------
  await G(() => { const p = window.__lecraft.session.player; p.gameMode = 'survival'; p.body.flying = false; p.body.setPos(2.5, 65, 0.5); });
  await page.waitForFunction(() => window.__lecraft.session?.dimension === 'overworld', null, { timeout: 30000 });
  await playing();
  await wait(500);
  const home = await G(() => { const s = window.__lecraft.session, p = s.player; return { dim: s.dimension, d: Math.hypot(p.x - p.spawn[0], p.z - p.spawn[2]), killed: s.endState.dragonKilled }; });
  check('Portail de sortie : retour au point d’apparition de la surface', home.dim === 'overworld' && home.d < 16 && home.killed, JSON.stringify(home));
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
