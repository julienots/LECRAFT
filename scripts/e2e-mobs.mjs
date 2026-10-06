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
  check('Loup apprivoisé avec des os (assis, 20 PV)', tame.tamed && tame.sitting && tame.hp === 20 && tame.bones === 40 - tame.tries, JSON.stringify(tame));
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
  const tp = await G(() => {
    const s = window.__lecraft.session, e = s.entities.mobs.find((m) => m.def.key === 'enderman');
    let moved = 0;
    for (let i = 0; i < 6; i++) {
      const x0 = e.x, z0 = e.z;
      e.iframes = 0;
      s.combat.damageMob(e, 1, { kind: 'player', fromPlayer: true });
      if (Math.hypot(e.x - x0, e.z - z0) > 1) moved++;
    }
    return moved;
  });
  check('Enderman : se téléporte quand on le frappe', tp >= 2, `${tp}/6 téléportations`);
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
