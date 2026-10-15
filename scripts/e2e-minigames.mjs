// E2E HypXL (hub v2 et nouveaux mini-jeux) : point d'apparition tourné vers la place, barre de boss,
// liste des joueurs (Tab, /list), récompense quotidienne, double saut, retour depuis le vide, points
// de contrôle du parcours du hub, portail « Partie rapide », puis Murder Mystery, The Bridge, TNT Tag
// et Piliers de la Chance : chaque jeu démarre, les bots jouent, la partie se termine avec un gagnant.
// URL=http://localhost:4173/ OUT=screenshots PREFIX=minigames- node scripts/e2e-minigames.mjs
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
const PREFIX = process.env.PREFIX ?? 'minigames-';
let failed = 0, total = 0;
const check = (n, ok, d = '') => { total++; if (!ok) failed++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 480 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const G = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${OUT}/${PREFIX}${n}.png` });
const net = () => G(() => { const n = window.__lecraft.session.server; return { game: n.game?.key ?? null, state: n.game?.state ?? null, alive: n.game?.alive.length ?? 0, parts: n.game?.parts.length ?? 0, you: n.game?.you.alive ?? null }; });
const waitState = (st, ms = 30000) => page.waitForFunction((st) => window.__lecraft.session.server.game?.state === st, st, { timeout: ms });
const chatHas = (re) => G((src) => window.__lecraft.chat.lines.map((l) => l.text.replace(/§./g, '')).some((l) => new RegExp(src).test(l)), re);
/** Le joueur tombe dans le vide (éliminé → spectateur) pour laisser les bots finir la partie. */
const dropPlayer = () => G(() => { const p = window.__lecraft.session.player; p.body.setPos(p.x, 0, p.z); });
const flyOver = (x, y, z, pitch = -0.7) => G(([x, y, z, pitch]) => { const p = window.__lecraft.session.player; p.gameMode = 'creative'; p.body.flying = true; p.body.setPos(x, y, z); p.yaw = 0; p.pitch = pitch; }, [x, y, z, pitch]);

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

  // ---------- hub ----------
  const hub = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const bots = s.entities.mobs.filter((m) => m.botName);
    const games = bots.filter((b) => b.npc && b.npc in { murder: 1, bridge: 1, tnttag: 1, pillars: 1, bedwars: 1, skywars: 1, duels: 1, sumo: 1, blockparty: 1, tntrun: 1, spleef: 1, parkour: 1 });
    return { yaw: p.yaw, gameNpcs: games.length, daily: bots.some((b) => b.npc === 'daily'), bar: document.querySelector('.hypxl-bossbar')?.textContent ?? '', clock: p.inventory.slots[6]?.id, npcTag: games.some((b) => b.npc === 'murder') };
  });
  check('Hub : point d’apparition tourné vers la place (yaw 0)', Math.abs(hub.yaw) < 0.01, JSON.stringify(hub));
  check('Hub : 12 PNJ de jeux (dont 4 nouveaux) et PNJ de récompense quotidienne', hub.gameNpcs === 12 && hub.daily && hub.npcTag, JSON.stringify(hub));
  check('Hub : barre de boss du serveur', /HYPXL|PNJ|portail|parcours|saut|cosm/i.test(hub.bar), hub.bar);
  await page.keyboard.down('Tab');
  await wait(700);
  const tab = await G(() => { const t = document.querySelector('.hypxl-tablist'); return { shown: !!t && t.style.display !== 'none', rows: t ? t.querySelectorAll('div > div > div').length : 0, text: t?.textContent?.slice(0, 80) ?? '' }; });
  await shot('tablist');
  await page.keyboard.up('Tab');
  check('Liste des joueurs (Tab) : rangs, niveaux et ping', tab.shown && tab.rows >= 15 && /✫/.test(tab.text), JSON.stringify(tab));
  await wait(400);
  const tabGone = await G(() => document.querySelector('.hypxl-tablist').style.display === 'none');
  check('Liste des joueurs : masquée en relâchant Tab', tabGone);
  const daily = await G(() => { const n = window.__lecraft.session.server; const c0 = n.profile.coins; n.useItem('clock'); const c1 = n.profile.coins; n.useItem('clock'); return { c0, c1, c2: n.profile.coins, streak: n.profile.dailyStreak }; });
  check('Récompense quotidienne (horloge) : une seule fois par jour', daily.c1 > daily.c0 && daily.c2 === daily.c1 && daily.streak === 1, JSON.stringify(daily));
  // double saut
  await G(() => { const p = window.__lecraft.session.player; p.body.setPos(0.5, 64, 22.5); p.yaw = 0; p.pitch = 0; });
  await wait(600);
  // appuis synchronisés avec les images (le rendu logiciel est lent) : saut, relâché en l'air, 2e appui
  const dj = await G(async () => {
    const s = window.__lecraft.session, p = s.player, n = s.server, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const key = (type) => window.dispatchEvent(new KeyboardEvent(type, { code: 'Space', key: ' ' }));
    const until = async (f, ms = 3000) => { const t = performance.now(); while (!f() && performance.now() - t < ms) await sleep(10); };
    const y0 = p.y; let top = y0;
    key('keydown'); await until(() => !p.body.onGround); key('keyup');
    await until(() => n.djReady); key('keydown'); await until(() => n.djUsed); key('keyup');
    for (let i = 0; i < 60; i++) { top = Math.max(top, p.y); await sleep(40); }
    return { rise: +(top - y0).toFixed(2), used: n.djUsed || top - y0 > 2 };
  });
  check('Hub : double saut', dj.rise > 1.6, JSON.stringify(dj));
  // vide : retour au point d'apparition
  await G(() => { const p = window.__lecraft.session.player; p.body.setPos(70, 40, 70); });
  await wait(800);
  const back = await G(() => { const p = window.__lecraft.session.player; return { x: +p.x.toFixed(1), z: +p.z.toFixed(1) }; });
  check('Hub : chute dans le vide → retour au point d’apparition', Math.abs(back.x - 0.5) < 1 && Math.abs(back.z - 44.5) < 1, JSON.stringify(back));
  // parcours du hub : points de contrôle
  const pk = await G(async () => {
    const s = window.__lecraft.session, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pts = [];
    const cx = -42; for (let i = 0; i < 16; i++) { const a = Math.PI * 0.15 + i * 0.55; pts.push({ x: Math.round(cx + Math.cos(a) * 7), y: 64 + Math.floor(i * 0.9), z: Math.round(Math.sin(a) * 7) }); }
    for (let i = 0; i <= 7; i++) { p.body.setPos(pts[i].x + 0.5, pts[i].y + 1, pts[i].z + 0.5); await sleep(450); }
    p.body.setPos(-36.5, 64.2, 12.5); // chute au sol du hub
    await sleep(1200);
    const fx = Math.floor(p.x), fz = Math.floor(p.z);
    const atCheck = fx === pts[5].x && fz === pts[5].z;
    for (let i = 5; i < 16; i++) { p.body.setPos(pts[i].x + 0.5, pts[i].y + 1, pts[i].z + 0.5); await sleep(450); }
    await sleep(300);
    return { atCheck, best: s.server.profile.bestHubParkour ?? 0 };
  });
  check('Parcours du hub : chute → retour au point de contrôle, record enregistré', pk.atCheck && pk.best > 0, JSON.stringify(pk));
  await flyOver(-30.5, 66, 14, 0.0);
  await G(() => { window.__lecraft.session.player.yaw = Math.PI; });
  await wait(1500);
  await shot('leaderboards');
  await G(() => { const p = window.__lecraft.session.player; p.gameMode = 'survival'; p.body.flying = false; });
  // portail « Partie rapide »
  await G(() => { const p = window.__lecraft.session.player; p.body.setPos(0.5, 64, -38.5); p.yaw = 0; p.pitch = 0; });
  await wait(1200);
  await shot('portal');
  await G(() => { const p = window.__lecraft.session.player; p.body.setPos(0.5, 64, -41.5); });
  await page.waitForFunction(() => !!window.__lecraft.session.server.game, null, { timeout: 8000 }).catch(() => {});
  const quick = await net();
  check('Portail « Partie rapide » : un jeu est lancé', !!quick.game, JSON.stringify(quick));
  await G(() => window.__lecraft.session.server.toHub());
  await wait(600);
  await G(() => window.__lecraft.session.server.useItem('compass'));
  await wait(400);
  const menu = await G(() => [...document.querySelectorAll('[data-game]')].map((b) => b.dataset.game));
  check('Boussole : menu des 12 jeux', menu.length === 12 && ['murder', 'bridge', 'tnttag', 'pillars'].every((k) => menu.includes(k)), menu.join(','));
  await shot('menu');
  await page.keyboard.press('Escape');
  await wait(300);

  // ---------- TNT Tag ----------
  await G(() => window.__lecraft.session.server.join('tnttag'));
  await waitState('playing');
  const t0 = await G(() => { const g = window.__lecraft.session.server.game; return { parts: g.parts.length, it: g.it.size, round: g.round }; });
  check('TNT Tag : 10 joueurs, manche 1, porteurs de TNT désignés', t0.parts === 10 && t0.it >= 2 && t0.round === 1, JSON.stringify(t0));
  await dropPlayer();
  await wait(500);
  await flyOver(3600.5, 78, 18);
  const tags = await G(async () => {
    const g = window.__lecraft.session.server.game, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const seen = new Set([...g.it].map((p) => p.name));
    for (let i = 0; i < 80; i++) { await sleep(150); for (const p of g.it) seen.add(p.name); }
    return { carriers: seen.size, hat: [...g.it].some((p) => p.bot?.model.parts.get('head')?.[0]?.getObjectByName('hat')) };
  });
  check('TNT Tag : les bots se passent la TNT (chapeau TNT)', tags.carriers >= 4 && tags.hat, JSON.stringify(tags));
  await shot('tnttag');
  // accélère les manches jusqu'à la fin
  const tt = await G(async () => {
    const s = window.__lecraft.session, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let g = s.server.game; const r0 = g.round;
    for (let i = 0; i < 900 && g.state === 'playing'; i++) { if (g.roundT > 2.5) g.roundT = 2.5; await sleep(200); }
    return { state: g.state, rounds: g.round - r0, alive: g.alive.length, winner: g.alive[0]?.name ?? null };
  });
  check('TNT Tag : explosions à chaque manche, un gagnant', tt.state === 'ended' && tt.alive === 1 && tt.rounds >= 3, JSON.stringify(tt));
  check('TNT Tag : annonce du gagnant', await chatHas('TNT Tag — gagnant'));
  await G(() => window.__lecraft.session.server.toHub());
  await wait(600);

  // ---------- The Bridge ----------
  await G(() => window.__lecraft.session.server.join('bridge'));
  await waitState('playing');
  const b0 = await G(() => { const s = window.__lecraft.session, g = s.server.game; return { parts: g.parts.length, teams: [...g.team.values()].join(''), sword: s.player.inventory.slots[0]?.id, blocks: s.player.inventory.count('red_terracotta') }; });
  check('The Bridge : 2 contre 2, épée et blocs de l’équipe', b0.parts === 4 && b0.teams.split('').sort().join('') === '0011' && b0.sword === 'iron_sword' && b0.blocks >= 64, JSON.stringify(b0));
  await flyOver(4000.5, 76, 30, -0.55);
  const goal = await G(async () => {
    const g = window.__lecraft.session.server.game, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let minD = 99;
    for (let i = 0; i < 600 && g.score[0] + g.score[1] === 0 && g.state === 'playing'; i++) {
      for (const p of g.parts) if (p.bot) minD = Math.min(minD, Math.abs(p.bot.z - (g.team.get(p) === 0 ? -23 : 23)));
      await sleep(200);
    }
    return { score: [...g.score], minD: +minD.toFixed(1), kills: g.parts.reduce((a, p) => a + p.kills, 0) };
  });
  check('The Bridge : les bots traversent le pont et marquent', goal.score[0] + goal.score[1] >= 1, JSON.stringify(goal));
  await shot('bridge');
  // le joueur marque le but décisif : saut dans le trou bleu
  const bw = await G(async () => {
    const s = window.__lecraft.session, g = s.server.game, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    while (g.freeze > 0) await sleep(100);
    g.score = [2, Math.min(g.score[1], 2)];
    p.gameMode = 'survival'; p.body.flying = false;
    p.body.setPos(4000.5, 63.5, -22.5);
    for (let i = 0; i < 20 && g.state === 'playing'; i++) await sleep(100);
    return { state: g.state, score: [...g.score], wins: s.server.profile.wins.bridge ?? 0 };
  });
  check('The Bridge : saut dans le trou adverse → but, 3 buts = victoire', bw.state === 'ended' && bw.score[0] === 3 && bw.wins >= 1, JSON.stringify(bw));
  await G(() => window.__lecraft.session.server.toHub());
  await wait(600);

  // ---------- Murder Mystery (innocent) ----------
  await G(() => { const n = window.__lecraft.session.server; n.nextRole = 'innocent'; n.join('murder'); });
  await waitState('playing', 40000);
  const m0 = await G(() => { const g = window.__lecraft.session.server.game; const roles = [...g.role.values()]; return { parts: g.parts.length, me: g.role.get(g.you), murderers: roles.filter((r) => r === 'murderer').length, detectives: roles.filter((r) => r === 'detective').length }; });
  check('Murder Mystery : 8 joueurs, 1 meurtrier, 1 détective, vous êtes innocent', m0.parts === 8 && m0.murderers === 1 && m0.detectives === 1 && m0.me === 'innocent', JSON.stringify(m0));
  await flyOver(4400.5, 92, 26, -0.8);
  const mk = await G(async () => {
    const g = window.__lecraft.session.server.game, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 450 && g.state === 'playing' && g.alive.length > 5; i++) await sleep(200);
    return { alive: g.alive.length, murdererKills: g.murderer.kills, state: g.state };
  });
  check('Murder Mystery : le meurtrier (bot) élimine des joueurs', mk.murdererKills >= 2 || mk.state === 'ended', JSON.stringify(mk));
  await shot('murder');
  const gold = await G(() => window.__lecraft.session.entities.entities.filter((e) => e.kind === 'item' && e.itemId === 'gold_ingot').length);
  check('Murder Mystery : de l’or apparaît dans le village', gold >= 1, `${gold} lingot(s)`);
  await G(() => window.__lecraft.session.server.toHub());
  await wait(600);

  // ---------- Murder Mystery (meurtrier) : le joueur élimine tout le monde à l'épée ----------
  await G(() => { const n = window.__lecraft.session.server; n.nextRole = 'murderer'; n.join('murder'); });
  await waitState('playing', 40000);
  const mm = await G(async () => {
    const s = window.__lecraft.session, g = s.server.game, p = s.player, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const sword = p.inventory.slots[1]?.id;
    p.inventory.selected = 1;
    for (let k = 0; k < 40 && g.state === 'playing' && g.you.alive; k++) {
      const v = g.alive.find((x) => x.bot);
      if (!v) break;
      p.body.setPos(v.bot.x + 1.4, v.bot.y, v.bot.z);
      s.combat.cooldown = 0;
      s.combat.playerAttack(s, v.bot);
      await sleep(250);
    }
    await sleep(300);
    return { sword, state: g.state, result: g.winnerText, kills: g.you.kills, you: g.you.alive, wins: s.server.profile.wins.murder ?? 0 };
  });
  check('Murder Mystery (meurtrier) : l’épée élimine, la partie se termine', mm.sword === 'iron_sword' && mm.state === 'ended' && mm.kills >= 1 && !!mm.result, JSON.stringify(mm));
  await G(() => window.__lecraft.session.server.toHub());
  await wait(600);

  // ---------- Piliers de la Chance ----------
  await G(() => window.__lecraft.session.server.join('pillars'));
  await waitState('playing', 40000);
  const pl0 = await G(() => { const s = window.__lecraft.session, g = s.server.game, p = s.player; return { parts: g.parts.length, onPillar: s.world.getBlock(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)) === window.__lecraft.debug.blockId('bedrock') }; });
  check('Piliers : 8 joueurs, chacun sur un pilier de bedrock', pl0.parts === 8 && pl0.onPillar, JSON.stringify(pl0));
  await wait(5500);
  const items = await G(() => window.__lecraft.session.player.inventory.slots.filter(Boolean).length);
  check('Piliers : des objets au hasard sont distribués', items >= 2, `${items} case(s) remplie(s)`);
  await dropPlayer();
  await wait(500);
  await flyOver(4800.5, 86, 26, -0.75);
  const pl = await G(async () => {
    const s = window.__lecraft.session, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const g = s.server.game; let placed = 0, shot = false;
    for (let i = 0; i < 1500 && g.state === 'playing'; i++) {
      let k = 0; for (const [, v] of g.journal) if (v === 0) k++;
      placed = Math.max(placed, k);
      if (placed >= 8 && !shot) { shot = true; window.__plShot = true; }
      await sleep(200);
    }
    return { placed, state: g.state, alive: g.alive.length, winner: g.alive[0]?.name ?? null, kills: g.parts.reduce((a, p) => a + p.kills, 0), t: Math.round(g.elapsed) };
  });
  await shot('pillars');
  check('Piliers : les bots construisent des ponts entre les piliers', pl.placed >= 8, JSON.stringify(pl));
  check('Piliers : les bots se battent jusqu’au dernier (gagnant)', pl.state === 'ended' && pl.alive <= 1 && (await chatHas('Piliers de la Chance — gagnant')), JSON.stringify(pl));
  await G(() => window.__lecraft.session.server.toHub());
  await wait(800);
  const prof = await G(() => { const n = window.__lecraft.session.server; return { wins: n.profile.wins, coins: n.profile.coins, level: n.level }; });
  check('Profil : victoires et pièces des nouveaux jeux enregistrées', (prof.wins.bridge ?? 0) >= 1 && prof.coins > 1000, JSON.stringify(prof));
  await G(() => { const p = window.__lecraft.session.player; p.body.setPos(0.5, 64, 44.5); p.yaw = 0; p.pitch = 0; });
  await wait(1500);
  await shot('spawn');
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
