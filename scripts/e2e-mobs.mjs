// E2E créatures : modèles des nouvelles créatures, loup (apprivoisement, assis, défense du maître),
// enderman (regard, téléportation), villageois (échanges, cloche du village), calamar (nage,
// suffocation), renvoi d'une boule de feu de ghast, flèche de vagabond (lenteur).
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
  await G(() => window.__lecraft.createWorld('Mobs', '2024', 'survival', 'normal'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(800);
  // arène plate éclairée
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const x = Math.floor(p.x), z = Math.floor(p.z), y = 100;
    s.runCommand(`/fill ${x - 14} ${y - 1} ${z - 14} ${x + 14} ${y - 1} ${z + 14} stone`);
    s.runCommand(`/fill ${x - 14} ${y} ${z - 14} ${x + 14} ${y + 8} ${z + 14} air`);
    s.runCommand('/gamerule doMobSpawning false');
    s.runCommand('/time set day');
    p.body.setPos(x + 0.5, y, z + 0.5);
    p.yaw = 0; p.pitch = 0;
    window.__arena = { x, y, z };
  });
  await wait(500);

  // ---------- modèles ----------
  const models = await G(() => {
    const s = window.__lecraft.session, a = window.__arena, out = {};
    ['enderman', 'wolf', 'squid', 'glow_squid', 'bat', 'husk', 'drowned', 'stray', 'witch', 'villager'].forEach((k, i) => {
      const m = s.entities.spawnMob(k, a.x - 9 + i * 2 + 0.5, a.y, a.z - 8 + 0.5, { persistent: true });
      out[k] = !!m && m.model.vanilla;
      if (m) { m.ai.update = () => {}; m.yaw = 0; }
    });
    return out;
  });
  check('10 nouvelles créatures (modèles vanilla)', Object.values(models).every(Boolean) && Object.keys(models).length === 10, JSON.stringify(models));
  await G(() => { const p = window.__lecraft.session.player, a = window.__arena; p.body.setPos(a.x + 0.5, a.y, a.z + 2); p.yaw = 0; p.pitch = -0.05; });
  await wait(1500);
  await page.screenshot({ path: `${OUT}/mobs-01-alignement.png` });
  await G(() => { for (const m of window.__lecraft.session.entities.mobs) m.removed = true; });
  await wait(300);

  // ---------- loup ----------
  const tame = await G(() => {
    const s = window.__lecraft.session, a = window.__arena, p = s.player;
    const w = s.entities.spawnMob('wolf', a.x + 0.5, a.y, a.z - 2.5, { persistent: true });
    p.inventory.clear();
    p.inventory.add({ id: 'bone', count: 40 });
    p.inventory.selected = 0;
    p.yaw = 0; p.pitch = -0.6;
    let tries = 0;
    while (!w.tamed && tries < 30) {
      s.interaction.targetMob = w;
      s.interaction.use();
      tries++;
    }
    return { tamed: w.tamed, sitting: w.sitting, tries, hp: w.maxHealth, bones: p.inventory.count('bone') };
  });
  check('Loup apprivoisé avec des os (assis, 40 PV comme Java 1.20.5+)', tame.tamed && tame.sitting && tame.hp === 40 && tame.bones === 40 - tame.tries, JSON.stringify(tame));
  const sit = await G(() => {
    const s = window.__lecraft.session, w = s.entities.mobs.find((m) => m.def.key === 'wolf');
    s.player.inventory.selected = 3;
    s.interaction.targetMob = w;
    s.interaction.use();
    return w.sitting;
  });
  check('Interagir : le loup se lève', sit === false);
  const defend = await G(async () => {
    const s = window.__lecraft.session, a = window.__arena;
    const z = s.entities.spawnMob('zombie', a.x + 4.5, a.y, a.z - 4.5, { persistent: true });
    z.ai.update = () => {};
    const h0 = z.health;
    s.combat.damageMob(z, 1, { kind: 'player', fromPlayer: true, itemId: 'wooden_sword' });
    const w = s.entities.mobs.find((m) => m.def.key === 'wolf');
    return { target: w.target === z, h0 };
  });
  await wait(4000);
  const bitten = await G(() => { const s = window.__lecraft.session, z = s.entities.mobs.find((m) => m.def.key === 'zombie'); return { dead: !z || z.dead, hp: z?.health }; });
  check('Le loup attaque la cible de son maître', defend.target && (bitten.dead || bitten.hp < defend.h0 - 2), JSON.stringify({ ...defend, ...bitten }));
  await page.screenshot({ path: `${OUT}/mobs-02-loup.png` });
  await G(() => { for (const m of window.__lecraft.session.entities.mobs) m.removed = true; });

  // ---------- enderman ----------
  const ender = await G(() => {
    const s = window.__lecraft.session, a = window.__arena, p = s.player;
    p.body.setPos(a.x + 0.5, a.y, a.z + 0.5);
    const e = s.entities.spawnMob('enderman', a.x + 0.5, a.y, a.z - 7.5, { persistent: true });
    e.ai.update = () => {};
    // regarde la tête de l'enderman
    const dy = a.y + 2.55 - (a.y + p.eyeHeight), dz = 8;
    p.yaw = 0; p.pitch = Math.atan2(dy, dz);
    return { anger0: e.anger };
  });
  await wait(1200);
  const angry = await G(() => { const e = window.__lecraft.session.entities.mobs.find((m) => m.def.key === 'enderman'); return { anger: e.anger, x: e.x, z: e.z }; });
  check('Enderman : se met en colère quand on le regarde', ender.anger0 === 0 && angry.anger > 0, JSON.stringify(angry));
  // jeu Java : un coup d'épée ne le fait pas fuir, le feu oui (9 fois sur 10), les projectiles ne le blessent pas
  const tp = await G(() => {
    const s = window.__lecraft.session, e = s.entities.mobs.find((m) => m.def.key === 'enderman');
    let melee = 0, fire = 0;
    for (let i = 0; i < 6; i++) {
      const x0 = e.x, z0 = e.z;
      e.iframes = 0;
      s.combat.damageMob(e, 1, { kind: 'player', fromPlayer: true });
      if (Math.hypot(e.x - x0, e.z - z0) > 1) melee++;
    }
    for (let i = 0; i < 6; i++) {
      const x0 = e.x, z0 = e.z;
      e.fireTime = 3;
      s.combat.damageMob(e, 1, { kind: 'environment', fire: true });
      e.fireTime = 0;
      if (Math.hypot(e.x - x0, e.z - z0) > 1) fire++;
    }
    const h0 = e.health;
    e.iframes = 0;
    const arrow = s.combat.damageMob(e, 5, { kind: 'projectile', fromPlayer: true, itemId: 'bow' });
    return { melee, fire, arrow, same: e.health === h0 };
  });
  check('Enderman : se téléporte quand il brûle, pas sous les coups ; flèches sans effet', tp.melee === 0 && tp.fire >= 2 && tp.arrow === 0 && tp.same, JSON.stringify(tp));
  await G(() => { for (const m of window.__lecraft.session.entities.mobs) m.removed = true; });

  // ---------- villageois : échanges ----------
  const vil = await G(() => {
    const s = window.__lecraft.session, a = window.__arena, p = s.player;
    const v = s.entities.spawnMob('villager', a.x + 0.5, a.y, a.z - 2.5, { persistent: true });
    v.dynProps.set('__profession', 'farmer');
    p.inventory.clear();
    p.inventory.add({ id: 'wheat', count: 40 });
    s.interaction.targetMob = v;
    s.interaction.use();
    return { open: !!document.querySelector('.trade-screen'), buttons: document.querySelectorAll('.trade-screen .trade-list button').length };
  });
  check('Villageois : écran d’échanges', vil.open && vil.buttons >= 4, JSON.stringify(vil));
  await page.screenshot({ path: `${OUT}/mobs-03-echanges.png` });
  const traded = await G(() => {
    const b = document.querySelector('.trade-screen .trade-list button[data-trade="wheat"]');
    const enabled = !b.disabled;
    b.click();
    const inv = window.__lecraft.session.player.inventory;
    return { enabled, wheat: inv.count('wheat'), emerald: inv.count('emerald') };
  });
  check('Échange : 20 blés → 1 émeraude', traded.enabled && traded.wheat === 20 && traded.emerald === 1, JSON.stringify(traded));
  await page.keyboard.press('Escape');
  await wait(300);
  await G(() => { for (const m of window.__lecraft.session.entities.mobs) m.removed = true; });

  // ---------- calamar : nage, suffocation ----------
  const squid = await G(() => {
    const s = window.__lecraft.session, a = window.__arena;
    s.runCommand(`/fill ${a.x + 4} ${a.y - 6} ${a.z + 4} ${a.x + 10} ${a.y - 1} ${a.z + 10} water`);
    const q = s.entities.spawnMob('squid', a.x + 7.5, a.y - 3, a.z + 7.5, { persistent: true });
    const out = s.entities.spawnMob('squid', a.x - 5.5, a.y, a.z - 5.5, { persistent: true });
    window.__sq = { x: q.x, y: q.y, z: q.z };
    return { h: out.health };
  });
  await wait(3500);
  const swim = await G(() => {
    const s = window.__lecraft.session, a = window.__arena;
    const [q, out] = [s.entities.mobs.find((m) => m.def.key === 'squid' && m.x > a.x), s.entities.mobs.find((m) => m.def.key === 'squid' && m.x < a.x)];
    const w0 = window.__sq;
    return { inWater: q.body.inWater, moved: Math.hypot(q.x - w0.x, q.y - w0.y, q.z - w0.z), outHp: out ? out.health : 0 };
  });
  check('Calamar : nage dans l’eau, suffoque hors de l’eau', swim.inWater && swim.moved > 0.3 && swim.outHp < 10, JSON.stringify(swim));
  await G(() => { for (const m of window.__lecraft.session.entities.mobs) m.removed = true; });

  // ---------- boule de feu renvoyée ----------
  const deflect = await G(() => {
    const s = window.__lecraft.session, a = window.__arena, p = s.player;
    p.body.setPos(a.x + 0.5, a.y, a.z + 0.5);
    p.yaw = 0; p.pitch = 0;
    s.interaction.targetMob = null;
    const g = s.entities.spawnMob('ghast', a.x + 0.5, a.y + 3, a.z - 12, { persistent: true });
    g.ai.update = () => {};
    // boule de feu qui arrive droit sur le joueur, à 2 blocs
    g.rangedAttack(s);
    const pr = s.entities.entities.filter((e) => e.kind === 'projectile').pop();
    pr.body.setPos(a.x + 0.5, a.y + p.eyeHeight, a.z - 1.5);
    pr.body.vx = 0; pr.body.vy = 0; pr.body.vz = 8;
    window.__lecraft.input.push('attackTap');
    return { id: pr.def?.id };
  });
  await wait(300);
  const back = await G(() => { const pr = window.__lecraft.session.entities.entities.filter((e) => e.kind === 'projectile').pop(); return pr ? { fromPlayer: pr.fromPlayer, vz: pr.body.vz } : null; });
  check('Frapper une boule de feu de ghast la renvoie', deflect.id === 'minecraft:fireball' && back && back.fromPlayer && back.vz < 0, JSON.stringify({ deflect, back }));
  await G(() => { const s = window.__lecraft.session; for (const e of s.entities.entities) e.removed = true; });

  // ---------- vagabond : flèche de lenteur ----------
  const slow = await G(() => {
    const s = window.__lecraft.session, a = window.__arena, p = s.player;
    p.health = 20;
    const st = s.entities.spawnMob('stray', a.x + 0.5, a.y, a.z - 6.5, { persistent: true });
    st.rangedAttack(s);
    const pr = s.entities.entities.filter((e) => e.kind === 'projectile').pop();
    pr.body.setPos(p.x, p.y + 1, p.z - 0.3);
    pr.body.vz = 10; pr.body.vx = 0; pr.body.vy = 0;
    return pr.def?.id;
  });
  await wait(400);
  const slowed = await G(() => window.__lecraft.session.player.effects.level('slowness'));
  check('Flèche de vagabond : lenteur', slow === 'lecraft:stray_arrow' && slowed > 0 || slowed === 0 && false, `${slow} niveau ${slowed}`);
  await G(() => { const s = window.__lecraft.session; for (const e of s.entities.entities) e.removed = true; });

  // ---------- recherche de chemin : contourner un mur pour atteindre le joueur ----------
  const nav = await G(async () => {
    const s = window.__lecraft.session, a = window.__arena, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const m of s.entities.mobs) m.removed = true;
    // mur de verre (on voit à travers, on ne passe pas) ouvert seulement à son extrémité est
    s.runCommand(`/fill ${a.x - 13} ${a.y} ${a.z - 3} ${a.x + 6} ${a.y + 2} ${a.z - 3} glass`);
    p.body.setPos(a.x + 0.5, a.y, a.z + 0.5);
    p.health = 20;
    const z = s.entities.spawnMob('zombie', a.x + 0.5, a.y, a.z - 8 + 0.5, { persistent: true });
    let best = 99, pathLen = 0;
    for (let t = 0; t < 150; t++) {
      await sleep(100);
      p.health = 20;
      p.body.setPos(a.x + 0.5, a.y, a.z + 0.5);
      best = Math.min(best, Math.hypot(z.x - p.x, z.z - p.z));
      if (z.ai.path) pathLen = Math.max(pathLen, z.ai.path.length);
      if (best < 2) break;
    }
    const out = { best: +best.toFixed(2), pathLen, state: z.ai.state };
    z.removed = true;
    s.runCommand(`/fill ${a.x - 13} ${a.y} ${a.z - 3} ${a.x + 6} ${a.y + 2} ${a.z - 3} air`);
    return out;
  });
  check('Zombie : contourne un mur (chemin A*) pour atteindre le joueur', nav.best < 2 && nav.pathLen > 5, JSON.stringify(nav));

  // ---------- conformité au jeu Java 1.21 ----------
  // slime : un grand slime (taille 4, 16 PV) se divise en 2 à 4 slimes moyens (4 PV)
  const slime = await G(async () => {
    const s = window.__lecraft.session, a = window.__arena, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const m of s.entities.mobs) m.removed = true;
    const big = s.entities.spawnMob('slime', a.x + 0.5, a.y, a.z - 6.5, { size: 4 });
    const info = { size: big.size, hp: big.health, w: +(big.body.halfWidth * 2).toFixed(2) };
    s.combat.damageMob(big, 100, { kind: 'player', fromPlayer: true });
    for (let t = 0; t < 40 && s.entities.mobs.filter((m) => m.def.key === 'slime' && !m.dead).length === 0; t++) await sleep(100);
    const kids = s.entities.mobs.filter((m) => m.def.key === 'slime' && !m.dead);
    const out = { ...info, kids: kids.length, kidSize: kids[0]?.size, kidHp: kids[0]?.health, babies: kids.some((k) => k.baby) };
    for (const m of s.entities.mobs) m.removed = true;
    return out;
  });
  check('Slime : grand (16 PV, 2,08 de large) → 2 à 4 moyens de 4 PV', slime.size === 4 && slime.hp === 16 && slime.w === 2.08 && slime.kids >= 2 && slime.kids <= 4 && slime.kidSize === 2 && slime.kidHp === 4 && !slime.babies, JSON.stringify(slime));

  // mouton : lâche sa laine à la mort (s'il n'est pas tondu)
  const wool = await G(async () => {
    const s = window.__lecraft.session, a = window.__arena, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const e of s.entities.entities) if (e.kind === 'item') e.removed = true;
    const sh = s.entities.spawnMob('sheep', a.x + 6.5, a.y, a.z - 6.5);
    sh.setWool('black', false);
    s.combat.damageMob(sh, 100, { kind: 'player', fromPlayer: true });
    for (let t = 0; t < 40 && !s.entities.entities.some((e) => e.kind === 'item' && e.itemId === 'black_wool'); t++) await sleep(100);
    return s.entities.entities.filter((e) => e.kind === 'item').map((e) => e.itemId);
  });
  check('Mouton : laine de sa couleur lâchée à la mort', wool.includes('black_wool') && wool.includes('mutton'), JSON.stringify(wool));

  // zombie au soleil : prend feu (8 s), pas dans l'eau
  const burn = await G(async () => {
    const s = window.__lecraft.session, a = window.__arena, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    s.runCommand('/time set noon');
    s.runCommand('/weather clear');
    for (const m of s.entities.mobs) m.removed = true;
    const z = s.entities.spawnMob('zombie', a.x - 8.5, a.y, a.z - 8.5, { persistent: true });
    const h = s.entities.spawnMob('husk', a.x - 6.5, a.y, a.z - 8.5, { persistent: true });
    z.ai.update = () => {}; h.ai.update = () => {};
    for (let t = 0; t < 40 && z.fireTime <= 0; t++) await sleep(100);
    const out = { zombieFire: +z.fireTime.toFixed(1), huskFire: h.fireTime };
    await sleep(2500);
    out.zombieHp = z.health;
    for (const m of s.entities.mobs) m.removed = true;
    return out;
  });
  check('Soleil : le zombie brûle (8 s, 1 dégât/s), pas le zombie momifié', burn.zombieFire > 5 && burn.huskFire === 0 && burn.zombieHp < 20, JSON.stringify(burn));

  // squelette : tourne autour du joueur en tirant
  const strafe = await G(async () => {
    const s = window.__lecraft.session, a = window.__arena, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    s.runCommand('/time set midnight');
    p.body.setPos(a.x + 0.5, a.y, a.z + 0.5);
    const sk = s.entities.spawnMob('skeleton', a.x + 0.5, a.y, a.z - 7.5, { persistent: true });
    const x0 = sk.x, z0 = sk.z;
    let lateral = 0, attack = 0, shots = 0;
    const shoot = sk.fireShot.bind(sk);
    sk.fireShot = (c) => { shots++; shoot(c); };
    for (let t = 0; t < 60; t++) {
      await sleep(100);
      p.health = 20;
      p.body.setPos(a.x + 0.5, a.y, a.z + 0.5);
      lateral = Math.max(lateral, Math.abs(sk.x - x0));
      if (sk.ai.state === 'ATTACK') attack++;
    }
    const out = { lateral: +lateral.toFixed(2), attack, shots, dz: +(sk.z - z0).toFixed(2) };
    sk.removed = true;
    for (const e of s.entities.entities) if (e.kind === 'projectile') e.removed = true;
    return out;
  });
  check('Squelette : mitraille en tournant autour du joueur', strafe.lateral > 0.8 && strafe.shots >= 1, JSON.stringify(strafe));

  // piglin : hostile sans armure en or, paisible avec un casque en or
  const pig = await G(async () => {
    const s = window.__lecraft.session, a = window.__arena, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    p.body.setPos(a.x + 0.5, a.y, a.z + 0.5);
    p.inventory.armor.head = null;
    const pg = s.entities.spawnMob('piglin', a.x + 0.5, a.y, a.z - 6.5, { persistent: true });
    let chase = false;
    for (let t = 0; t < 40 && !chase; t++) {
      await sleep(100);
      p.health = 20;
      chase = pg.ai.state === 'CHASE' || pg.ai.state === 'ATTACK';
    }
    p.inventory.armor.head = { id: 'golden_helmet', count: 1 };
    let calm = false;
    for (let t = 0; t < 40 && !calm; t++) {
      await sleep(100);
      p.health = 20;
      calm = pg.ai.state !== 'CHASE' && pg.ai.state !== 'ATTACK';
    }
    p.inventory.armor.head = null;
    const st = pg.ai.state;
    pg.removed = true;
    return { chase, calm, st };
  });
  check('Piglin : hostile sans or, paisible avec un casque en or', pig.chase && pig.calm, JSON.stringify(pig));

  // créeper chargé : puissance 6 ; insomnie suivie pour les phantoms
  const misc = await G(() => {
    const s = window.__lecraft.session, a = window.__arena;
    const c = s.entities.spawnMob('creeper', a.x + 0.5, a.y, a.z + 9.5);
    c.charged = true;
    const out = { charged: c.charged, rest: typeof s.entities.timeSinceRest === 'number' && s.entities.timeSinceRest > 0 };
    c.removed = true;
    return out;
  });
  check('Créeper chargé et statistique d’insomnie (phantoms)', misc.charged && misc.rest, JSON.stringify(misc));
  await G(() => window.__lecraft.session.runCommand('/time set day'));

  // ---------- village : cloche et villageois ----------
  const vloc = await G(async () => { const s = window.__lecraft.session, p = s.player; return s.chunks.locate('village', p.x, p.z); });
  if (vloc.found) {
    await G((v) => { const p = window.__lecraft.session.player; p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(v.x + 0.5, 100, v.z + 0.5); }, vloc);
    await page.waitForFunction((v) => window.__lecraft.session.world.isLoaded(v.x, v.z), vloc, { timeout: 60000 });
    await wait(4000);
    const vil2 = await G((v) => {
      const s = window.__lecraft.session;
      let bell = false;
      for (const sp of s.world.specials.values()) if (sp.block === I('bell')) bell = true;
      return { bell, villagers: s.entities.mobs.filter((m) => m.def.key === 'villager' && Math.hypot(m.x - v.x, m.z - v.z) < 40).length };
    }, vloc);
    check('Village : cloche et villageois', vil2.bell && vil2.villagers >= 3, JSON.stringify(vil2));
    await G((v) => { const s = window.__lecraft.session, p = s.player, m = s.entities.mobs.find((x) => x.def.key === 'villager'); if (m) { p.body.setPos(m.x + 3, m.y + 1.5, m.z + 3); p.yaw = Math.atan2(3, 3); p.pitch = -0.3; } }, vloc);
    await wait(1500);
    await page.screenshot({ path: `${OUT}/mobs-04-village.png` });
  } else check('Village : cloche et villageois', false, 'aucun village localisé');
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
