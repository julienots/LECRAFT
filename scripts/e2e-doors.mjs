// E2E portes : portes de toutes les essences (pose sur 2 blocs, ouverture), trappes, portillons,
// porte en fer (pas à la main) ouverte par levier, bouton (relâché) et plaque de pression.
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
  await G(() => window.__lecraft.createWorld('Portes', '77', 'survival', 'peaceful'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(600);
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const x = Math.floor(p.x), z = Math.floor(p.z), y = 100;
    s.runCommand(`/fill ${x - 10} ${y - 1} ${z - 10} ${x + 10} ${y - 1} ${z + 10} stone`);
    s.runCommand(`/fill ${x - 10} ${y} ${z - 10} ${x + 10} ${y + 6} ${z + 10} air`);
    s.runCommand('/time set day');
    p.body.setPos(x + 0.5, y, z + 0.5);
    p.yaw = 0; p.pitch = -0.3;
    window.__a = { x, y, z };
    // pose avec la vraie logique de placement (prévisualisation + utilisation)
    window.__place = (id, bx, by, bz, nx = 0, ny = 1, nz = 0, yaw = 0) => {
      p.yaw = yaw;
      p.inventory.clear();
      p.inventory.add({ id, count: 1 });
      p.inventory.selected = 0;
      s.interaction.target = { x: bx - nx, y: by - ny, z: bz - nz, nx, ny, nz, block: s.world.getBlock(bx - nx, by - ny, bz - nz), distance: 2, px: bx + 0.5, py: by - ny * 0.5 + 0.01, pz: bz + 0.5 };
      s.interaction.preview = s.interaction.computePlacement(s.interaction.target, I(id));
      s.interaction.use();
    };
    window.__use = (bx, by, bz) => {
      p.inventory.clear();
      s.interaction.target = { x: bx, y: by, z: bz, nx: 0, ny: 0, nz: 1, block: s.world.getBlock(bx, by, bz), distance: 2, px: bx + 0.5, py: by + 0.5, pz: bz + 1 };
      s.interaction.preview = null;
      s.interaction.use();
    };
  });
  await wait(300);

  // ---------- portes en bois de toutes les essences ----------
  const woods = await G(() => {
    const s = window.__lecraft.session, a = window.__a, w = s.world;
    const out = {};
    ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'mangrove', 'pale_oak', 'crimson', 'warped', 'bamboo'].forEach((wd, i) => {
      const x = a.x - 6 + i, z = a.z - 4;
      window.__place(`${wd}_door`, x, a.y, z);
      const two = w.getBlock(x, a.y, z) === I(`${wd}_door`) && w.getBlock(x, a.y + 1, z) === I(`${wd}_door`);
      window.__use(x, a.y + 1, z);
      out[wd] = two && (w.getMeta(x, a.y, z) & 4) !== 0;
    });
    return out;
  });
  check('Portes des 12 essences : posées sur 2 blocs et ouvertes à la main', Object.values(woods).every(Boolean), JSON.stringify(woods));
  // ---------- trappe et portillon ----------
  const td = await G(() => {
    const s = window.__lecraft.session, a = window.__a, w = s.world;
    const x = a.x - 3, z = a.z + 3;
    window.__place('oak_trapdoor', x, a.y, z);
    const placed = w.getBlock(x, a.y, z) === I('oak_trapdoor');
    window.__use(x, a.y, z);
    const open = (w.getMeta(x, a.y, z) & 4) !== 0;
    window.__place('spruce_fence_gate', x + 2, a.y, z);
    const gx = x + 2;
    window.__use(gx, a.y, z);
    const gateOpen = (w.getMeta(gx, a.y, z) & 4) !== 0;
    return { placed, open, gate: w.getBlock(gx, a.y, z) === I('spruce_fence_gate'), gateOpen };
  });
  check('Trappe : posée et ouverte ; portillon : posé et ouvert', td.placed && td.open && td.gate && td.gateOpen, JSON.stringify(td));

  // ---------- porte en fer + levier ----------
  const iron = await G(async () => {
    const s = window.__lecraft.session, a = window.__a, w = s.world, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const x = a.x + 3, z = a.z + 3;
    window.__place('iron_door', x, a.y, z);
    window.__use(x, a.y, z);
    const byHand = (w.getMeta(x, a.y, z) & 4) !== 0;
    // levier posé au sol juste à côté
    window.__place('lever', x + 1, a.y, z);
    window.__use(x + 1, a.y, z);
    const leverOn = (w.getMeta(x, a.y, z) & 4) !== 0;
    window.__use(x + 1, a.y, z);
    const leverOff = (w.getMeta(x, a.y, z) & 4) === 0;
    // bouton de pierre : ouvre puis referme après ~1 s
    w.setBlock(x + 1, a.y, z, 0);
    window.__place('stone_button', x - 1, a.y, z);
    window.__use(x - 1, a.y, z);
    const btnOpen = (w.getMeta(x, a.y, z) & 4) !== 0;
    await sleep(1800);
    const btnClosed = (w.getMeta(x, a.y, z) & 4) === 0;
    return { placed: w.getBlock(x, a.y + 1, z) === I('iron_door'), byHand, leverOn, leverOff, btnOpen, btnClosed };
  });
  check('Porte en fer : ne s’ouvre pas à la main', iron.placed && !iron.byHand, JSON.stringify(iron));
  check('Levier : ouvre puis referme la porte en fer', iron.leverOn && iron.leverOff, JSON.stringify(iron));
  check('Bouton : ouvre la porte puis se relâche (fermeture)', iron.btnOpen && iron.btnClosed, JSON.stringify(iron));

  // ---------- plaque de pression ----------
  const plate = await G(async () => {
    const s = window.__lecraft.session, a = window.__a, w = s.world, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const x = a.x + 6, z = a.z + 3;
    window.__place('iron_door', x, a.y, z);
    window.__place('oak_pressure_plate', x, a.y, z + 1);
    p.body.setPos(x + 0.5, a.y, z + 1.5);
    await sleep(600);
    const on = (w.getMeta(x, a.y, z) & 4) !== 0;
    p.body.setPos(a.x + 0.5, a.y, a.z + 0.5);
    await sleep(600);
    const off = (w.getMeta(x, a.y, z) & 4) === 0;
    return { on, off };
  });
  check('Plaque de pression : le joueur dessus ouvre la porte, en partant elle se referme', plate.on && plate.off, JSON.stringify(plate));
  await G(() => { const p = window.__lecraft.session.player, a = window.__a; p.body.setPos(a.x + 0.5, a.y, a.z + 2.5); p.yaw = 0; p.pitch = -0.15; p.inventory.clear(); });
  await wait(800);
  await page.screenshot({ path: `${OUT}/doors-01.png` });
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
