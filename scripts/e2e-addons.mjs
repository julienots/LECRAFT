// Add-ons Bedrock (.mcaddon) et commandes : un add-on de test est généré (packs .mcpack imbriqués,
// JSON avec commentaires, géométrie, textures, langue, recettes, butin, apparition, fonctions),
// importé par l'interface puis vérifié en jeu. Contrôles tactiles « croix ».
// Usage : npm run build && npx vite preview & node scripts/e2e-addons.mjs
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

// ---------- PNG + ZIP ----------
function png(w, h, fn) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) Buffer.from(fn(x, y)).copy(raw, y * (w * 4 + 1) + 1 + x * 4);
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
  for (const [name, d] of files) {
    const data = Buffer.isBuffer(d) ? d : Buffer.from(typeof d === 'string' ? d : JSON.stringify(d, null, 1));
    const n = Buffer.from(name);
    const comp = deflateSync(data);
    const raw = comp.subarray(2, comp.length - 4);
    const crc = crc32(data) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(raw.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, raw);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(raw.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(ch, n);
    off += 30 + n.length + raw.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const solid = (r, g, b) => () => [r, g, b, 255];

// ---------- add-on de test ----------
const bp = zip([
  ['manifest.json', { format_version: 2, header: { name: '§cRubis BP', description: 'Add-on de test', uuid: '11111111-1111-1111-1111-111111111111', version: [1, 0, 0] }, modules: [{ type: 'data', uuid: '22222222-2222-2222-2222-222222222222', version: [1, 0, 0] }, { type: 'script', language: 'javascript', entry: 'scripts/main.js', uuid: '33333333-3333-3333-3333-333333333333', version: [1, 0, 0] }] }],
  ['scripts/main.js', `import { world, system, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { helper } from "./lib/util";
system.beforeEvents.startup.subscribe(({ blockComponentRegistry, itemComponentRegistry }) => {
  blockComponentRegistry.registerCustomComponent("test:toggle", {
    onPlayerInteract(e) { const p = e.block.permutation; e.block.setPermutation(p.withState("test:lit", !p.getState("test:lit"))); },
  });
  itemComponentRegistry.registerCustomComponent("test:wand", {
    onUse(e, { params }) {
      new ActionFormData().title("§6Baguette").body(params.msg).button("A").button("B").show(e.source).then((r) => world.setDynamicProperty("choice", r.canceled ? -1 : r.selection));
    },
  });
});
world.afterEvents.playerBreakBlock.subscribe((e) => world.setDynamicProperty("broken", e.brokenBlockPermutation.type.id));
system.runInterval(() => world.setDynamicProperty("ticks", (world.getDynamicProperty("ticks") ?? 0) + 1), 1);
world.beforeEvents.chatSend.subscribe((e) => { if (e.message === "secret") { e.cancel = true; system.run(() => world.sendMessage("§aSecret intercepté")); } });
system.afterEvents.scriptEventReceive.subscribe((e) => { if (e.id === "test:ping") e.sourceEntity?.runCommand("give @s test:ruby " + helper(2)); });
world.afterEvents.entityHurt.subscribe((e) => { if (e.hurtEntity.typeId === "test:ruby_golem") e.hurtEntity.addTag("hurt"); });
world.afterEvents.playerSpawn.subscribe((e) => { if (e.initialSpawn) e.player.sendMessage("§bScript prêt " + new ItemStack("test:ruby", 2).amount); });
`],
  ['scripts/lib/util.js', 'export const helper = (n) => n * 2;'],
  ['blocks/ruby_lamp.json', { format_version: '1.21.40', 'minecraft:block': { description: { identifier: 'test:ruby_lamp', states: { 'test:lit': [false, true] } }, components: { 'test:toggle': {}, 'minecraft:material_instances': { '*': { texture: 'test_ruby_block', render_method: 'opaque' } } }, permutations: [{ condition: "q.block_state('test:lit')", components: { 'minecraft:light_emission': 15 } }] } }],
  ['items/ruby_wand.json', { format_version: '1.21.40', 'minecraft:item': { description: { identifier: 'test:ruby_wand' }, components: { 'minecraft:icon': 'test_ruby', 'minecraft:max_stack_size': 1, 'test:wand': { msg: 'Choisissez' } } } }],
  ['items/ruby.json', `{
    // commentaire : JSON tolérant
    "format_version": "1.20.50",
    "minecraft:item": { "description": { "identifier": "test:ruby", "menu_category": { "category": "items" } },
      "components": { "minecraft:icon": "test_ruby", "minecraft:display_name": { "value": "item.test:ruby.name" }, "minecraft:max_stack_size": 64, } }
  }`],
  ['items/ruby_apple.json', { format_version: '1.20.50', 'minecraft:item': { description: { identifier: 'test:ruby_apple' }, components: { 'minecraft:icon': 'test_ruby', 'minecraft:food': { nutrition: 6, saturation_modifier: 'good' }, 'minecraft:use_animation': 'eat' } } }],
  ['items/ruby_sword.json', { format_version: '1.20.50', 'minecraft:item': { description: { identifier: 'test:ruby_sword', menu_category: { category: 'equipment' } }, components: { 'minecraft:icon': 'test_ruby', 'minecraft:damage': 9, 'minecraft:durability': { max_durability: 500 }, 'minecraft:hand_equipped': true, 'minecraft:tags': { tags: ['minecraft:is_sword'] } } } }],
  ['blocks/ruby_block.json', `{ "format_version": "1.20.50", /* bloc lumineux */
    "minecraft:block": { "description": { "identifier": "test:ruby_block" },
      "components": { "minecraft:destructible_by_mining": { "seconds_to_destroy": 3 }, "minecraft:light_emission": 10,
        "minecraft:material_instances": { "*": { "texture": "test_ruby_block", "render_method": "opaque" } },
        "minecraft:loot": "loot_tables/blocks/ruby_block.json" } } }`],
  ['loot_tables/blocks/ruby_block.json', { pools: [{ rolls: 1, entries: [{ type: 'item', name: 'test:ruby', weight: 1, functions: [{ function: 'set_count', count: { min: 2, max: 2 } }] }] }] }],
  ['loot_tables/entities/ruby_golem.json', { pools: [{ rolls: 1, entries: [{ type: 'item', name: 'test:ruby', weight: 1, functions: [{ function: 'set_count', count: { min: 1, max: 3 } }] }] }] }],
  ['recipes/ruby_block.json', { format_version: '1.20.10', 'minecraft:recipe_shaped': { description: { identifier: 'test:ruby_block' }, tags: ['crafting_table'], pattern: ['###', '###', '###'], key: { '#': { item: 'test:ruby' } }, result: { item: 'test:ruby_block' } } }],
  ['recipes/ruby_from_block.json', { format_version: '1.20.10', 'minecraft:recipe_shapeless': { description: { identifier: 'test:ruby_from_block' }, tags: ['crafting_table'], ingredients: [{ item: 'test:ruby_block' }], result: { item: 'test:ruby', count: 9 } } }],
  ['recipes/ruby_sword.json', { format_version: '1.20.10', 'minecraft:recipe_shaped': { description: { identifier: 'test:ruby_sword' }, tags: ['crafting_table'], pattern: ['R', 'R', 'S'], key: { R: 'test:ruby', S: 'minecraft:stick' }, result: 'test:ruby_sword' } }],
  ['recipes/ruby_smelt.json', { format_version: '1.20.10', 'minecraft:recipe_furnace': { description: { identifier: 'test:ruby_smelt' }, tags: ['furnace'], input: 'minecraft:flint', output: 'test:ruby' } }],
  ['entities/ruby_golem.json', { format_version: '1.20.50', 'minecraft:entity': { description: { identifier: 'test:ruby_golem', is_spawnable: true, is_summonable: true },
    components: { 'minecraft:health': { value: 30, max: 30 }, 'minecraft:movement': { value: 0.25 }, 'minecraft:attack': { damage: 4 }, 'minecraft:collision_box': { width: 0.8, height: 1.6 }, 'minecraft:type_family': { family: ['monster', 'ruby'] }, 'minecraft:behavior.nearest_attackable_target': { entity_types: [{ filters: { test: 'is_family', subject: 'other', value: 'player' } }] }, 'minecraft:loot': { table: 'loot_tables/entities/ruby_golem.json' } } } }],
  ['spawn_rules/ruby_golem.json', { format_version: '1.8.0', 'minecraft:spawn_rules': { description: { identifier: 'test:ruby_golem', population_control: 'monster' }, conditions: [{ 'minecraft:spawns_on_surface': {}, 'minecraft:brightness_filter': { min: 0, max: 7 }, 'minecraft:weight': { default: 50 }, 'minecraft:herd': { min_size: 1, max_size: 1 }, 'minecraft:biome_filter': { test: 'has_biome_tag', value: 'monster' } }] } }],
  ['functions/hello.mcfunction', '# fonction de test\nsay Bonjour depuis l\'add-on\ngive @s test:ruby 3\n'],
  ['functions/tickfn.mcfunction', 'gamerule showCoordinates true\n'],
  ['functions/tick.json', { values: ['tickfn'] }],
]);
const rp = zip([
  ['manifest.json', { format_version: 2, header: { name: 'Rubis RP', uuid: '44444444-4444-4444-4444-444444444444', version: [1, 0, 0] }, modules: [{ type: 'resources', uuid: '55555555-5555-5555-5555-555555555555', version: [1, 0, 0] }] }],
  ['textures/terrain_texture.json', { resource_pack_name: 'rubis', texture_data: { test_ruby_block: { textures: 'textures/blocks/ruby_block' } } }],
  ['textures/item_texture.json', { resource_pack_name: 'rubis', texture_data: { test_ruby: { textures: 'textures/items/ruby' } } }],
  ['textures/blocks/ruby_block.png', png(16, 16, (x, y) => ((x + y) % 4 ? [200, 20, 40, 255] : [255, 120, 140, 255]))],
  ['textures/items/ruby.png', png(16, 16, (x, y) => (Math.abs(x - 8) + Math.abs(y - 8) < 6 ? [230, 30, 60, 255] : [0, 0, 0, 0]))],
  ['textures/blocks/dirt.png', png(16, 16, solid(30, 60, 220))],
  ['textures/entity/ruby_golem.png', png(64, 64, (x, y) => (y < 16 ? [180, 30, 50, 255] : [120, 20, 40, 255]))],
  ['texts/fr_FR.lang', 'item.test:ruby.name=Rubis\ntile.test:ruby_block.name=Bloc de rubis\nentity.test:ruby_golem.name=Golem de rubis\n'],
  ['entity/ruby_golem.entity.json', { format_version: '1.10.0', 'minecraft:client_entity': { description: { identifier: 'test:ruby_golem', textures: { default: 'textures/entity/ruby_golem' }, geometry: { default: 'geometry.ruby_golem' }, render_controllers: ['controller.render.default'] } } }],
  ['models/entity/ruby_golem.geo.json', { format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier: 'geometry.ruby_golem', texture_width: 64, texture_height: 64 }, bones: [
    { name: 'body', pivot: [0, 12, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }] },
    { name: 'head', parent: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }] },
    { name: 'rightArm', parent: 'body', pivot: [-5, 22, 0], cubes: [{ origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16] }] },
    { name: 'leftArm', parent: 'body', pivot: [5, 22, 0], cubes: [{ origin: [4, 12, -2], size: [4, 12, 4], uv: [40, 16], mirror: true }] },
    { name: 'rightLeg', pivot: [-2, 12, 0], cubes: [{ origin: [-4, 0, -2], size: [4, 12, 4], uv: [0, 16] }] },
    { name: 'leftLeg', pivot: [2, 12, 0], cubes: [{ origin: [0, 0, -2], size: [4, 12, 4], uv: [0, 16], mirror: true }] },
  ] }] }],
]);
const addonPath = join(tmpdir(), 'rubis-test.mcaddon');
writeFileSync(addonPath, zip([['Rubis_BP.mcpack', bp], ['Rubis_RP.mcpack', rp]]));

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const G = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const cmd = (line) => G((l) => window.__lecraft.session.runCommand(l), line);
const chatLast = () => G(() => [...document.querySelectorAll('.chat-feed .chat-line')].map((e) => e.textContent).slice(-3).join(' | '));

try {
  await page.addInitScript(() => localStorage.setItem('lecraft.settings.v1', JSON.stringify({ quality: 'LOW', renderDistance: 2, autoQuality: false })));
  await page.goto(URL);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu');
  // ---------- import par l'interface ----------
  await page.getByText('Options...').click();
  await page.getByText('Add-ons (.mcaddon)...').click();
  await wait(200);
  await page.locator('.mc-screen').last().locator('input[type=file]').setInputFiles(addonPath);
  await page.waitForFunction(() => /importé/.test(document.body.innerText), null, { timeout: 20000 });
  check('Import d’un .mcaddon (packs .mcpack imbriqués)', (await page.locator('.world-entry', { hasText: 'Rubis BP' }).count()) === 1);
  await page.screenshot({ path: `${OUT}/addons-01-screen.png` });
  await Promise.all([page.waitForEvent('load'), page.getByText('Redémarrer pour appliquer').click()]);
  await page.waitForFunction(() => window.__lecraft?.state === 'menu' && window.__lecraft.addonResult, null, { timeout: 30000 });
  const res = await G(() => { const r = window.__lecraft.addonResult; return { ...r, scripts: r.scripts.map((x) => ({ entry: x.entry, files: x.files.size, modules: x.modules })) }; });
  check('Contenu chargé au démarrage', res.counts.blocks === 2 && res.counts.items >= 4 && res.counts.recipes === 4 && res.counts.mobs === 1 && res.counts.functions === 2 && res.counts.textures >= 1, JSON.stringify(res.counts));
  check('Script du pack détecté (point d’entrée, fichiers, version du module)', res.scripts?.length === 1 && res.scripts[0].files === 2 && !res.report.some((r) => /JavaScript/.test(r)), JSON.stringify(res.scripts?.map((x) => [x.entry, x.files.size, x.modules])));

  // ---------- en jeu ----------
  await G(() => window.__lecraft.createWorld('Add-ons', '99', 'survival', 'normal'));
  await page.waitForFunction(() => window.__lecraft?.state === 'playing', null, { timeout: 120000 });
  await wait(1200);
  // ---------- API de script ----------
  await wait(400);
  const sc = await G(() => { const h = window.__lecraft.session.scripts; return { log: h?.log ?? ['pas d’hôte'], ticks: window.__lecraft.session.worldProps.get('ticks') }; });
  check('Script exécuté sans erreur (imports relatifs sans extension, @minecraft/server-ui)', sc.log.length === 0 && sc.ticks > 3, JSON.stringify(sc));
  check('Événement playerSpawn + sendMessage + ItemStack', (await G(() => [...document.querySelectorAll('.chat-line')].some((l) => /Script prêt 2/.test(l.textContent)))));
  // composant de bloc personnalisé
  const lamp = await G(() => {
    const s = window.__lecraft.session, p = s.player, w = s.world;
    const id = window.__lecraft.debug.blockId('test:ruby_lamp');
    const x = Math.floor(p.x) + 2, y = Math.floor(p.y) + 1, z = Math.floor(p.z);
    w.setBlock(x - 1, y, z, 0, 0);
    w.setBlock(x - 1, y - 1, z, 0, 0);
    w.setBlock(x, y, z, id, 0);
    const ex = p.x, ey = p.y + p.eyeHeight, ez = p.z;
    p.yaw = Math.atan2(-(x + 0.5 - ex), -(z + 0.5 - ez));
    p.pitch = Math.atan2(y + 0.5 - ey, Math.hypot(x + 0.5 - ex, z + 0.5 - ez));
    s.interaction.update(0, []);
    const t = s.interaction.target;
    s.interaction.use();
    return { meta: w.getMeta(x, y, z), id: w.getBlock(x, y, z) === id, target: t && [t.x - x, t.y - y, t.z - z, t.block], mob: !!s.interaction.targetMob };
  });
  check('Composant de bloc personnalisé (onPlayerInteract → setPermutation)', lamp.id && lamp.meta === 1, JSON.stringify(lamp));
  // composant d'objet personnalisé + formulaire
  await G(() => { const s = window.__lecraft.session, inv = s.player.inventory; inv.slots[3] = { id: 'test:ruby_wand', count: 1 }; inv.selected = 3; inv.changed(); s.player.pitch = 1.4; s.interaction.update(0, []); s.player.pitch = 1.5; s.interaction.target = null; s.interaction.use(); });
  await wait(300);
  const formText = await G(() => document.querySelector('.script-form')?.innerText ?? '');
  await page.screenshot({ path: `${OUT}/addons-05-form.png` });
  if (formText) await page.locator('.script-form .mc-btn', { hasText: 'A' }).first().click();
  await wait(300);
  check('Composant d’objet (onUse) + ActionFormData', /Baguette/.test(formText) && /Choisissez/.test(formText) && (await G(() => window.__lecraft.session.worldProps.get('choice'))) === 0, formText.replace(/\n/g, ' | '));
  await G(() => { const inv = window.__lecraft.session.player.inventory; inv.selected = 0; inv.changed(); });
  // scriptevent + runCommand depuis une entité
  const r0 = await G(() => window.__lecraft.session.player.inventory.count('test:ruby'));
  await cmd('/scriptevent test:ping hello');
  await wait(300);
  const r1 = await G(() => window.__lecraft.session.player.inventory.count('test:ruby'));
  check('/scriptevent → scriptEventReceive → entity.runCommand', r1 === r0 + 4, `${r0} → ${r1}`);
  // chat intercepté (beforeEvents.chatSend)
  await G(() => window.__lecraft.openChat(''));
  await wait(150);
  await page.locator('.chat-input').fill('secret');
  await page.locator('.chat-input').press('Enter');
  await wait(300);
  const chatTxt = await G(() => [...document.querySelectorAll('.chat-line')].map((l) => l.textContent).join(' | '));
  check('beforeEvents.chatSend (annulation) + world.sendMessage', /Secret intercepté/.test(chatTxt) && !/<Joueur> secret/.test(chatTxt), chatTxt.slice(-160));

  await cmd('/clear @s test:ruby');
  await cmd('/give @s test:ruby 9');
  const info = await G(() => ({ rubies: window.__lecraft.session.player.inventory.count('test:ruby') }));
  check('/give d’un objet d’add-on', info.rubies === 9, `rubis : ${info.rubies}`);
  const item = await G(() => {
    const g = window.__lecraft, t = g.textures;
    const c = t.iconCanvas('test:ruby').getContext('2d').getImageData(16, 16, 1, 1).data;
    return { px: [...c] };
  });
  check('Icône de l’objet issue du pack de ressources (item_texture.json)', item.px[0] > 180 && item.px[1] < 80, JSON.stringify(item.px));
  // fabrication 3x3 : bloc de rubis
  // grille 3x3 via l'interface de la table de fabrication
  await G(() => { const g = window.__lecraft, p = g.session.player; g.openInventory('table', { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }); });
  await wait(300);
  const slot = (n) => page.locator('.gui .gslot').nth(n);
  const tap = async (loc) => { await loc.dispatchEvent('pointerdown'); await loc.dispatchEvent('pointerup'); await wait(70); };
  const rubyIdx = await G(() => window.__lecraft.session.player.inventory.slots.findIndex((x) => x?.id === 'test:ruby'));
  const guiIdx = (i) => (i < 9 ? 37 + i : 10 + i - 9);
  await tap(slot(guiIdx(rubyIdx)));
  // glisser sur les 9 cases : un rubis par case
  const centers = [];
  for (let i = 0; i < 9; i++) { const b = await slot(i).boundingBox(); centers.push([b.x + b.width / 2, b.y + b.height / 2]); }
  const cdp = await ctx.newCDPSession(page);
  const touchAt = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 3 }] });
  await touchAt('touchStart', ...centers[0]);
  for (const [x, y] of centers) { await touchAt('touchMove', x, y); await wait(50); }
  await touchAt('touchEnd'); await wait(200);
  await tap(slot(9));
  await tap(slot(guiIdx(8)));
  await wait(150);
  const blockItem = await G(() => window.__lecraft.session.player.inventory.count('test:ruby_block'));
  check('Recette à motif d’un add-on (9 rubis → bloc de rubis)', blockItem === 1, `blocs : ${blockItem}`);
  await page.keyboard.press('Escape');
  await wait(200);
  // bloc posé : texture, lumière, butin
  const blk = await G(() => {
    const s = window.__lecraft.session, w = s.world, p = s.player;
    const id = window.__lecraft.debug.blockId('test:ruby_block');
    const x = Math.floor(p.x) + 2, y = Math.floor(p.y) + 1, z = Math.floor(p.z);
    w.setBlock(x, y, z, id);
    window.__rb = { x, y, z, id };
    const B = s.world.getBlock(x, y, z);
    return { id, placed: B === id };
  });
  await wait(1200);
  const light = await G(() => { const s = window.__lecraft.session, r = window.__rb; return s.world.getLight(r.x + 1, r.y, r.z).block; });
  check('Bloc d’add-on posé et lumineux (light_emission 10)', blk.placed && light >= 8, `id ${blk.id}, lumière voisine ${light}`);
  const drops = await G(() => {
    const s = window.__lecraft.session, r = window.__rb;
    const before = s.entities.entities.length;
    s.interaction.breakBlock(r.x, r.y, r.z, undefined);
    return s.entities.entities.slice(before).filter((e) => e.kind === 'item').map((e) => `${e.itemId}x${e.count ?? e.stack?.count ?? '?'}`);
  });
  check('Table de butin du bloc (2 rubis)', drops.some((d) => d.startsWith('test:ruby')), drops.join(','));
  // créature
  const mob = await G(() => {
    const s = window.__lecraft.session;
    s.runCommand('/summon test:ruby_golem ~3 ~ ~');
    const m = s.entities.mobs.find((x) => x.def.key === 'test:ruby_golem');
    return m ? { hp: m.health, name: m.def.name, hostile: m.def.category, model: !!m.model } : null;
  });
  check('/summon d’une créature d’add-on (santé, nom, hostilité)', !!mob && mob.hp === 30 && mob.name === 'Golem de rubis' && mob.hostile === 'hostile', JSON.stringify(mob));
  const hurt = await G(() => { const s = window.__lecraft.session; const m = s.entities.mobs.find((x) => x.def.key === 'test:ruby_golem'); s.combat.damageMob(m, 2, { kind: 'player', fromPlayer: true }); return [...m.tags]; });
  check('afterEvents.entityHurt (addTag sur la créature)', hurt.includes('hurt'), JSON.stringify(hurt));
  await G(() => { const s = window.__lecraft.session; s.dayCycle.time = 0.2; const p = s.player; p.yaw = -Math.PI / 2; p.pitch = -0.1; });
  await wait(800);
  await page.screenshot({ path: `${OUT}/addons-02-golem.png` });
  // fonctions
  await cmd('/kill @e[type=item]');
  await wait(100);
  const before = await G(() => window.__lecraft.session.player.inventory.count('test:ruby'));
  await cmd('/function hello');
  await wait(200);
  const after = await G(() => window.__lecraft.session.player.inventory.count('test:ruby'));
  check('/function (fichier .mcfunction de l’add-on)', after === before + 3, `${before} → ${after} ; chat : ${await chatLast()}`);
  check('Fonction tick.json exécutée à chaque tick', await G(() => window.__lecraft.session.gamerules.showCoordinates === true));
  // textures du jeu remplacées par le pack de ressources Bedrock
  const dirt = await G(() => [...window.__lecraft.textures.tileByName('dirt').getContext('2d').getImageData(5, 5, 1, 1).data]);
  check('Texture du jeu remplacée (textures/blocks/dirt.png)', dirt[2] > 180 && dirt[0] < 80, JSON.stringify(dirt));
  // nourriture et arme
  const food = await G(() => { const s = window.__lecraft.session; s.runCommand('/give @s test:ruby_apple 1'); s.runCommand('/give @s test:ruby_sword 1'); return { apple: s.player.inventory.count('test:ruby_apple'), sword: s.player.inventory.slots.find((x) => x?.id === 'test:ruby_sword')?.durability }; });
  check('Objets d’add-on : nourriture et épée (durabilité 500)', food.apple === 1 && food.sword === 500, JSON.stringify(food));

  // ---------- commandes diverses ----------
  await cmd('/time set midnight');
  const t = await G(() => window.__lecraft.session.dayCycle.time);
  check('/time set midnight', Math.abs(t - 0.75) < 0.01, t.toFixed(3));
  await cmd('/weather thunder');
  check('/weather thunder', (await G(() => window.__lecraft.session.weather.state)) === 'storm');
  await cmd('/gamemode creative');
  check('/gamemode creative', (await G(() => window.__lecraft.session.player.gameMode)) === 'creative');
  await cmd('/gamemode s');
  const y0 = await G(() => window.__lecraft.session.player.y);
  await cmd('/tp @s ~ ~5 ~');
  const y1 = await G(() => window.__lecraft.session.player.y);
  check('/tp avec coordonnées relatives', Math.abs(y1 - y0 - 5) < 0.6, `${y0.toFixed(1)} → ${y1.toFixed(1)}`);
  await cmd('/fill ~2 ~-6 ~2 ~4 ~-4 ~4 glass hollow');
  check('/fill … hollow', /blocs remplis/.test(await chatLast()), await chatLast());
  await cmd('/kill @e[type=test:ruby_golem]');
  await wait(300);
  check('/kill @e[type=…]', !(await G(() => window.__lecraft.session.entities.mobs.some((m) => m.def.key === 'test:ruby_golem' && !m.dead && !m.removed))));
  await cmd('/xyz');
  check('Commande inconnue : message d’erreur', /Commande inconnue/.test(await chatLast()));
  // chat par l'interface
  await G(() => window.__lecraft.openChat('/'));
  await wait(200);
  await page.locator('.chat-input').fill('/gi');
  await page.locator('.chat-input').dispatchEvent('input');
  await wait(100);
  const sugg = await page.locator('.chat-sugg-item').first().textContent();
  check('Chat : autocomplétion des commandes', /^\/give/.test(sugg ?? ''), sugg);
  await page.locator('.chat-input').fill('/seed');
  await page.locator('.chat-input').press('Enter');
  await wait(200);
  check('Chat : saisie et exécution', /Graine/.test(await chatLast()), await chatLast());
  await page.screenshot({ path: `${OUT}/addons-03-chat.png` });

  // ---------- triches désactivées ----------
  await G(() => { window.__lecraft.session.meta.cheats = false; });
  await cmd('/give @s diamond 1');
  check('Triches désactivées : commandes refusées', /désactivées/.test(await chatLast()), await chatLast());
  await G(() => { window.__lecraft.session.meta.cheats = true; });

  // ---------- croix directionnelle ----------
  await G(() => { const g = window.__lecraft; g.settings.controlScheme = 'dpad'; g.applySettings(); });
  await wait(200);
  const up = await page.locator('.dpad-up').boundingBox();
  await touchAt('touchStart', up.x + up.width / 2, up.y + up.height / 2);
  await wait(150);
  const mv = await G(() => window.__lecraft.input.moveY);
  await touchAt('touchEnd');
  await wait(100);
  check('Croix directionnelle : avancer', mv === 1, `moveY ${mv}`);
  await page.screenshot({ path: `${OUT}/addons-04-dpad.png` });
  await G(() => { const g = window.__lecraft; g.settings.controlScheme = 'joystick'; g.applySettings(); });

  // ---------- désactivation ----------
  await page.keyboard.press('Escape');
  await wait(200);
  await page.getByText('Sauvegarder et quitter').click();
  await page.waitForFunction(() => window.__lecraft.state === 'menu');
  await G(async () => {
    const r = indexedDB.open('lecraft-addons', 1);
    await new Promise((res) => (r.onsuccess = res));
    const db = r.result;
    const tx = db.transaction('addons', 'readwrite');
    const st = tx.objectStore('addons');
    const all = await new Promise((res) => { const q = st.getAll(); q.onsuccess = () => res(q.result); });
    for (const a of all) { a.enabled = false; st.put(a); }
    await new Promise((res) => (tx.oncomplete = res));
  });
  await page.reload();
  await page.waitForFunction(() => window.__lecraft?.state === 'menu');
  const off = await G(() => { let ruby = true; try { window.__lecraft.debug.blockId('test:ruby_block'); } catch { ruby = false; } let unknown = false; try { const rid = JSON.parse(localStorage.getItem('lecraft.addonBlockIds'))['test:ruby_block']; unknown = window.__lecraft.debug.registries.blocks.blocks[rid]?.key === `unknown_block_${rid}`; } catch {} return { ruby, unknown }; });
  check('Add-on désactivé : contenu retiré, identifiant conservé en « bloc inconnu »', !off.ruby && off.unknown, JSON.stringify(off));
} catch (e) {
  check('Exception', false, String(e?.stack ?? e));
}
const serious = errors.filter((e) => !/favicon/.test(e));
check('Aucune erreur console', serious.length === 0, serious.slice(0, 3).join(' | '));
console.log(`\n${total - failed}/${total} vérifications réussies`);
await browser.close();
process.exit(failed ? 1 : 0);
