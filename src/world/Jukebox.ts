/**
 * Juke-box, comme le jeu original (Java 1.21) : un disque inséré (clic droit, retiré de la main en
 * survie) joue sa piste une seule fois, sans boucler ; un clic droit sur le juke-box plein éjecte
 * le disque au-dessus ; casser le juke-box le lâche (World.containerItems). Le contenu est
 * enregistré par position comme les coffres et les fourneaux (World.jukeboxes, sauvegarde).
 *
 * Méta du bloc : bit 0 = disque présent (« has_record »), bit 1 = en lecture (le juke-box est
 * alors une source de redstone, world/Redstone.ts). Un comparateur lirait jukeboxSignal (signal
 * propre à chaque disque) ; la redstone simplifiée de LeCraft n'a pas encore de comparateur.
 */
import type { ItemStack } from '../inventory/Item';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { DISCS, discSignal, isDisc } from '../data/discs';
import type { World } from './World';

export interface JukeboxState {
  /** Disque inséré. */
  disc: ItemStack;
  /** Temps écoulé depuis le début de la piste (secondes de jeu). */
  elapsed: number;
  /** Piste en cours de lecture (faux une fois terminée : le disque reste dans le juke-box). */
  playing: boolean;
}

export const JUKEBOX_HAS_RECORD = 1;
export const JUKEBOX_PLAYING = 2;

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

export function isJukeboxBlock(id: number): boolean {
  return id > 0 && BlockRegistry.get(id).key === 'jukebox';
}

/** Durée d'une piste (secondes) ; le juke-box s'arrête une seconde après la fin (20 ticks). */
export function discLength(disc: string): number {
  return DISCS[disc]?.length ?? 0;
}

/** Met à jour les bits de méta (disque présent, en lecture) ; vrai si l'état de lecture a changé. */
function syncMeta(world: World, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  if (!isJukeboxBlock(id)) return false;
  const st = world.jukeboxes.get(key(x, y, z));
  const m = world.getMeta(x, y, z);
  const next = (m & ~3) | (st ? JUKEBOX_HAS_RECORD : 0) | (st?.playing ? JUKEBOX_PLAYING : 0);
  if (next === m) return false;
  world.setBlock(x, y, z, id, next, false);
  return (m & JUKEBOX_PLAYING) !== (next & JUKEBOX_PLAYING);
}

/** Insère un disque dans un juke-box vide ; faux si ce n'est pas possible. */
export function insertDisc(world: World, x: number, y: number, z: number, stack: ItemStack | null | undefined): boolean {
  if (!stack || !isDisc(stack.id) || !isJukeboxBlock(world.getBlock(x, y, z))) return false;
  const k = key(x, y, z);
  if (world.jukeboxes.has(k)) return false;
  world.jukeboxes.set(k, { disc: { ...stack, count: 1 }, elapsed: 0, playing: true });
  syncMeta(world, x, y, z);
  return true;
}

/** Retire le disque (éjection) ; null si le juke-box est vide. */
export function ejectDisc(world: World, x: number, y: number, z: number): ItemStack | null {
  const k = key(x, y, z);
  const st = world.jukeboxes.get(k);
  if (!st) return null;
  world.jukeboxes.delete(k);
  syncMeta(world, x, y, z);
  return st.disc;
}

/** Signal d'un comparateur placé contre le juke-box (0 s'il est vide). */
export function jukeboxSignal(world: World, x: number, y: number, z: number): number {
  return discSignal(world.jukeboxes.get(key(x, y, z))?.disc.id);
}

/** Juke-box en lecture : source de redstone (signal 15). */
export function jukeboxPowered(world: World, x: number, y: number, z: number): boolean {
  return !!world.jukeboxes.get(key(x, y, z))?.playing;
}

/**
 * Clic droit sur un juke-box : éjecte le disque s'il est plein, insère le disque tenu s'il est
 * vide. `sneaking` : rien (le jeu original n'utilise pas le bloc en se baissant).
 */
export function useJukebox(world: World, x: number, y: number, z: number, held: ItemStack | null | undefined, sneaking: boolean): { action: 'insert' | 'eject' | 'none'; disc?: ItemStack } {
  if (sneaking || !isJukeboxBlock(world.getBlock(x, y, z))) return { action: 'none' };
  if (world.jukeboxes.has(key(x, y, z))) {
    const disc = ejectDisc(world, x, y, z)!;
    return { action: 'eject', disc };
  }
  if (held && insertDisc(world, x, y, z, held)) return { action: 'insert', disc: { ...held, count: 1 } };
  return { action: 'none' };
}

/**
 * Avance la lecture de tous les juke-box (à chaque tick) : fin de piste (pas de boucle) et
 * changement de l'état « en lecture ». `onPowerChange` reçoit chaque juke-box dont la sortie
 * redstone a changé (mise à jour des portes voisines).
 */
export function tickJukeboxes(world: World, dt: number, onPowerChange?: (x: number, y: number, z: number) => void) {
  for (const [k, st] of world.jukeboxes) {
    if (!st.playing) continue;
    st.elapsed += dt;
    if (st.elapsed < discLength(st.disc.id) + 1) continue;
    st.playing = false;
    const [x, y, z] = k.split(',').map(Number);
    if (syncMeta(world, x, y, z)) onPowerChange?.(x, y, z);
  }
}

/** Juke-box en lecture (pour le son et les particules). */
export function playingJukeboxes(world: World): { key: string; x: number; y: number; z: number; disc: string; elapsed: number }[] {
  const out: { key: string; x: number; y: number; z: number; disc: string; elapsed: number }[] = [];
  for (const [k, st] of world.jukeboxes) {
    if (!st.playing) continue;
    const [x, y, z] = k.split(',').map(Number);
    out.push({ key: k, x, y, z, disc: st.disc.id, elapsed: st.elapsed });
  }
  return out;
}

/** État à enregistrer (sauvegarde) et à recharger. */
export function serializeJukeboxes(world: World): Record<string, JukeboxState> {
  return Object.fromEntries([...world.jukeboxes].map(([k, s]) => [k, { disc: { ...s.disc }, elapsed: Math.round(s.elapsed * 100) / 100, playing: s.playing }]));
}
export function loadJukeboxes(world: World, data: Record<string, JukeboxState> | undefined) {
  for (const [k, s] of Object.entries(data ?? {})) {
    if (!s?.disc?.id) continue;
    world.jukeboxes.set(k, { disc: { ...s.disc, count: 1 }, elapsed: Number(s.elapsed) || 0, playing: !!s.playing });
  }
}
