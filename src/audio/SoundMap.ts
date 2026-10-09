/**
 * Correspondance des identifiants de sons du jeu de référence (« random.door_open »,
 * « mob.zombie.say », « dig.stone »…) vers les sons synthétisés du jeu, utilisée par /playsound
 * et l'API de script quand l'add-on ne fournit pas lui-même le fichier audio.
 */
const RULES: [RegExp, string][] = [
  [/door.*open|open.*door|open_door|fence_gate.*open|open.*trapdoor|trapdoor.*open/, 'door_open'],
  [/door.*close|close.*door|close_door|fence_gate.*close|close.*trapdoor|trapdoor.*close/, 'door_close'],
  [/chest.*close|barrel.*close|shulker.*close|enderchest.*close/, 'chest_close'],
  [/armor.*equip|equip.*armor/, 'equip'],
  [/chest.*open|barrel.*open|shulker.*open|enderchest.*open/, 'chest_open'],
  [/chest.*close|barrel.*close/, 'door_close'],
  [/levelup|level_up/, 'levelup'],
  [/orb|experience|xp/, 'xp'],
  [/explode|explosion|tnt|blast|boom/, 'explode'],
  [/fuse|ignite|flint|fire\.ignite/, 'ignite'],
  [/fizz|extinguish/, 'fizz'],
  [/thunder|lightning/, 'thunder'],
  [/splash|water|swim/, 'splash'],
  [/bucket.*fill/, 'bucket_fill'],
  [/bucket.*empty/, 'bucket_empty'],
  [/burp/, 'burp'],
  [/eat|drink|consume/, 'eat'],
  [/bow|crossbow|arrow\.shoot|shoot|throw/, 'bow'],
  [/pop|pickup/, 'pop'],
  [/click|button|lever|ui\.|note/, 'click'],
  [/anvil|smithing|iron|metal|chain|copper|lantern/, 'hit_metal'],
  [/glass.*break|break.*glass|random\.glass/, 'glass_break'],
  [/glass|amethyst|crystal|chime|bell|beacon|portal|enchant|conduit|respawn_anchor/, 'glass_hit'],
  [/teleport|endermen\.portal|enderman\.portal|warp|chorus/, 'teleport'],
  [/zombie|husk|drowned|groan/, 'groan'],
  [/skeleton|stray|bone/, 'rattle'],
  [/spider|silverfish|endermite|hiss|creeper/, 'hiss'],
  [/slime|magmacube|squish/, 'squish'],
  [/cow|mooshroom|moo/, 'moo'],
  [/sheep|goat|baa/, 'baa'],
  [/pig|hoglin|oink/, 'oink'],
  [/chicken|parrot|bird/, 'cluck'],
  [/wolf|growl|bear|panda|cat|ocelot|fox/, 'growl'],
  [/ravager|roar|dragon|wither|warden|dinosaur|rex|raptor/, 'roar'],
  [/whisper|ghast|phantom|vex|evoker|soul|ambient\.cave|cave/, 'whisper'],
  [/hurt|damage|hit|attack|crit/, 'hit'],
  [/jump/, 'jump'],
  [/shear/, 'shear'],
  [/slam|smash|mace/, 'slam'],
  [/break|dig\.|mine/, 'break_stone'],
  [/place|use\./, 'place_stone'],
  [/step/, 'step_stone'],
];

const MATERIALS: [RegExp, string][] = [
  [/wood|log|plank|bamboo|cherry|azalea|mangrove|ladder|scaffold/, 'wood'],
  [/grass|leaves|leaf|vine|moss|azalea|flower|sapling|crop|plant/, 'grass'],
  [/gravel/, 'gravel'],
  [/sand|soul_sand|powder/, 'sand'],
  [/snow|powder_snow/, 'snow'],
  [/glass|amethyst/, 'glass'],
  [/wool|cloth|carpet/, 'wool'],
  [/dirt|mud|clay|farmland|soil/, 'dirt'],
  [/metal|iron|copper|anvil|chain|lantern|netherite|gold/, 'metal'],
];

const cache = new Map<string, string | null>();

/** Nom du son synthétisé le plus proche (ou null si aucun ne convient). */
export function mapSound(id: string): string | null {
  const k = String(id).toLowerCase().replace(/^minecraft:/, '');
  if (cache.has(k)) return cache.get(k)!;
  let out: string | null = null;
  if (/^(dig|break|place|hit|step|land|fall)\./.test(k) || /\.(break|place|hit|step)$/.test(k)) {
    const kind = /^dig|break/.test(k) ? 'break' : /^place|place$/.test(k) ? 'place' : /^hit|hit$/.test(k) ? 'hit' : 'step';
    const mat = MATERIALS.find(([r]) => r.test(k))?.[1] ?? 'stone';
    out = `${kind}_${mat}`;
  } else out = RULES.find(([r]) => r.test(k))?.[1] ?? null;
  cache.set(k, out);
  return out;
}

/** Identifiants de particules → effet de particules du jeu. */
export type BurstKind = 'smoke' | 'fire' | 'lava' | 'water' | 'damage' | 'explosion' | 'magic' | 'hearts' | 'dust' | 'ice' | 'crystal';

export function mapParticle(id: string): { kind: BurstKind; count: number } {
  const k = String(id).toLowerCase();
  const pick = (kind: BurstKind, count = 6) => ({ kind, count });
  if (/explosion|explode|huge|large_explosion|boom/.test(k)) return pick('explosion', 12);
  if (/heart|love|villager_happy|happy/.test(k)) return pick('hearts', 4);
  if (/flame|fire|lava_spark|soul_fire|blaze|torch/.test(k)) return pick('fire', 6);
  if (/lava/.test(k)) return pick('lava', 6);
  if (/water|bubble|splash|drip|rain|evaporation|wake/.test(k)) return pick('water', 8);
  if (/smoke|campfire|cloud|poof|dust_plume|ash|white_smoke|basic_smoke/.test(k)) return pick('smoke', 6);
  if (/crit|damage|blood|hit|sweep/.test(k)) return pick('damage', 6);
  if (/snow|ice|frost|freeze/.test(k)) return pick('ice', 6);
  if (/crystal|end_rod|totem|glow|sculk|portal|amethyst/.test(k)) return pick('crystal', 6);
  if (/dust|redstone|falling|block|dirt|sand|gravel/.test(k)) return pick('dust', 6);
  return pick('magic', 6);
}
