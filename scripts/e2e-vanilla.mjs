// Mécaniques « vanilla » : portes, lit, seaux, TNT, dalles, échelles, cisailles, poudre d'os,
// et import d'un pack de ressources (.zip généré à la volée, textures factices).
// Usage : npm run build && npx vite preview & node scripts/e2e-vanilla.mjs
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
mkdirSync(OUT, { recursive: true });
let total = 0, failed = 0;
const check = (name, ok, detail = '') => {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---------- PNG + ZIP minimalistes ----------
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.copy(raw, y * (w * 4 + 1) + 1 + x * 4, 0, 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function zip(files) {
  const locals = [], centrals = [];
  let off = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name);
    const comp = deflateSync(data, { level: 9 }).subarray(0); // deflate zlib → on retire en-tête/somme
    const rawDeflate = comp.subarray(2, comp.length - 4);
    const crc = crc32(data) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(rawDeflate.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, rawDeflate);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(rawDeflate.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(ch, n);
    off += 30 + n.length + rawDeflate.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true })).newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const G = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);

try {
  await page.addInitScript(() => {
    window.I = (k) => window.__lecraft.debug.blockId(k);
    localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'LOW', renderDistance: 2, autoQuality: false }));
  });
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu');
  await G(() => window.__lecraft.createWorld('Mécaniques', '777', 'survival', 'normal'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing', null, { timeout: 120000 });
  await wait(1500);
  // arène plane
  await G(() => {
    const s = window.__lecraft.session, w = s.world, p = s.player;
    const a = (window.__a = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) {
      w.setBlock(a.x + dx, a.y - 1, a.z + dz, I('stone'));
      w.setBlock(a.x + dx, a.y - 2, a.z + dz, I('stone'));
      for (let dy = 0; dy < 8; dy++) w.setBlock(a.x + dx, a.y + dy, a.z + dz, 0);
    }
    s.dayCycle.time = 0.2;
    p.body.setPos(a.x + 0.5, a.y, a.z + 0.5);
  });
  await wait(800);
  /** Utilise l'objet `item` en visant la face supérieure (ou `n`) du bloc (x,y,z) relatif à l'arène. */
  const useOn = (item, dx, dy, dz, n = [0, 1, 0], fy = 0.5) =>
    G(([item, dx, dy, dz, n, fy]) => {
      const s = window.__lecraft.session, it = s.interaction, p = s.player, a = window.__a, w = s.world;
      const x = a.x + dx, y = a.y + dy, z = a.z + dz;
      p.inventory.slots[0] = item ? { id: item, count: item.includes('bucket') || item === 'flint_and_steel' || item === 'shears' ? 1 : 16, ...(item === 'flint_and_steel' ? { durability: 64 } : item === 'shears' ? { durability: 238 } : {}) } : null;
      p.inventory.selected = 0;
      it.target = { x, y, z, nx: n[0], ny: n[1], nz: n[2], block: w.getBlock(x, y, z), distance: 2, px: x + 0.5 + n[0] * 0.5, py: y + (n[1] ? (n[1] > 0 ? 1 : 0) : fy), pz: z + 0.5 + n[2] * 0.5 };
      it.targetMob = null;
      const def = item ? window.__lecraft.session.constructor && null : null;
      void def;
      const place = item ? s.interaction['computePlacement'] && p.inventory.selectedStack : null;
      it.preview = null;
      if (place) {
        const reg = window.__lecraft.debug;
        try { it.preview = it['computePlacement'](it.target, reg.blockId(item)); } catch { it.preview = null; }
      }
      it.use();
      return true;
    }, [item, dx, dy, dz, n, fy]);
  const at = (dx, dy, dz) => G(([dx, dy, dz]) => { const s = window.__lecraft.session, a = window.__a; return { id: s.world.getBlock(a.x + dx, a.y + dy, a.z + dz), meta: s.world.getMeta(a.x + dx, a.y + dy, a.z + dz) }; }, [dx, dy, dz]);
  const ID = (k) => G((k) => I(k), k);

  // ---------- dalles ----------
  await useOn('stone_slab', 2, -1, -2);
  const slab1 = await at(2, 0, -2);
  await useOn('stone_slab', 2, 0, -2);
  const slab2 = await at(2, 0, -2);
  check('Dalle posée en bas puis fusionnée en dalle double', slab1.id === (await ID('stone_slab')) && slab1.meta === 0 && slab2.meta === 2, `${JSON.stringify(slab1)} → ${JSON.stringify(slab2)}`);
  await useOn('stone_slab', 3, 0, -2, [0, 0, 1], 0.8);
  const slabTop = await at(3, 0, -1);
  check('Dalle haute en visant le haut d’une face latérale', slabTop.meta === 1, JSON.stringify(slabTop));

  // ---------- porte ----------
  await G(() => { window.__lecraft.session.player.yaw = 0; });
  await useOn('oak_door', 0, -1, -3);
  const d0 = await at(0, 0, -3), d1 = await at(0, 1, -3);
  check('Porte : deux blocs (bas + haut)', d0.id === (await ID('oak_door')) && d1.id === d0.id && (d1.meta & 8) === 8, `${JSON.stringify(d0)} / ${JSON.stringify(d1)}`);
  await useOn(null, 0, 0, -3, [0, 0, 1]);
  const dOpen = await at(0, 0, -3), dOpenTop = await at(0, 1, -3);
  check('Porte : ouverture des deux moitiés', (dOpen.meta & 4) === 4 && (dOpenTop.meta & 4) === 4);
  const passable = await G(() => { const s = window.__lecraft.session, a = window.__a, b = s.player.body; return !b.collides(s.world, a.x + 0.5, a.y, a.z - 2.5); });
  check('Porte ouverte : passage libre au centre', passable);
  await G(() => { const s = window.__lecraft.session, a = window.__a; s.interaction.breakBlock(a.x, a.y + 1, a.z - 3, undefined); });
  await wait(500);
  check('Casser la moitié haute retire toute la porte', (await at(0, 0, -3)).id === 0);

  // ---------- lit & sommeil ----------
  await G(() => { window.__lecraft.session.player.yaw = -Math.PI / 2; });
  await useOn('red_bed', -3, -1, 0);
  const foot = await at(-3, 0, 0), head = await at(-2, 0, 0);
  check('Lit : pied + tête posés', foot.id === (await ID('red_bed')) && head.id === foot.id && (head.meta & 4) === 4, `${JSON.stringify(foot)} ${JSON.stringify(head)}`);
  await G(() => { const s = window.__lecraft.session; s.dayCycle.time = 0.75; s.entities.entities.forEach((e) => (e.removed = true)); s.player.body.setPos(window.__a.x - 1.5, window.__a.y, window.__a.z + 0.5); });
  const day0 = await G(() => window.__lecraft.session.dayCycle.day);
  await useOn(null, -3, 0, 0);
  await wait(2600);
  const slept = await G(() => { const s = window.__lecraft.session; return { t: s.dayCycle.time, day: s.dayCycle.day, spawn: s.player.spawn }; });
  check('Dormir la nuit : passe au matin et change le point d’apparition', slept.t < 0.1 && slept.day === day0 + 1 && Math.abs(slept.spawn[0] - (await G(() => window.__a.x - 1.5))) < 0.01, JSON.stringify(slept));

  // ---------- seaux ----------
  const bucket = await G(() => {
    const s = window.__lecraft.session, a = window.__a, p = s.player, w = s.world;
    w.setBlock(a.x + 4, a.y - 1, a.z + 3, I('water'), 0);
    p.body.setPos(a.x + 4.5, a.y + 0.2, a.z + 3.5 + 1.6);
    p.yaw = 0; p.pitch = -1.0;
    p.inventory.slots[0] = { id: 'bucket', count: 1 }; p.inventory.selected = 0;
    s.interaction['useSpecial']('bucket', 'bucket');
    return { held: p.inventory.slots[0]?.id, water: w.getBlock(a.x + 4, a.y - 1, a.z + 3) };
  });
  check('Seau : remplir à une source d’eau', bucket.held === 'water_bucket' && bucket.water === 0, JSON.stringify(bucket));
  await useOn('water_bucket', 5, -1, 5);
  const poured = await at(5, 0, 5);
  check('Seau d’eau : verser une source', poured.id === (await ID('water')) && poured.meta === 0);
  const back = await G(() => window.__lecraft.session.player.inventory.slots[0]?.id);
  check('Le seau vide revient en main', back === 'bucket', back);
  await G(() => { const s = window.__lecraft.session, a = window.__a; s.world.setBlock(a.x + 5, a.y, a.z + 5, 0); });
  await wait(2500);

  // ---------- poudre d'os ----------
  await G(() => { const s = window.__lecraft.session, a = window.__a, w = s.world; w.setBlock(a.x - 4, a.y - 1, a.z - 4, I('farmland'), 1); w.setBlock(a.x - 4, a.y, a.z - 4, I('wheat'), 0); });
  await useOn('bone_meal', -4, 0, -4);
  const crop = await at(-4, 0, -4);
  check('Poudre d’os : fait pousser le blé', crop.meta >= 2, `stade ${crop.meta}`);

  // ---------- cisailles ----------
  const sheared = await G(() => {
    const s = window.__lecraft.session, p = s.player;
    const sheep = s.entities.spawnMob('sheep', p.x + 2, p.y, p.z);
    s.interaction.targetMob = sheep;
    p.inventory.slots[0] = { id: 'shears', count: 1, durability: 238 }; p.inventory.selected = 0;
    s.interaction['useSpecial']('shear', 'shears');
    return { sheared: sheep.sheared, wool: s.entities.entities.filter((e) => e.kind === 'item' && String(e.itemId).endsWith('_wool')).length };
  });
  check('Cisailles : tondre un mouton (laine)', sheared.sheared && sheared.wool > 0, JSON.stringify(sheared));

  // ---------- échelle ----------
  await G(() => {
    const s = window.__lecraft.session, a = window.__a, w = s.world;
    for (let y = 0; y < 6; y++) { w.setBlock(a.x + 6, a.y + y, a.z - 6, I('stone')); w.setBlock(a.x + 6, a.y + y, a.z - 5, I('ladder'), 2); }
    const p = s.player; p.body.setPos(a.x + 6.5, a.y, a.z - 4.5); p.yaw = 0; p.pitch = 0;
  });
  await wait(300);
  const y0 = await G(() => window.__lecraft.session.player.y);
  await G(() => { window.__lecraft.input.jump = true; });
  await wait(1500);
  await G(() => { window.__lecraft.input.jump = false; });
  const y1 = await G(() => window.__lecraft.session.player.y);
  check('Échelle : on grimpe en maintenant saut', y1 > y0 + 2, `${y0.toFixed(2)} → ${y1.toFixed(2)}`);
  await G(() => { const s = window.__lecraft.session, a = window.__a; s.player.body.setPos(a.x + 0.5, a.y, a.z + 0.5); s.player.body.vy = 0; });
  await wait(600);

  // ---------- TNT ----------
  await G(() => { const s = window.__lecraft.session, a = window.__a; s.world.setBlock(a.x, a.y, a.z + 6, I('tnt')); s.player.body.setPos(a.x + 0.5, a.y, a.z - 5.5); s.player.gameMode = 'creative'; });
  await useOn('flint_and_steel', 0, 0, 6, [0, 0, -1]);
  const primed = await G(() => ({ count: window.__lecraft.session.explosions.count, block: window.__lecraft.session.world.getBlock(window.__a.x, window.__a.y, window.__a.z + 6) }));
  check('Briquet : la TNT s’amorce', primed.count === 1 && primed.block === 0, JSON.stringify(primed));
  await page.screenshot({ path: `${OUT}/vanilla-01-tnt.png` });
  await wait(4800);
  const crater = await G(() => { const s = window.__lecraft.session, a = window.__a; let air = 0; for (let dx = -1; dx <= 1; dx++) for (let dz = 5; dz <= 7; dz++) if (s.world.getBlock(a.x + dx, a.y - 1, a.z + dz) !== I('stone')) air++; return { air, left: s.explosions.count }; });
  check('Explosion : cratère dans le sol', crater.air >= 5 && crater.left === 0, JSON.stringify(crater));
  await page.screenshot({ path: `${OUT}/vanilla-02-crater.png` });

  // ---------- sable qui tombe (animation) ----------
  await G(() => { const s = window.__lecraft.session, a = window.__a, w = s.world; s.player.gameMode = 'survival'; w.setBlock(a.x - 6, a.y + 5, a.z + 6, I('sand')); });
  await wait(200);
  const fallingNow = await G(() => window.__lecraft.session.falling.count);
  await wait(1500);
  const landed = await at(-6, 0, 6);
  check('Sable : chute animée puis repos au sol', fallingNow === 1 && landed.id === (await ID('sand')), `en chute ${fallingNow}, posé ${landed.id}`);

  // ---------- décomposition des feuilles ----------
  await G(() => {
    const s = window.__lecraft.session, a = window.__a, w = s.world;
    for (let y = 0; y < 4; y++) w.setBlock(a.x + 6, a.y + y, a.z + 6, I('oak_log'));
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) w.setBlock(a.x + 6 + dx, a.y + 3, a.z + 6 + dz, I('oak_leaves'), 0);
    w.setBlock(a.x + 6, a.y + 4, a.z + 6, I('oak_leaves'), 0);
    w.setBlock(a.x + 5, a.y + 4, a.z + 6, I('oak_leaves'), 1); // posée par le joueur : persistante
  });
  await wait(300);
  await G(() => { const s = window.__lecraft.session, a = window.__a; for (let y = 0; y < 4; y++) s.world.setBlock(a.x + 6, a.y + y, a.z + 6, 0); });
  let leaves = 99;
  for (let i = 0; i < 40 && leaves > 1; i++) {
    await wait(500);
    leaves = await G(() => { const s = window.__lecraft.session, a = window.__a; let n = 0; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 3; dy <= 4; dy++) if (String(s.world.getBlock(a.x + 6 + dx, a.y + dy, a.z + 6 + dz)) === String(I('oak_leaves'))) n++; return n; });
  }
  check('Feuilles sans tronc : décomposition (sauf celles posées par le joueur)', leaves === 1, `feuilles restantes : ${leaves}`);

  // ---------- flèches récupérables ----------
  const arrowBack = await G(() => {
    const s = window.__lecraft.session, p = s.player, a = window.__a;
    p.inventory.clear();
    const pr = s.entities.spawnProjectile('player_arrow', a.x + 0.5, a.y + 1.5, a.z - 1.5, 0, -10, 0, 2, true);
    pr.pickable = true;
    p.body.setPos(a.x + 0.5, a.y, a.z + 2.5);
    return true;
  });
  await wait(800);
  await G(() => { const s = window.__lecraft.session, a = window.__a; s.player.body.setPos(a.x + 0.5, a.y, a.z - 1.3); });
  await wait(800);
  const arrows = await G(() => window.__lecraft.session.player.inventory.count('arrow'));
  check('Flèche plantée : ramassée en marchant dessus', arrowBack && arrows === 1, `flèches : ${arrows}`);

  // ---------- glisser pour répartir ----------
  await G(() => { const g = window.__lecraft, inv = g.session.player.inventory; inv.clear(); inv.slots[9] = { id: 'cobblestone', count: 30 }; inv.changed(); g.openInventory('hand'); });
  await wait(300);
  const box = async (n) => { const b = await page.locator('.gui .gslot').nth(n).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const cdp = await page.context().newCDPSession(page);
  const touchAt = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const [sx, sy] = await box(9);
  await touchAt('touchStart', sx, sy); await touchAt('touchEnd'); await wait(450);
  const pts = [await box(10), await box(11), await box(12)];
  await touchAt('touchStart', ...pts[0]);
  for (const [x, y] of pts) { await touchAt('touchMove', x, y); await wait(60); }
  await touchAt('touchEnd'); await wait(200);
  const spread = await G(() => window.__lecraft.session.player.inventory.slots.slice(10, 13).map((s) => s?.count ?? 0));
  check('Glisser sur 3 cases : le stack est réparti (10/10/10)', spread.join(',') === '10,10,10', spread.join(','));
  await page.keyboard.press('Escape');
  await wait(200);

  // ---------- charnière des portes (double porte) ----------
  await G(() => { window.__lecraft.session.player.yaw = 0; });
  await useOn('oak_door', -6, -1, 3);
  await useOn('oak_door', -5, -1, 3);
  const dl = await at(-6, 0, 3), dr = await at(-5, 0, 3);
  check('Double porte : la seconde a la charnière opposée', ((dl.meta & 16) === 0) !== ((dr.meta & 16) === 0), `${dl.meta} / ${dr.meta}`);

  // ---------- creeper : mèche, explosion, cratère, dégâts ----------
  const cr = await G(() => {
    const s = window.__lecraft.session, a = window.__a, p = s.player;
    p.gameMode = 'survival'; p.health = 20;
    s.player.body.setPos(a.x + 10.5, a.y, a.z + 0.5);
    p.yaw = 0; p.pitch = 0;
    s.runCommand('/gamerule doMobSpawning false');
    for (const o of s.entities.mobs) if (o.def.key === 'creeper') o.removed = true;
    const m = s.entities.spawnMob('creeper', a.x + 10.5, a.y, a.z - 1.5, { persistent: true });
    window.__cr = m;
    return { ok: !!m, model: !!m?.model?.vanilla };
  });
  check('Creeper : apparition (modèle vanilla)', cr.ok && cr.model, JSON.stringify(cr));
  await wait(700);
  const lit = await G(() => window.__cr?.fuse ?? -1);
  await page.screenshot({ path: `${OUT}/vanilla-03-creeper.png` });
  await wait(2200);
  const boom = await G(() => {
    const s = window.__lecraft.session, a = window.__a;
    let air = 0;
    for (let dx = 9; dx <= 11; dx++) for (let dz = -3; dz <= 0; dz++) if (s.world.getBlock(a.x + dx, a.y - 1, a.z + dz) === 0) air++;
    return { gone: window.__cr.dead || window.__cr.removed, health: s.player.health, air };
  });
  check('Creeper : la mèche s’allume près du joueur', lit > 0, `mèche ${lit.toFixed?.(2) ?? lit} s`);
  check('Creeper : explosion (disparaît, blesse le joueur, cratère)', boom.gone && boom.health < 20 && boom.air >= 3, JSON.stringify(boom));
  await G(() => { const p = window.__lecraft.session.player; p.health = 20; p.gameMode = 'creative'; });

  // ---------- pack de ressources ----------
  const magenta = Buffer.from([255, 0, 255, 255]);
  const cyan = Buffer.from([0, 255, 255, 255]);
  const zipPath = join(tmpdir(), 'pack-test.zip');
  writeFileSync(zipPath, zip([
    ['pack.mcmeta', Buffer.from('{"pack":{"pack_format":34,"description":"test"}}')],
    ['assets/minecraft/textures/block/stone.png', png(16, 16, magenta)],
    ['assets/minecraft/textures/entity/pig/pig.png', png(64, 32, cyan)],
    ['assets/minecraft/textures/item/diamond.png', png(16, 16, cyan)],
  ]));
  await page.keyboard.press('Escape');
  await wait(300);
  await page.getByText('Options...').click();
  await page.getByText('Packs de ressources...').click();
  await wait(200);
  await page.locator('.mc-screen').last().locator('input[type=file]').setInputFiles(zipPath);
  await page.waitForFunction(() => /importées depuis/.test(document.body.innerText), null, { timeout: 20000 });
  const px = await G(() => {
    const g = window.__lecraft, t = g.textures;
    const c = t.tileByName('stone').getContext('2d').getImageData(4, 4, 1, 1).data;
    const pig = t.skin('pig').image.getContext('2d').getImageData(10, 10, 1, 1).data;
    return { stone: [...c], pig: [...pig], name: t.packName };
  });
  check('Pack de ressources : texture de bloc remplacée', px.stone[0] === 255 && px.stone[1] === 0 && px.stone[2] === 255, JSON.stringify(px.stone));
  check('Pack de ressources : skin de créature remplacée', px.pig[0] === 0 && px.pig[1] === 255, JSON.stringify(px.pig));
  await page.screenshot({ path: `${OUT}/vanilla-03-pack.png` });
  await page.reload();
  await page.waitForFunction(() => window.__lecraft?.state === 'menu');
  const persisted = await G(() => window.__lecraft.textures.packName);
  check('Pack conservé après redémarrage (stockage local)', persisted === 'pack-test.zip', persisted);
  await page.getByText('Options...').click();
  await page.getByText('Packs de ressources...').click();
  await page.getByText('Retirer le pack').click();
  await wait(500);
  const cleared = await G(() => ({ name: window.__lecraft.textures.packName, px: [...window.__lecraft.textures.tileByName('stone').getContext('2d').getImageData(4, 4, 1, 1).data] }));
  check('Retirer le pack rétablit les textures du jeu', cleared.name === null && !(cleared.px[0] === 255 && cleared.px[1] === 0), JSON.stringify(cleared));
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
check('Aucune erreur console', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
