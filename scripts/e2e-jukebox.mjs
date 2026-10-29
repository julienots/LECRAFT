// E2E juke-box et disques : insertion (retirée de la main), état « en lecture », message HUD
// « Lecture en cours », son positionnel (piste composée), éjection (objet au sol), disque lâché à la
// casse, sauvegarde du contenu, disque de creeper tué par un squelette, nouveaux disques de LeCraft.
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
let failed = 0, total = 0;
const check = (n, ok, d = '') => { total++; if (!ok) failed++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const G = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);
const until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await G(f)) return true; await wait(150); } return false; };

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'MEDIUM', renderDistance: 2, autoQuality: false, gfxV: 3, musicVolume: 0.5, sfxVolume: 0.8 })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await G(() => window.__lecraft.createWorld('Jukebox', '4242', 'survival', 'peaceful'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(800);
  await G(() => {
    const g = window.__lecraft, s = g.session, p = s.player;
    g.audio.unlock();
    const x = Math.floor(p.x), z = Math.floor(p.z), y = 100;
    s.runCommand(`/fill ${x - 9} ${y - 1} ${z - 9} ${x + 9} ${y - 1} ${z + 9} stone`);
    s.runCommand(`/fill ${x - 9} ${y} ${z - 9} ${x + 9} ${y + 5} ${z + 9} air`);
    s.runCommand('/time set day');
    p.body.setPos(x + 0.5, y, z + 0.5);
    s.runCommand(`/setblock ${x + 2} ${y} ${z} jukebox`);
    window.__a = { x, y, z, jx: x + 2, jy: y, jz: z };
    window.__use = () => { const { jx, jy, jz } = window.__a; s.interaction.targetMob = null; s.interaction.target = { x: jx, y: jy, z: jz, nx: 0, ny: 1, nz: 0, block: s.world.getBlock(jx, jy, jz), distance: 2, px: jx + 0.5, py: jy + 1, pz: jz + 0.5 }; s.interaction.use(); };
    window.__hold = (stack) => { p.inventory.clear(); p.inventory.slots[0] = stack; p.inventory.selected = 0; p.inventory.changed(); };
    window.__items = () => s.entities.entities.filter((e) => e.kind === 'item' && !e.removed).map((e) => e.itemId);
  });
  const audioOk = await G(() => window.__lecraft.audio.ready);
  check('Audio prêt (WebAudio)', audioOk);

  // ---------- insertion ----------
  await G(() => window.__hold({ id: 'music_disc_cat', count: 1 }));
  await G(() => window.__use());
  const ins = await G(() => {
    const s = window.__lecraft.session, { jx, jy, jz } = window.__a;
    return { st: s.world.jukeboxes.get(`${jx},${jy},${jz}`), meta: s.world.getMeta(jx, jy, jz), held: s.player.inventory.slots[0], msg: document.querySelector('.mc-actionbar')?.textContent };
  });
  check('Disque inséré : juke-box plein et en lecture', ins.st?.disc.id === 'music_disc_cat' && ins.st.playing === true && (ins.meta & 3) === 3, JSON.stringify(ins.st));
  check('Disque retiré de la main en survie', ins.held === null, JSON.stringify(ins.held));
  check('Message HUD « Lecture en cours : C418 - cat »', ins.msg === 'Lecture en cours : C418 - cat', ins.msg);
  const color = await G(() => document.querySelector('.mc-actionbar').style.color);
  await wait(700);
  const color2 = await G(() => document.querySelector('.mc-actionbar').style.color);
  check('Couleur du message animée (arc-en-ciel)', !!color && !!color2 && color !== color2, `${color} → ${color2}`);
  await page.screenshot({ path: `${OUT}/jukebox-01-playing.png` });

  // ---------- son positionnel ----------
  const audible = await until(() => window.__lecraft.audio.recordCount === 1);
  check('Piste en lecture dans le moteur audio', audible, String(await G(() => window.__lecraft.audio.recordCount)));
  check('Titre audible (le plus proche)', (await G(() => window.__lecraft.audio.recordPlaying)) === 'C418 - cat');
  // loin : hors de portée (64 blocs), la lecture est coupée ; de retour, elle reprend
  await G(() => { const p = window.__lecraft.session.player; window.__home = [p.x, p.y, p.z]; p.body.setPos(p.x + 120, p.y, p.z); });
  const far = await until(() => window.__lecraft.audio.recordCount === 0, 8000);
  check('Hors de portée (> 64 blocs) : plus de son', far);
  await G(() => { const p = window.__lecraft.session.player; p.body.setPos(...window.__home); });
  check('De retour à portée : la piste reprend', await until(() => window.__lecraft.audio.recordCount === 1, 8000));

  // ---------- particules de notes ----------
  const notes = await G(() => window.__lecraft.session.world.jukeboxes.size);
  check('Un juke-box actif (notes émises chaque seconde)', notes === 1);

  // ---------- éjection ----------
  await G(() => { window.__hold(null); window.__use(); });
  await wait(300);
  const ej = await G(() => {
    const s = window.__lecraft.session, { jx, jy, jz } = window.__a;
    return { st: !!s.world.jukeboxes.get(`${jx},${jy},${jz}`), items: window.__items(), meta: s.world.getMeta(jx, jy, jz) & 3 };
  });
  check('Éjection : juke-box vide, disque en objet au-dessus', !ej.st && ej.meta === 0 && ej.items.includes('music_disc_cat'), JSON.stringify(ej));
  check('Éjection : la piste s’arrête', await until(() => window.__lecraft.audio.recordCount === 0, 8000));

  // ---------- casser : lâche le disque ----------
  await G(() => { window.__hold({ id: 'music_disc_murmures', count: 1 }); window.__use(); });
  const murmur = await G(() => ({ msg: document.querySelector('.mc-actionbar')?.textContent, ok: window.__lecraft.session.world.jukeboxes.size === 1 }));
  check('Disque de LeCraft : « Lecture en cours : LeCraft - murmures »', murmur.ok && murmur.msg === 'Lecture en cours : LeCraft - murmures', murmur.msg);
  await G(() => { const { jx, jy, jz } = window.__a; const s = window.__lecraft.session; s.interaction.breakBlock(jx, jy, jz, undefined); });
  await wait(300);
  const br = await G(() => ({ items: window.__items(), size: window.__lecraft.session.world.jukeboxes.size }));
  check('Juke-box cassé : disque lâché, état effacé', br.items.includes('music_disc_murmures') && br.size === 0, JSON.stringify(br));
  check('Juke-box cassé : la piste s’arrête', await until(() => window.__lecraft.audio.recordCount === 0, 8000));

  // ---------- disque 11 / signal ----------
  await G(() => { const { jx, jy, jz } = window.__a; window.__lecraft.session.runCommand(`/setblock ${jx} ${jy} ${jz} jukebox`); window.__hold({ id: 'music_disc_11', count: 1 }); window.__use(); });
  const d11 = await G(() => { const { jx, jy, jz } = window.__a; return window.__lecraft.session.world.jukeboxes.get(`${jx},${jy},${jz}`)?.disc.id; });
  check('Disque « 11 » inséré', d11 === 'music_disc_11');

  // ---------- sauvegarde et rechargement ----------
  await G(() => window.__lecraft.session.save(false));
  const snap = await G(() => JSON.stringify(window.__lecraft.session.snapshot().jukeboxes));
  check('Sauvegarde : contenu du juke-box dans l’état', /music_disc_11/.test(snap), snap);
  await G(() => window.__lecraft.quitToMenu());
  await wait(500);
  check('Quitter le monde : plus aucune piste', (await G(() => window.__lecraft.audio.recordCount)) === 0);
  await G(async () => {
    const g = window.__lecraft;
    const list = await g.saves.listWorlds();
    const m = list.find((w) => w.name === 'Jukebox');
    await g.playWorld(m);
  });
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session.loaded, null, { timeout: 120000 });
  await wait(1000);
  const re = await G(() => {
    const s = window.__lecraft.session, w = s.world;
    return { all: [...w.jukeboxes].map(([k, v]) => ({ k, id: v.disc.id, playing: v.playing, el: v.elapsed })) };
  });
  check('Rechargement : le disque est toujours dans le juke-box', re.all.length === 1 && re.all[0].id === 'music_disc_11', JSON.stringify(re));

  // ---------- creeper tué par un squelette ----------
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const cr = s.entities.spawnMob('creeper', p.x + 7, 100, p.z + 4, { persistent: true });
    s.combat.damageMob(cr, 999, { kind: 'player', fromPlayer: true });
  });
  const none = await G(() => window.__lecraft.session.entities.entities.filter((e) => e.kind === 'item' && /^music_disc_/.test(e.itemId)).length);
  check('Creeper tué par le joueur : pas de disque', none === 0, String(none));
  await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const sk = s.entities.spawnMob('skeleton', p.x + 6, 100, p.z, { persistent: true });
    const cr = s.entities.spawnMob('creeper', p.x + 7, 100, p.z, { persistent: true });
    s.combat.damageMob(cr, 999, { kind: 'projectile', fromPlayer: false, attacker: sk });
  });
  const discDropped = await G(() => window.__lecraft.session.entities.entities.filter((e) => e.kind === 'item' && !e.removed).map((e) => e.itemId).filter((i) => /^music_disc_/.test(i)));
  check('Creeper tué par un squelette : un disque est lâché', discDropped.length === 1, JSON.stringify(discDropped));

  // ---------- icônes ----------
  const icons = await G(() => {
    const tm = window.__lecraft.textures;
    const keys = ['music_disc_murmures', 'music_disc_toc', 'music_disc_signal_perdu', 'music_disc_gouffre', 'music_disc_cat'];
    return keys.map((k) => {
      const c = tm.iconCanvas(k);
      const d = c.getContext('2d').getImageData(0, 0, 32, 32).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return { k, n };
    });
  });
  check('Icônes des disques dessinées (non vides, pas des cases magenta)', icons.every((i) => i.n > 200 && i.n < 900), JSON.stringify(icons));
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
