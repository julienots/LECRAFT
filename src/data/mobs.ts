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
  traits?: ('burnsInSun' | 'climbs' | 'hops' | 'flies' | 'splits' | 'knockbackResist' | 'aquatic')[];
  /** Conditions d'apparition naturelle. */
  spawn?: { where: 'surface' | 'cave'; light: 'day' | 'dark' | 'any'; group: [number, number]; weight: number; minY?: number; maxY?: number };
  sounds: { idle: string; hurt: string; death: string };
  /** Multiplicateurs de dégâts reçus selon le type d'outil (faiblesses). */
  weakness?: Partial<Record<'pickaxe' | 'axe' | 'sword' | 'shovel' | 'gold' | 'fire', number>>;
  scale?: number;
}

export const MOB_DEFS: MobDef[] = [
  { key: 'vachette', name: 'Vachette', category: 'passive', health: 10, damage: 0, speed: 1.4, detectionRange: 8, attackRange: 0, attackCooldown: 1, width: 0.9, height: 1.4, drops: [{ item: 'raw_meat', min: 1, max: 3 }, { item: 'leather', min: 0, max: 2 }], xp: 2, food: ['wheat'], spawn: { where: 'surface', light: 'day', group: [2, 4], weight: 8 }, sounds: { idle: 'moo', hurt: 'moo_hurt', death: 'moo_hurt' } },
  { key: 'laineux', name: 'Laineux', category: 'passive', health: 8, damage: 0, speed: 1.4, detectionRange: 8, attackRange: 0, attackCooldown: 1, width: 0.9, height: 1.3, drops: [{ item: 'wool', min: 1, max: 2 }, { item: 'raw_meat', min: 1, max: 2 }], xp: 2, food: ['wheat'], spawn: { where: 'surface', light: 'day', group: [2, 4], weight: 9 }, sounds: { idle: 'baa', hurt: 'baa', death: 'baa' } },
  { key: 'porcelet', name: 'Porcelet', category: 'passive', health: 10, damage: 0, speed: 1.5, detectionRange: 8, attackRange: 0, attackCooldown: 1, width: 0.9, height: 0.9, drops: [{ item: 'raw_meat', min: 1, max: 3 }], xp: 2, food: ['carrot'], spawn: { where: 'surface', light: 'day', group: [2, 4], weight: 8 }, sounds: { idle: 'oink', hurt: 'oink_hurt', death: 'oink_hurt' } },
  { key: 'plumeau', name: 'Plumeau', category: 'passive', health: 4, damage: 0, speed: 1.6, detectionRange: 8, attackRange: 0, attackCooldown: 1, width: 0.45, height: 0.75, drops: [{ item: 'raw_poultry', min: 1, max: 1 }, { item: 'feather', min: 0, max: 2 }], xp: 1, food: ['seeds'], spawn: { where: 'surface', light: 'day', group: [2, 5], weight: 8 }, sounds: { idle: 'cluck', hurt: 'cluck_hurt', death: 'cluck_hurt' } },
  { key: 'rodeur', name: 'Rôdeur nocturne', category: 'hostile', health: 20, damage: 3, speed: 2.4, detectionRange: 22, attackRange: 1.6, attackCooldown: 1.1, width: 0.6, height: 1.9, drops: [{ item: 'bone', min: 0, max: 2 }, { item: 'carrot', min: 0, max: 1, chance: 0.08 }, { item: 'iron_ingot', min: 1, max: 1, chance: 0.03 }], xp: 5, traits: ['burnsInSun'], spawn: { where: 'surface', light: 'dark', group: [1, 3], weight: 10 }, sounds: { idle: 'groan', hurt: 'groan_hurt', death: 'groan_death' } },
  { key: 'arachne', name: 'Arachne des cavernes', category: 'hostile', health: 14, damage: 2, speed: 3.2, detectionRange: 16, attackRange: 1.4, attackCooldown: 0.9, width: 1.2, height: 0.7, drops: [{ item: 'string', min: 0, max: 2 }], xp: 5, traits: ['climbs'], spawn: { where: 'cave', light: 'dark', group: [1, 2], weight: 8, maxY: 60 }, sounds: { idle: 'hiss', hurt: 'hiss_hurt', death: 'hiss_hurt' } },
  { key: 'gelee', name: 'Gelée', category: 'hostile', health: 12, damage: 2, speed: 2.2, detectionRange: 14, attackRange: 1.3, attackCooldown: 1, width: 0.9, height: 0.9, drops: [{ item: 'slime_ball', min: 0, max: 2 }], xp: 3, traits: ['hops', 'splits'], spawn: { where: 'cave', light: 'dark', group: [1, 2], weight: 4, maxY: 40 }, sounds: { idle: 'squish', hurt: 'squish', death: 'squish' } },
  { key: 'archer', name: "Archer d'os", category: 'hostile', health: 18, damage: 2, speed: 2.3, detectionRange: 20, attackRange: 12, attackCooldown: 2, width: 0.6, height: 1.9, drops: [{ item: 'bone', min: 0, max: 2 }, { item: 'arrow', min: 0, max: 3 }, { item: 'bow', min: 1, max: 1, chance: 0.05 }], xp: 6, ranged: { projectile: 'arrow', range: 14, damage: 3, speed: 22 }, traits: ['burnsInSun'], spawn: { where: 'surface', light: 'dark', group: [1, 2], weight: 6 }, sounds: { idle: 'rattle', hurt: 'rattle', death: 'rattle' } },
  { key: 'chef', name: 'Chef rôdeur', category: 'hostile', health: 80, damage: 6, speed: 2.6, detectionRange: 24, attackRange: 2.2, attackCooldown: 1.4, width: 0.9, height: 2.8, scale: 1.45, drops: [{ item: 'iron_ingot', min: 2, max: 5 }, { item: 'gold_ingot', min: 1, max: 3 }, { item: 'ancient_relic', min: 1, max: 1, chance: 0.5 }], xp: 40, traits: ['knockbackResist'], sounds: { idle: 'groan', hurt: 'groan_hurt', death: 'groan_death' } },
  { key: 'ours', name: 'Ours brun', category: 'neutral', health: 30, damage: 5, speed: 2.6, detectionRange: 16, attackRange: 1.8, attackCooldown: 1.2, width: 1.3, height: 1.4, drops: [{ item: 'raw_meat', min: 2, max: 4 }, { item: 'leather', min: 1, max: 2 }], xp: 6, food: ['apple'], spawn: { where: 'surface', light: 'day', group: [1, 1], weight: 2 }, sounds: { idle: 'growl', hurt: 'growl', death: 'growl' } },
  { key: 'golem', name: 'Golem des profondeurs', category: 'boss', health: 320, damage: 9, speed: 2.2, detectionRange: 32, attackRange: 3, attackCooldown: 1.8, width: 1.6, height: 3.2, drops: [{ item: 'golem_core', min: 1, max: 1 }, { item: 'aurite_ingot', min: 2, max: 4 }, { item: 'iron_block', min: 1, max: 2 }], xp: 120, traits: ['knockbackResist'], weakness: { pickaxe: 2, sword: 0.7 }, sounds: { idle: 'golem_idle', hurt: 'stone_hit', death: 'golem_death' } },
  { key: 'liche', name: 'Liche de givre', category: 'boss', health: 240, damage: 7, speed: 2.4, detectionRange: 32, attackRange: 16, attackCooldown: 1.6, width: 0.9, height: 2.6, drops: [{ item: 'frost_heart', min: 1, max: 1 }, { item: 'frost_scepter', min: 1, max: 1 }, { item: 'crystal_shard', min: 4, max: 8 }], xp: 150, ranged: { projectile: 'ice', range: 18, damage: 5, speed: 16 }, traits: ['flies', 'knockbackResist'], weakness: { gold: 2, fire: 2 }, sounds: { idle: 'lich_idle', hurt: 'glass_hit', death: 'lich_death' } },
  { key: 'spectre', name: 'Spectre cristallin', category: 'hostile', health: 24, damage: 4, speed: 2.8, detectionRange: 18, attackRange: 10, attackCooldown: 2.2, width: 0.7, height: 1.6, drops: [{ item: 'crystal_shard', min: 1, max: 2 }, { item: 'ancient_relic', min: 1, max: 1, chance: 0.1 }], xp: 12, ranged: { projectile: 'crystal', range: 12, damage: 4, speed: 14 }, traits: ['flies'], spawn: { where: 'cave', light: 'dark', group: [1, 1], weight: 1, maxY: 24 }, sounds: { idle: 'whisper', hurt: 'glass_hit', death: 'glass_break' } },
];

export const MOB_BY_KEY = new Map(MOB_DEFS.map((m, i) => [m.key, { def: m, index: i }]));
