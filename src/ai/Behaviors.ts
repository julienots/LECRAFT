/**
 * Règles de comportement pures (sans état de jeu) : portes, mèche du creeper, renforts du zombie,
 * choix des destinations de panique / de fuite, lit du villageois. Testées dans tests/ai.test.ts ;
 * l'AIController et les créatures les appellent avec leur contexte.
 */
import { BlockRegistry, SHAPES } from '../blocks/BlockRegistry';
import type { PathWorld } from './Pathfinder';

export type Rng = () => number;
export type Cell = [number, number, number];

// ---------- portes ----------

export type DoorMode = 'none' | 'open' | 'break';
/** Créatures qui ouvrent les portes en bois (OpenDoorGoal / setCanOpenDoors du jeu Java). */
const DOOR_OPENERS = new Set(['villager', 'wandering_trader', 'pillager', 'vindicator', 'evoker', 'illusioner', 'witch', 'piglin', 'piglin_brute']);
/** Zombies qui brisent les portes (BreakDoorGoal) : famille Zombie de Java, en difficile seulement. */
const DOOR_BREAKERS = new Set(['zombie', 'husk', 'drowned', 'zombie_villager']);
/** BreakDoorGoal : 240 ticks de travail sur la porte (12 s) avant qu'elle ne cède. */
export const DOOR_BREAK_SECONDS = 12;

export function doorMode(key: string, difficulty: string): DoorMode {
  if (key.startsWith('bot:') || DOOR_OPENERS.has(key)) return 'open';
  if (DOOR_BREAKERS.has(key)) return difficulty === 'hard' ? 'break' : 'none';
  return 'none';
}

// ---------- creeper ----------

/**
 * SwellGoal du creeper : la mèche s'amorce à moins de 3 blocs d'une cible visible, continue tant que
 * la cible reste visible à moins de 7 blocs, sinon elle se dégonfle. Renvoie +1 (gonfle) ou -1.
 */
export function creeperSwellDir(swelling: boolean, dist: number, canSee: boolean): 1 | -1 {
  if (swelling) return dist > 7 || !canSee ? -1 : 1;
  return dist < 3 && canSee ? 1 : -1;
}

// ---------- renforts du zombie ----------

/**
 * Renforts (Zombie#hurt) : seulement en difficile ; chaque zombie a une chance propre (0 à 10 %,
 * « zombie.spawn_reinforcements »). Renvoie la probabilité pour ce coup.
 */
export function reinforcementChance(difficulty: string, bonus: number): number {
  return difficulty === 'hard' ? Math.max(0, bonus) : 0;
}

/** Bonus de renfort d'un zombie neuf : au hasard entre 0 et 0,1 (attribut du jeu Java). */
export const rollReinforcementBonus = (rng: Rng) => rng() * 0.1;

const solidAt = (w: PathWorld, x: number, y: number, z: number) => {
  const b = w.getBlock(x, y, z);
  return b < 0 || (b > 0 && BlockRegistry.solid[b] === 1);
};
const freeAt = (w: PathWorld, x: number, y: number, z: number) => {
  const b = w.getBlock(x, y, z);
  return b === 0 || (b > 0 && BlockRegistry.solid[b] !== 1 && BlockRegistry.liquid[b] === 0 && BlockRegistry.blocks[b].contactDamage === 0);
};

/** Cherche, en balayant vers le bas à partir de y + haut, un sol libre sur 2 blocs de haut ; renvoie le y des pieds. */
export function groundY(w: PathWorld, x: number, z: number, y: number, up = 3, down = 7): number | null {
  for (let yy = y + up; yy >= y - down; yy--) if (freeAt(w, x, yy, z) && freeAt(w, x, yy + 1, z) && solidAt(w, x, yy - 1, z) && BlockRegistry.liquid[Math.max(0, w.getBlock(x, yy - 1, z))] === 0) return yy;
  return null;
}

/**
 * Point d'apparition des renforts : 7 à 40 blocs du zombie (par axe, ou 0), sol libre, à plus de 7 blocs
 * du joueur (SpawnReinforcements : NaturalSpawner + hasNearbyAlivePlayer 7).
 */
export function reinforcementSpot(w: PathWorld, x: number, y: number, z: number, px: number, pz: number, rng: Rng): Cell | null {
  for (let t = 0; t < 50; t++) {
    const sx = Math.floor(rng() * 3) - 1, sz = Math.floor(rng() * 3) - 1;
    const tx = Math.floor(x) + (7 + Math.floor(rng() * 34)) * sx, tz = Math.floor(z) + (7 + Math.floor(rng() * 34)) * sz;
    if (Math.hypot(tx + 0.5 - px, tz + 0.5 - pz) < 7 || w.getBlock(tx, Math.floor(y), tz) < 0) continue;
    const gy = groundY(w, tx, tz, Math.floor(y), 8, 12);
    if (gy !== null) return [tx, gy, tz];
  }
  return null;
}

// ---------- panique et fuite ----------

/**
 * Eau la plus proche (rayon horizontal 5, 4 blocs en hauteur) pour une créature qui brûle :
 * PanicGoal#lookForWater du jeu Java. Renvoie la case d'eau (les pieds y entrent et le feu s'éteint).
 */
export function findWaterNear(w: PathWorld, x: number, y: number, z: number, radius = 5, vert = 4): Cell | null {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  let best: Cell | null = null, bd = Infinity;
  for (let dz = -radius; dz <= radius; dz++)
    for (let dx = -radius; dx <= radius; dx++) {
      const d = dx * dx + dz * dz;
      if (d >= bd || d > radius * radius) continue;
      for (let dy = -vert; dy <= vert; dy++) {
        const b = w.getBlock(bx + dx, by + dy, bz + dz);
        if (b > 0 && BlockRegistry.liquid[b] === 1 && !solidAt(w, bx + dx, by + dy + 1, bz + dz)) {
          best = [bx + dx, by + dy, bz + dz];
          bd = d;
          break;
        }
      }
    }
  return best;
}

/** Destination au hasard dans 5 blocs (DefaultRandomPos.getPos(mob, 5, 4) de PanicGoal). */
export function pickPanicSpot(w: PathWorld, x: number, y: number, z: number, rng: Rng, range = 5): Cell | null {
  for (let t = 0; t < 10; t++) {
    const tx = Math.floor(x + (rng() * 2 - 1) * range), tz = Math.floor(z + (rng() * 2 - 1) * range);
    const gy = groundY(w, tx, tz, Math.floor(y), 2, 4);
    if (gy !== null) return [tx, gy, tz];
  }
  return null;
}

/**
 * Destination qui éloigne de la menace (AvoidEntityGoal : DefaultRandomPos.getPosAway) : plusieurs
 * essais dans un cône opposé au danger, on garde le sol libre le plus éloigné de lui.
 */
export function pickAwaySpot(w: PathWorld, x: number, y: number, z: number, fromX: number, fromZ: number, rng: Rng, dist = 10): Cell | null {
  const base = Math.atan2(z - fromZ, x - fromX);
  const here = Math.hypot(x - fromX, z - fromZ);
  let best: Cell | null = null, bd = here;
  for (let t = 0; t < 12; t++) {
    const a = base + (rng() - 0.5) * 1.6, r = dist * (0.6 + rng() * 0.4);
    const tx = Math.floor(x + Math.cos(a) * r), tz = Math.floor(z + Math.sin(a) * r);
    const gy = groundY(w, tx, tz, Math.floor(y), 3, 6);
    if (gy === null) continue;
    const d = Math.hypot(tx + 0.5 - fromX, tz + 0.5 - fromZ);
    if (d > bd) {
      bd = d;
      best = [tx, gy, tz];
    }
  }
  return best;
}

// ---------- villageois ----------

let BED_SHAPE = -1;
/** Lit libre le plus proche (rayon horizontal, ±4 en hauteur) : Activity.REST des villageois. */
export function findBed(w: PathWorld, x: number, y: number, z: number, radius: number, taken: (k: string) => boolean): Cell | null {
  if (BED_SHAPE < 0) BED_SHAPE = SHAPES.indexOf('bed' as (typeof SHAPES)[number]) + 1;
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  let best: Cell | null = null, bd = Infinity;
  for (let dz = -radius; dz <= radius; dz++)
    for (let dx = -radius; dx <= radius; dx++) {
      const d = dx * dx + dz * dz;
      if (d >= bd) continue;
      for (let dy = -4; dy <= 4; dy++) {
        const b = w.getBlock(bx + dx, by + dy, bz + dz);
        if (b > 0 && BlockRegistry.shape[b] === BED_SHAPE && !taken(`${bx + dx},${by + dy},${bz + dz}`)) {
          best = [bx + dx, by + dy, bz + dz];
          bd = d;
          break;
        }
      }
    }
  return best;
}

/** Un villageois va se coucher à la nuit tombée, sauf s'il panique ou qu'un monstre est près de lui. */
export function villagerWantsBed(isNight: boolean, panicking: boolean): boolean {
  return isNight && !panicking;
}
