// E2E multijoueur en réseau : deux navigateurs (hôte + invité) via le relais du serveur
// d'aperçu (npm run preview) : ouverture de la partie, liste des parties, connexion, joueurs
// visibles des deux côtés, chunks modifiés transmis, blocs en direct dans les deux sens, chat,
// créatures et bots de l'hôte chez l'invité, coup sur une créature, coffre partagé, JcJ,
// déconnexion, et serveur autonome (npm run server).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
let failed = 0, total = 0;
const check = (n, ok, d = '') => { total++; if (!ok) failed++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
async function open(name) {
  const page = await (await browser.newContext({ viewport: { width: 800, height: 400 } })).newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/WebSocket|ERR_CONNECTION/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  await page.addInitScript((n) => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'LOW', renderDistance: 3, autoQuality: false, gfxV: 2, playerName: n, playerSkin: n === 'Hote' ? 'alex' : 'steve' })), name);
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  return page;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const host = await open('Hote');
  const H = (f, a) => host.evaluate(f, a);
  await H(() => window.__lecraft.createWorld('Monde partagé', 'multi42', 'survival', 'normal'));
  await host.waitForFunction(() => window.__lecraft?.state === 'playing', null, { timeout: 120000 });
  // jour fixe, bloc posé AVANT l'arrivée de l'invité (chunk modifié à transmettre)
  const spot = await H(() => {
    const s = window.__lecraft.session, p = s.player;
    s.dayCycle.time = 0.1;
    s.gamerules.doDaylightCycle = false;
    const x = Math.floor(p.x) + 3, z = Math.floor(p.z) + 2;
    const y = s.world.heightAt(x, z) + 1;
    s.world.setBlock(x, y, z, window.__lecraft.debug.registries.blocks.byName('gold_block').id);
    return { x, y, z, id: s.world.getBlock(x, y, z) };
  });
  await H(() => window.__lecraft.hostWorld('', { pvp: true, bots: true, max: 8 }));
  const room = await H(() => window.__lecraft.session.netHost?.room);
  check('Hôte : partie ouverte sur le relais', !!room, room);

  const guest = await open('Invite');
  const C = (f, a) => guest.evaluate(f, a);
  // liste des parties (écran Multijoueur › Parties en réseau)
  await guest.getByText('Multijoueur', { exact: true }).click();
  await wait(300);
  await guest.getByText('Parties en réseau (vrais joueurs)...').click();
  await guest.waitForSelector(`.server-entry[data-room="${room}"]`, { timeout: 10000 });
  check('Invité : la partie apparaît dans la liste', true);
  await guest.screenshot({ path: `${OUT}/multi-01-liste.png` });
  await guest.locator(`.server-entry[data-room="${room}"]`).click();
  await guest.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session?.netClient, null, { timeout: 120000 });
  check('Invité : connecté et dans le monde de l’hôte', true);
  await wait(3000);

  const seen = await Promise.all([H(() => [...window.__lecraft.session.netHost.peers.values()].map((p) => p.name)), C(() => [...window.__lecraft.session.netClient.players.values()].map((p) => p.botName))]);
  check('Joueurs : l’hôte voit l’invité et l’invité voit l’hôte', seen[0].includes('Invite') && seen[1].includes('Hote'), JSON.stringify(seen));
  const seed = await Promise.all([H(() => window.__lecraft.session.world.seed), C(() => window.__lecraft.session.world.seed)]);
  check('Même graine des deux côtés', seed[0] === seed[1], JSON.stringify(seed));
  await guest.waitForFunction((s) => window.__lecraft.session.world.getBlock(s.x, s.y, s.z) === s.id, spot, { timeout: 20000 }).catch(() => {});
  const got = await C((s) => window.__lecraft.session.world.getBlock(s.x, s.y, s.z), spot);
  check('Chunk modifié avant l’arrivée : transmis à l’invité', got === spot.id, `${got} / ${spot.id}`);

  // l'invité rejoint l'hôte pour se voir l'un l'autre
  await C((p) => { const pl = window.__lecraft.session.player; pl.body.setPos(p.x + 2, p.y, p.z + 2); }, await H(() => { const p = window.__lecraft.session.player; return { x: p.x, y: p.y, z: p.z }; }));
  await wait(1500);

  // blocs en direct
  const e1 = await H((s) => { const w = window.__lecraft.session.world; w.setBlock(s.x, s.y + 1, s.z, 4); return w.getBlock(s.x, s.y + 1, s.z); }, spot);
  await guest.waitForFunction((s) => window.__lecraft.session.world.getBlock(s.x, s.y + 1, s.z) === 4, spot, { timeout: 5000 }).catch(() => {});
  check('Bloc posé par l’hôte → visible chez l’invité', (await C((s) => window.__lecraft.session.world.getBlock(s.x, s.y + 1, s.z), spot)) === e1);
  await C((s) => window.__lecraft.session.world.setBlock(s.x, s.y + 2, s.z, 5), spot);
  await host.waitForFunction((s) => window.__lecraft.session.world.getBlock(s.x, s.y + 2, s.z) === 5, spot, { timeout: 5000 }).catch(() => {});
  check('Bloc posé par l’invité → appliqué chez l’hôte', (await H((s) => window.__lecraft.session.world.getBlock(s.x, s.y + 2, s.z), spot)) === 5);
  await C((s) => window.__lecraft.session.world.setBlock(s.x, s.y + 2, s.z, 0), spot);
  await wait(800);
  check('Bloc cassé par l’invité → cassé chez l’hôte', (await H((s) => window.__lecraft.session.world.getBlock(s.x, s.y + 2, s.z), spot)) === 0);

  // chat
  await C(() => { window.__lecraft.chat.add('<Invite> bonjour tout le monde', 'chat'); window.__lecraft.session.mp.chat('bonjour tout le monde'); });
  await H(() => window.__lecraft.session.mp.chat('salut Invite !'));
  await wait(1500);
  const hl = await H(() => window.__lecraft.chat.lines.map((l) => l.text.replace(/§./g, '')));
  const cl = await C(() => window.__lecraft.chat.lines.map((l) => l.text.replace(/§./g, '')));
  check('Chat : invité → hôte', hl.some((l) => l.includes('<Invite> bonjour tout le monde')), hl.slice(-3).join(' | '));
  check('Chat : hôte → invité', cl.some((l) => l.includes('<Hote> salut Invite !')), cl.slice(-3).join(' | '));

  // créatures de l'hôte chez l'invité, coup porté par l'invité
  const mob = await H(() => {
    const s = window.__lecraft.session, p = s.player;
    const m = s.entities.spawnMob('cow', p.x + 3, p.y + 0.5, p.z, { persistent: true });
    return { id: m.id, hp: m.health };
  });
  await guest.waitForFunction(() => window.__lecraft.session.entities.mobs.some((m) => m.net && m.def.key === 'cow'), null, { timeout: 8000 }).catch(() => {});
  const puppet = await C(() => window.__lecraft.session.entities.mobs.filter((m) => m.net).map((m) => m.def.key));
  check('Créatures de l’hôte affichées chez l’invité', puppet.includes('cow'), JSON.stringify(puppet.slice(0, 12)));
  await guest.waitForFunction((id) => window.__lecraft.session.entities.mobs.some((m) => m.netId === id), mob.id, { timeout: 5000 }).catch(() => {});
  await C((id) => { const s = window.__lecraft.session; const m = s.entities.mobs.find((x) => x.netId === id); s.combat.damageMob(m, 4, { kind: 'player', fromPlayer: true, knockX: 1, knockZ: 0, itemId: 'iron_sword' }); }, mob.id);
  await wait(800);
  const hp = await H((id) => window.__lecraft.session.entities.entities.find((e) => e.id === id)?.health, mob.id);
  check('Coup de l’invité sur une créature → blessée chez l’hôte', hp < mob.hp, `${mob.hp} → ${hp}`);
  // le dernier coup : le butin va à l'invité
  const inv0 = await C(() => window.__lecraft.session.player.inventory.count('beef') + window.__lecraft.session.player.inventory.count('leather'));
  for (let i = 0; i < 4; i++) {
    await C((id) => { const s = window.__lecraft.session; const m = s.entities.mobs.find((x) => x.netId === id && !x.dead); if (m) { m.iframes = 0; s.combat.damageMob(m, 6, { kind: 'player', fromPlayer: true, knockX: 0, knockZ: 0, itemId: 'iron_sword' }); } }, mob.id);
    await wait(600);
  }
  const inv1 = await C(() => window.__lecraft.session.player.inventory.count('beef') + window.__lecraft.session.player.inventory.count('leather'));
  check('Créature tuée par l’invité : butin dans son inventaire', inv1 > inv0, `${inv0} → ${inv1}`);

  // bots de l'hôte
  await host.waitForFunction(() => (window.__lecraft.session.smp?.bots.length ?? 0) >= 1, null, { timeout: 30000 }).catch(() => {});
  await H(() => { const s = window.__lecraft.session, p = s.player; for (const b of s.smp.bots) b.bot.body.setPos(p.x + 2, p.y + 0.5, p.z - 2); });
  await guest.waitForFunction(() => window.__lecraft.session.entities.mobs.some((m) => m.net && m.def.key.startsWith('bot:')), null, { timeout: 10000 }).catch(() => {});
  const bots = await C(() => window.__lecraft.session.entities.mobs.filter((m) => m.net && m.def.key.startsWith('bot:')).map((m) => m.botName));
  check('Bots joueurs de l’hôte visibles chez l’invité (avec leur pseudo)', bots.length >= 1, JSON.stringify(bots));

  // coffre partagé
  const chest = await H((s) => {
    const g = window.__lecraft, w = g.session.world;
    w.setBlock(s.x + 1, s.y, s.z, window.__lecraft.debug.registries.blocks.byName('chest').id, 0);
    const inv = w.getChest(s.x + 1, s.y, s.z);
    inv.slots[0] = { id: 'diamond', count: 7 };
    return w.getBlock(s.x + 1, s.y, s.z);
  }, spot);
  await wait(800);
  const cc = await C(async (s) => { const n = window.__lecraft.session.netClient; await n.requestChest(s.x + 1, s.y, s.z); return window.__lecraft.session.world.getChest(s.x + 1, s.y, s.z).slots[0]; }, spot);
  check('Coffre : contenu de l’hôte lu par l’invité', cc?.id === 'diamond' && cc.count === 7, JSON.stringify(cc) + ` bloc ${chest}`);
  await C((s) => { const w = window.__lecraft.session.world; w.getChest(s.x + 1, s.y, s.z).slots[1] = { id: 'emerald', count: 3 }; window.__lecraft.session.netClient.sendChest(s.x + 1, s.y, s.z); }, spot);
  await wait(800);
  const hc = await H((s) => window.__lecraft.session.world.getChest(s.x + 1, s.y, s.z).slots[1], spot);
  check('Coffre : objet rangé par l’invité → chez l’hôte', hc?.id === 'emerald', JSON.stringify(hc));

  // JcJ : l'hôte frappe l'invité
  const hp0 = await C(() => window.__lecraft.session.player.health);
  await H(() => { const s = window.__lecraft.session; const a = [...s.netHost.peers.values()][0].avatar; s.combat.damageMob(a, 3, { kind: 'player', fromPlayer: true, knockX: 1, knockZ: 0 }); });
  await wait(800);
  const hp1 = await C(() => window.__lecraft.session.player.health);
  check('JcJ : coup de l’hôte → l’invité perd de la vie', hp1 < hp0, `${hp0} → ${hp1}`);

  await host.screenshot({ path: `${OUT}/multi-02-hote.png` });
  await guest.screenshot({ path: `${OUT}/multi-03-invite.png` });

  // déconnexion de l'invité
  await C(() => window.__lecraft.quitToMenu());
  await wait(1500);
  const left = await H(() => window.__lecraft.session.netHost.peers.size);
  check('Invité déconnecté : retiré chez l’hôte', left === 0, String(left));

  // reconnexion puis fermeture par l'hôte
  await C((r) => window.__lecraft.joinRemote('', r), room);
  await guest.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session?.netClient, null, { timeout: 60000 });
  await H(() => window.__lecraft.session.stopMultiplayer());
  await guest.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 10000 }).catch(() => {});
  check('Hôte ferme la partie : l’invité revient au menu', (await C(() => window.__lecraft.state)) === 'menu');

  // serveur autonome
  const srv = spawn(process.execPath, ['server/lecraft-server.mjs'], { env: { ...process.env, PORT: '25599' }, stdio: 'pipe' });
  await wait(1200);
  const info = await fetch('http://127.0.0.1:25599/lecraft-info').then((r) => r.json()).catch((e) => ({ error: String(e) }));
  const page = await fetch('http://127.0.0.1:25599/').then((r) => r.status).catch(() => 0);
  srv.kill();
  check('Serveur autonome (npm run server) : relais et jeu servis', Array.isArray(info.rooms) && page === 200, JSON.stringify(info) + ` page ${page}`);

  check('Aucune erreur JavaScript', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  console.error(e);
  failed++;
} finally {
  await browser.close();
  console.log(`\n${total - failed}/${total} vérifications réussies`);
  process.exit(failed ? 1 : 0);
}
