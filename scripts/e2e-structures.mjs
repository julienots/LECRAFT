// E2E structures du jeu de référence : pyramide du désert, temple de la jungle, igloo, cabane de
// sorcière, avant-poste de pillards, épave, ruines sous-marines, portail en ruine, ruines de piste.
// Pour chacune : /locate, téléportation, chargement des chunks, blocs caractéristiques présents,
// coffres remplis à l'ouverture (butin), puis captures d'écran (vue extérieure + intérieur).
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'screenshots';
const SEED = process.env.SEED ?? '12345';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
let failed = 0, total = 0;
const check = (n, ok, d = '') => { total++; if (!ok) failed++; console.log(`${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 915, height: 412 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const G = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);

/**
 * key : clé du générateur ; locate : nom accepté par /locate ; r : demi-côté du scan ;
 * need : blocs attendus (nombre minimal) ; chests : coffres attendus (minimum) ;
 * inside : bloc repère pour la vue intérieure (caméra placée à côté).
 */
const STRUCTS = [
  { key: 'desert_pyramid', locate: 'desert_pyramid', r: 13, need: { sandstone: 300, orange_terracotta: 10, blue_terracotta: 1, tnt: 9, stone_pressure_plate: 1, chiseled_sandstone: 4 }, chests: 4, inside: 'stone_pressure_plate' },
  { key: 'jungle_temple', locate: 'jungle_temple', r: 11, need: { mossy_cobblestone: 60, cobblestone: 60, dispenser: 2, tripwire: 1, lever: 3, chiseled_stone_bricks: 5 }, chests: 2, inside: 'tripwire', clearLeaves: true },
  { key: 'igloo', locate: 'igloo', r: 12, need: { snow_block: 40, red_bed: 2, furnace: 1, crafting_table: 1, white_carpet: 5 }, chests: 0, inside: 'furnace', insideR: 2 },
  { key: 'witch_hut', locate: 'swamp_hut', r: 8, need: { spruce_planks: 40, oak_log: 10, cauldron: 1, flower_pot: 1, crafting_table: 1 }, chests: 0, inside: 'cauldron', clearLeaves: true },
  { key: 'pillager_outpost', locate: 'pillager_outpost', r: 16, need: { dark_oak_log: 40, dark_oak_planks: 60, spawner: 1, ladder: 10 }, chests: 1, inside: 'chest' },
  { key: 'shipwreck', locate: 'shipwreck', r: 14, need: { chest: 1 }, chests: 1, under: true, inside: 'chest' },
  { key: 'ocean_ruins', locate: 'ocean_ruin', r: 22, need: { chest: 1 }, chests: 1, under: true },
  { key: 'ruined_portal', locate: 'ruined_portal', r: 8, need: { obsidian: 4, netherrack: 8 }, chests: 1, inside: 'chest', clearLeaves: true },
  { key: 'trail_ruins', locate: 'trail_ruins', r: 15, need: { mud_bricks: 10 }, chests: 0, clearLeaves: true },
];

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'MEDIUM', renderDistance: 3, autoQuality: false })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu', null, { timeout: 120000 });
  await G((s) => window.__lecraft.createWorld('Structures', s, 'creative', 'peaceful'), SEED);
  await page.waitForFunction(() => window.__lecraft?.state === 'playing' && window.__lecraft.session?.loaded, null, { timeout: 120000 });

  for (const st of STRUCTS) {
    if (ONLY && !ONLY.includes(st.key)) continue;
    // /locate (commande) puis position exacte via le générateur
    await G(() => { window.__lecraft.session.player.body.setPos(0.5, 100, 0.5); });
    const loc = await G(async (st) => {
      const s = window.__lecraft.session, chat = s.game.chat, out = [];
      const add = chat.add;
      chat.add = (t, k) => { out.push(t); return add.call(chat, t, k); };
      s.runCommand(`/locate structure ${st.locate}`);
      const r = await s.chunks.locate(st.key, s.player.x, s.player.z);
      await new Promise((ok) => setTimeout(ok, 300));
      chat.add = add;
      return { ...r, cmd: out.join(' ') };
    }, st);
    check(`${st.key} : /locate structure ${st.locate}`, loc.found && loc.cmd.includes(`${loc.x}`), `${loc.cmd}`);
    if (!loc.found) continue;
    // téléportation et chargement de la zone
    await G((l) => { const p = window.__lecraft.session.player; p.body.flying = true; p.body.setPos(l.x + 0.5, 110, l.z + 0.5); p.body.vx = p.body.vz = p.body.vy = 0; }, loc);
    await page.waitForFunction(([l, r]) => {
      const s = window.__lecraft.session, w = s.world;
      return [[-r, -r], [r, -r], [-r, r], [r, r], [0, 0]].every(([dx, dz]) => w.isLoaded(l.x + dx, l.z + dz));
    }, [loc, st.r], { timeout: 90000 }).catch(() => {});
    await wait(1500);
    // inventaire des blocs de la zone
    const scan = await G(([l, st]) => {
      const s = window.__lecraft.session, w = s.world, R = window.__lecraft.debug.registries.blocks;
      const want = Object.keys(st.need), ids = Object.fromEntries(want.map((k) => [R.has(k) ? R.byName(k).id : -2, k]));
      const counts = Object.fromEntries(want.map((k) => [k, 0]));
      const chests = [], marks = [];
      const chestId = R.byName('chest').id, insideId = st.inside && R.has(st.inside) ? R.byName(st.inside).id : -3;
      for (let y = 1; y < 127; y++)
        for (let z = l.z - st.r; z <= l.z + st.r; z++)
          for (let x = l.x - st.r; x <= l.x + st.r; x++) {
            const b = w.getBlock(x, y, z);
            if (b <= 0) continue;
            if (ids[b]) counts[ids[b]]++;
            if (b === chestId && w.getMeta(x, y, z) >> 2 >= 40) chests.push({ x, y, z, table: w.getMeta(x, y, z) >> 2 });
            if (b === insideId) marks.push({ x, y, z });
          }
      // ouverture des coffres : butin généré
      for (const c of chests) {
        s.interaction.ensureChestLoot(c.x, c.y, c.z);
        c.items = (w.getChest(c.x, c.y, c.z, false)?.slots ?? []).filter(Boolean).map((i) => `${i.id}×${i.count}`);
      }
      // sommet de la structure (pour la caméra)
      let top = 0;
      for (let z = l.z - 3; z <= l.z + 3; z++) for (let x = l.x - 3; x <= l.x + 3; x++) for (let y = 126; y > top; y--) if (w.getBlock(x, y, z) > 0 && !/water|leaves$/.test(R.get(w.getBlock(x, y, z)).key)) { top = y; break; }
      return { counts, chests, marks, top, surface: w.heightAt(l.x, l.z) };
    }, [loc, st]);
    const missing = Object.entries(st.need).filter(([k, n]) => scan.counts[k] < n);
    check(`${st.key} : blocs caractéristiques`, missing.length === 0, JSON.stringify(scan.counts));
    if (st.chests) {
      const filled = scan.chests.filter((c) => c.items.length > 0);
      check(`${st.key} : ${scan.chests.length} coffre(s) de butin remplis`, scan.chests.length >= st.chests && filled.length === scan.chests.length, scan.chests.map((c) => `[t${c.table}] ${c.items.slice(0, 4).join(', ')}`).join(' | '));
    }
    // vue extérieure : de biais au-dessus ; sous l'eau, caméra près du fond. Le feuillage qui
    // masque la structure (jungle, marais) est retiré pour la capture.
    const R = st.r + 8;
    await G(([l, R, top, st]) => {
      const s = window.__lecraft.session, p = s.player, w = s.world, Rg = window.__lecraft.debug.registries.blocks;
      if (st.clearLeaves)
        for (let y = 40; y < 127; y++)
          for (let z = l.z - R; z <= l.z + R; z++)
            for (let x = l.x - R; x <= l.x + R; x++) {
              const b = w.getBlock(x, y, z);
              if (b > 0 && /leaves$|^vine$/.test(Rg.get(b).key)) w.setBlock(x, y, z, 0, 0, false);
            }
      // structures immergées : l'eau est retirée autour (sans écoulement) pour voir la forme
      // (l'éclairage n'est pas recalculé : vision nocturne)
      if (st.under) s.runCommand('/effect @s night_vision 999 0 true');
      if (st.under)
        for (let y = 20; y <= 60; y++)
          for (let z = l.z - R; z <= l.z + R; z++)
            for (let x = l.x - R; x <= l.x + R; x++) {
              const b = w.getBlock(x, y, z);
              if (b > 0 && Rg.get(b).key === 'water') w.setBlock(x, y, z, 0, 0, false);
            }
      let ex, ey, ez, ty;
      {
        ex = l.x + R * 0.8; ez = l.z + R * 0.9; ey = Math.max(top, 50) + R * 0.6; ty = top - 4;
      }
      const dx = l.x - ex, dz = l.z - ez, dy = ty - ey;
      p.body.flying = true; p.body.setPos(ex, ey, ez); p.body.vx = p.body.vy = p.body.vz = 0;
      p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      s.dayCycle.time = 0.3;
    }, [loc, R, scan.top, st]);
    await wait(3500);
    await page.screenshot({ path: `${OUT}/struct-${st.key}.png` });
    // vue intérieure (vision nocturne : les salles secrètes ne sont pas éclairées)
    if (scan.marks.length) {
      const m = scan.marks[0];
      await G(([m, IR]) => {
        const s = window.__lecraft.session, p = s.player, w = s.world, Rg = window.__lecraft.debug.registries.blocks;
        s.runCommand('/effect @s night_vision 999 0 true');
        const free = (x, y, z) => { const b = w.getBlock(x, y, z); return b === 0 || !Rg.solid[b]; };
        // case libre la plus éloignée (≤ 4 blocs) d'où le repère est visible (même salle)
        let best = null;
        for (let dz = -IR; dz <= IR; dz++)
          for (let dx = -IR; dx <= IR; dx++) {
            const d = dx * dx + dz * dz;
            if (best && d <= best.d) continue;
            if (!free(m.x + dx, m.y, m.z + dz) || !free(m.x + dx, m.y + 1, m.z + dz)) continue;
            // sous un toit (même pièce que le repère)
            let roof = false;
            for (let k = 2; k <= 5 && !roof; k++) roof = !free(m.x + dx, m.y + k, m.z + dz);
            if (!roof) continue;
            let ok = true;
            for (let k = 1; k < 8 && ok; k++) ok = free(Math.floor(m.x + 0.5 + (dx * k) / 8), m.y + 1, Math.floor(m.z + 0.5 + (dz * k) / 8));
            if (ok) best = { dx, dz, d };
          }
        const ex = m.x + 0.5 + (best?.dx ?? 0), ez = m.z + 0.5 + (best?.dz ?? 0), ey = m.y + 0.1;
        p.body.flying = true; p.body.setPos(ex, ey, ez); p.body.vx = p.body.vy = p.body.vz = 0;
        const dx = m.x + 0.5 - ex, dz = m.z + 0.5 - ez;
        p.yaw = dx || dz ? Math.atan2(-dx, -dz) : 0; p.pitch = -0.3;
      }, [m, st.insideR ?? 4]);
      await wait(2000);
      await page.screenshot({ path: `${OUT}/struct-${st.key}-inside.png` });
    }
    await G(() => window.__lecraft.session.runCommand('/effect @s clear'));
  }
  check('Aucune erreur JavaScript', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('Exception', false, e.stack ?? String(e));
}
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
