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
async function tapAt(x, y, id = 1) {
  await touch('touchStart', [[x, y, id]]);
  await wait(60);
  await touch('touchEnd', []);
  await wait(60);
}
/** Remet le joueur au centre d'une zone plane dégagée (tests reproductibles). */
async function reset(pitch = 0, yaw = 0) {
  await G(([pitch, yaw]) => {
    const s = window.__lecraft.session, w = s.world, p = s.player;
    if (!window.__arena) window.__arena = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    const a = window.__arena;
    for (let dx = -7; dx <= 7; dx++) for (let dz = -7; dz <= 7; dz++) {
      w.setBlock(a.x + dx, a.y - 1, a.z + dz, 4);
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
  await page.getByText('Paramètres').first().click();
  await page.getByText('Contrôles').click();
  await wait(200);
  check('Écran paramètres (onglets)', (await page.locator('.setting').count()) > 5);
  await page.locator('.title-bar .btn').last().click();

  // ---------- nouveau monde ----------
  await page.getByText('Nouveau monde').first().click();
  await page.locator('input[type=text]').first().fill(`Test E2E ${Date.now() % 100000}`);
  await page.locator('input[type=text]').nth(1).fill('839274928');
  await page.getByText('Créer le monde').click();
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
    s.world.setBlock(x, y, z, 3); // terre devant le joueur
    s.world.setBlock(x, y + 1, z, 0);
    p.yaw = 0; p.pitch = -0.38;
    return { x, y, z };
  });
  await wait(600);
  const aimed = await G(() => { const t = window.__lecraft.session.interaction.target; return t ? `${t.x},${t.y},${t.z}` : null; });
  check('Visée d’un bloc (raycast)', aimed === `${target.x},${target.y},${target.z}`, `visé ${aimed}`);
  await touch('touchStart', [[700, 180, 4]]);
  await wait(2200);
  await shot('e2e-03-mining');
  await touch('touchEnd', []);
  await wait(1500);
  const mined = await G((t) => window.__lecraft.session.world.getBlock(t.x, t.y, t.z), target);
  check('Minage par appui long', mined === 0, `bloc après minage : ${mined}`);
  // ramassage
  await G(() => { const p = window.__lecraft.session.player; p.body.setPos(p.x, p.y, p.z - 1.2); });
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
  await tapAt(700, 200, 5);
  await wait(300);
  const placed = pv ? await G((v) => window.__lecraft.session.world.getBlock(v.x, v.y, v.z), pv) : -1;
  check('Pose d’un bloc (toucher)', placed === 3, `bloc posé : ${placed}`);
  void placeT;

  // ---------- hotbar tactile ----------
  await G(() => { const inv = window.__lecraft.session.player.inventory; inv.add({ id: 'log', count: 4 }); });
  const [hx, hy] = await center('.hotbar .slot:nth-child(3)');
  await tapAt(hx, hy, 6);
  await wait(200);
  check('Sélection dans la hotbar (toucher)', (await G(() => window.__lecraft.session.player.inventory.selected)) === 2);

  // ---------- inventaire & crafting ----------
  const [ix, iy] = await center('.btn-inventory');
  await tapAt(ix, iy, 8);
  await wait(400);
  check('Ouverture de l’inventaire (bouton)', (await page.locator('.inv-grid').count()) >= 2);
  await shot('e2e-04-inventory');
  await page.locator('.tab', { hasText: 'Fabrication' }).click();
  await wait(200);
  await shot('e2e-05-crafting');
  const plankRow = page.locator('.recipe', { hasText: 'Planches' }).first();
  await plankRow.getByText('×5').click();
  await wait(200);
  const planks = await G(() => window.__lecraft.session.player.inventory.count('planks'));
  check('Fabrication : planches (×4 recettes)', planks === 16, `planches : ${planks}`);
  await page.locator('.recipe', { hasText: 'Établi' }).first().getByText('Fabriquer').click();
  await wait(200);
  const table = await G(() => window.__lecraft.session.player.inventory.count('crafting_table'));
  check('Fabrication : établi', table === 1);
  await page.locator('.recipe', { hasText: 'Bâton' }).first().getByText('Fabriquer').click();
  await page.locator('.recipe', { hasText: 'Pioche en bois' }).first().getByText('Fabriquer').click();
  await wait(200);
  check('Fabrication : pioche en bois', (await G(() => window.__lecraft.session.player.inventory.count('wood_pickaxe'))) === 1);
  // déplacer un objet (toucher prendre / toucher poser)
  await page.locator('.tab', { hasText: 'Sac' }).click();
  await wait(150);
  const before = await G(() => window.__lecraft.session.player.inventory.slots.map((s) => s?.id ?? null));
  const srcIdx = before.findIndex((x) => x === 'planks');
  const emptyIdx = before.findIndex((x, i) => x === null && i >= 9);
  const slotSel = (i) => (i < 9 ? `.inv-grid >> nth=1 >> .slot >> nth=${i}` : `.inv-grid >> nth=0 >> .slot >> nth=${i - 9}`);
  await page.locator(slotSel(srcIdx)).dispatchEvent('pointerdown');
  await page.locator(slotSel(srcIdx)).dispatchEvent('pointerup');
  await page.locator(slotSel(emptyIdx)).dispatchEvent('pointerdown');
  await page.locator(slotSel(emptyIdx)).dispatchEvent('pointerup');
  await wait(150);
  const after = await G(() => window.__lecraft.session.player.inventory.slots.map((s) => s?.id ?? null));
  check('Déplacer un objet dans l’inventaire', after[emptyIdx] === 'planks' && after[srcIdx] !== 'planks', `slot ${srcIdx} → ${emptyIdx}`);
  await page.keyboard.press('Escape');
  await wait(300);
  check('Fermeture de l’inventaire (retour)', (await page.locator('.inv-grid').count()) === 0 && (await state()) === 'playing');

  // ---------- établi posé & ouvert ----------
  await reset(-0.6, Math.PI);
  await G(() => {
    const s = window.__lecraft.session, p = s.player, inv = p.inventory;
    inv.selected = inv.slots.findIndex((x) => x?.id === 'crafting_table'); inv.changed();
    p.yaw = Math.PI; p.pitch = -0.6;
  });
  await wait(400);
  await tapAt(700, 200, 9);
  await wait(300);
  await tapAt(700, 200, 10);
  await wait(400);
  check('Établi posé puis ouvert', (await page.locator('.title-bar h2', { hasText: 'Établi' }).count()) === 1);
  await page.keyboard.press('Escape');
  await wait(200);

  // ---------- combat & créatures ----------
  await reset(-0.45);
  const mob = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const m = s.entities.spawnMob('porcelet', p.x, p.y, p.z - 2.2);
    m.ai.fsm.set('IDLE'); m.idleTime = 100;
    return m.id;
  });
  await wait(500);
  const hp0 = await G((id) => window.__lecraft.session.entities.mobs.find((m) => m.id === id)?.health, mob);
  await hold('.btn-attack', 300);
  await wait(300);
  const hp1 = await G((id) => window.__lecraft.session.entities.mobs.find((m) => m.id === id)?.health ?? 0, mob);
  check('Combat : attaque d’une créature (bouton ⚔)', hp1 < hp0, `PV ${hp0} → ${hp1}`);
  const fsm = await G((id) => window.__lecraft.session.entities.mobs.find((m) => m.id === id)?.ai.state, mob);
  check('IA : fuite après dégâts (animal passif)', fsm === 'FLEE', `état ${fsm}`);
  const hostile = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const m = s.entities.spawnMob('rodeur', p.x + 6, p.y, p.z);
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
  await wait(3500);
  const hpP1 = await G(() => window.__lecraft.session.player.health);
  check('Combat : le joueur reçoit des dégâts', hpP1 < hpP0, `PV joueur ${hpP0} → ${hpP1}`);
  await shot('e2e-06-combat');
  await G((id) => { const s = window.__lecraft.session; const m = s.entities.mobs.find((x) => x.id === id); if (m) s.combat.damageMob(m, 999, { kind: 'player', fromPlayer: true }); s.dayCycle.time = 0.2; }, hostile);
  await wait(1200);
  check('Mort d’une créature (suppression)', !(await G((id) => window.__lecraft.session.entities.mobs.some((m) => m.id === id), hostile)));

  // ---------- pause / retour Android ----------
  await page.keyboard.press('Escape');
  await wait(300);
  check('Pause (retour)', (await state()) === 'paused' && (await page.getByText('Reprendre').count()) === 1);
  await shot('e2e-07-pause');
  const simT = await G(() => window.__lecraft.session.dayCycle.time);
  await wait(700);
  check('Simulation stoppée en pause', (await G(() => window.__lecraft.session.dayCycle.time)) === simT);
  await page.keyboard.press('Escape');
  await wait(300);
  check('Reprise (retour depuis la pause)', (await state()) === 'playing');

  // ---------- sauvegarde & rechargement ----------
  const snap = await G(() => { const s = window.__lecraft.session, p = s.player; return { x: p.x, y: p.y, z: p.z, planks: p.inventory.count('planks'), placed: s.world.getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)) }; });
  await page.keyboard.press('Escape');
  await wait(200);
  await page.getByText('Sauvegarder').click();
  await page.waitForFunction(() => document.body.innerText.includes('Sauvegardé à'), null, { timeout: 15000 });
  check('Sauvegarde manuelle', true);
  await page.getByText('Quitter vers le menu').click();
  await page.waitForFunction(() => window.__lecraft.state === 'menu');
  await page.reload();
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 30000 });
  await page.getByText('Mondes').first().click();
  await wait(600);
  check('Liste des mondes (miniature, nom)', (await page.locator('.world-card', { hasText: 'Test E2E' }).count()) >= 1 && (await page.locator('.world-card img').count()) >= 1);
  await shot('e2e-08-worlds');
  await page.locator('.world-card').first().getByText('Jouer').click();
  await page.waitForFunction(() => window.__lecraft?.state === 'playing', null, { timeout: 120000 });
  await wait(1500);
  const re = await G(() => { const p = window.__lecraft.session.player; return { x: p.x, y: p.y, z: p.z, planks: p.inventory.count('planks') }; });
  check('Chargement : position restaurée', Math.abs(re.x - snap.x) < 0.5 && Math.abs(re.z - snap.z) < 0.5, `${JSON.stringify(re)}`);
  check('Chargement : inventaire restauré', re.planks === snap.planks, `planches ${re.planks}`);
  const minedAfter = await G((t) => window.__lecraft.session.world.getBlock(t.x, t.y, t.z), target);
  check('Chargement : blocs modifiés restaurés', minedAfter === 0 || minedAfter === 3, `bloc ${minedAfter}`);

  // ---------- mort & réapparition ----------
  await G(() => window.__lecraft.session.player.damage(100, 'void'));
  await wait(500);
  check('Mort du joueur → écran de mort', (await page.getByText('Vous êtes mort').count()) === 1);
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
