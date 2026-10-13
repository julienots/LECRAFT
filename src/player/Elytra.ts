import type { ItemStack } from '../inventory/Item';

/**
 * Vol plané en élytres, porté de LivingEntity.travel (Java 1.21).
 * Les formules travaillent en blocs/tick (20 ticks/s) ; le contrôleur convertit (×20).
 */
export const GLIDE_TICK = 1 / 20;

export interface Vel {
  x: number;
  y: number;
  z: number;
}

/** Élytres portées et utilisables (durabilité restante > 1, comme le jeu de référence). */
export function canGlideWith(chest: ItemStack | null | undefined): boolean {
  return !!chest && chest.id === 'elytra' && (chest.durability === undefined || chest.durability > 1);
}

/** Vecteur de regard (pitch > 0 = vers le haut, yaw 0 = vers -Z). */
export function lookVec(yaw: number, pitch: number): Vel {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/**
 * Un tick de vol plané (vitesses en blocs/tick, modifiées en place).
 * `gravity` = 0,08 (0,01 avec Chute lente en descente).
 */
export function glideTick(v: Vel, yaw: number, pitch: number, gravity = 0.08) {
  const look = lookVec(yaw, pitch);
  // angle Java : xRot > 0 = regard vers le bas
  const xRot = -pitch;
  const hLook = Math.hypot(look.x, look.z);
  const hSpeed = Math.hypot(v.x, v.z);
  const c = Math.cos(xRot);
  const lift = c * c; // longueur du regard = 1 → min(1, 1/0,4) = 1
  v.y += gravity * (-1 + lift * 0.75);
  // descente : la chute est convertie en vitesse horizontale
  if (v.y < 0 && hLook > 0) {
    const d = v.y * -0.1 * lift;
    v.x += (look.x * d) / hLook;
    v.y += d;
    v.z += (look.z * d) / hLook;
  }
  // montée : la vitesse horizontale est convertie en altitude
  if (xRot < 0 && hLook > 0) {
    const d = hSpeed * -Math.sin(xRot) * 0.04;
    v.x += (-look.x * d) / hLook;
    v.y += d * 3.2;
    v.z += (-look.z * d) / hLook;
  }
  // la trajectoire s'aligne sur le regard
  if (hLook > 0) {
    v.x += ((look.x / hLook) * hSpeed - v.x) * 0.1;
    v.z += ((look.z / hLook) * hSpeed - v.z) * 0.1;
  }
  v.x *= 0.99;
  v.y *= 0.98;
  v.z *= 0.99;
}

/** Poussée d'une fusée d'artifice, un tick (blocs/tick, en place). */
export function rocketTick(v: Vel, yaw: number, pitch: number) {
  const l = lookVec(yaw, pitch);
  v.x += l.x * 0.1 + (l.x * 1.5 - v.x) * 0.5;
  v.y += l.y * 0.1 + (l.y * 1.5 - v.y) * 0.5;
  v.z += l.z * 0.1 + (l.z * 1.5 - v.z) * 0.5;
}

/** Dégâts d'impact contre un mur (« fly into wall ») : vitesses horizontales en blocs/tick. */
export function wallDamage(before: number, after: number): number {
  const d = (before - after) * 10 - 3;
  return d > 0 ? d : 0;
}

/** Durée d'une fusée (ticks) : 10 × (vol + 1) + aléa, comme le jeu de référence. */
export function rocketTicks(flight = 1, rand: () => number = Math.random): number {
  return 10 * (flight + 1) + Math.floor(rand() * 6) + Math.floor(rand() * 7);
}
