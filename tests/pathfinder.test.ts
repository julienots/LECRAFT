import { describe, expect, it } from 'vitest';
import { findPath } from '../src/ai/Pathfinder';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';
import { EXTRA_BLOCKS } from '../src/data/vanillaExtra';

registerAddonBlocks(EXTRA_BLOCKS);

/** Petit monde en mémoire : sol de pierre en y = 0 sur 32×32. */
function world() {
  const m = new Map<string, [number, number]>();
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const w = {
    set(x: number, y: number, z: number, b: number, meta = 0) {
      m.set(k(x, y, z), [b, meta]);
    },
    getBlock(x: number, y: number, z: number) {
      if (x < 0 || z < 0 || x >= 32 || z >= 32) return -1;
      return m.get(k(x, y, z))?.[0] ?? (y === 0 ? B.STONE : 0);
    },
    getMeta(x: number, y: number, z: number) {
      return m.get(k(x, y, z))?.[1] ?? 0;
    },
  };
  return w;
}

describe('Recherche de chemin (A*)', () => {
  it('contourne un mur au lieu de foncer dedans', () => {
    const w = world();
    for (let z = 0; z < 12; z++) for (let y = 1; y <= 3; y++) w.set(10, y, z, B.STONE);
    const p = findPath(w, 5, 1, 5, 15, 1, 5, { height: 2 })!;
    expect(p).not.toBeNull();
    const last = p[p.length - 1];
    expect([last[0], last[2]]).toEqual([15, 5]);
    expect(p.some(([x, , z]) => x === 10 && z >= 12)).toBe(true); // passe par l'extrémité du mur
  });

  it('monte une marche d’un bloc mais pas un mur de deux', () => {
    const w = world();
    for (let z = 0; z < 32; z++) w.set(10, 1, z, B.STONE);
    const up = findPath(w, 5, 1, 5, 15, 1, 5, { height: 2 })!;
    expect(up.some(([x, y]) => x === 10 && y === 2)).toBe(true);
    for (let z = 0; z < 32; z++) w.set(10, 2, z, B.STONE);
    const blocked = findPath(w, 5, 1, 5, 15, 1, 5, { height: 2 })!;
    // inaccessible : le chemin s'arrête au plus près, devant le mur
    expect(blocked[blocked.length - 1][0]).toBe(9);
  });

  it('évite la lave et ne franchit pas une barrière', () => {
    const w = world();
    for (let z = 0; z < 32; z++) if (z !== 20) w.set(10, 0, z, B.LAVA);
    const p = findPath(w, 5, 1, 5, 15, 1, 5, { height: 2 })!;
    expect(p.every(([x, y, z]) => !(x === 10 && y === 1 && z !== 20))).toBe(true);
    expect(p.some(([x, , z]) => x === 10 && z === 20)).toBe(true);
    const w2 = world();
    for (let z = 0; z < 32; z++) w2.set(10, 1, z, B.OAK_FENCE);
    const f = findPath(w2, 5, 1, 5, 15, 1, 5, { height: 2 })!;
    expect(f[f.length - 1][0]).toBeLessThan(10);
  });

  it('traverse une porte ouverte, pas une porte fermée', () => {
    const door = BlockRegistry.byName('oak_door').id;
    const w = world();
    for (let z = 0; z < 32; z++) for (let y = 1; y <= 3; y++) w.set(10, y, z, B.STONE);
    w.set(10, 1, 5, door, 0);
    w.set(10, 2, 5, door, 8);
    const closed = findPath(w, 5, 1, 5, 15, 1, 5, { height: 2 })!;
    expect(closed[closed.length - 1][0]).toBe(9);
    w.set(10, 1, 5, door, 4);
    w.set(10, 2, 5, door, 8 | 4);
    const open = findPath(w, 5, 1, 5, 15, 1, 5, { height: 2 })!;
    expect(open[open.length - 1]).toEqual([15, 1, 5]);
  });

  it('descend d’un rebord (jusqu’à 3 blocs)', () => {
    const w = world();
    for (let z = 0; z < 32; z++) for (let x = 0; x < 10; x++) for (let y = 1; y <= 3; y++) w.set(x, y, z, B.STONE);
    const p = findPath(w, 5, 4, 5, 15, 1, 5, { height: 2 })!;
    expect(p[p.length - 1]).toEqual([15, 1, 5]);
  });
});
