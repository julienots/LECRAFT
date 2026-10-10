// Test de bout en bout : pilote le jeu avec de vrais événements tactiles (CDP) dans Chromium
// (même moteur que la WebView Android). Usage : npm run build && npx vite preview & npm run e2e
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
mkdirSync(OUT, { recursive: true });
const W = 915, H = 412;
const results = [];
let failed = 0;
const check = (name, ok, detail = '') => {
  results.push(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
  console.log(results[results.length - 1]);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const cdp = await ctx.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id]) => ({ x, y, id })) });
const wait = (ms) => page.waitForTimeout(ms);
const G = (fn, arg) => page.evaluate(fn, arg);
const state = () => G(() => window.__lecraft.state);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const center = async (sel) => {
  const b = await page.locator(sel).first().boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
};
/** Réévalue `fn` dans la page jusqu'à ce que `ok(valeur)` (rendu logiciel lent : pas de délai fixe). */
async function poll(fn, arg, ok, ms = 4000) {
  const t0 = Date.now();
  let v = await G(fn, arg);
  while (!ok(v) && Date.now() - t0 < ms) {
    await wait(150);
    v = await G(fn, arg);
  }
  return v;
}
async function tapAt(x, y, id = 1) {
  // toucher bref : horodatages explicites à 60 ms d'écart (l'outil de test attend que chaque événement
  // soit traité ; sur une image lente en rendu logiciel l'écart réel dépasserait l'appui long)
  const t = Date.now() / 1000;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }], timestamp: t });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t + 0.06 });
  await wait(60);
}
/** Remet le joueur au centre d'une zone plane dégagée (tests reproductibles). */
async function reset(pitch = 0, yaw = 0) {
  await G(([pitch, yaw]) => {
    const s = window.__lecraft.session, w = s.world, p = s.player;
    if (!window.__arena) window.__arena = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    const a = window.__arena;
    for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) {
      w.setBlock(a.x + dx, a.y - 1, a.z + dz, window.__lecraft.debug.blockId('stone'));
      for (let dy = 0; dy < 6; dy++) w.setBlock(a.x + dx, a.y + dy, a.z + dz, 0);
    }
    p.body.setPos(a.x + 0.5, a.y, a.z + 0.5);
    p.body.vx = p.body.vy = p.body.vz = 0;
    p.yaw = yaw; p.pitch = pitch;
  }, [pitch, yaw]);
  await wait(900);
}
async function hold(sel, ms) {
  const [x, y] = await center(sel);
  await touch('touchStart', [[x, y, 7]]);
  await wait(ms);
  await touch('touchEnd', []);
}

try {
  // ---------- lancement & menu ----------
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 30000 });
  check('Lancement et menu principal', true);
  await shot('e2e-01-menu');

  // ---------- paramètres depuis le menu ----------
  await page.getByText('Options...').first().click();
  await page.getByText('Commandes...').click();
  await wait(200);
  check('Écran Options → Commandes', (await page.locator('.mc-screen').last().locator('.mc-btn, .mc-slider').count()) > 8);
  await page.getByText('Terminé').last().click();
  await wait(100);
  await page.getByText('Terminé').last().click();
  await wait(100);

  // ---------- nouveau monde ----------
  await page.getByText('Solo').click();
  await page.getByText('Créer un nouveau monde').first().click();
  await wait(200);
  const form = page.locator('.mc-screen').last();
  await form.locator('input').first().fill(`Test E2E ${Date.now() % 100000}`);
  await form.locator('input').nth(1).fill('839274928');
  await page.locator('.mc-footer').last().getByText('Créer un nouveau monde').click();
  await page.waitForFunction(() => window.__lecraft?.state === 'playing', null, { timeout: 120000 });
  await wait(2500);
  const info0 = await G(() => { const s = window.__lecraft.session; return { seed: s.world.seed, x: s.player.x, y: s.player.y, z: s.player.z, chunks: s.world.chunks.size, ground: s.player.body.onGround }; });
  check('Création du monde avec seed', info0.seed === 839274928, `seed ${info0.seed}, ${info0.chunks} chunks`);
  check('Génération du terrain / joueur au sol', info0.ground && info0.chunks >= 25, JSON.stringify(info0));
  await shot('e2e-02-world');

  // zone dégagée pour les tests d'interaction
  await G(() => { const s = window.__lecraft.session; s.dayCycle.time = 0.2; s.weather.state = 'clear'; s.weather.intensity = 0; });
  await reset();

  // ---------- déplacement au joystick ----------
  const z1 = await G(() => window.__lecraft.session.player.z);
  await touch('touchStart', [[150, 300, 1]]);
  await wait(50);
  for (let i = 1; i <= 5; i++) { await touch('touchMove', [[150, 300 - i * 12, 1]]); await wait(30); }
  await wait(1200);
  await touch('touchEnd', []);
  const z2 = await G(() => window.__lecraft.session.player.z);
  check('Déplacement (joystick tactile)', z2 < z1 - 1, `z ${z1.toFixed(2)} → ${z2.toFixed(2)}`);

  // ---------- caméra ----------
  const yaw1 = await G(() => window.__lecraft.session.player.yaw);
  await touch('touchStart', [[650, 200, 2]]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [[650 - i * 15, 200, 2]]); await wait(20); }
  await touch('touchEnd', []);
  await wait(100);
  const yaw2 = await G(() => window.__lecraft.session.player.yaw);
  check('Caméra (glisser à droite)', Math.abs(yaw2 - yaw1) > 0.1, `yaw ${yaw1.toFixed(2)} → ${yaw2.toFixed(2)}`);

  // ---------- saut ----------
  await reset();
  const yJ = await G(() => window.__lecraft.session.player.y);
  const [jx, jy] = await center('.btn-jump');
  await touch('touchStart', [[jx, jy, 3]]);
  let maxY = yJ;
  for (let i = 0; i < 8; i++) { await wait(40); maxY = Math.max(maxY, await G(() => window.__lecraft.session.player.y)); }
  await touch('touchEnd', []);
  check('Saut', maxY > yJ + 0.5, `hauteur max +${(maxY - yJ).toFixed(2)}`);
  await wait(800);

  // ---------- minage (appui long) ----------
  await reset(-0.38);
  const target = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z) - 2;
    s.world.setBlock(x, y, z, window.__lecraft.debug.blockId('dirt')); // terre devant le joueur
    s.world.setBlock(x, y + 1, z, 0);
    p.yaw = 0; p.pitch = -0.38;
    return { x, y, z };
  });
  await wait(600);
  const aimed = await G(() => { const t = window.__lecraft.session.interaction.target; return t ? `${t.x},${t.y},${t.z}` : null; });
  check('Visée d’un bloc (raycast)', aimed === `${target.x},${target.y},${target.z}`, `visé ${aimed}`);
  await touch('touchStart', [[457, 206, 4]]);
  await wait(2200);
  await shot('e2e-03-mining');
  await touch('touchEnd', []);
  await wait(1500);
  const mined = await G((t) => window.__lecraft.session.world.getBlock(t.x, t.y, t.z), target);
  check('Minage par appui long', mined === 0, `bloc après minage : ${mined}`);
  // ramassage
  // le joueur marche jusqu'à l'objet (pas d'aimant, comme le jeu original : ramassage à ~1 bloc)
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const it = s.entities.entities.find((e) => e.kind === 'item' && e.itemId === 'dirt');
    if (it) p.body.setPos(it.body.x, p.y, it.body.z + 0.6);
    else p.body.setPos(p.x, p.y, p.z - 1.2);
  });
  await wait(1500);
  const dirt = await G(() => window.__lecraft.session.player.inventory.count('dirt'));
  check('Drop et ramassage de l’objet', dirt >= 1, `terre en inventaire : ${dirt}`);

  // ---------- placement (toucher) ----------
  const placeT = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const inv = p.inventory;
    const i = inv.slots.findIndex((x) => x?.id === 'dirt');
    inv.selected = i; inv.changed();
    p.yaw = 0; p.pitch = -0.6;
    return true;
  });
  await wait(400);
  const pv = await G(() => window.__lecraft.session.interaction.preview);
  check('Prévisualisation de pose (valide)', !!pv && pv.valid, JSON.stringify(pv));
  await tapAt(457, 206, 5);
  const dirtId = await G(() => window.__lecraft.debug.blockId('dirt'));
  const placed = pv ? await poll((v) => window.__lecraft.session.world.getBlock(v.x, v.y, v.z), pv, (b) => b === dirtId) : -1;
  check('Pose d’un bloc (toucher)', placed === dirtId, `bloc posé : ${placed}`);
  void placeT;

  // ---------- hotbar tactile ----------
  await G(() => { const inv = window.__lecraft.session.player.inventory; inv.add({ id: 'oak_log', count: 4 }); });
  const [hx, hy] = await center('.mc-hotbar .mc-hslot:nth-child(3)');
  await tapAt(hx, hy, 6);
  check('Sélection dans la hotbar (toucher)', (await poll(() => window.__lecraft.session.player.inventory.selected, undefined, (v) => v === 2)) === 2);

  // ---------- inventaire à curseur & fabrication ----------
  const slot = (n) => page.locator('.gui .gslot').nth(n);
  // toucher bref : appui et relâchement partent ensemble (le rendu logiciel peut prendre > 380 ms par
  // image ; deux allers-retours séparés seraient pris pour un appui long)
  const tap = async (loc) => { await loc.evaluate((el) => { for (const t of ['pointerdown', 'pointerup']) el.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerType: 'touch' })); }); await wait(60); };
  // double toucher réel : les quatre événements partent d'un coup (sans aller-retour par événement)
  const dbl = async (loc) => {
    // événements créés d'avance : comme un vrai écran, chaque toucher est horodaté quand il a lieu,
    // pas quand le jeu a fini de traiter le précédent (rendu logiciel lent)
    await loc.evaluate((el) => { const evs = ['pointerdown', 'pointerup', 'pointerdown', 'pointerup'].map((t) => new PointerEvent(t, { bubbles: true, pointerType: 'touch' })); for (const e of evs) el.dispatchEvent(e); });
    await wait(160);
  };
  const [ix, iy] = await center('.mc-invbtn');
  await tapAt(ix, iy, 8);
  await wait(400);
  check('Ouverture de l’inventaire (bouton ••• de la hotbar)', (await page.locator('.gui').count()) === 1 && (await page.locator('.gui .gslot').count()) === 45);
  await shot('e2e-04-inventory');
  // ordre des cases (mode main) : armure 0-3, grille 4-7, résultat 8, sac 9-35, barre 36-44
  const logIdx = await G(() => window.__lecraft.session.player.inventory.slots.findIndex((x) => x?.id === 'oak_log'));
  const guiIdx = (i) => (i < 9 ? 36 + i : i);
  await tap(slot(guiIdx(logIdx)));
  await tap(slot(4));
  const gridOk = await G(() => window.__lecraft.session.player.inventory.count('oak_log'));
  check('Curseur : prendre puis poser les troncs dans la grille 2x2', gridOk === 0);
  // le résultat apparaît à l'image suivante (lente en rendu logiciel)
  await page.waitForFunction(() => document.querySelectorAll('.gui .gslot')[8]?.querySelector('img,canvas,.item'), null, { timeout: 5000 }).catch(() => {});
  await wait(300);
  await dbl(slot(8));
  const planks = await G(() => window.__lecraft.session.player.inventory.count('oak_planks'));
  const craftDbg = planks === 16 ? '' : await G(() => { const g = window.__lecraft.inventoryUI ?? window.__lecraft.invUI; const s = window.__lecraft.session; return JSON.stringify({ slots: s.player.inventory.slots.map((x) => x && `${x.id}x${x.count}`).filter(Boolean), gui: [...document.querySelectorAll('.gui .gslot')].slice(4, 9).map((e) => e.outerHTML.slice(0, 120)), keys: Object.keys(window.__lecraft).filter((k) => /inv/i.test(k)) }); });
  check('Fabrication 2x2 : planches (double toucher = tout fabriquer)', planks === 16, `planches : ${planks} ${craftDbg}`);
  // livre de recettes
  if ((await page.locator('.gui-side').count()) === 0) await page.locator('.gui .gui-btn').dispatchEvent('pointerup');
  await wait(200);
  await shot('e2e-05-crafting');
  await tap(page.locator('.brecipe[data-item=crafting_table]'));
  await wait(400);
  await dbl(slot(8));
  check('Livre de recettes : établi', (await G(() => window.__lecraft.session.player.inventory.count('crafting_table'))) === 1);
  await tap(page.locator('.brecipe[data-item=stick]'));
  await wait(400);
  await dbl(slot(8));
  check('Livre de recettes : bâtons', (await G(() => window.__lecraft.session.player.inventory.count('stick'))) === 4);
  // déplacer un stack (toucher prendre / toucher poser)
  const before = await G(() => window.__lecraft.session.player.inventory.slots.map((s) => s?.id ?? null));
  const srcIdx = before.findIndex((x) => x === 'oak_planks');
  const emptyIdx = before.findIndex((x, i) => x === null && i >= 9);
  await tap(slot(guiIdx(srcIdx)));
  await wait(400);
  await tap(slot(guiIdx(emptyIdx)));
  await wait(150);
  const after = await G(() => window.__lecraft.session.player.inventory.slots.map((s) => s?.id ?? null));
  check('Déplacer un objet dans l’inventaire', after[emptyIdx] === 'oak_planks' && after[srcIdx] !== 'oak_planks', `slot ${srcIdx} → ${emptyIdx}`);
  await page.keyboard.press('Escape');
  await wait(300);
  check('Fermeture de l’inventaire (retour)', (await page.locator('.gui').count()) === 0 && (await state()) === 'playing');

  // ---------- établi posé & ouvert ----------
  await reset(-0.6, Math.PI);
  await G(() => {
    const s = window.__lecraft.session, p = s.player, inv = p.inventory;
    inv.selected = inv.slots.findIndex((x) => x?.id === 'crafting_table'); inv.changed();
    p.yaw = Math.PI; p.pitch = -0.6;
  });
  await wait(400);
  await tapAt(457, 206, 9);
  await wait(300);
  await tapAt(457, 206, 10);
  await wait(400);
  const tableDbg = await G(() => { const s = window.__lecraft.session, i = s.interaction, a = window.__arena; let placed = null; for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) for (let dy = 0; dy < 4; dy++) if (s.world.getBlock(a.x + dx, a.y + dy, a.z + dz) === window.__lecraft.debug.blockId('crafting_table')) placed = [dx, dy, dz]; return JSON.stringify({ placed, inv: s.player.inventory.count('crafting_table'), mob: i.targetMob?.def.key ?? null, mobs: s.entities.mobs.filter((m) => Math.hypot(m.x - a.x, m.z - a.z) < 8).map((m) => m.def.key), t: i.target && [i.target.x - a.x, i.target.y - a.y, i.target.z - a.z] }); });
  check('Établi posé puis ouvert (grille 3x3)', (await page.locator('.gui .gslot').count()) === 46, tableDbg);
  await tap(page.locator('.brecipe[data-item=wooden_pickaxe]'));
  await dbl(slot(9));
  check('Fabrication 3x3 : pioche en bois', (await G(() => window.__lecraft.session.player.inventory.count('wooden_pickaxe'))) === 1);
  await shot('e2e-05b-table');
  await page.keyboard.press('Escape');
  await wait(200);

  // ---------- combat & créatures ----------
  await reset(-0.45);
  const mob = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const m = s.entities.spawnMob('pig', p.x, p.y, p.z - 2.2);
    m.ai.fsm.set('IDLE'); m.idleTime = 100;
    return m.id;
  });
  await wait(500);
  const hp0 = await G((id) => window.__lecraft.session.entities.mobs.find((m) => m.id === id)?.health, mob);
  // comme l'édition mobile : toucher la créature la frappe
  await tapAt(457, 206, 11);
  await wait(300);
  const hp1 = await G((id) => window.__lecraft.session.entities.mobs.find((m) => m.id === id)?.health ?? 0, mob);
  check('Combat : toucher une créature la frappe', hp1 < hp0, `PV ${hp0} → ${hp1}`);
  const fsm = await G((id) => window.__lecraft.session.entities.mobs.find((m) => m.id === id)?.ai.state, mob);
  check('IA : fuite après dégâts (animal passif)', fsm === 'FLEE', `état ${fsm}`);
  const hostile = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const m = s.entities.spawnMob('zombie', p.x + 6, p.y, p.z);
    return m.id;
  });
  await G(() => { window.__lecraft.session.dayCycle.time = 0.75; });
  let chase = '';
  for (let i = 0; i < 20 && chase !== 'CHASE' && chase !== 'ATTACK'; i++) {
    await wait(200);
    chase = await G((id) => window.__lecraft.session.entities.mobs.find((m) => m.id === id)?.ai.state, hostile);
  }
  check('IA : un monstre détecte et poursuit le joueur', chase === 'CHASE' || chase === 'ATTACK', `état ${chase}`);
  const hpP0 = await G(() => window.__lecraft.session.player.health);
  const hpP1 = await poll(() => window.__lecraft.session.player.health, undefined, (h) => h < hpP0, 10000);
  check('Combat : le joueur reçoit des dégâts', hpP1 < hpP0, `PV joueur ${hpP0} → ${hpP1}`);
  await shot('e2e-06-combat');
  await G((id) => { const s = window.__lecraft.session; const m = s.entities.mobs.find((x) => x.id === id); if (m) s.combat.damageMob(m, 999, { kind: 'player', fromPlayer: true }); s.dayCycle.time = 0.2; }, hostile);
  // la créature bascule pendant 1 s (temps de jeu) puis disparaît ; on attend au plus 4 s réelles
  for (let i = 0; i < 20 && (await G((id) => window.__lecraft.session.entities.mobs.some((m) => m.id === id), hostile)); i++) await wait(200);
  check('Mort d’une créature (suppression)', !(await G((id) => window.__lecraft.session.entities.mobs.some((m) => m.id === id), hostile)));

  // ---------- pause / retour Android ----------
  await page.keyboard.press('Escape');
  await wait(300);
  check('Pause (retour)', (await state()) === 'paused' && (await page.getByText('Retour au jeu').count()) === 1);
  await shot('e2e-07-pause');
  const simT = await G(() => window.__lecraft.session.dayCycle.time);
  await wait(700);
  check('Simulation stoppée en pause', (await G(() => window.__lecraft.session.dayCycle.time)) === simT);
  await page.keyboard.press('Escape');
  await wait(300);
  check('Reprise (retour depuis la pause)', (await state()) === 'playing');

  // ---------- sauvegarde & rechargement ----------
  const snap = await G(() => { const s = window.__lecraft.session, p = s.player; return { x: p.x, y: p.y, z: p.z, planks: p.inventory.count('oak_planks'), placed: s.world.getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)) }; });
  await page.keyboard.press('Escape');
  await wait(200);
  await page.getByText('Sauvegarder', { exact: true }).click();
  await page.waitForFunction(() => document.body.innerText.includes('Sauvegardé à'), null, { timeout: 15000 });
  check('Sauvegarde manuelle', true);
  await page.getByText('Sauvegarder et quitter').click();
  await page.waitForFunction(() => window.__lecraft.state === 'menu');
  await page.reload();
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 30000 });
  await page.getByText('Solo').click();
  await wait(600);
  check('Liste des mondes (miniature, nom)', (await page.locator('.world-entry', { hasText: 'Test E2E' }).count()) >= 1 && (await page.locator('.world-entry img').count()) >= 1);
  await shot('e2e-08-worlds');
  await page.locator('.world-entry').first().click();
  await page.getByText('Jouer au monde sélectionné').click();
  await page.waitForFunction(() => window.__lecraft?.state === 'playing', null, { timeout: 120000 });
  await wait(1500);
  const re = await G(() => { const p = window.__lecraft.session.player; return { x: p.x, y: p.y, z: p.z, planks: p.inventory.count('oak_planks') }; });
  check('Chargement : position restaurée', Math.abs(re.x - snap.x) < 0.5 && Math.abs(re.z - snap.z) < 0.5, `${JSON.stringify(re)}`);
  check('Chargement : inventaire restauré', re.planks === snap.planks, `planches ${re.planks}`);
  const minedAfter = await G((t) => window.__lecraft.session.world.getBlock(t.x, t.y, t.z), target);
  check('Chargement : blocs modifiés restaurés', minedAfter === 0 || minedAfter === dirtId, `bloc ${minedAfter}`);

  // ---------- mort & réapparition ----------
  await G(() => window.__lecraft.session.player.damage(100, 'void'));
  await wait(500);
  check('Mort du joueur → écran de mort', (await page.getByText('Vous êtes mort').count()) === 1);
  await wait(1100);
  await page.getByText('Réapparaître').click();
  await wait(500);
  check('Réapparition', (await G(() => window.__lecraft.session.player.health)) > 0 && (await state()) === 'playing');

  // ---------- performance (indicatif : rendu logiciel SwiftShader) ----------
  await G(() => window.__lecraft.hud.setDebug(true));
  await wait(3000);
  await shot('e2e-09-debug');
  const perf = await G(() => ({ fps: window.__lecraft.hud.currentFps, calls: window.__lecraft.renderer.gl.info.render.calls, tris: window.__lecraft.renderer.gl.info.render.triangles, meshMs: window.__lecraft.session.chunks.stats.meshMs }));
  check('Statistiques de rendu', perf.calls > 0, JSON.stringify(perf));
} catch (e) {
  check('Exception pendant le test', false, String(e?.stack ?? e));
  await shot('e2e-error').catch(() => {});
}

const serious = errors.filter((e) => !/favicon|DevTools/.test(e));
check('Aucune erreur console', serious.length === 0, serious.slice(0, 5).join(' | '));
console.log(`\n${results.length - failed}/${results.length} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
