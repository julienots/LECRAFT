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
  await page.locator('.server-entry[data-server="HypXL"]').click();
  await page.getByText('Rejoindre le serveur').click();
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded && window.__lecraft.session.server, null, { timeout: 120000 });
  await wait(3000);
  const hub = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const bots = s.entities.mobs.filter((m) => m.botName);
    return { npcs: bots.filter((b) => b.npc).length, walkers: bots.filter((b) => !b.npc).length, compass: p.inventory.slots[0]?.id, sidebar: document.querySelector('.mc-sidebar:not(.hidden)')?.textContent ?? '', y: p.y, floor: s.world.getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)) };
  });
  check('Menu Multijoueur → serveur : hub chargé (sol, boussole)', hub.floor > 0 && hub.compass === 'compass', JSON.stringify(hub));
  check('Hub : 8 PNJ de jeux + cosmétiques, boîtes mystères, survie, hologrammes et des bots joueurs', hub.npcs >= 14 && hub.walkers >= 20, JSON.stringify(hub));
  check('Tableau de scores latéral', /HYPXL/.test(hub.sidebar) && /Pièces/.test(hub.sidebar), hub.sidebar);
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
  check('Boussole : menu des 8 jeux', menu.length === 8, menu.join(','));
  await shot('02-menu');
  await page.keyboard.press('Escape');
  await wait(300);

  // ---------- Cosmétiques, boîtes mystères, lobbys ----------
  await G(() => { const n = window.__lecraft.session.server; n.profile.coins = 5000; n.useItem('emerald'); });
  await wait(400);
  const tabs = await G(() => [...document.querySelectorAll('[data-tab]')].map((b) => b.dataset.tab));
  check('Émeraude : menu des cosmétiques (6 onglets)', tabs.length === 6, tabs.join(','));
  await page.locator('[data-cosmetic="trail_flame"]').click();
  await wait(300);
  await page.locator('[data-tab="hat"]').click();
  await wait(200);
  await page.locator('[data-cosmetic="hat_pumpkin"]').click();
  const cos = await G(() => { const n = window.__lecraft.session.server; return { owned: n.profile.owned.length, trail: n.profile.equipped.trail, coins: n.profile.coins }; });
  check('Achat et équipement d’une traînée', cos.trail === 'trail_flame' && cos.coins < 5000, JSON.stringify(cos));
  await shot('03-cosmetics');
  await page.keyboard.press('Escape');
  await wait(300);
  const box = await G(() => { const n = window.__lecraft.session.server; const before = n.profile.owned.length; const c = n.openMystery(); return { got: c?.id ?? null, before, after: n.profile.owned.length }; });
  check('Boîte mystère : un cosmétique gagné', !!box.got && box.after === box.before + 1, JSON.stringify(box));
  await wait(2500);
  const pet = await G(() => { const n = window.__lecraft.session.server; n.profile.owned.push('pet_fox'); n.equip({ id: 'pet_fox', kind: 'pet', value: 'fox' }); return window.__lecraft.session.entities.mobs.filter((m) => m.def.key === 'fox' && m.invulnerable).length; });
  check('Compagnon équipé : il apparaît', pet >= 1, `${pet} compagnon(s)`);
  const fmtc = await G(() => { const n = window.__lecraft.session.server; n.profile.owned.push('rank_mvpp'); n.profile.equipped.rank = 'rank_mvpp'; return n.formatPlayerChat('bonjour'); });
  check('Chat : rang du joueur affiché', /MVP/.test(fmtc), fmtc);
  await G(() => window.__lecraft.session.server.switchLobby(7));
  await wait(1500);
  const lob = await G(() => { const n = window.__lecraft.session.server; return { lobby: n.profile.lobby, bots: window.__lecraft.session.entities.mobs.filter((m) => m.botName && !m.npc).length }; });
  check('Changement de lobby', lob.lobby === 7 && lob.bots >= 20, JSON.stringify(lob));
  await G(() => window.__lecraft.session.server.useItem('book'));
  await wait(300);
  await shot('03b-profile');
  await page.keyboard.press('Escape');
  await wait(300);

  // ---------- Sumo ----------
  await G(() => window.__lecraft.session.server.join('sumo'));
  await page.waitForFunction(() => window.__lecraft.session.server.game?.state === 'playing', null, { timeout: 25000 });
  await G(() => { const p = window.__lecraft.session.player; p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(2400.5, 74, 14); p.yaw = 0; p.pitch = -0.7; });
  await wait(14000);
  const su = await net();
  check('Sumo : 6 joueurs, les bots se poussent hors de l’arène', su.game === 'sumo' && su.parts === 6 && (su.alive < 6 || su.state === 'ended'), JSON.stringify(su));
  await shot('09-sumo');
  await G(() => window.__lecraft.session.server.toHub());
  await wait(500);

  // ---------- Block Party ----------
  await G(() => window.__lecraft.session.server.join('blockparty'));
  await page.waitForFunction(() => window.__lecraft.session.server.game?.state === 'playing', null, { timeout: 25000 });
  await G(() => { const p = window.__lecraft.session.player; p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(2800.5, 78, 20); p.yaw = 0; p.pitch = -0.7; });
  await page.waitForFunction(() => window.__lecraft.session.server.game?.phase === 'drop', null, { timeout: 20000 });
  const bp = await G(() => { const s = window.__lecraft.session, g = s.server.game; let solid = 0; for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) if (s.world.getBlock(2800 + x, 63, z) !== 0) solid++; return { solid, round: g.round, parts: g.parts.length }; });
  check('Block Party : couleur annoncée, les autres disparaissent', bp.parts === 10 && bp.round >= 1 && bp.solid > 0 && bp.solid < 300, JSON.stringify(bp));
  await wait(400);
  await shot('10-blockparty');
  await page.waitForFunction(() => window.__lecraft.session.server.game?.phase === 'dance', null, { timeout: 10000 });
  const bp2 = await G(() => { const s = window.__lecraft.session; let solid = 0; for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) if (s.world.getBlock(2800 + x, 63, z) !== 0) solid++; return solid; });
  check('Block Party : nouvelle piste pour la manche suivante', bp2 === 625, `${bp2} blocs`);
  await G(() => window.__lecraft.session.server.toHub());
  await wait(500);

  // ---------- BedWars ----------
  await G(() => window.__lecraft.session.server.join('bedwars'));
  await page.waitForFunction(() => window.__lecraft.session.server.game?.state === 'playing', null, { timeout: 25000 });
  const bw0 = await G(() => { const s = window.__lecraft.session, g = s.server.game; return { parts: g.parts.length, beds: g.beds.filter(Boolean).length, sword: s.player.inventory.slots[0]?.id }; });
  check('BedWars : 4 équipes de 2, 4 lits, épée de départ', bw0.parts === 8 && bw0.beds === 4 && bw0.sword === 'wooden_sword', JSON.stringify(bw0));
  await wait(4000);
  const iron = await G(() => window.__lecraft.session.entities.entities.filter((e) => e.kind === 'item' && e.itemId === 'iron_ingot').length + window.__lecraft.session.player.inventory.count('iron_ingot'));
  check('BedWars : le générateur produit du fer', iron >= 1, `${iron} lingot(s)`);
  await G(() => { const s = window.__lecraft.session; s.player.inventory.add({ id: 'iron_ingot', count: 40 }); s.server.game.interact('bw_shop'); });
  await wait(300);
  await page.locator('[data-buy="stone_sword"]').click();
  const bought = await G(() => window.__lecraft.session.player.inventory.count('stone_sword'));
  check('BedWars : marchand (paiement en fer)', bought === 1, `${bought}`);
  await shot('11-bedwars-shop');
  await page.keyboard.press('Escape');
  await G(() => { const p = window.__lecraft.session.player; p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(3200.5, 90, 40); p.yaw = 0; p.pitch = -0.8; });
  await wait(40000);
  const bw = await G(() => { const s = window.__lecraft.session, g = s.server.game; let placed = 0; for (const [k, v] of g.journal) if (v === 0) placed++; return { placed, beds: g.beds.filter(Boolean).length, state: g.state }; });
  check('BedWars : les bots construisent des ponts', bw.placed >= 6, JSON.stringify(bw));
  await shot('12-bedwars');
  await G(() => window.__lecraft.session.server.toHub());
  await wait(500);

  // ---------- Duel ----------
  await G(() => window.__lecraft.session.server.useItem('compass'));
  await wait(400);
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
