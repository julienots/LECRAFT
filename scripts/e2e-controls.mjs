// E2E commandes : vues 1re / 3e personne (F5) et manette (API Gamepad simulée : sticks, gâchettes,
// boutons, curseur virtuel des menus et de l'inventaire).
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

// manette simulée : 17 boutons (disposition standard) + 4 axes
const pad = (state = {}) => G((st) => {
  const gp = window.__lecraft.gamepad;
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: !!st.b?.includes(i), value: st.b?.includes(i) ? 1 : 0 }));
  gp.virtual = { axes: st.axes ?? [0, 0, 0, 0], buttons };
}, state);
const tap = async (b, ms = 250) => { await pad({ b: [b] }); await wait(ms); await pad(); await wait(ms); };
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7, START = 9, UP = 12;
/** Amène le curseur virtuel sur un élément (au stick gauche, comme un joueur). */
const cursorTo = async (selector, text) => {
  for (let i = 0; i < 400; i++) {
    const d = await G(([sel, t]) => {
      const el = [...document.querySelectorAll(sel)].find((e) => !t || e.textContent.includes(t));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const [cx, cy] = window.__lecraft.gamepad.cursorPos;
      return [r.left + r.width / 2 - cx, r.top + r.height / 2 - cy, Math.min(r.width, r.height) / 2];
    }, [selector, text]);
    if (!d) return false;
    if (Math.abs(d[0]) < d[2] * 0.8 && Math.abs(d[1]) < d[2] * 0.8) {
      await pad();
      return true;
    }
    const m = Math.hypot(d[0], d[1]);
    const k = Math.min(1, Math.max(0.5, m / 150));
    await pad({ axes: [(d[0] / m) * k, (d[1] / m) * k, 0, 0] });
    await wait(30);
  }
  await pad();
  return false;
};

try {
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await wait(500);

  // ---------- manette dans les menus ----------
  await pad({ b: [] , axes: [0.6, 0, 0, 0] });
  await wait(200);
  await pad();
  const gpOn = await G(() => ({ active: window.__lecraft.gamepad.active, cls: document.documentElement.classList.contains('gamepad'), cursor: !document.querySelector('.gp-cursor').classList.contains('hidden') }));
  check('Manette détectée : mode manette + curseur virtuel', gpOn.active && gpOn.cls && gpOn.cursor, JSON.stringify(gpOn));
  check('Stick gauche → curseur jusqu’au bouton « Solo »', await cursorTo('.mc-btn', 'Solo'));
  await tap(A);
  await wait(300);
  const onWorlds = await page.getByText('Créer un nouveau monde').count();
  check('A : clic sur le bouton (liste des mondes)', onWorlds > 0);
  await tap(B);
  await wait(300);
  check('B : retour au menu principal', (await page.getByText('Solo').count()) > 0 && (await page.getByText('Créer un nouveau monde').count()) === 0);

  // ---------- en jeu ----------
  await G(() => window.__lecraft.createWorld('Manette', '777', 'creative', 'peaceful'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing', null, { timeout: 120000 });
  await wait(1500);
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const x = Math.floor(p.x), z = Math.floor(p.z), y = 120;
    s.runCommand(`/fill ${x - 8} ${y - 1} ${z - 8} ${x + 8} ${y - 1} ${z + 8} stone`);
    s.runCommand(`/fill ${x - 8} ${y} ${z - 8} ${x + 8} ${y + 6} ${z + 8} air`);
    s.runCommand(`/tp @s ${x + 0.5} ${y} ${z + 0.5}`);
    p.yaw = 0; p.pitch = 0; p.body.flying = false;
    p.inventory.clear();
    p.inventory.add({ id: 'stone', count: 10 });
    p.inventory.add({ id: 'oak_planks', count: 10 });
    p.inventory.selected = 0;
  });
  await wait(800);
  check('Commandes tactiles masquées avec la manette', await G(() => getComputedStyle(document.querySelector('.touch-layer')).display === 'none'));

  const p0 = await G(() => { const p = window.__lecraft.session.player; return { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch }; });
  await pad({ axes: [0, -1, 0, 0] });
  await wait(700);
  await pad();
  const p1 = await G(() => { const p = window.__lecraft.session.player; return { x: p.x, z: p.z }; });
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check('Stick gauche : avancer', moved > 1 && p1.z < p0.z, `${moved.toFixed(2)} blocs`);
  await pad({ axes: [0, 0, 1, 0] });
  await wait(400);
  await pad({ axes: [0, 0, 0, 1] });
  await wait(250);
  await pad();
  const look = await G(() => { const p = window.__lecraft.session.player; return { yaw: p.yaw, pitch: p.pitch }; });
  check('Stick droit : tourner et regarder en bas', look.yaw < p0.yaw - 0.3 && look.pitch < -0.1, JSON.stringify(look));

  await tap(RB);
  check('RB : objet suivant', (await G(() => window.__lecraft.session.player.inventory.selected)) === 1);
  await tap(LB);
  check('LB : objet précédent', (await G(() => window.__lecraft.session.player.inventory.selected)) === 0);

  // regarder le sol devant soi, LT : poser un bloc, RT : le casser
  const target = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    p.pitch = -1.1; p.yaw = 0;
    return null;
  });
  void target;
  await wait(300);
  const spot = await G(() => { const t = window.__lecraft.session.interaction.target; return t && { x: t.x + t.nx, y: t.y + t.ny, z: t.z + t.nz }; });
  const before = spot && (await G((q) => window.__lecraft.session.world.getBlock(q.x, q.y, q.z), spot));
  await tap(LT, 200);
  const placed = spot && (await G((q) => window.__lecraft.session.world.getBlock(q.x, q.y, q.z), spot));
  check('LT : poser un bloc', !!spot && before === 0 && placed === (await G(() => window.I?.('stone') ?? window.__lecraft.debug.blockId('stone'))), `${JSON.stringify(spot)} : ${before} → ${placed}`);
  const tg = await G(() => { const t = window.__lecraft.session.interaction.target; return t && { x: t.x, y: t.y, z: t.z, b: t.block }; });
  await pad({ b: [RT] });
  await wait(500);
  await pad();
  const broke = await G((t) => window.__lecraft.session.world.getBlock(t.x, t.y, t.z), tg);
  check('RT : casser le bloc visé', tg && broke !== tg.b, `${JSON.stringify(tg)} → ${broke}`);

  // saut
  await G(() => { window.__lecraft.session.player.pitch = 0; });
  const y0 = await G(() => window.__lecraft.session.player.y);
  await pad({ b: [A] });
  await wait(200);
  const y1 = await G(() => window.__lecraft.session.player.y);
  await pad();
  await wait(600);
  check('A : sauter', y1 > y0 + 0.3, `${y0.toFixed(2)} → ${y1.toFixed(2)}`);

  // vue (croix haut) : 1re → 3e arrière → 3e avant → 1re
  const views = [];
  for (let i = 0; i < 3; i++) {
    await tap(UP);
    views.push(await G(() => window.__lecraft.session.perspective));
    if (i < 2) await page.screenshot({ path: `${OUT}/ctl-0${i + 1}-vue.png` });
  }
  check('Croix haut : vues 3e personne arrière, avant, puis 1re', views.join(',') === '1,2,0', views.join(','));
  // F5 au clavier + caméra derrière le joueur à 4 blocs
  await page.keyboard.press('F5');
  await wait(300);
  const cam = await G(() => { const s = window.__lecraft.session, p = s.player, c = window.__lecraft.renderer.camera.position; return { v: s.perspective, d: Math.hypot(c.x - p.x, c.y - p.y - p.eyeHeight, c.z - p.z) }; });
  check('F5 : vue arrière, caméra à ~4 blocs', cam.v === 1 && cam.d > 3.5 && cam.d < 4.2, JSON.stringify(cam));
  const model = await G(() => window.__lecraft.session.scene.children.some((o) => o.visible && o.children.some((c) => c.type === 'Group' && o.scale.x > 0.85 && o.scale.x < 0.95)));
  check('Modèle du joueur affiché en 3e personne', model);
  await G(() => { const s = window.__lecraft.session, p = s.player; const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z); p.yaw = 0; p.pitch = 0; s.runCommand(`/fill ${x - 2} ${y} ${z + 2} ${x + 2} ${y + 3} ${z + 2} stone`); });
  await wait(300);
  const near = await G(() => { const s = window.__lecraft.session, p = s.player, c = window.__lecraft.renderer.camera.position; return Math.hypot(c.x - p.x, c.y - p.y - p.eyeHeight, c.z - p.z); });
  check('Caméra 3e personne : ne traverse pas un mur', near < 1.6, near.toFixed(2));
  await page.keyboard.press('F5');
  await page.keyboard.press('F5');
  await wait(200);
  await pad({ axes: [0.5, 0, 0, 0] }); // revient au mode manette (le clavier l'a désactivé)
  await wait(100);
  await pad();

  // inventaire : Y ouvre, A prend un objet, A le repose, B ferme
  await tap(Y, 300);
  check('Y : ouvrir l’inventaire', await G(() => !!document.querySelector('.gui-screen')));
  const slotSel = '.gui-screen .gslot:not(.static)';
  const slotCount = await G((sel) => document.querySelectorAll(sel).length, slotSel);
  if (slotCount) {
    // première case contenant de la pierre (barre d'objets de l'inventaire)
    const ok = await G((sel) => {
      // case de la barre d'objets contenant la pierre (les objets sont dessinés sur un canvas)
      const sl = window.__lecraft.inventoryUI?.slots.find((x) => x.key === 'inv0' && x.group === 'hotbar');
      const el = sl?.el;
      if (!el) return false;
      el.classList.add('gp-test-src');
      return true;
    }, slotSel);
    if (ok && (await cursorTo('.gp-test-src'))) {
      await tap(A, 200);
      const carried = await G(() => document.querySelector('.gui-cursor')?.style.display === 'block' && !window.__lecraft.session.player.inventory.slots[0]);
      check('A sur une case : prendre l’objet', carried);
      await tap(A, 300);
      check('A à nouveau : reposer l’objet', await G(() => window.__lecraft.session.player.inventory.slots[0]?.id === 'stone'));
    } else check('A sur une case : prendre l’objet', false, 'case introuvable');
  } else check('A sur une case : prendre l’objet', false, 'aucune case');
  await tap(B, 300);
  check('B : fermer l’inventaire', await G(() => !document.querySelector('.gui-screen') && window.__lecraft.state === 'playing'));

  // pause (Start) puis reprise (B)
  await tap(START, 300);
  check('Start : pause', await G(() => window.__lecraft.state === 'paused'));
  await tap(B, 300);
  check('B en pause : reprendre', await G(() => window.__lecraft.state === 'playing'));

  // B en jeu : lâcher l'objet
  const n0 = await G(() => window.__lecraft.session.entities.entities.filter((e) => e.kind === 'item').length);
  await tap(B, 300);
  const n1 = await G(() => window.__lecraft.session.entities.entities.filter((e) => e.kind === 'item').length);
  check('B en jeu : lâcher l’objet', n1 > n0, `${n0} → ${n1}`);

  // toucher l'écran : retour aux commandes tactiles
  await page.mouse.click(400, 200);
  await wait(200);
  check('Toucher l’écran : commandes tactiles réaffichées', await G(() => !window.__lecraft.gamepad.active && !document.documentElement.classList.contains('gamepad')));
  await page.screenshot({ path: `${OUT}/ctl-03-fin.png` });
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
