// E2E serveur de survie moddé : connexion, bots qui rejoignent et travaillent (bois, construction),
// chat (réponses, suivre, donner), commandes (/sethome /home /money /list /tpa /shop /sell), mods
// (abattage d'arbre entier, filon), tombe à la mort, sauvegarde du monde et des bots.
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
const shot = (n) => page.screenshot({ path: `${OUT}/smp-${n}.png` });
const lines = () => G(() => window.__lecraft.chat.lines.map((l) => l.text.replace(/§./g, '')));

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'MEDIUM', renderDistance: 4, autoQuality: false, gfxV: 2 })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await page.getByText('Multijoueur', { exact: true }).click();
  await wait(300);
  await page.locator('.server-entry[data-server="LeCraft SMP"]').click();
  await page.getByText('Rejoindre le serveur').click();
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session?.smp, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__lecraft.session.smp.bots.length >= 3, null, { timeout: 30000 });
  // journée (les monstres de nuit détournent les bots de leurs tâches)
  await G(() => { const s = window.__lecraft.session; s.dayCycle.time = 0.05; s.gamerules.doDaylightCycle = false; });
  const j = await G(() => ({ bots: window.__lecraft.session.smp.bots.map((b) => b.name), sidebar: document.querySelector('.mc-sidebar:not(.hidden)')?.textContent ?? '' }));
  const joined = (await lines()).filter((l) => /a rejoint la partie/.test(l));
  check('Connexion SMP : des bots rejoignent la partie (messages)', j.bots.length >= 3 && joined.length >= 3, JSON.stringify(j.bots));
  check('Tableau de scores SMP', /LECRAFT SMP/.test(j.sidebar) && /Pièces/.test(j.sidebar), j.sidebar);
  const inList = await G(async () => (await window.__lecraft.saves.listWorlds()).some((w) => w.smp));
  check('Le monde SMP n’apparaît pas dans la liste Solo', !inList);

  // ---------- les bots travaillent : bois ----------
  await wait(25000);
  const work = await G(() => window.__lecraft.session.smp.bots.map((b) => ({ n: b.name, task: b.task, log: (b.inv.log ?? 0) + (b.inv.planks ?? 0) / 4, tier: b.tier })));
  check('Bots : récoltent du bois et fabriquent des outils', work.some((b) => b.log > 0 || b.tier >= 1), JSON.stringify(work));
  await shot('01-bots');

  // ---------- construction (ressources données pour accélérer) ----------
  const site = await G(async () => {
    const s = window.__lecraft.session, smp = s.smp, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const m = smp.online[0];
    Object.assign(m.p, { tier: 3, inv: { planks: 200, cobblestone: 120, iron_ingot: 5, diamond: 2 } });
    m.task = 'idle'; m.follow = 0;
    for (let i = 0; i < 60 && !(m.p.home && m.p.built > 40); i++) await sleep(500);
    return { home: m.p.home, built: m.p.built, task: m.task, why: m.why, name: m.p.name };
  });
  check('Bot : choisit un terrain et construit sa maison bloc par bloc', !!site.home && site.built > 40, JSON.stringify(site));
  if (site.home) {
    await G((h) => { const p = window.__lecraft.session.player; p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(h.x + 9, h.y + 7, h.z + 9); p.yaw = Math.atan2(-9, -9) + Math.PI; p.pitch = -0.45; }, site.home);
    await wait(2500);
    await shot('02-build');
    await G(() => { const p = window.__lecraft.session.player; p.gameMode = 'survival'; p.body.flying = false; p.body.setPos(...p.spawn); });
  }

  // ---------- chat avec les bots ----------
  const bname = site.name;
  await G((n) => window.__lecraft.session.smp.playerChat(`${n} tu fais quoi ?`), bname);
  await wait(3800);
  let l = await lines();
  check('Chat : le bot répond à « tu fais quoi ? »', l.some((x) => x.startsWith(`${bname}:`) || x.includes(`${bname}:`)), l.slice(-3).join(' | '));
  await G((n) => window.__lecraft.session.smp.playerChat(`${n} donne moi du fer`), bname);
  await wait(5500);
  const iron = await G(() => window.__lecraft.session.entities.entities.filter((e) => e.kind === 'item' && e.itemId === 'iron_ingot').reduce((a, e) => a + e.count, 0) + window.__lecraft.session.player.inventory.count('iron_ingot'));
  check('Chat : « donne moi du fer » → le bot lâche des lingots', iron > 0, `fer : ${iron}`);
  await G((n) => window.__lecraft.session.smp.playerChat(`${n} suis moi`), bname);
  await wait(1000);
  const fol = await G(async (n) => {
    const s = window.__lecraft.session, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const m = s.smp.online.find((x) => x.p.name === n);
    p.body.setPos(p.x + 12, p.y, p.z + 4);
    await sleep(9000);
    return { task: m.task, d: +Math.hypot(m.bot.x - p.x, m.bot.z - p.z).toFixed(1) };
  }, bname);
  check('Chat : « suis moi » → le bot suit le joueur', fol.task === 'follow' && fol.d < 6, JSON.stringify(fol));

  // ---------- commandes ----------
  const cmds = await G(async (n) => {
    const s = window.__lecraft.session, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    s.runCommand('/sethome');
    const home = [p.x, p.z];
    p.body.setPos(p.x + 40, 100, p.z);
    s.runCommand('/home');
    const back = Math.hypot(p.x - home[0], p.z - home[1]) < 1;
    s.runCommand('/list');
    for (let k = 0; k < 3 && s.smp.lastTpa !== n; k++) {
      s.runCommand(`/tpa ${n}`);
      await sleep(6000);
    }
    const near = s.smp.lastTpa === n;
    // économie : vendre un diamant puis acheter du pain
    p.inventory.clear(); p.inventory.add({ id: 'diamond', count: 2 }); p.inventory.selected = 0;
    s.runCommand('/sell');
    const coins = s.smp.data.coins;
    return { back, near, coins };
  }, bname);
  check('/sethome et /home', cmds.back);
  check('/tpa : le bot accepte et le joueur est téléporté', cmds.near, JSON.stringify(cmds));
  check('/sell : vente contre des pièces', cmds.coins >= 80, `pièces : ${cmds.coins}`);
  await G(() => window.__lecraft.session.runCommand('/shop'));
  await wait(500);
  const shopN = await page.locator('[data-buy]').count();
  await page.locator('[data-buy="bread"]').dispatchEvent('click');
  await wait(300);
  const bread = await G(() => window.__lecraft.session.player.inventory.count('bread'));
  check('/shop : boutique, achat de pain', shopN >= 8 && bread >= 4, `${shopN} articles, pain ${bread}`);
  await shot('03-shop');
  await page.keyboard.press('Escape');
  await wait(300);

  // ---------- mods ----------
  const mods = await G(() => {
    const s = window.__lecraft.session, w = s.world, p = s.player, I = (k) => window.__lecraft.debug.blockId(k);
    const x = Math.floor(p.x) + 20, z = Math.floor(p.z) + 20, y = 110;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) { w.setBlock(x + dx, y - 1, z + dz, I('stone')); for (let dy = 0; dy < 10; dy++) w.setBlock(x + dx, y + dy, z + dz, 0); }
    for (let dy = 0; dy < 6; dy++) w.setBlock(x, y + dy, z, I('oak_log'));
    // filon de fer
    for (const [ox, oz] of [[2, 0], [2, 1], [2, 2], [3, 1]]) w.setBlock(x + ox, y, z + oz, I('iron_ore'));
    s.smp.afterBreak(x, y - 1, z, I('oak_log'), 'iron_axe');
    let logs = 0; for (let dy = 0; dy < 6; dy++) if (w.getBlock(x, y + dy, z) === I('oak_log')) logs++;
    w.setBlock(x + 2, y, z, 0);
    s.smp.afterBreak(x + 2, y, z, I('iron_ore'), 'iron_pickaxe');
    let ores = 0; for (const [ox, oz] of [[2, 1], [2, 2], [3, 1]]) if (w.getBlock(x + ox, y, z + oz) === I('iron_ore')) ores++;
    return { logs, ores };
  });
  check('Mod : abattage de l’arbre entier (hache)', mods.logs === 0, JSON.stringify(mods));
  check('Mod : filon de minerai cassé d’un coup (pioche)', mods.ores === 0, JSON.stringify(mods));

  // ---------- tombe ----------
  const grave = await G(async () => {
    const s = window.__lecraft.session, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    p.inventory.clear(); p.inventory.add({ id: 'diamond', count: 3 }); p.inventory.add({ id: 'iron_ingot', count: 7 });
    const x = Math.floor(p.x), z = Math.floor(p.z);
    p.damage(1000, 'void');
    await sleep(600);
    let chest = null;
    for (let dy = -3; dy <= 6 && !chest; dy++) { const inv = s.world.getChest(x, Math.floor(p.y) + dy, z, false); if (inv) chest = inv.slots.filter(Boolean).map((t) => `${t.id}x${t.count}`); }
    return { chest, inv: p.inventory.count('diamond') };
  });
  check('Mod : tombe à la mort (objets dans un coffre)', !!grave.chest && grave.chest.some((x) => x.startsWith('diamond')), JSON.stringify(grave));
  await G(() => window.__lecraft.respawn?.() ?? window.__lecraft.session.respawn());
  await wait(800);

  // ---------- sauvegarde ----------
  await G(() => window.__lecraft.quitToMenu());
  await wait(1500);
  const saved = await G(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('lecraft.smp.') && x.endsWith('.bots')); return k ? JSON.parse(localStorage.getItem(k)).filter((b) => b.home).length : -1; });
  check('Profils des bots sauvegardés (maison conservée)', saved >= 1, `bots avec maison : ${saved}`);
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
