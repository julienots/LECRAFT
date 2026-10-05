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
  ranged?: { projectile: 'arrow' | 'ice' | 'crystal' | 'boulder'; range: number; damage: number; speed: number };
  /** Comportements spéciaux. */
  traits?: ('burnsInSun' | 'climbs' | 'hops' | 'flies' | 'splits' | 'knockbackResist' | 'aquatic' | 'poison' | 'neutralInDay' | 'shearable' | 'laysEggs' | 'milkable')[];
  /** Conditions d'apparition naturelle. */
  spawn?: { where: 'surface' | 'cave'; light: 'day' | 'dark' | 'any'; group: [number, number]; weight: number; minY?: number; maxY?: number };
  sounds: { idle: string; hurt: string; death: string };
  /** Multiplicateurs de dégâts reçus selon le type d'outil (faiblesses). */
  weakness?: Partial<Record<'pickaxe' | 'axe' | 'sword' | 'shovel' | 'gold' | 'fire', number>>;
  scale?: number;
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
];

export const MOB_BY_KEY = new Map(MOB_DEFS.map((m, i) => [m.key, { def: m, index: i }]));

/** Ajoute une créature (add-ons) à la fin de la liste. */
export function registerMob(def: MobDef) {
  if (MOB_BY_KEY.has(def.key)) throw new Error(`Créature dupliquée : ${def.key}`);
  MOB_DEFS.push(def);
  MOB_BY_KEY.set(def.key, { def, index: MOB_DEFS.length - 1 });
}
