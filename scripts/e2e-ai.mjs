// E2E intelligence des créatures (ai/AIController.ts, ai/Pathfinder.ts, ai/Behaviors.ts) : chaque
// scénario est joué seul dans une arène plate, le résultat est mesuré en jeu (positions, états
// d'IA, blocs, créatures apparues). Contournement d'un trou et d'une barrière, portes (ouvertes par
// les illageois, brisées par les zombies en difficile seulement), renforts du zombie, creeper qui
// s'arrête et se dégonfle, squelette qui garde ses distances, animal en feu vers l'eau, petit qui
// suit son parent, loup qui contourne un mur, villageois couché la nuit, coût d'une bande de zombies.
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

/**
 * Prépare un scénario : arène vide 17×17 (sol de pierre en y-1), créatures posées (clé → [créature, dx, dz, options]),
 * joueur en survie (opts.survival) ou en vol créatif ; opts.diff règle la difficulté.
 */
const scene = (spec, opts = {}) => G(([spec, opts]) => {
  const s = window.__lecraft.session, p = s.player, a = window.__a;
  for (const e of s.entities.entities) if (e.kind === 'mob' || e.kind === 'item' || e.kind === 'projectile') e.removed = true;
  s.runCommand(`/fill ${a.x - 8} ${a.y - 8} ${a.z - 8} ${a.x + 8} ${a.y + 5} ${a.z + 8} air`);
  s.runCommand(`/fill ${a.x - 8} ${a.y - 1} ${a.z - 8} ${a.x + 8} ${a.y - 1} ${a.z + 8} stone`);
  p.gameMode = opts.survival ? 'survival' : 'creative';
  p.body.flying = !opts.survival;
  p.health = 20;
  p.difficulty = opts.diff ?? 'normal';
  p.effects.map.clear();
  p.body.setPos(a.x + 0.5 + (opts.px ?? 0), a.y + (opts.survival ? 0 : 6), a.z + 0.5 + (opts.pz ?? 7));
  p.yaw = 0; p.pitch = -0.6;
  window.__m = {};
  for (const [k, [key, dx, dz, o]] of Object.entries(spec)) window.__m[k] = s.entities.spawnMob(key, a.x + 0.5 + dx, a.y, a.z + 0.5 + dz, { persistent: true, ...(o ?? {}) });
  return Object.fromEntries(Object.entries(window.__m).map(([k, m]) => [k, !!m]));
}, [spec, opts]);

/** Attend qu'une condition (évaluée dans la page) soit vraie ; renvoie le dernier état. Le joueur est soigné à chaque sondage. */
const until = async (fn, ms = 45000) => {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await G(fn);
    await G(() => { window.__lecraft.session.player.health = 20; });
    if (last?.ok) return last;
    await wait(500);
  }
  return last;
};

try {
  await page.addInitScript(() => {
    localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'LOW', renderDistance: 2, autoQuality: false }));
    window.I = (k) => window.__lecraft.debug.blockId(k);
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await G(() => window.__lecraft.createWorld('IA', '4242', 'creative', 'normal'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(600);
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    s.gamerules.doMobSpawning = false;
    s.gamerules.doDaylightCycle = false;
    s.runCommand('/time set midnight'); // les zombies ne brûlent pas
    window.__a = { x: Math.floor(p.x), y: 100, z: Math.floor(p.z) };
  });

  // ---------- navigation ----------
  // trou de 6 blocs de profondeur : le zombie le contourne (jamais de saut dans le vide)
  await scene({ zombie: ['zombie', -6, 0] }, { survival: true, px: 6, pz: 0 });
  await G(() => {
    const s = window.__lecraft.session, a = window.__a;
    s.runCommand(`/fill ${a.x - 1} ${a.y - 7} ${a.z - 8} ${a.x + 1} ${a.y - 1} ${a.z + 3} air`);
    window.__minY = 1e9;
  });
  let r = await until(() => {
    const m = window.__m, a = window.__a, p = window.__lecraft.session.player;
    window.__minY = Math.min(window.__minY, m.zombie.y);
    const d = Math.hypot(m.zombie.x - p.x, m.zombie.z - p.z);
    return { ok: d < 2.5 && m.zombie.x > a.x + 1.5, d: +d.toFixed(1), x: +(m.zombie.x - a.x).toFixed(1), z: +(m.zombie.z - a.z).toFixed(1), minY: +(window.__minY - a.y).toFixed(1), state: m.zombie.ai.state };
  });
  check('Zombie : contourne un trou de 6 blocs pour atteindre le joueur', !!r?.ok && r.minY > -1, JSON.stringify(r));

  // barrière (clôture) sans issue directe : le chemin passe par l'extrémité
  await scene({ zombie: ['zombie', -5, 0] }, { survival: true, px: 5, pz: 0 });
  await G(() => {
    const s = window.__lecraft.session, a = window.__a;
    s.runCommand(`/fill ${a.x} ${a.y} ${a.z - 8} ${a.x} ${a.y} ${a.z + 4} oak_fence`);
  });
  r = await until(() => {
    const m = window.__m, p = window.__lecraft.session.player;
    const d = Math.hypot(m.zombie.x - p.x, m.zombie.z - p.z);
    return { ok: d < 2.5, d: +d.toFixed(1), z: +(m.zombie.z - window.__a.z).toFixed(1), state: m.zombie.ai.state };
  });
  check('Zombie : ne reste pas coincé derrière une barrière (la contourne)', !!r?.ok, JSON.stringify(r));

  // ---------- portes ----------
  // pièce fermée par un mur en z = a.z + 2 (largeur de l'arène) avec une porte en bois en x = a.x
  const room = () => G(() => {
    const s = window.__lecraft.session, a = window.__a, I = window.I;
    s.runCommand(`/fill ${a.x - 8} ${a.y} ${a.z + 2} ${a.x + 8} ${a.y + 3} ${a.z + 2} stone`);
    s.world.setBlock(a.x, a.y, a.z + 2, I('oak_door'), 0);
    s.world.setBlock(a.x, a.y + 1, a.z + 2, I('oak_door'), 8);
    window.__door = () => s.world.getMeta(a.x, a.y, a.z + 2);
    window.__doorBlock = () => s.world.getBlock(a.x, a.y, a.z + 2);
    window.__doorOpened = false;
  });
  await scene({ v: ['vindicator', 0, 5] }, { survival: true, px: 0, pz: -4, diff: 'normal' });
  await room();
  r = await until(() => {
    const m = window.__m, a = window.__a;
    if (window.__door() & 4) window.__doorOpened = true;
    return { ok: m.v.z < a.z + 1.5 && window.__doorOpened, z: +(m.v.z - a.z).toFixed(1), opened: window.__doorOpened, state: m.v.ai.state };
  });
  check('Vindicateur : ouvre la porte en bois fermée et rejoint le joueur', !!r?.ok, JSON.stringify(r));
  await wait(1500);
  r = await G(() => ({ closed: !(window.__door() & 4), exists: window.__doorBlock() > 0 }));
  check('Vindicateur : la porte se referme après son passage', r.closed && r.exists, JSON.stringify(r));

  // zombie en difficulté normale : la porte reste fermée et intacte
  await scene({ z: ['zombie', 0, 5] }, { survival: true, px: 0, pz: -4, diff: 'normal' });
  await room();
  await wait(1000);
  r = await until(() => {
    const m = window.__m, a = window.__a;
    return { ok: false, z: +(m.z.z - a.z).toFixed(1), doorIntact: window.__doorBlock() > 0, open: !!(window.__door() & 4) };
  }, 20000);
  check('Zombie (normal) : ne brise ni n’ouvre la porte, reste de l’autre côté', r.z > 2 && r.doorIntact && !r.open, JSON.stringify(r));

  // zombie en difficile : brise la porte au bout de 12 s de travail
  await scene({ z: ['zombie', 0, 5] }, { survival: true, px: 0, pz: -4, diff: 'hard' });
  await room();
  r = await until(() => {
    const m = window.__m, a = window.__a;
    return { ok: window.__doorBlock() === 0 && m.z.z < a.z + 1.5, z: +(m.z.z - a.z).toFixed(1), doorBlock: window.__doorBlock(), state: m.z.ai.state };
  }, 120000);
  check('Zombie (difficile) : brise la porte en bois puis passe', !!r?.ok, JSON.stringify(r));

  // porte en fer : personne ne la franchit à la main
  await scene({ v: ['vindicator', 0, 5] }, { survival: true, px: 0, pz: -4, diff: 'hard' });
  await G(() => {
    const s = window.__lecraft.session, a = window.__a, I = window.I;
    s.runCommand(`/fill ${a.x - 8} ${a.y} ${a.z + 2} ${a.x + 8} ${a.y + 3} ${a.z + 2} stone`);
    s.world.setBlock(a.x, a.y, a.z + 2, I('iron_door'), 0);
    s.world.setBlock(a.x, a.y + 1, a.z + 2, I('iron_door'), 8);
  });
  r = await until(() => ({ ok: false, z: +(window.__m.v.z - window.__a.z).toFixed(1) }), 15000);
  check('Porte en fer : le vindicateur ne la franchit pas', r.z > 2, JSON.stringify(r));

  // ---------- renforts du zombie ----------
  const count = () => G(() => window.__lecraft.session.entities.entities.filter((e) => e.kind === 'mob' && e.def.key === 'zombie' && !e.dead && !e.removed).length);
  await scene({ z: ['zombie', 0, -3] }, { survival: true, px: 0, pz: 3, diff: 'hard' });
  // les renforts exigent la règle doMobSpawning (comme le jeu Java)
  await G(() => {
    const s = window.__lecraft.session, a = window.__a;
    s.runCommand(`/fill ${a.x - 30} ${a.y - 1} ${a.z - 30} ${a.x + 30} ${a.y - 1} ${a.z + 30} stone`); // sol pour le point d'apparition (7 à 40 blocs)
    s.gamerules.doMobSpawning = true;
    window.__m.z.dynProps.set('__reinf', 1);
  });
  const before = await count();
  await G(() => { const s = window.__lecraft.session; s.combat.damageMob(window.__m.z, 1, { kind: 'player', fromPlayer: true }); });
  const afterHard = await count();
  const spawned = await G(() => {
    const m = window.__m, p = window.__lecraft.session.player;
    const o = window.__lecraft.session.entities.entities.find((e) => e.kind === 'mob' && e.def.key === 'zombie' && e !== m.z && !e.removed);
    return o ? +Math.hypot(o.x - m.z.x, o.z - m.z.z).toFixed(1) : -1;
  });
  check('Zombie (difficile) : appelle un renfort à 7+ blocs quand on le frappe', afterHard === before + 1 && spawned >= 7, `avant=${before} après=${afterHard} distance=${spawned}`);
  await scene({ z: ['zombie', 0, -3] }, { survival: true, px: 0, pz: 3, diff: 'normal' });
  await G(() => { window.__m.z.dynProps.set('__reinf', 1); });
  const b2 = await count();
  await G(() => { const s = window.__lecraft.session; s.combat.damageMob(window.__m.z, 1, { kind: 'player', fromPlayer: true }); });
  check('Zombie (normal) : pas de renfort', (await count()) === b2, `avant=${b2}`);
  await G(() => { window.__lecraft.session.gamerules.doMobSpawning = false; });

  // ---------- creeper ----------
  await scene({ c: ['creeper', 0, -2] }, { survival: true, px: 0, pz: 3 });
  r = await until(() => {
    const c = window.__m.c;
    if (c.fuse > 0.15) {
      window.__fx = window.__fx ?? [c.x, c.z];
      window.__fT = (window.__fT ?? 0) + 1;
    }
    const moved = window.__fx ? Math.hypot(c.x - window.__fx[0], c.z - window.__fx[1]) : 0;
    return { ok: window.__fT >= 2 || c.removed, fuse: +c.fuse.toFixed(2), moved: +moved.toFixed(2) };
  }, 20000);
  check('Creeper : s’immobilise pendant que la mèche brûle', r && r.moved < 0.8 && (r.fuse > 0 || r.ok), JSON.stringify(r));

  // mèche amorcée, joueur derrière un mur : sans vue, elle se dégonfle (SwellGoal)
  await scene({ c: ['creeper', 0, -3] }, { survival: true, px: 0, pz: 3 });
  await G(() => {
    const s = window.__lecraft.session, a = window.__a;
    s.runCommand(`/fill ${a.x - 8} ${a.y} ${a.z} ${a.x + 8} ${a.y + 4} ${a.z} stone`);
    window.__m.c.fuse = 1.0;
    window.__m.c.ai.canSee = false;
  });
  r = await until(() => {
    const c = window.__m.c;
    return { ok: !c.removed && c.fuse < 0.3, fuse: +c.fuse.toFixed(2), removed: c.removed };
  }, 20000);
  check('Creeper : sans ligne de vue sur le joueur, la mèche se dégonfle sans exploser', !!r?.ok, JSON.stringify(r));

  // ---------- squelette ----------
  await scene({ sk: ['skeleton', 0, 3] }, { survival: true, px: 0, pz: 0 });
  await G(() => {
    const E = window.__lecraft.session.entities, orig = E.spawnProjectile.bind(E);
    window.__shots = [];
    window.__skMax = 0;
    E.spawnProjectile = (...a) => { const pr = orig(...a); window.__shots.push(pr); return pr; }; // le tireur est posé après l'appel
  });
  r = await until(() => {
    const m = window.__m, p = window.__lecraft.session.player;
    const d = Math.hypot(m.sk.x - p.x, m.sk.z - p.z);
    window.__skMax = Math.max(window.__skMax, d);
    const arrows = window.__shots.filter((pr) => pr.owner === m.sk).length;
    return { ok: window.__skMax > 6 && arrows >= 2, dMax: +window.__skMax.toFixed(1), arrows, state: m.sk.ai.state };
  });
  check('Squelette : recule pour garder ses distances et tire', !!r?.ok, JSON.stringify(r));

  // ---------- panique : animal en feu ----------
  await scene({ sheep: ['sheep', -3, 0] }, { px: 0, pz: 7 });
  await G(() => {
    const s = window.__lecraft.session, a = window.__a;
    // bassin de 3×3 à 4 blocs du mouton, bordé de pierre
    s.runCommand(`/fill ${a.x + 0} ${a.y - 4} ${a.z - 2} ${a.x + 4} ${a.y - 2} ${a.z + 2} stone`);
    s.runCommand(`/fill ${a.x + 1} ${a.y - 3} ${a.z - 1} ${a.x + 3} ${a.y - 1} ${a.z + 1} water`);
    window.__m.sheep.fireTime = 8;
    window.__m.sheep.health = 20;
    window.__m.sheep.maxHealthOverride = 20;
  });
  r = await until(() => {
    const sh = window.__m.sheep, a = window.__a;
    window.__wet = window.__wet || sh.body.inWater;
    // éteinte tôt (un feu laissé à lui-même coûte 8 PV sur 20) : l'eau a été atteinte, même entre deux sondages
    return { ok: sh.fireTime <= 0 && !sh.dead && sh.health >= 14, wet: window.__wet, fire: +sh.fireTime.toFixed(1), hp: sh.health, x: +(sh.x - a.x).toFixed(1), state: sh.ai.state };
  }, 30000);
  check('Mouton en feu : court vers l’eau voisine et s’éteint (moins de 6 PV perdus sur 8)', !!r?.ok, JSON.stringify(r));

  // ---------- petits ----------
  await scene({ cow: ['cow', 0, 0], baby: ['cow', 6, 0, { baby: true }] });
  r = await until(() => {
    const m = window.__m;
    const d = Math.hypot(m.cow.x - m.baby.x, m.cow.z - m.baby.z);
    window.__bd = Math.min(window.__bd ?? 99, d);
    return { ok: d < 4.5 && window.__bd < 4.5, d: +d.toFixed(1), parent: m.baby.parentMob === m.cow };
  }, 40000);
  check('Veau : rejoint et suit sa mère', !!r?.ok, JSON.stringify(r));

  // ---------- loup apprivoisé ----------
  await scene({ wolf: ['wolf', -7, 0] }, { px: 4, pz: 0 });
  await G(() => {
    const s = window.__lecraft.session, a = window.__a;
    s.runCommand(`/fill ${a.x - 2} ${a.y} ${a.z - 7} ${a.x - 2} ${a.y + 3} ${a.z + 3} stone`);
    window.__m.wolf.tame(s);
    window.__m.wolf.sitting = false;
    s.player.body.flying = true;
    s.player.body.setPos(a.x + 4.5, a.y, a.z + 0.5);
  });
  r = await until(() => {
    const w = window.__m.wolf, p = window.__lecraft.session.player, a = window.__a;
    const d = Math.hypot(w.x - p.x, w.z - p.z);
    return { ok: d < 4 && w.x > a.x - 1, d: +d.toFixed(1), x: +(w.x - a.x).toFixed(1), z: +(w.z - a.z).toFixed(1) };
  }, 40000);
  check('Loup apprivoisé : contourne un mur pour rejoindre son maître', !!r?.ok, JSON.stringify(r));

  // ---------- villageois : sommeil ----------
  await scene({ v: ['villager', 0, 0] }, { px: 0, pz: 7 });
  await G(() => {
    const s = window.__lecraft.session, a = window.__a, I = window.I;
    s.world.setBlock(a.x + 5, a.y, a.z, I('red_bed'), 0);
    s.world.setBlock(a.x + 5, a.y, a.z + 1, I('red_bed'), 4);
    window.__m.v.homeX = a.x + 0.5;
    window.__m.v.homeZ = a.z + 0.5;
    s.runCommand('/time set midnight');
  });
  r = await until(() => {
    const v = window.__m.v, a = window.__a;
    return { ok: v.sleeping, sleeping: v.sleeping, d: +Math.hypot(v.x - (a.x + 5.5), v.z - (a.z + 0.5)).toFixed(1), y: +(v.y - a.y).toFixed(2) };
  }, 40000);
  check('Villageois : rejoint un lit libre la nuit et s’y couche', !!r?.ok && r.d < 1.6, JSON.stringify(r));
  await G(() => { window.__lecraft.session.runCommand('/time set day'); });
  r = await until(() => ({ ok: !window.__m.v.sleeping, sleeping: window.__m.v.sleeping }), 15000);
  check('Villageois : se lève au matin', !!r?.ok, JSON.stringify(r));

  // ---------- villageois : fuite d’un zombie par un chemin ----------
  await scene({ zombie: ['zombie', -4, 0], v: ['villager', 2, 0] }, { px: 0, pz: 7 });
  await G(() => { const a = window.__a; window.__lecraft.session.runCommand(`/fill ${a.x - 20} ${a.y - 1} ${a.z - 20} ${a.x + 20} ${a.y - 1} ${a.z + 20} stone`); }); // de la place pour fuir
  r = await until(() => {
    const m = window.__m;
    window.__vf = window.__vf || m.v.ai.state === 'FLEE';
    window.__vmax = Math.max(window.__vmax ?? 0, Math.hypot(m.v.x - m.zombie.x, m.v.z - m.zombie.z));
    return { ok: window.__vf && window.__vmax > 7, fled: window.__vf, dMax: +window.__vmax.toFixed(1), hp: m.v.health };
  }, 25000);
  check('Villageois : fuit le zombie et s’en éloigne à plus de 7 blocs', !!r?.ok, JSON.stringify(r));

  // ---------- coût de l'IA : une horde de zombies ----------
  await scene({}, { survival: true, px: 0, pz: 0 });
  await G(() => {
    const s = window.__lecraft.session, a = window.__a;
    s.runCommand(`/fill ${a.x - 3} ${a.y} ${a.z - 3} ${a.x + 3} ${a.y + 2} ${a.z + 3} stone`);
    s.runCommand(`/fill ${a.x - 2} ${a.y} ${a.z - 2} ${a.x + 2} ${a.y + 2} ${a.z + 2} air`);
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      s.entities.spawnMob('zombie', a.x + 0.5 + Math.cos(ang) * 7, a.y, a.z + 0.5 + Math.sin(ang) * 7, { persistent: true });
    }
    const E = s.entities, up = E.update.bind(E);
    window.__ticks = [];
    E.update = (...x) => { const t = performance.now(); up(...x); window.__ticks.push(performance.now() - t); };
  });
  await wait(8000);
  r = await G(() => {
    const t = window.__ticks.slice().sort((a, b) => a - b);
    const n = t.length;
    return { n, mean: +(t.reduce((x, y) => x + y, 0) / Math.max(1, n)).toFixed(2), p95: +(t[Math.floor(n * 0.95)] ?? 0).toFixed(2), max: +(t[n - 1] ?? 0).toFixed(1) };
  });
  check('Perf : 24 zombies à la poursuite, mise à jour des entités < 8 ms en moyenne', r.n > 10 && r.mean < 8, JSON.stringify(r));

  check('Aucune erreur de page', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('Script e2e-ai sans exception', false, String(e?.stack ?? e).slice(0, 400));
}
await browser.close();
console.log(`\n${total - failed}/${total} vérifications réussies`);
process.exit(failed ? 1 : 0);
