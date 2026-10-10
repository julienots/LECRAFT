// E2E relations entre créatures (entities/MobRelations.ts) : chaque scénario est joué seul dans
// un enclos, le résultat est mesuré en jeu (santé, état d'IA, distance, objets lâchés).
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

/** Prépare un scénario : enclos vide, créatures posées (clé → [créature, dx, dz, options]). */
const scene = (spec, opts = {}) => G(([spec, opts]) => {
  const s = window.__lecraft.session, p = s.player, a = window.__a;
  for (const e of s.entities.entities) if (e.kind === 'mob' || e.kind === 'item' || e.kind === 'projectile') e.removed = true;
  s.runCommand(`/fill ${a.x - 8} ${a.y} ${a.z - 8} ${a.x + 8} ${a.y + 5} ${a.z + 8} air`);
  s.runCommand(`/fill ${a.x - 8} ${a.y - 1} ${a.z - 8} ${a.x + 8} ${a.y - 1} ${a.z + 8} stone`);
  if (opts.water) s.runCommand(`/fill ${a.x - 4} ${a.y - 3} ${a.z - 4} ${a.x + 4} ${a.y - 1} ${a.z + 4} water`);
  p.gameMode = opts.survival ? 'survival' : 'creative';
  p.body.flying = !opts.survival;
  p.health = 20;
  p.effects.map.clear();
  p.body.setPos(a.x + 0.5 + (opts.px ?? 0), a.y + (opts.survival ? 0 : 6), a.z + 0.5 + (opts.pz ?? 7));
  p.yaw = 0; p.pitch = -0.6;
  window.__m = {};
  for (const [k, [key, dx, dz, o]] of Object.entries(spec)) window.__m[k] = s.entities.spawnMob(key, a.x + 0.5 + dx, a.y - (opts.water ? 2 : 0), a.z + 0.5 + dz, { persistent: true, ...(o ?? {}) });
  return Object.fromEntries(Object.entries(window.__m).map(([k, m]) => [k, !!m]));
}, [spec, opts]);

/** Attend qu'une condition (évaluée dans la page sur window.__m) soit vraie ; renvoie l'état. */
const until = async (fn, ms = 40000) => {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await G(fn);
    if (last?.ok) return last;
    await wait(500);
  }
  return last;
};

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'LOW', renderDistance: 2, autoQuality: false })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await G(() => window.__lecraft.createWorld('Relations', '4242', 'creative', 'normal'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(600);
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    s.gamerules.doMobSpawning = false;
    s.gamerules.doDaylightCycle = false;
    s.runCommand('/time set midnight'); // les zombies ne brûlent pas
    window.__a = { x: Math.floor(p.x), y: 100, z: Math.floor(p.z) };
  });

  // ---------- chasse ----------
  await scene({ wolf: ['wolf', -4, 0], sheep: ['sheep', 4, 0] });
  let r = await until(() => { const m = window.__m; return { ok: m.sheep.health < m.sheep.maxHealth, wolf: m.wolf.ai.state, sheep: m.sheep.health }; });
  check('Loup sauvage : chasse et mord le mouton', !!r?.ok, JSON.stringify(r));

  await scene({ fox: ['fox', -4, 0], chicken: ['chicken', 4, 0] });
  r = await until(() => { const m = window.__m; return { ok: m.chicken.health < m.chicken.maxHealth, fox: m.fox.ai.state, chicken: m.chicken.health }; });
  check('Renard : chasse la poule', !!r?.ok, JSON.stringify(r));

  await scene({ cat: ['cat', -4, 0], rabbit: ['rabbit', 4, 0] });
  r = await until(() => { const m = window.__m; return { ok: m.rabbit.health < m.rabbit.maxHealth, cat: m.cat.ai.state, rabbit: m.rabbit.health }; });
  check('Chat : chasse le lapin', !!r?.ok, JSON.stringify(r));

  await scene({ ocelot: ['ocelot', -4, 0], chicken: ['chicken', 4, 0] });
  r = await until(() => { const m = window.__m; return { ok: m.chicken.health < m.chicken.maxHealth, ocelot: m.ocelot.ai.state, chicken: m.chicken.health }; });
  check('Ocelot : chasse la poule', !!r?.ok, JSON.stringify(r));

  await scene({ bear: ['polar_bear', -4, 0], fox: ['fox', 4, 0] });
  r = await until(() => { const m = window.__m; return { ok: m.fox.health < m.fox.maxHealth, bear: m.bear.ai.state, fox: m.fox.health }; });
  check('Ours polaire : attaque le renard', !!r?.ok, JSON.stringify(r));

  await scene({ axolotl: ['axolotl', -2, 0], cod: ['cod', 2, 0] }, { water: true });
  r = await until(() => { const m = window.__m; return { ok: m.cod.health < m.cod.maxHealth, axolotl: m.axolotl.ai.state, cod: m.cod.health, inWater: m.cod.body.inWater }; });
  check('Axolotl : attaque la morue dans l’eau', !!r?.ok, JSON.stringify(r));

  await scene({ frog: ['frog', -3, 0], slime: ['slime', 3, 0, { baby: true }] });
  r = await until(() => {
    const m = window.__m, s = window.__lecraft.session;
    const balls = s.entities.entities.filter((e) => e.kind === 'item' && e.itemId === 'slime_ball').length;
    return { ok: m.slime.removed && balls > 0, frog: m.frog.ai.state, eaten: m.slime.removed, balls };
  });
  check('Grenouille : avale le petit slime (boule de slime lâchée)', !!r?.ok, JSON.stringify(r));

  // ---------- ennemis naturels ----------
  await scene({ zombie: ['zombie', -4, 0], villager: ['villager', 4, 0] });
  let fled = false;
  r = await until(() => {
    const m = window.__m;
    window.__fled = window.__fled || m.villager.ai.state === 'FLEE';
    return { ok: m.villager.health < m.villager.maxHealth && window.__fled, zombie: m.zombie.ai.state, prey: m.zombie.prey?.def.key, villager: m.villager.health, fled: window.__fled };
  });
  fled = r?.fled;
  check('Zombie : poursuit et frappe le villageois, qui fuit', !!r?.ok, JSON.stringify(r));
  void fled;

  await scene({ golem: ['snow_golem', -4, 0], zombie: ['zombie', 4, 0] });
  await G(() => {
    const E = window.__lecraft.session.entities, orig = E.spawnProjectile.bind(E);
    window.__shots = [];
    E.spawnProjectile = (...a) => { const pr = orig(...a); window.__shots.push(pr); return pr; };
  });
  r = await until(() => {
    const m = window.__m;
    const shots = window.__shots.filter((pr) => pr.owner === m.golem).length;
    return { ok: shots > 0 && m.zombie.prey === m.golem, golem: m.golem.ai.state, shots, zombiePrey: m.zombie.prey?.def.key };
  });
  check('Golem de neige : lance des boules de neige au zombie, qui riposte', !!r?.ok, JSON.stringify(r));

  await scene({ llama: ['llama', -4, 0], wolf: ['wolf', 4, 0] });
  r = await until(() => { const m = window.__m; return { ok: m.wolf.health < m.wolf.maxHealth, llama: m.llama.ai.state, wolf: m.wolf.health }; });
  check('Lama : crache sur le loup', !!r?.ok, JSON.stringify(r));

  // ---------- fuite ----------
  await scene({ cat: ['cat', -1, 0], creeper: ['creeper', 2, 0] });
  r = await until(() => {
    const m = window.__m;
    window.__cf = window.__cf || m.creeper.ai.state === 'FLEE';
    const d = Math.hypot(m.creeper.x - m.cat.x, m.creeper.z - m.cat.z);
    return { ok: window.__cf && d > 4, creeper: m.creeper.ai.state, fled: window.__cf, d: +d.toFixed(1) };
  }, 20000);
  check('Creeper : fuit le chat', !!r?.ok, JSON.stringify(r));

  await scene({ wolf: ['wolf', -1, 0], skeleton: ['skeleton', 2, 0] });
  r = await until(() => {
    const m = window.__m;
    window.__sf = window.__sf || m.skeleton.ai.state === 'FLEE';
    return { ok: window.__sf, skeleton: m.skeleton.ai.state, wolf: m.wolf.ai.state };
  }, 20000);
  check('Squelette : fuit le loup', !!r?.ok, JSON.stringify(r));

  // ---------- vengeance : la meute ----------
  await scene({ w1: ['wolf', -3, -2], w2: ['wolf', -3, 2], zombie: ['zombie', 4, 0] });
  r = await G(() => {
    const m = window.__m, s = window.__lecraft.session;
    s.combat.damageMob(m.w1, 1, { kind: 'bot', attacker: m.zombie });
    return { w1: m.w1.prey?.def.key, w2: m.w2.prey?.def.key, s1: m.w1.ai.state, s2: m.w2.ai.state };
  });
  check('Vengeance : le loup frappé et sa meute attaquent le zombie', r.w1 === 'zombie' && r.w2 === 'zombie' && r.s1 === 'HUNT' && r.s2 === 'HUNT', JSON.stringify(r));
  r = await until(() => { const m = window.__m; return { ok: m.zombie.health < m.zombie.maxHealth, zombie: m.zombie.health }; }, 20000);
  check('Vengeance : la meute mord le zombie', !!r?.ok, JSON.stringify(r));

  // ---------- chèvre ----------
  await scene({ goat: ['goat', -2, 0], cow: ['cow', 2, 0] });
  await G(() => { window.__m.goat.ramCooldown = 1; });
  r = await until(() => { const m = window.__m; return { ok: m.cow.health < m.cow.maxHealth, goat: m.goat.ai.state, cow: m.cow.health }; }, 20000);
  check('Chèvre : charge une créature proche', !!r?.ok, JSON.stringify(r));

  // ---------- en survie : ours polaire et abeille ----------
  await scene({ bear: ['polar_bear', -2, 0], cub: ['polar_bear', -4, 1, { baby: true }] }, { survival: true, px: 3, pz: 0 });
  r = await until(() => { const m = window.__m, p = window.__lecraft.session.player; return { ok: m.bear.anger > 0 && p.health < 20, anger: +m.bear.anger.toFixed(1), bear: m.bear.ai.state, hp: p.health }; }, 25000);
  check('Ours polaire : défend son petit (attaque le joueur proche)', !!r?.ok, JSON.stringify(r));

  await scene({ bear: ['polar_bear', -2, 0] }, { survival: true, px: 3, pz: 0 });
  await wait(4000);
  r = await G(() => { const m = window.__m, p = window.__lecraft.session.player; return { anger: m.bear.anger, hp: p.health }; });
  check('Ours polaire sans petit : reste neutre', r.anger === 0 && r.hp === 20, JSON.stringify(r));

  await scene({ bee: ['bee', -2, 0] }, { survival: true, px: 1, pz: 0 });
  await G(() => { const m = window.__m, s = window.__lecraft.session; s.combat.damageMob(m.bee, 1, { kind: 'player', fromPlayer: true }); });
  r = await until(() => {
    const m = window.__m, p = window.__lecraft.session.player;
    return { ok: !!m.bee.dynProps.get('__stung') && p.effects.level('poison') > 0, stung: !!m.bee.dynProps.get('__stung'), poison: p.effects.level('poison'), hp: p.health, bee: m.bee.ai.state };
  }, 25000);
  check('Abeille : pique le joueur et l’empoisonne', !!r?.ok, JSON.stringify(r));
  r = await G(async () => {
    const m = window.__m, p = window.__lecraft.session.player;
    const stung = !!m.bee.dynProps.get('__stung');
    const hp = p.health;
    p.effects.map.clear();
    await new Promise((res) => setTimeout(res, 3000));
    const again = p.health < hp;
    m.bee.stingDeath = 0.2; // accélère la mort (50 à 60 s dans le jeu)
    await new Promise((res) => setTimeout(res, 1500));
    return { stung, again, dead: m.bee.dead };
  });
  check('Abeille : sans dard, ne pique plus et meurt', r.stung && !r.again && r.dead, JSON.stringify(r));
  await G(() => { window.__lecraft.session.player.gameMode = 'creative'; });
  await page.screenshot({ path: `${OUT}/relations-01.png` });
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
