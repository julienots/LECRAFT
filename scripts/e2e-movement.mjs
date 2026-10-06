// E2E mouvement : sprint en double appui (clavier), élan du saut en sprint, nage rapide (corps
// horizontal, direction du regard), ramper sous un plafond bas, poussière de sprint, créatures
// qui suivent le joueur du regard.
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

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'LOW', renderDistance: 2, autoQuality: false })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await G(() => window.__lecraft.createWorld('Move', '55', 'survival', 'peaceful'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(600);
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const x = Math.floor(p.x), z = Math.floor(p.z), y = 100;
    s.runCommand(`/fill ${x - 6} ${y - 1} ${z - 60} ${x + 6} ${y - 1} ${z + 6} stone`);
    s.runCommand(`/fill ${x - 6} ${y} ${z - 60} ${x + 6} ${y + 6} ${z + 6} air`);
    s.runCommand('/gamerule doMobSpawning false');
    p.body.setPos(x + 0.5, y, z + 0.5);
    p.yaw = 0; p.pitch = 0; p.hunger = 20;
    window.__o = { x, y, z };
  });
  await wait(300);

  // ---------- double appui sur avancer : sprint ----------
  await page.mouse.click(450, 200); // focus du canevas
  await page.keyboard.press('KeyW');
  await page.keyboard.down('KeyW');
  await wait(300);
  const sprintOn = await G(() => window.__lecraft.input.sprint && window.__lecraft.session.player.sprinting);
  await page.keyboard.up('KeyW');
  await wait(100);
  const sprintOff = await G(() => window.__lecraft.input.sprint);
  check('Double appui sur avancer : sprint, relâcher : arrêt', sprintOn && !sprintOff, JSON.stringify({ sprintOn, sprintOff }));

  // ---------- élan du saut en sprint ----------
  const run = async (jump) => {
    await G((j) => { const s = window.__lecraft.session, o = window.__o, p = s.player; p.body.setPos(o.x + 0.5, o.y, o.z + 0.5); p.body.vx = p.body.vz = 0; p.yaw = 0; p.hunger = 20; const i = window.__lecraft.input; i.moveY = 1; i.sprint = true; i.jump = j; }, jump);
    await wait(2500);
    return G(() => { const s = window.__lecraft.session, o = window.__o, i = window.__lecraft.input; i.moveY = 0; i.sprint = false; i.jump = false; return o.z + 0.5 - s.player.z; });
  };
  const flat = await run(false);
  await wait(300);
  const hop = await run(true);
  check('Saut en sprint : plus rapide que le sprint seul', hop > flat * 1.05, `sprint ${flat.toFixed(1)} blocs, sprint+saut ${hop.toFixed(1)} blocs`);
  const dust = await G(async () => {
    const s = window.__lecraft.session, o = window.__o, p = s.player, i = window.__lecraft.input;
    p.body.setPos(o.x + 0.5, o.y, o.z + 0.5);
    const a0 = s.particles.active;
    i.moveY = 1; i.sprint = true;
    await new Promise((r) => setTimeout(r, 600));
    const a1 = s.particles.active;
    i.moveY = 0; i.sprint = false;
    return { a0, a1 };
  });
  check('Poussière soulevée en sprintant', dust.a1 > dust.a0, JSON.stringify(dust));

  // ---------- nage rapide ----------
  await G(() => {
    const s = window.__lecraft.session, o = window.__o, p = s.player;
    s.runCommand(`/fill ${o.x - 3} ${o.y - 8} ${o.z - 30} ${o.x + 3} ${o.y - 1} ${o.z - 10} water`);
    p.body.setPos(o.x + 0.5, o.y - 5, o.z - 11);
    p.body.vx = p.body.vy = p.body.vz = 0;
    p.yaw = 0; p.pitch = -0.4;
    const i = window.__lecraft.input; i.moveY = 1; i.sprint = true;
  });
  await wait(1200);
  const swim = await G(() => { const p = window.__lecraft.session.player; return { swimming: p.swimming, h: p.body.height, eye: p.eyeHeight, z: p.z, y: p.y }; });
  await wait(1000);
  const swim2 = await G(() => { const p = window.__lecraft.session.player, i = window.__lecraft.input; const r = { z: p.z, y: p.y }; i.moveY = 0; i.sprint = false; return r; });
  const speed = swim.z - swim2.z;
  check('Nage rapide : corps horizontal (0,6 bloc), vue basse', swim.swimming && Math.abs(swim.h - 0.6) < 0.01 && swim.eye < 0.5, JSON.stringify(swim));
  check('Nage rapide : plus vite que la nage normale et suit le regard (plonge)', speed > 3 && swim2.y < swim.y, `${speed.toFixed(2)} blocs/s, y ${swim.y.toFixed(1)} → ${swim2.y.toFixed(1)}`);

  // ---------- ramper sous un plafond bas ----------
  const crawl = await G(async () => {
    const s = window.__lecraft.session, o = window.__o, p = s.player;
    const x = o.x + 4, z = o.z - 40, y = o.y;
    s.runCommand(`/fill ${x - 1} ${y + 1} ${z - 3} ${x + 1} ${y + 1} ${z + 3} stone`);
    p.body.setPos(x + 0.5, y, z + 0.5);
    p.body.height = 0.6; // sortie de nage dans un tunnel d'un bloc
    p.swimming = false;
    await new Promise((r) => setTimeout(r, 300));
    const low = { crawling: p.crawling, h: p.body.height };
    s.runCommand(`/fill ${x - 1} ${y + 1} ${z - 3} ${x + 1} ${y + 1} ${z + 3} air`);
    await new Promise((r) => setTimeout(r, 300));
    return { low, after: { crawling: p.crawling, h: p.body.height } };
  });
  check('Plafond bas : le joueur rampe, puis se relève', crawl.low.crawling && crawl.low.h < 0.7 && !crawl.after.crawling && crawl.after.h > 1.7, JSON.stringify(crawl));

  // ---------- regard des créatures ----------
  const look = await G(async () => {
    const s = window.__lecraft.session, o = window.__o, p = s.player;
    p.body.setPos(o.x + 0.5, o.y, o.z + 0.5);
    const c = s.entities.spawnMob('cow', o.x + 3.5, o.y, o.z + 0.5, { persistent: true });
    c.ai.update = () => {};
    c.yaw = 0; // regarde vers +Z ; le joueur est sur le côté (-X)
    await new Promise((r) => setTimeout(r, 400));
    const head = c.model.parts.get('head')?.[0];
    return head ? +head.rotation.y.toFixed(2) : null;
  });
  check('Les créatures proches tournent la tête vers le joueur', look !== null && Math.abs(look) > 0.5, `rotation de la tête ${look}`);
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
