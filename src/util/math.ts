export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Hash entier 32 bits déterministe (xxhash-like) pour la génération procédurale. */
export function hash3(seed: number, x: number, y: number, z: number): number {
  let h = (seed ^ 0x9e3779b9) | 0;
  h = Math.imul(h ^ x, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ y, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16) ^ z, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x165667b1);
  h ^= h >>> 13;
  return h >>> 0;
}
export const hash2 = (seed: number, x: number, z: number) => hash3(seed, x, 0x5bd1e995, z);
export const hashFloat = (seed: number, x: number, y: number, z: number) => hash3(seed, x, y, z) / 4294967296;

/** PRNG déterministe (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

/** Convertit une chaîne (seed textuelle) en entier 32 bits. */
export function seedFromString(s: string): number {
  const trimmed = s.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isSafeInteger(n)) return n | 0;
  }
  let h = 2166136261;
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;
