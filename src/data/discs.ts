/**
 * Disques de musique : catalogue de tous les disques (auteur et titre affichés au juke-box,
 * durée, signal de comparateur, couleur de l'étiquette) et nouveaux disques originaux de LeCraft,
 * dans l'esprit du disque « 11 » (fendu) : des pistes qui font peur.
 *
 * Aucune musique du jeu de référence n'est incluse : chaque piste est composée à la volée
 * (src/audio/Records.ts) ; seul le titre de l'original est affiché, comme sur la pochette.
 * Un pack de ressources qui fournit sounds/records/<nom>.ogg est joué à la place.
 */
import type { ItemDef } from '../inventory/Item';
import type { LootPool } from './vanillaLoot';

export interface DiscInfo {
  /** Auteur affiché (« C418 », « LeCraft »…). */
  author: string;
  /** Titre affiché (« cat », « Pigstep »…). */
  title: string;
  /** Durée de la piste (secondes, proche de l'original). */
  length: number;
  /** Signal d'un comparateur lisant le juke-box (1..15). */
  signal: number;
  /** Couleur de l'étiquette (icône dessinée sans pack de ressources). */
  label: string;
  /** Disque fendu (icône). */
  cracked?: boolean;
  /** Nom du fichier du pack de ressources (sounds/records/<nom>.ogg). */
  file: string;
}

/** Les 21 disques Java (durées, titres et signaux de comparateur de la 1.21). */
const JAVA_DISCS: Record<string, DiscInfo> = {
  '13': { author: 'C418', title: '13', length: 178, signal: 1, label: '#ffd800', file: '13' },
  cat: { author: 'C418', title: 'cat', length: 185, signal: 2, label: '#4cff00', file: 'cat' },
  blocks: { author: 'C418', title: 'blocks', length: 345, signal: 3, label: '#e2502a', file: 'blocks' },
  chirp: { author: 'C418', title: 'chirp', length: 185, signal: 4, label: '#c8342a', file: 'chirp' },
  far: { author: 'C418', title: 'far', length: 174, signal: 5, label: '#9ad43a', file: 'far' },
  mall: { author: 'C418', title: 'mall', length: 197, signal: 6, label: '#8a4fd8', file: 'mall' },
  mellohi: { author: 'C418', title: 'mellohi', length: 96, signal: 7, label: '#d070d0', file: 'mellohi' },
  stal: { author: 'C418', title: 'stal', length: 150, signal: 8, label: '#2a2a2a', file: 'stal' },
  strad: { author: 'C418', title: 'strad', length: 188, signal: 9, label: '#f2f2f2', file: 'strad' },
  ward: { author: 'C418', title: 'ward', length: 251, signal: 10, label: '#2f7d32', file: 'ward' },
  '11': { author: 'C418', title: '11', length: 71, signal: 11, label: '#888888', cracked: true, file: '11' },
  wait: { author: 'C418', title: 'wait', length: 238, signal: 12, label: '#3a6ee8', file: 'wait' },
  pigstep: { author: 'Lena Raine', title: 'Pigstep', length: 148, signal: 13, label: '#c8a020', file: 'pigstep' },
  otherside: { author: 'Lena Raine', title: 'otherside', length: 195, signal: 14, label: '#3ab0c8', file: 'otherside' },
  '5': { author: 'Samuel Åberg', title: '5', length: 178, signal: 15, label: '#29dfeb', file: '5' },
  relic: { author: 'Aaron Cherof', title: 'Relic', length: 218, signal: 14, label: '#4fb8a0', file: 'relic' },
  precipice: { author: 'Aaron Cherof', title: 'Precipice', length: 299, signal: 13, label: '#d07a3a', file: 'precipice' },
  creator: { author: 'Lena Raine', title: 'Creator', length: 176, signal: 12, label: '#f0c040', file: 'creator' },
  creator_music_box: { author: 'Lena Raine', title: 'Creator (Music Box)', length: 73, signal: 11, label: '#f0d880', file: 'creator_music_box' },
  tears: { author: 'Amos Roddy', title: 'Tears', length: 175, signal: 10, label: '#c8d8e8', file: 'tears' },
  lava_chicken: { author: 'Hyper Potions', title: 'Lava Chicken', length: 134, signal: 9, label: '#ff6a1a', file: 'lava_chicken' },
};

/** Nouveaux disques de LeCraft (pistes angoissantes, voir src/audio/Records.ts). */
const LECRAFT_DISCS: Record<string, DiscInfo & { name: string }> = {
  murmures: { name: 'Disque « murmures »', author: 'LeCraft', title: 'murmures', length: 96, signal: 4, label: '#b9a3d6', cracked: true, file: 'murmures' },
  toc: { name: 'Disque « toc »', author: 'LeCraft', title: 'toc', length: 84, signal: 7, label: '#9b1c1c', file: 'toc' },
  signal_perdu: { name: 'Disque « signal perdu »', author: 'LeCraft', title: 'signal perdu', length: 102, signal: 11, label: '#7fbf3f', cracked: true, file: 'signal_perdu' },
  gouffre: { name: 'Disque « gouffre »', author: 'LeCraft', title: 'gouffre', length: 130, signal: 13, label: '#2a3f8f', file: 'gouffre' },
};

/** Catalogue complet : clé d'objet (music_disc_…) → informations. */
export const DISCS: Record<string, DiscInfo> = Object.fromEntries(
  [...Object.entries(JAVA_DISCS), ...Object.entries(LECRAFT_DISCS)].map(([k, v]) => [`music_disc_${k}`, v]),
);

/** Clés des nouveaux disques de LeCraft. */
export const LECRAFT_DISC_KEYS = Object.keys(LECRAFT_DISCS).map((k) => `music_disc_${k}`);

/** Objets des nouveaux disques (enregistrés avec les autres objets, src/data/vanillaExtra.ts). */
export const DISC_ITEMS: ItemDef[] = Object.entries(LECRAFT_DISCS).map(([k, d]) => ({
  key: `music_disc_${k}`,
  name: d.name,
  maxStack: 1,
  rare: true,
  icon: { sprite: 'ball', colors: ['#202020'] },
  tab: 'ingredients',
  description: `${d.author} - ${d.title}`,
}));

export const isDisc = (id: string | undefined | null): boolean => !!id && id in DISCS;

/** Texte « Lecture en cours » du juke-box (« C418 - cat », « LeCraft - murmures »). */
export function discLabel(id: string): string {
  const d = DISCS[id];
  return d ? `${d.author} - ${d.title}` : id;
}

/** Signal de comparateur du juke-box (0 s'il est vide). */
export function discSignal(id: string | null | undefined): number {
  return id ? (DISCS[id]?.signal ?? 0) : 0;
}

/**
 * Disques lâchés par un creeper tué par un squelette (étiquette « creeper_drop_music_discs »
 * du jeu de référence) et les disques de LeCraft.
 */
export const CREEPER_DROP_DISCS = [
  'music_disc_13', 'music_disc_cat', 'music_disc_blocks', 'music_disc_chirp', 'music_disc_far', 'music_disc_mall',
  'music_disc_mellohi', 'music_disc_stal', 'music_disc_strad', 'music_disc_ward', 'music_disc_11', 'music_disc_wait',
  ...LECRAFT_DISC_KEYS,
];

/** Tueurs qui font lâcher un disque au creeper (étiquette « skeletons »). */
const SKELETON_KILLERS = new Set(['skeleton', 'stray', 'wither_skeleton', 'bogged', 'parched']);

/** Disque lâché par une créature tuée (creeper tué par un squelette), sinon null. */
export function creeperDiscDrop(victim: string, killer: string | null | undefined, rand: () => number = Math.random): string | null {
  if (victim !== 'creeper' || !killer || !SKELETON_KILLERS.has(killer)) return null;
  return CREEPER_DROP_DISCS[Math.min(CREEPER_DROP_DISCS.length - 1, Math.floor(rand() * CREEPER_DROP_DISCS.length))];
}

/** Pool supplémentaire des coffres de puits de mine : un disque de LeCraft de temps en temps. */
export const DISC_CHEST_POOL: LootPool[] = [[[1, 1], [...LECRAFT_DISC_KEYS.map((k): [string, number, number, number] => [k, 2, 1, 1]), ['', 72, 0, 0]]]];
