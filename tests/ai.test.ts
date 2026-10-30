import { describe, expect, it } from 'vitest';
import { findPath } from '../src/ai/Pathfinder';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';
import { EXTRA_BLOCKS } from '../src/data/vanillaExtra';
import { creeperSwellDir, doorMode, DOOR_BREAK_SECONDS, findBed, findWaterNear, groundY, pickAwaySpot, pickPanicSpot, reinforcementChance, reinforcementSpot, villagerWantsBed } from '../src/ai/Behaviors';

registerAddonBlocks(EXTRA_BLOCKS);

/** Petit monde en mémoire : sol de pierre en y = 0 sur 64×64. */
function world() {
  const m = new Map<string, [number, number]>();
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  return {
    set(x: number, y: number, z: number, b: number | string, meta = 0) {
      m.set(k(x, y, z), [typeof b === 'string' ? BlockRegistry.byName(b).id : b, meta]);
    },
    getBlock(x: number, y: number, z: number) {
      if (x < 0 || z < 0 || x >= 64 || z >= 64) return -1;
      return m.get(k(x, y, z))?.[0] ?? (y === 0 ? B.STONE : 0);
    },
    getMeta(x: number, y: number, z: number) {
      return m.get(k(x, y, z))?.[1] ?? 0;
    },
  };
}
type W = ReturnType<typeof world>;

/** Mur plein de 3 blocs en x = 10 avec une porte de bois en z = 5 (deux moitiés). */
function wallWithDoor(w: W, door = 'oak_door', open = false) {
  for (let z = 0; z < 64; z++) for (let y = 1; y <= 3; y++) w.set(10, y, z, B.STONE);
  w.set(10, 1, 5, door, open ? 4 : 0);
  w.set(10, 2, 5, door, 8 | (open ? 4 : 0));
}
const reach = (p: ReturnType<typeof findPath>, x: number, z: number) => !!p && p.length > 0 && p[p.length - 1][0] === x && p[p.length - 1][2] === z;

describe('Pathfinder : portes', () => {
  it('une porte fermée barre la route sans option', () => {
    const w = world();
    wallWithDoor(w);
    expect(reach(findPath(w, 5, 1, 5, 15, 1, 5, { height: 2, maxNodes: 1500 }), 15, 5)).toBe(false);
  });
  it('les créatures qui ouvrent les portes passent par la porte fermée', () => {
    const w = world();
    wallWithDoor(w);
    const p = findPath(w, 5, 1, 5, 15, 1, 5, { height: 2, doors: 'open' });
    expect(reach(p, 15, 5)).toBe(true);
    expect(p!.some(([x, , z]) => x === 10 && z === 5)).toBe(true);
  });
  it('les zombies qui brisent la porte la traversent aussi, mais la préfèrent une brèche proche', () => {
    const w = world();
    wallWithDoor(w);
    expect(reach(findPath(w, 5, 1, 5, 15, 1, 5, { height: 2, doors: 'break' }), 15, 5)).toBe(true);
    // brèche à 2 blocs de la porte : le détour coûte moins que 12 s de bris
    w.set(10, 1, 7, 0);
    w.set(10, 2, 7, 0);
    w.set(10, 3, 7, 0);
    const p = findPath(w, 5, 1, 5, 15, 1, 5, { height: 2, doors: 'break' })!;
    expect(p.some(([x, , z]) => x === 10 && z === 7)).toBe(true);
    expect(p.some(([x, , z]) => x === 10 && z === 5)).toBe(false);
  });
  it('la porte en fer résiste à tous', () => {
    const w = world();
    wallWithDoor(w, 'iron_door');
    expect(reach(findPath(w, 5, 1, 5, 15, 1, 5, { height: 2, doors: 'open', maxNodes: 1500 }), 15, 5)).toBe(false);
    expect(reach(findPath(w, 5, 1, 5, 15, 1, 5, { height: 2, doors: 'break', maxNodes: 1500 }), 15, 5)).toBe(false);
  });
});

describe('Pathfinder : cases dangereuses', () => {
  it('évite de longer la lave quand un autre passage existe', () => {
    const w = world();
    // ruban de lave en z = 6 (sol creusé) : le chemin direct en z = 5 la longerait
    for (let x = 6; x < 14; x++) w.set(x, 0, 6, B.LAVA);
    const p = findPath(w, 5, 1, 5, 15, 1, 5, { height: 2 })!;
    expect(reach(p, 15, 5)).toBe(true);
    expect(p.every(([x, , z]) => !(x >= 6 && x < 14 && z === 5))).toBe(true);
  });
  it('contourne un feu de camp, un cactus et un buisson de baies', () => {
    for (const bad of ['campfire', 'cactus', 'sweet_berry_bush']) {
      const w = world();
      for (let z = 0; z < 64; z++) if (z !== 20) w.set(10, 1, z, B.STONE), w.set(10, 2, z, B.STONE);
      w.set(10, 1, 5, 0);
      w.set(10, 2, 5, 0);
      w.set(10, 1, 5, bad);
      const p = findPath(w, 5, 1, 5, 15, 1, 5, { height: 2, maxNodes: 1500 })!;
      expect(p.some(([x, y, z]) => x === 10 && y === 1 && z === 5), bad).toBe(false);
    }
  });
  it('évite la toile d’araignée si un détour court existe', () => {
    const w = world();
    w.set(8, 1, 5, 'cobweb');
    const p = findPath(w, 5, 1, 5, 12, 1, 5, { height: 2 })!;
    expect(reach(p, 12, 5)).toBe(true);
    expect(p.some(([x, y, z]) => x === 8 && y === 1 && z === 5)).toBe(false);
  });
  it('un trou de 5 blocs n’est pas franchi à pied : le chemin le contourne', () => {
    const w = world();
    for (let x = 8; x <= 12; x++) for (let z = 0; z < 12; z++) for (let y = -5; y <= 0; y++) w.set(x, y, z, 0);
    const p = findPath(w, 5, 1, 5, 15, 1, 5, { height: 2, maxNodes: 1500 })!;
    expect(reach(p, 15, 5)).toBe(true);
    expect(p.every(([x, y]) => !(x >= 8 && x <= 12 && y < 1))).toBe(true);
    expect(p.some(([x, , z]) => x === 10 && z >= 12)).toBe(true);
  });
});

describe('Règles de comportement', () => {
  it('portes : villageois ouvrent, zombies brisent seulement en difficile', () => {
    expect(doorMode('villager', 'easy')).toBe('open');
    expect(doorMode('pillager', 'normal')).toBe('open');
    expect(doorMode('bot:alex', 'normal')).toBe('open');
    expect(doorMode('zombie', 'hard')).toBe('break');
    expect(doorMode('husk', 'hard')).toBe('break');
    expect(doorMode('zombie', 'normal')).toBe('none');
    expect(doorMode('skeleton', 'hard')).toBe('none');
    expect(doorMode('cow', 'hard')).toBe('none');
    expect(DOOR_BREAK_SECONDS).toBe(12);
  });
  it('creeper : amorce à moins de 3 blocs, continue jusqu’à 7 blocs en vue, sinon se dégonfle', () => {
    expect(creeperSwellDir(false, 2.9, true)).toBe(1);
    expect(creeperSwellDir(false, 3.1, true)).toBe(-1);
    expect(creeperSwellDir(false, 2, false)).toBe(-1);
    expect(creeperSwellDir(true, 6.9, true)).toBe(1);
    expect(creeperSwellDir(true, 7.1, true)).toBe(-1);
    expect(creeperSwellDir(true, 4, false)).toBe(-1);
  });
  it('renforts du zombie : difficile seulement', () => {
    expect(reinforcementChance('hard', 0.07)).toBe(0.07);
    expect(reinforcementChance('normal', 0.07)).toBe(0);
    expect(reinforcementChance('easy', 0.07)).toBe(0);
    expect(reinforcementChance('hard', -0.03)).toBe(0);
  });
  it('point de renfort : 7 à 40 blocs du zombie, à plus de 7 blocs du joueur, sur un sol libre', () => {
    const w = world();
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 20; i++) {
      const s = reinforcementSpot(w, 32, 1, 32, 32, 32, rng);
      if (!s) continue;
      expect(s[1]).toBe(1);
      expect(Math.max(Math.abs(s[0] - 32), Math.abs(s[2] - 32))).toBeGreaterThanOrEqual(7);
      expect(Math.hypot(s[0] + 0.5 - 32, s[2] + 0.5 - 32)).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('Panique et fuite', () => {
  it('groundY : trouve le sol, null au-dessus du vide', () => {
    const w = world();
    expect(groundY(w, 5, 5, 1)).toBe(1);
    w.set(5, 0, 5, 0);
    expect(groundY(w, 5, 5, 1, 3, 3)).toBeNull();
  });
  it('animal en feu : l’eau la plus proche dans 5 blocs, rien au-delà', () => {
    const w = world();
    w.set(12, 0, 8, B.WATER);
    w.set(20, 0, 8, B.WATER);
    expect(findWaterNear(w, 10, 1, 8)).toEqual([12, 0, 8]);
    expect(findWaterNear(w, 10, 1, 20)).toBeNull();
    w.set(11, 0, 10, B.WATER);
    expect(findWaterNear(w, 10, 1, 10)).toEqual([11, 0, 10]); // une eau plus proche l'emporte
  });
  it('l’eau recouverte d’un bloc plein n’est pas retenue', () => {
    const w = world();
    w.set(12, 0, 8, B.WATER);
    w.set(12, 1, 8, B.STONE);
    expect(findWaterNear(w, 10, 1, 8)).toBeNull();
  });
  it('destination de panique : dans 5 blocs, sur le sol', () => {
    const w = world();
    let seed = 3;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 20; i++) {
      const s = pickPanicSpot(w, 30, 1, 30, rng)!;
      expect(s).not.toBeNull();
      expect(Math.hypot(s[0] - 30, s[2] - 30)).toBeLessThanOrEqual(7.1);
    }
  });
  it('fuite : le point choisi est plus loin de la menace que la créature, jamais dans le vide', () => {
    const w = world();
    for (let x = 0; x < 64; x++) for (let z = 0; z < 18; z++) for (let y = -3; y <= 0; y++) w.set(x, y, z, 0); // vide au sud
    let seed = 11;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 30; i++) {
      const s = pickAwaySpot(w, 30, 1, 30, 30, 36, rng, 10);
      expect(s).not.toBeNull();
      expect(s![2]).toBeLessThan(30); // la menace est au sud (z = 36) : on fuit vers le nord
      expect(w.getBlock(s![0], s![1] - 1, s![2])).toBe(B.STONE);
      expect(Math.hypot(s![0] + 0.5 - 30, s![2] + 0.5 - 36)).toBeGreaterThan(6);
    }
    // acculée contre le vide : aucune destination plus éloignée
    expect(pickAwaySpot(w, 30, 1, 19, 30, 36, rng, 10)).toBeNull();
  });
});

describe('Villageois : lit', () => {
  it('cherche le lit libre le plus proche, ignore les lits réservés', () => {
    const w = world();
    w.set(14, 1, 10, 'red_bed');
    w.set(20, 1, 10, 'red_bed');
    expect(findBed(w, 10, 1, 10, 24, () => false)).toEqual([14, 1, 10]);
    expect(findBed(w, 10, 1, 10, 24, (k) => k === '14,1,10')).toEqual([20, 1, 10]);
    expect(findBed(w, 10, 1, 10, 3, () => false)).toBeNull();
  });
  it('couche seulement la nuit et sans panique', () => {
    expect(villagerWantsBed(true, false)).toBe(true);
    expect(villagerWantsBed(false, false)).toBe(false);
    expect(villagerWantsBed(true, true)).toBe(false);
  });
});
