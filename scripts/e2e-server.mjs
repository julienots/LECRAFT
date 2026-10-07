// E2E serveur de mini-jeux : menu Multijoueur, hub (PNJ, bots, tableau de scores), menu des jeux,
// SkyWars (cages, coffres, ponts des bots), Spleef, TNT Run, Duel contre un bot, Parkour, retour au hub.
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
const shot = (n) => page.screenshot({ path: `${OUT}/server-${n}.png` });
const net = () => G(() => { const n = window.__lecraft.session.server; return { game: n.game?.key ?? null, state: n.game?.state ?? null, alive: n.game?.alive.length ?? 0, parts: n.game?.parts.length ?? 0, you: n.game?.you.alive ?? null }; });

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'MEDIUM', renderDistance: 3, autoQuality: false, gfxV: 2 })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await page.getByText('Multijoueur', { exact: true }).click();
  await wait(300);
  await page.locator('.server-entry[data-server="LeCraft Network"]').click();
  await page.getByText('Rejoindre le serveur').click();
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded && window.__lecraft.session.server, null, { timeout: 120000 });
  await wait(3000);
  const hub = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const bots = s.entities.mobs.filter((m) => m.botName);
    return { npcs: bots.filter((b) => b.npc).length, walkers: bots.filter((b) => !b.npc).length, compass: p.inventory.slots[0]?.id, sidebar: document.querySelector('.mc-sidebar:not(.hidden)')?.textContent ?? '', y: p.y, floor: s.world.getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)) };
  });
  check('Menu Multijoueur → serveur : hub chargé (sol, boussole)', hub.floor > 0 && hub.compass === 'compass', JSON.stringify(hub));
  check('Hub : 5 PNJ de jeux + PNJ « Survie moddée » et des bots joueurs', hub.npcs === 6 && hub.walkers >= 8, JSON.stringify(hub));
  check('Tableau de scores latéral', /LECRAFT NETWORK/.test(hub.sidebar) && /Pièces/.test(hub.sidebar), hub.sidebar);
  await G(() => { const p = window.__lecraft.session.player; p.body.flying = true; p.body.setPos(0.5, 80, 30); p.yaw = 0; p.pitch = -0.55; });
  await wait(2500);
  await shot('01-hub');
  await G(() => { const p = window.__lecraft.session.player; p.body.flying = false; p.body.setPos(0.5, 64, 14.5); p.yaw = 0; p.pitch = 0; });
  // les bots marchent
  const pos0 = await G(() => window.__lecraft.session.entities.mobs.filter((m) => m.botName && !m.npc).map((m) => [m.x, m.z]));
  await wait(4000);
  const moved = await G((p0) => window.__lecraft.session.entities.mobs.filter((m) => m.botName && !m.npc).filter((m, i) => p0[i] && Math.hypot(m.x - p0[i][0], m.z - p0[i][1]) > 1).length, pos0);
  check('Bots du hub : ils se déplacent', moved >= 3, `${moved} bots ont bougé`);
  // casser un bloc du hub : interdit
  const hubEdit = await G(() => { const s = window.__lecraft.session, p = s.player; const x = Math.floor(p.x), y = Math.floor(p.y) - 1, z = Math.floor(p.z); const b = s.world.getBlock(x, y, z); s.interaction.breakBlock && s.interaction.target; return s.server.canEdit(x, y, z, 'break', b); });
  check('Hub protégé (pas de casse)', hubEdit === false);
  // menu des jeux par la boussole
  await G(() => window.__lecraft.session.server.useItem('compass'));
  await wait(400);
  const menu = await G(() => [...document.querySelectorAll('[data-game]')].map((b) => b.dataset.game));
  check('Boussole : menu des 5 jeux', menu.length === 5, menu.join(','));
  await shot('02-menu');

  // ---------- Duel ----------
  await page.locator('[data-game="duels"]').click();
  await wait(1500);
  let st = await net();
  check('Duel : partie lancée (compte à rebours)', st.game === 'duels' && st.parts === 2, JSON.stringify(st));
  await page.waitForFunction(() => window.__lecraft.session.server.game?.state === 'playing', null, { timeout: 15000 });
  // le bot vient au combat : la vie du joueur baisse
  const duel = await G(async () => {
    const s = window.__lecraft.session, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const bot = s.server.game.parts[1].bot;
    const h0 = p.health;
    let minD = 99;
    for (let i = 0; i < 80; i++) { await sleep(100); minD = Math.min(minD, Math.hypot(bot.x - p.x, bot.z - p.z)); if (p.health < h0 - 2) break; }
    return { minD: +minD.toFixed(1), lost: +(h0 - p.health).toFixed(1), weapon: bot.weapon };
  });
  check('Duel : le bot approche et frappe (épée en fer)', duel.minD < 3.5 && duel.lost > 0 && duel.weapon === 'iron_sword', JSON.stringify(duel));
  // à distance, le bot tire à l'arc
  const bow = await G(async () => {
    const s = window.__lecraft.session, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const bot = s.server.game.parts[1].bot;
    const a0 = bot.arrows;
    for (let i = 0; i < 40 && bot.arrows === a0; i++) { p.health = 20; p.body.setPos(bot.x, bot.y + 0.1, bot.z + 14); await sleep(100); }
    return { before: a0, after: bot.arrows };
  });
  check('Duel : à distance, le bot tire à l’arc', bow.after < bow.before, JSON.stringify(bow));
  await shot('03-duel');
  // le joueur frappe le bot jusqu'à la victoire
  const win = await G(async () => {
    const s = window.__lecraft.session, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const bot = s.server.game.parts[1].bot;
    for (let i = 0; i < 120 && !bot.dead; i++) {
      p.health = 20; p.invulnerable = 1;
      p.body.setPos(bot.x + 1.5, bot.y, bot.z);
      s.combat.cooldown = 0;
      s.combat.playerAttack(s, bot);
      await sleep(120);
    }
    await sleep(800);
    return { dead: bot.dead, state: s.server.game?.state, coins: s.server.profile.coins, wins: s.server.profile.wins.duels ?? 0 };
  });
  check('Duel : bot vaincu → victoire, pièces et victoire comptées', win.dead && win.state === 'ended' && win.coins > 0 && win.wins >= 1, JSON.stringify(win));
  await page.waitForFunction(() => !window.__lecraft.session.server.game, null, { timeout: 15000 });
  check('Fin de partie : retour au hub', (await net()).game === null);

  // ---------- SkyWars ----------
  await G(() => window.__lecraft.session.server.join('skywars'));
  await page.waitForFunction(() => !window.__lecraft.session.server.game?.loading, null, { timeout: 30000 });
  await wait(1500);
  st = await net();
  const cage = await G(() => { const s = window.__lecraft.session, p = s.player; return { glass: s.world.getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)) === window.__lecraft.debug.blockId('glass'), chest: (() => { const c = s.server.game.islands[0].chest; return s.world.getChest(c[0], c[1], c[2], false)?.slots.filter(Boolean).length ?? -1; })() }; });
  check('SkyWars : 8 joueurs, cage de verre, coffres remplis', st.parts === 8 && cage.glass && cage.chest > 0, JSON.stringify({ st, cage }));
  await wait(4000);
  const queue = await G(() => window.__lecraft.chat.lines.map((l) => l.text.replace(/§./g, '')).filter((l) => /a rejoint la partie \(\d\/8\)/.test(l)).length);
  check('File d’attente : les joueurs arrivent un par un (k/8)', queue >= 5, `${queue} arrivées annoncées`);
  await shot('04-skywars-cage');
  await page.waitForFunction(() => window.__lecraft.session.server.game?.state === 'playing', null, { timeout: 15000 });
  await G(() => { const p = window.__lecraft.session.player; p.gameMode = 'creative'; });
  await wait(9000);
  const sw = await G(() => {
    const s = window.__lecraft.session, g = s.server.game;
    const bots = g.parts.filter((x) => x.bot).map((x) => x.bot);
    return { armed: bots.filter((b) => b.weapon).length, bridged: bots.filter((b) => Math.hypot(b.x - 800, b.z) < 20).length, alive: g.alive.length };
  });
  check('SkyWars : les bots pillent leur coffre (arme) et construisent des ponts', sw.armed >= 4 && sw.bridged >= 1, JSON.stringify(sw));
  await G(() => { const p = window.__lecraft.session.player; p.body.flying = true; p.body.setPos(800, 84, 40); p.yaw = 0; p.pitch = -0.55; });
  await wait(1500);
  await shot('05-skywars');
  await G(() => window.__lecraft.session.server.toHub());
  await wait(500);

  // ---------- Spleef ----------
  await G(() => window.__lecraft.session.server.join('spleef'));
  await page.waitForFunction(() => window.__lecraft.session.server.game?.state === 'playing', null, { timeout: 20000 });
  await G(() => { const p = window.__lecraft.session.player; p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(400, 74, 16); p.yaw = 0; p.pitch = -0.6; });
  await wait(12000);
  const sp = await G(() => { const s = window.__lecraft.session, g = s.server.game; let holes = 0; for (let x = -11; x <= 11; x++) for (let z = -11; z <= 11; z++) if (s.world.getBlock(400 + x, 63, z) === 0) holes++; return { holes, alive: g?.alive.length ?? 0, state: g?.state }; });
  check('Spleef : les bots cassent la neige sous les autres', sp.holes >= 5, JSON.stringify(sp));
  await shot('06-spleef');
  await G(() => window.__lecraft.session.server.toHub());
  await wait(500);
  const restored = await G(() => { const s = window.__lecraft.session; let holes = 0; for (let x = -11; x <= 11; x++) for (let z = -11; z <= 11; z++) if (s.world.getBlock(400 + x, 63, z) === 0) holes++; return holes; });
  check('Carte restaurée après la partie', restored === 0, `trous restants : ${restored}`);

  // ---------- TNT Run ----------
  await G(() => window.__lecraft.session.server.join('tntrun'));
  await page.waitForFunction(() => window.__lecraft.session.server.game?.state === 'playing', null, { timeout: 20000 });
  await G(() => { const p = window.__lecraft.session.player; p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(1600, 74, 16); p.yaw = 0; p.pitch = -0.6; });
  await wait(8000);
  const tr = await G(() => { const s = window.__lecraft.session, g = s.server.game; let gone = 0; for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) if (s.world.getBlock(1600 + x, 63, z) === 0) gone++; return { gone, alive: g?.alive.length ?? 0 }; });
  check('TNT Run : le sol disparaît sous les pas des bots', tr.gone >= 10, JSON.stringify(tr));
  await shot('07-tntrun');
  await G(() => window.__lecraft.session.server.toHub());
  await wait(500);

  // ---------- Parkour ----------
  await G(() => window.__lecraft.session.server.join('parkour'));
  await page.waitForFunction(() => window.__lecraft.session.server.game?.state === 'playing', null, { timeout: 20000 });
  const pk = await G(async () => {
    const s = window.__lecraft.session, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const g = s.server.game;
    const course = g.course;
    for (const c of course) { p.body.setPos(c.x + 0.5, c.y + 1, c.z + 0.5); await sleep(120); }
    await sleep(300);
    return { best: s.server.profile.bestParkour, state: s.server.game?.state };
  });
  check('Parkour : parcours terminé, record enregistré', pk.best > 0 && pk.state === 'ended', JSON.stringify(pk));
  await shot('08-parkour');
  // chat : un bot répond
  await G(() => window.__lecraft.session.server.toHub());
  await G(() => window.__lecraft.session.server.playerChat('salut tout le monde'));
  await wait(3500);
  const chat = await G(() => [...document.querySelectorAll('.chat-line')].map((l) => l.textContent).slice(-6).join(' | '));
  check('Chat : les bots répondent', /salut|yo|bonjour|wesh/i.test(chat), chat);
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
