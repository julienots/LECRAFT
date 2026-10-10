/**
 * Sons d'un pack de ressources : fichiers `sounds/…` (pack Java : assets/minecraft/sounds,
 * pack Bedrock : sounds) utilisés à la place des sons synthétisés du jeu — cris de chaque
 * créature (sounds/mob/<créature>/), blocs (dig/, step/) et sons courants (random/…).
 * Les variantes numérotées (say1.ogg, say2.ogg…) sont tirées au hasard.
 */

/** Dossier et préfixes (idle, hurt, death) des cris de chaque créature, comme dans le jeu original. */
const MOB_DIRS: Record<string, [string, string, string, string]> = {
  cow: ['mob/cow', 'say', 'hurt', 'hurt'],
  mooshroom: ['mob/cow', 'say', 'hurt', 'hurt'],
  pig: ['mob/pig', 'say', 'say', 'death'],
  sheep: ['mob/sheep', 'say', 'say', 'say'],
  chicken: ['mob/chicken', 'say', 'hurt', 'hurt'],
  zombie: ['mob/zombie', 'say', 'hurt', 'death'],
  zombie_chief: ['mob/zombie', 'say', 'hurt', 'death'],
  zombie_villager: ['mob/zombie_villager', 'say', 'hurt', 'death'],
  husk: ['mob/husk', 'idle', 'hurt', 'death'],
  drowned: ['mob/drowned', 'idle', 'hurt', 'death'],
  skeleton: ['mob/skeleton', 'say', 'hurt', 'death'],
  stray: ['mob/stray', 'idle', 'hurt', 'death'],
  bogged: ['mob/bogged', 'ambient', 'hurt', 'death'],
  wither_skeleton: ['mob/skeleton', 'say', 'hurt', 'death'],
  creeper: ['mob/creeper', '', 'say', 'death'],
  spider: ['mob/spider', 'say', 'say', 'death'],
  cave_spider: ['mob/spider', 'say', 'say', 'death'],
  enderman: ['mob/endermen', 'idle', 'hit', 'death'],
  wolf: ['mob/wolf', 'bark', 'hurt', 'death'],
  cat: ['mob/cat', 'meow', 'hitt', 'hitt'],
  ocelot: ['mob/cat', 'meow', 'hitt', 'hitt'],
  horse: ['mob/horse', 'idle', 'hit', 'death'],
  donkey: ['mob/horse/donkey', 'idle', 'hit', 'death'],
  mule: ['mob/horse/donkey', 'idle', 'hit', 'death'],
  skeleton_horse: ['mob/horse/skeleton', 'idle', 'hit', 'death'],
  zombie_horse: ['mob/horse/zombie', 'idle', 'hit', 'death'],
  llama: ['mob/llama', 'idle', 'hurt', 'death'],
  trader_llama: ['mob/llama', 'idle', 'hurt', 'death'],
  rabbit: ['mob/rabbit', 'idle', 'hurt', 'bunnymurder'],
  parrot: ['mob/parrot', 'idle', 'hurt', 'death'],
  fox: ['mob/fox', 'idle', 'hurt', 'death'],
  bee: ['mob/bee', 'loop', 'hurt', 'death'],
  villager: ['mob/villager', 'idle', 'hit', 'death'],
  wandering_trader: ['mob/wandering_trader', 'idle', 'hurt', 'death'],
  witch: ['mob/witch', 'ambient', 'hurt', 'death'],
  pillager: ['mob/pillager', 'idle', 'hurt', 'death'],
  vindicator: ['mob/vindication_illager', 'idle', 'hurt', 'death'],
  evoker: ['mob/evocation_illager', 'idle', 'hurt', 'death'],
  slime: ['mob/slime', 'small', 'small', 'big'],
  magma_cube: ['mob/magmacube', 'small', 'small', 'big'],
  ghast: ['mob/ghast', 'moan', 'scream', 'death'],
  blaze: ['mob/blaze', 'breathe', 'hit', 'death'],
  wither: ['mob/wither', 'idle', 'hurt', 'death'],
  ender_dragon: ['mob/enderdragon', 'growl', 'hit', 'end'],
  iron_golem: ['mob/irongolem', '', 'hit', 'death'],
  squid: ['mob/squid', 'ambient', 'hurt', 'death'],
  glow_squid: ['mob/glow_squid', 'ambient', 'hurt', 'death'],
  dolphin: ['mob/dolphin', 'idle', 'hurt', 'death'],
  turtle: ['mob/turtle', 'idle', 'hurt', 'death'],
  axolotl: ['mob/axolotl', 'idle_air', 'hurt', 'death'],
  goat: ['mob/goat', 'idle', 'hurt', 'death'],
  panda: ['mob/panda', 'idle', 'hurt', 'death'],
  polar_bear: ['mob/polarbear', 'idle', 'hurt', 'death'],
  frog: ['mob/frog', 'idle', 'hurt', 'death'],
  piglin: ['mob/piglin', 'idle', 'hurt', 'death'],
  piglin_brute: ['mob/piglin_brute', 'idle', 'hurt', 'death'],
  hoglin: ['mob/hoglin', 'idle', 'hurt', 'death'],
  zoglin: ['mob/zoglin', 'idle', 'hurt', 'death'],
  zombified_piglin: ['mob/zombified_piglin', 'zpig', 'zpighurt', 'zpigdeath'],
  strider: ['mob/strider', 'idle', 'hurt', 'death'],
  silverfish: ['mob/silverfish', 'say', 'hit', 'kill'],
  endermite: ['mob/endermite', 'say', 'hit', 'kill'],
  bat: ['mob/bat', 'idle', 'hurt', 'death'],
  phantom: ['mob/phantom', 'idle', 'hurt', 'death'],
  guardian: ['mob/guardian', 'ambient', 'guardian_hit', 'guardian_death'],
  elder_guardian: ['mob/guardian', 'elder_idle', 'elder_hit', 'elder_death'],
  shulker: ['mob/shulker', 'ambient', 'hurt', 'death'],
  armadillo: ['mob/armadillo', 'ambient', 'hurt', 'death'],
  camel: ['mob/camel', 'ambient', 'hurt', 'death'],
  snow_golem: ['mob/snow_golem', '', 'hurt', 'death'],
  cod: ['entity/fish', '', 'hurt', 'hurt'],
  salmon: ['entity/fish', '', 'hurt', 'hurt'],
  tropical_fish: ['entity/fish', '', 'hurt', 'hurt'],
  pufferfish: ['entity/fish', '', 'hurt', 'hurt'],
};

/** Sons courants : nom du son synthétisé → fichiers du pack (le premier trouvé). */
const COMMON: Record<string, string[]> = {
  pop: ['random/pop'], eat: ['random/eat'], burp: ['random/burp'], levelup: ['random/levelup'], xp: ['random/orb'],
  explode: ['random/explode'], fuse: ['random/fuse'], bow: ['random/bow'], click: ['random/click'],
  door_open: ['random/door_open', 'block/wooden_door/open'], door_close: ['random/door_close', 'block/wooden_door/close'],
  chest_open: ['random/chestopen', 'block/chest/open'], chest_close: ['random/chestclosed', 'block/chest/close'],
  splash: ['random/splash', 'liquid/splash'], swim: ['liquid/swim'], fizz: ['random/fizz'], extinguish: ['random/fizz'],
  glass_break: ['random/glass'], bucket_fill: ['item/bucket/fill'], bucket_empty: ['item/bucket/empty'], shear: ['mob/sheep/shear'],
  ignite: ['fire/ignite'], thunder: ['ambient/weather/thunder'], hurt: ['damage/hit'], hit: ['entity/player/attack/strong', 'damage/hit'],
  crit: ['entity/player/attack/crit', 'damage/hit'], teleport: ['mob/endermen/portal'], enderman_tp: ['mob/endermen/portal'],
  portal: ['portal/trigger'], equip: ['item/armor/equip_generic'], enderman_scream: ['mob/endermen/scream'], villager_yes: ['mob/villager/yes'],
};

/** Matériau des blocs → dossiers dig/ (casse, pose) et step/ (pas, coups). */
const MATERIAL: Record<string, [string, string]> = {
  stone: ['dig/stone', 'step/stone'], dirt: ['dig/gravel', 'step/gravel'], grass: ['dig/grass', 'step/grass'], wood: ['dig/wood', 'step/wood'],
  sand: ['dig/sand', 'step/sand'], gravel: ['dig/gravel', 'step/gravel'], glass: ['random/glass', 'step/stone'], leaves: ['dig/grass', 'step/grass'],
  snow: ['dig/snow', 'step/snow'], metal: ['dig/stone', 'step/stone'], wool: ['dig/cloth', 'step/cloth'],
};

/** Fichiers du pack regroupés par préfixe (« mob/cow/say » → [say1.ogg, say2.ogg…]). */
export function groupPackSounds(files: Map<string, Blob>): Map<string, Blob[]> {
  const out = new Map<string, Blob[]>();
  for (const [path, blob] of files) {
    const k = path.toLowerCase().replace(/\d*\.(ogg|mp3|wav)$/, '');
    const list = out.get(k) ?? [];
    list.push(blob);
    out.set(k, list);
  }
  return out;
}

/** Fichiers à jouer pour un son synthétisé (`moo`, `break_stone`…) ; null = son synthétisé. */
export function packFilesFor(groups: Map<string, Blob[]>, name: string): Blob[] | null {
  for (const p of COMMON[name] ?? []) {
    const g = groups.get(p);
    if (g?.length) return g;
  }
  const m = /^(break|place|step|hit)_(\w+)$/.exec(name);
  if (m && MATERIAL[m[2]]) {
    const g = groups.get(m[1] === 'break' || m[1] === 'place' ? MATERIAL[m[2]][0] : MATERIAL[m[2]][1]);
    if (g?.length) return g;
  }
  return null;
}

/** Fichiers du cri d'une créature (null : pas dans le pack). */
export function packMobFiles(groups: Map<string, Blob[]>, mobKey: string, kind: 'idle' | 'hurt' | 'death'): Blob[] | null {
  const d = MOB_DIRS[mobKey] ?? [`mob/${mobKey}`, 'idle', 'hurt', 'death'];
  const name = d[kind === 'idle' ? 1 : kind === 'hurt' ? 2 : 3];
  if (!name) return null;
  const g = groups.get(`${d[0]}/${name}`);
  if (g?.length) return g;
  // créatures d'autres versions : « ambient » / « say » pour le cri d'ambiance
  if (kind === 'idle') for (const alt of ['ambient', 'say', 'idle']) {
    const a = groups.get(`${d[0]}/${alt}`);
    if (a?.length) return a;
  }
  return null;
}
