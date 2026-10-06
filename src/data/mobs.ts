/**
 * Définitions des créatures. L'ORDRE est référencé par la méta des cages à monstres
 * (voir MOB_INDEX dans StructureGenerator) : ajouter les nouvelles créatures à la FIN.
 */
export type MobCategory = 'passive' | 'neutral' | 'hostile' | 'boss';

export interface MobDef {
  key: string;
  name: string;
  category: MobCategory;
  health: number;
  damage: number;
  speed: number;
  detectionRange: number;
  attackRange: number;
  attackCooldown: number;
  width: number;
  height: number;
  drops: { item: string; min: number; max: number; chance?: number }[];
  xp: number;
  /** Nourriture qui attire / permet la reproduction. */
  food?: string[];
  ranged?: { projectile: 'arrow' | 'ice' | 'crystal' | 'boulder'; range: number; damage: number; speed: number; /** Projectile d'add-on (minecraft:shooter). */ customId?: string };
  /** Comportements spéciaux. */
  traits?: ('teleports' | 'tameable' | 'ambient' | 'waterSpawn' | 'fireImmune' | 'groupAnger' | 'burnsInSun' | 'climbs' | 'hops' | 'flies' | 'splits' | 'knockbackResist' | 'aquatic' | 'poison' | 'neutralInDay' | 'shearable' | 'laysEggs' | 'milkable')[];
  /** Conditions d'apparition naturelle. */
  spawn?: { where: 'surface' | 'cave' | 'nether'; light: 'day' | 'dark' | 'any'; group: [number, number]; weight: number; minY?: number; maxY?: number };
  sounds: { idle: string; hurt: string; death: string };
  /** Multiplicateurs de dégâts reçus selon le type d'outil (faiblesses). */
  weakness?: Partial<Record<'pickaxe' | 'axe' | 'sword' | 'shovel' | 'gold' | 'fire', number>>;
  scale?: number;
  /** Familles (minecraft:type_family) : « monster », « undead »… */
  families?: string[];
  /** Propriétés d'entité (minecraft:properties) → valeur par défaut. */
  properties?: Record<string, number | string | boolean>;
  /** Événements d'entité définis par l'add-on (noms). */
  events?: string[];
  /** Variantes (minecraft:variant / mark_variant / skin_id) de base. */
  variant?: number;
}

const VANILLA_FAMILIES: Record<string, string[]> = {
  zombie: ['zombie', 'undead', 'monster'], skeleton: ['skeleton', 'undead', 'monster'], spider: ['spider', 'arthropod', 'monster'],
  cave_spider: ['cave_spider', 'arthropod', 'monster'], creeper: ['creeper', 'monster'], zombified_piglin: ['zombified_piglin', 'piglin', 'undead', 'monster'], ghast: ['ghast', 'monster'], magma_cube: ['magma_cube', 'monster'], blaze: ['blaze', 'monster'], enderman: ['enderman', 'monster'], wolf: ['wolf'], squid: ['squid'], glow_squid: ['squid'], bat: ['bat'], husk: ['husk', 'zombie', 'undead', 'monster'], drowned: ['drowned', 'zombie', 'undead', 'monster'], stray: ['stray', 'skeleton', 'undead', 'monster'], witch: ['witch', 'monster'], villager: ['villager'], slime: ['slime', 'monster'], zombie_chief: ['zombie', 'undead', 'monster'],
  cow: ['cow'], sheep: ['sheep'], pig: ['pig'], chicken: ['chicken'], golem: ['irongolem'], liche: ['undead', 'monster'],
};

/** Familles d'une créature (définies par l'add-on, ou déduites pour les créatures de base). */
export function familiesOf(def: MobDef): string[] {
  if (def.families?.length) return def.families;
  const f = VANILLA_FAMILIES[def.key] ?? [def.key.split(':').pop()!];
  return [...f, 'mob', ...(def.category === 'hostile' || def.category === 'boss' ? ['monster'] : [])];
}

export const MOB_DEFS: MobDef[] = [
  { key: 'cow', name: 'Vache', category: 'passive', health: 10, damage: 0, speed: 1.3, detectionRange: 8, attackRange: 0, attackCooldown: 1, width: 0.9, height: 1.4, drops: [{ item: 'beef', min: 1, max: 3 }, { item: 'leather', min: 0, max: 2 }], xp: 2, food: ['wheat'], traits: ['milkable'], spawn: { where: 'surface', light: 'day', group: [2, 4], weight: 8 }, sounds: { idle: 'moo', hurt: 'moo_hurt', death: 'moo_hurt' } },
  { key: 'sheep', name: 'Mouton', category: 'passive', health: 8, damage: 0, speed: 1.3, detectionRange: 8, attackRange: 0, attackCooldown: 1, width: 0.9, height: 1.3, drops: [{ item: 'mutton', min: 1, max: 2 }], xp: 2, food: ['wheat'], traits: ['shearable'], spawn: { where: 'surface', light: 'day', group: [2, 4], weight: 12 }, sounds: { idle: 'baa', hurt: 'baa', death: 'baa' } },
  { key: 'pig', name: 'Cochon', category: 'passive', health: 10, damage: 0, speed: 1.4, detectionRange: 8, attackRange: 0, attackCooldown: 1, width: 0.9, height: 0.9, drops: [{ item: 'porkchop', min: 1, max: 3 }], xp: 2, food: ['carrot', 'potato'], spawn: { where: 'surface', light: 'day', group: [2, 4], weight: 10 }, sounds: { idle: 'oink', hurt: 'oink_hurt', death: 'oink_hurt' } },
  { key: 'chicken', name: 'Poule', category: 'passive', health: 4, damage: 0, speed: 1.4, detectionRange: 8, attackRange: 0, attackCooldown: 1, width: 0.4, height: 0.7, drops: [{ item: 'chicken', min: 1, max: 1 }, { item: 'feather', min: 0, max: 2 }], xp: 1, food: ['wheat_seeds'], traits: ['laysEggs'], spawn: { where: 'surface', light: 'day', group: [2, 4], weight: 10 }, sounds: { idle: 'cluck', hurt: 'cluck_hurt', death: 'cluck_hurt' } },
  { key: 'zombie', name: 'Zombie', category: 'hostile', health: 20, damage: 3, speed: 2.3, detectionRange: 35, attackRange: 1.6, attackCooldown: 1, width: 0.6, height: 1.95, drops: [{ item: 'rotten_flesh', min: 0, max: 2 }, { item: 'iron_ingot', min: 1, max: 1, chance: 0.008 }, { item: 'carrot', min: 1, max: 1, chance: 0.008 }, { item: 'potato', min: 1, max: 1, chance: 0.008 }], xp: 5, traits: ['burnsInSun'], spawn: { where: 'surface', light: 'dark', group: [2, 4], weight: 100 }, sounds: { idle: 'groan', hurt: 'groan_hurt', death: 'groan_death' } },
  { key: 'spider', name: 'Araignée', category: 'hostile', health: 16, damage: 2, speed: 3, detectionRange: 16, attackRange: 1.4, attackCooldown: 1, width: 1.4, height: 0.9, drops: [{ item: 'string', min: 0, max: 2 }, { item: 'spider_eye', min: 1, max: 1, chance: 0.33 }], xp: 5, traits: ['climbs', 'neutralInDay'], spawn: { where: 'surface', light: 'dark', group: [1, 2], weight: 100 }, sounds: { idle: 'hiss', hurt: 'hiss_hurt', death: 'hiss_hurt' } },
  { key: 'slime', name: 'Slime', category: 'hostile', health: 16, damage: 4, speed: 1.8, detectionRange: 16, attackRange: 1.4, attackCooldown: 1, width: 1, height: 1, scale: 2, drops: [{ item: 'slime_ball', min: 0, max: 2 }], xp: 4, traits: ['hops', 'splits'], spawn: { where: 'cave', light: 'any', group: [1, 2], weight: 10, maxY: 40 }, sounds: { idle: 'squish', hurt: 'squish', death: 'squish' } },
  { key: 'skeleton', name: 'Squelette', category: 'hostile', health: 20, damage: 2, speed: 2.3, detectionRange: 16, attackRange: 15, attackCooldown: 2, width: 0.6, height: 1.99, drops: [{ item: 'bone', min: 0, max: 2 }, { item: 'arrow', min: 0, max: 2 }, { item: 'bow', min: 1, max: 1, chance: 0.085 }], xp: 5, ranged: { projectile: 'arrow', range: 15, damage: 3, speed: 24 }, traits: ['burnsInSun'], spawn: { where: 'surface', light: 'dark', group: [1, 2], weight: 100 }, sounds: { idle: 'rattle', hurt: 'rattle', death: 'rattle' } },
  { key: 'zombie_chief', name: 'Chef zombie', category: 'hostile', health: 80, damage: 6, speed: 2.5, detectionRange: 24, attackRange: 2.2, attackCooldown: 1.4, width: 0.9, height: 2.8, scale: 1.45, drops: [{ item: 'iron_ingot', min: 2, max: 5 }, { item: 'gold_ingot', min: 1, max: 3 }, { item: 'diamond', min: 1, max: 1, chance: 0.4 }, { item: 'ancient_relic', min: 1, max: 1, chance: 0.5 }], xp: 40, traits: ['knockbackResist'], sounds: { idle: 'groan', hurt: 'groan_hurt', death: 'groan_death' } },
  { key: 'cave_spider', name: 'Araignée venimeuse', category: 'hostile', health: 12, damage: 2, speed: 3.2, detectionRange: 16, attackRange: 1.2, attackCooldown: 1, width: 0.7, height: 0.5, scale: 0.7, drops: [{ item: 'string', min: 0, max: 2 }, { item: 'spider_eye', min: 1, max: 1, chance: 0.33 }], xp: 5, traits: ['climbs', 'poison'], sounds: { idle: 'hiss', hurt: 'hiss_hurt', death: 'hiss_hurt' } },
  { key: 'golem', name: 'Golem des profondeurs', category: 'boss', health: 320, damage: 9, speed: 2.2, detectionRange: 32, attackRange: 3, attackCooldown: 1.8, width: 1.6, height: 3.2, drops: [{ item: 'golem_core', min: 1, max: 1 }, { item: 'diamond', min: 2, max: 4 }, { item: 'iron_block', min: 1, max: 2 }], xp: 120, traits: ['knockbackResist'], weakness: { pickaxe: 2, sword: 0.7 }, sounds: { idle: 'golem_idle', hurt: 'stone_hit', death: 'golem_death' } },
  { key: 'liche', name: 'Liche de givre', category: 'boss', health: 240, damage: 7, speed: 2.4, detectionRange: 32, attackRange: 16, attackCooldown: 1.6, width: 0.9, height: 2.6, drops: [{ item: 'frost_heart', min: 1, max: 1 }, { item: 'frost_scepter', min: 1, max: 1 }, { item: 'emerald', min: 4, max: 8 }], xp: 150, ranged: { projectile: 'ice', range: 18, damage: 5, speed: 16 }, traits: ['flies', 'knockbackResist'], weakness: { gold: 2, fire: 2 }, sounds: { idle: 'lich_idle', hurt: 'glass_hit', death: 'lich_death' } },
  { key: 'creeper', name: 'Creeper', category: 'hostile', health: 20, damage: 0, speed: 2.1, detectionRange: 16, attackRange: 3, attackCooldown: 1, width: 0.6, height: 1.7, drops: [{ item: 'gunpowder', min: 0, max: 2 }], xp: 5, spawn: { where: 'surface', light: 'dark', group: [1, 1], weight: 100 }, sounds: { idle: '', hurt: 'hurt', death: 'hurt' } },
  { key: 'zombified_piglin', name: 'Piglin zombifié', category: 'neutral', health: 20, damage: 8, speed: 2.4, detectionRange: 35, attackRange: 1.6, attackCooldown: 1, width: 0.6, height: 1.95, drops: [{ item: 'rotten_flesh', min: 0, max: 1 }, { item: 'gold_nugget', min: 0, max: 1 }, { item: 'gold_ingot', min: 1, max: 1, chance: 0.025 }], xp: 5, traits: ['fireImmune', 'groupAnger'], spawn: { where: 'nether', light: 'any', group: [2, 4], weight: 100 }, sounds: { idle: 'grunt', hurt: 'grunt_hurt', death: 'grunt_hurt' } },
  { key: 'ghast', name: 'Ghast', category: 'hostile', health: 10, damage: 0, speed: 1.6, detectionRange: 64, attackRange: 0, attackCooldown: 3, width: 4, height: 4, scale: 4.5, ranged: { projectile: 'crystal', range: 64, damage: 6, speed: 12, customId: 'minecraft:fireball' }, drops: [{ item: 'ghast_tear', min: 0, max: 1 }, { item: 'gunpowder', min: 0, max: 2 }], xp: 5, traits: ['fireImmune', 'flies'], spawn: { where: 'nether', light: 'any', group: [1, 1], weight: 50 }, sounds: { idle: 'ghast_moan', hurt: 'ghast_hurt', death: 'ghast_hurt' } },
  { key: 'magma_cube', name: 'Cube de magma', category: 'hostile', health: 16, damage: 6, speed: 2, detectionRange: 16, attackRange: 1.6, attackCooldown: 1, width: 2, height: 2, scale: 4, drops: [{ item: 'magma_cream', min: 0, max: 1 }], xp: 4, traits: ['fireImmune', 'hops', 'splits'], spawn: { where: 'nether', light: 'any', group: [1, 3], weight: 30 }, sounds: { idle: 'squish', hurt: 'squish', death: 'squish' } },
  { key: 'blaze', name: 'Blaze', category: 'hostile', health: 20, damage: 6, speed: 2.3, detectionRange: 48, attackRange: 1.6, attackCooldown: 2.5, width: 0.6, height: 1.8, ranged: { projectile: 'crystal', range: 32, damage: 5, speed: 16, customId: 'minecraft:small_fireball' }, drops: [{ item: 'blaze_rod', min: 0, max: 1 }], xp: 10, traits: ['fireImmune', 'flies'], sounds: { idle: 'blaze_breath', hurt: 'blaze_hurt', death: 'blaze_hurt' } },
  { key: 'enderman', name: 'Enderman', category: 'neutral', health: 40, damage: 7, speed: 3, detectionRange: 32, attackRange: 2, attackCooldown: 1, width: 0.6, height: 2.9, drops: [{ item: 'ender_pearl', min: 0, max: 1 }], xp: 5, traits: ['teleports'], spawn: { where: 'surface', light: 'dark', group: [1, 2], weight: 10 }, sounds: { idle: 'enderman_idle', hurt: 'enderman_hurt', death: 'enderman_hurt' } },
  { key: 'wolf', name: 'Loup', category: 'neutral', health: 8, damage: 4, speed: 3, detectionRange: 16, attackRange: 1.4, attackCooldown: 1, width: 0.6, height: 0.85, drops: [], xp: 2, food: ['beef', 'cooked_beef', 'porkchop', 'cooked_porkchop', 'chicken', 'cooked_chicken', 'mutton', 'cooked_mutton', 'rotten_flesh'], traits: ['groupAnger', 'tameable'], spawn: { where: 'surface', light: 'any', group: [2, 4], weight: 8 }, sounds: { idle: 'bark', hurt: 'whine', death: 'whine' } },
  { key: 'squid', name: 'Calamar', category: 'passive', health: 10, damage: 0, speed: 1.4, detectionRange: 8, attackRange: 0, attackCooldown: 1, width: 0.8, height: 0.8, drops: [{ item: 'ink_sac', min: 1, max: 3 }], xp: 1, traits: ['aquatic', 'waterSpawn'], spawn: { where: 'surface', light: 'any', group: [2, 4], weight: 10 }, sounds: { idle: 'squish', hurt: 'squish', death: 'squish' } },
  { key: 'glow_squid', name: 'Calamar luisant', category: 'passive', health: 10, damage: 0, speed: 1.4, detectionRange: 8, attackRange: 0, attackCooldown: 1, width: 0.8, height: 0.8, drops: [{ item: 'glow_ink_sac', min: 1, max: 3 }], xp: 1, traits: ['aquatic', 'waterSpawn'], spawn: { where: 'cave', light: 'dark', group: [2, 3], weight: 10, maxY: 45 }, sounds: { idle: 'squish', hurt: 'squish', death: 'squish' } },
  { key: 'bat', name: 'Chauve-souris', category: 'passive', health: 6, damage: 0, speed: 3, detectionRange: 8, attackRange: 0, attackCooldown: 1, width: 0.5, height: 0.9, scale: 0.6, drops: [], xp: 0, traits: ['flies', 'ambient'], spawn: { where: 'cave', light: 'dark', group: [1, 2], weight: 10, maxY: 60 }, sounds: { idle: 'squeak', hurt: 'squeak', death: 'squeak' } },
  { key: 'husk', name: 'Zombie momifié', category: 'hostile', health: 20, damage: 3, speed: 2.3, detectionRange: 35, attackRange: 1.6, attackCooldown: 1, width: 0.6, height: 1.95, drops: [{ item: 'rotten_flesh', min: 0, max: 2 }, { item: 'iron_ingot', min: 1, max: 1, chance: 0.008 }], xp: 5, spawn: { where: 'surface', light: 'dark', group: [2, 4], weight: 80 }, sounds: { idle: 'groan', hurt: 'groan_hurt', death: 'groan_death' } },
  { key: 'drowned', name: 'Noyé', category: 'hostile', health: 20, damage: 3, speed: 2.2, detectionRange: 35, attackRange: 1.6, attackCooldown: 1, width: 0.6, height: 1.95, drops: [{ item: 'rotten_flesh', min: 0, max: 2 }, { item: 'copper_ingot', min: 1, max: 1, chance: 0.11 }, { item: 'trident', min: 1, max: 1, chance: 0.0625 }], xp: 5, traits: ['burnsInSun', 'waterSpawn'], spawn: { where: 'surface', light: 'dark', group: [1, 2], weight: 60 }, sounds: { idle: 'groan', hurt: 'groan_hurt', death: 'groan_death' } },
  { key: 'stray', name: 'Vagabond', category: 'hostile', health: 20, damage: 2, speed: 2.3, detectionRange: 16, attackRange: 14, attackCooldown: 2, width: 0.6, height: 1.99, ranged: { projectile: 'arrow', range: 15, damage: 3, speed: 18, customId: 'lecraft:stray_arrow' }, drops: [{ item: 'bone', min: 0, max: 2 }, { item: 'arrow', min: 0, max: 2 }], xp: 5, traits: ['burnsInSun'], spawn: { where: 'surface', light: 'dark', group: [1, 3], weight: 80 }, sounds: { idle: 'rattle', hurt: 'rattle', death: 'rattle' } },
  { key: 'witch', name: 'Sorcière', category: 'hostile', health: 26, damage: 0, speed: 2.2, detectionRange: 16, attackRange: 8, attackCooldown: 3, width: 0.6, height: 1.95, ranged: { projectile: 'boulder', range: 8, damage: 3, speed: 9, customId: 'lecraft:witch_potion' }, drops: [{ item: 'glass_bottle', min: 0, max: 2 }, { item: 'glowstone_dust', min: 0, max: 2 }, { item: 'redstone', min: 0, max: 2 }, { item: 'spider_eye', min: 0, max: 2 }, { item: 'sugar', min: 0, max: 2 }, { item: 'stick', min: 0, max: 2 }], xp: 5, spawn: { where: 'surface', light: 'dark', group: [1, 1], weight: 5 }, sounds: { idle: 'cackle', hurt: 'cackle', death: 'cackle' } },
  { key: 'villager', name: 'Villageois', category: 'passive', health: 20, damage: 0, speed: 1.5, detectionRange: 8, attackRange: 0, attackCooldown: 1, width: 0.6, height: 1.95, drops: [], xp: 0, sounds: { idle: 'hmm', hurt: 'hmm_hurt', death: 'hmm_hurt' } },
];

export const MOB_BY_KEY = new Map(MOB_DEFS.map((m, i) => [m.key, { def: m, index: i }]));

/** Ajoute une créature (add-ons) à la fin de la liste. */
export function registerMob(def: MobDef) {
  if (MOB_BY_KEY.has(def.key)) throw new Error(`Créature dupliquée : ${def.key}`);
  MOB_DEFS.push(def);
  MOB_BY_KEY.set(def.key, { def, index: MOB_DEFS.length - 1 });
}
