import { describe, expect, it } from 'vitest';
import { World } from '../src/world/World';
import { Chunk } from '../src/world/Chunk';
import { createChunkData, idx, computeHeights } from '../src/world/ChunkData';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';
import { EXTRA_BLOCKS } from '../src/data/vanillaExtra';
import { FireSystem, encouragement, flammability, type FireHost } from '../src/world/Fire';

registerAddonBlocks(EXTRA_BLOCKS);
const id = (k: string) => BlockRegistry.id(k);
const G = 11;

function flat() {
  const w = new World(1);
  for (let cx = -2; cx <= 2; cx++)
    for (let cz = -2; cz <= 2; cz++) {
      const d = createChunkData(cx, cz);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y <= 10; y++) d.blocks[idx(x, y, z)] = B.STONE;
      computeHeights(d);
      w.chunks.set(`${cx},${cz}`, new Chunk(d, `${cx},${cz}`));
    }
  return w;
}
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function sim(host: Partial<FireHost> = {}, seed = 1) {
  const w = flat();
  const fire = new FireSystem(w, { raining: () => false, difficulty: () => 2, ...host });
  fire.rand = seeded(seed);
  w.events.on('blockChanged', (e) => fire.blockChanged(e));
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) fire.tick();
  };
  return { w, fire, run };
}
const count = (w: World, k: string, r = 12) => {
  let n = 0;
  const t = id(k);
  for (let y = 0; y < 30; y++) for (let z = -r; z <= r; z++) for (let x = -r; x <= r; x++) if (w.getBlock(x, y, z) === t) n++;
  return n;
};

describe('Feu', () => {
  it('valeurs du jeu de référence', () => {
    expect([encouragement(id('oak_planks')), flammability(id('oak_planks'))]).toEqual([5, 20]);
    expect([encouragement(id('oak_log')), flammability(id('oak_log'))]).toEqual([5, 5]);
    expect([encouragement(id('oak_leaves')), flammability(id('oak_leaves'))]).toEqual([30, 60]);
    expect([encouragement(B.TNT), flammability(B.TNT)]).toEqual([15, 100]);
    expect(flammability(B.STONE)).toBe(0);
  });

  it('sur la pierre : s’éteint tout seul', () => {
    const { w, run } = sim();
    w.setBlock(0, G, 0, id('fire'));
    run(2000);
    expect(w.getBlock(0, G, 0)).toBe(B.AIR);
  });

  it('sur le netherrack : brûle indéfiniment', () => {
    const { w, run } = sim();
    w.setBlock(0, G - 1, 0, id('netherrack'));
    w.setBlock(0, G, 0, id('fire'));
    run(3000);
    expect(w.getBlock(0, G, 0)).toBe(id('fire'));
  });

  it('se propage dans une forêt de planches et la consume', () => {
    const { w, run } = sim();
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) w.setBlock(x, G, z, id('oak_planks'));
    w.setBlock(0, G + 1, 0, id('fire'));
    run(600);
    const left = count(w, 'oak_planks', 5);
    expect(left).toBeLessThan(81);
    run(12000);
    expect(count(w, 'oak_planks', 5)).toBeLessThan(left);
    // tout finit par s'éteindre
    run(6000);
    expect(count(w, 'fire', 8)).toBe(0);
  });

  it('la pluie l’éteint', () => {
    const { w, run } = sim({ raining: () => true });
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) w.setBlock(x, G, z, id('oak_planks'));
    w.setBlock(0, G + 1, 0, id('fire'));
    run(1200);
    expect(count(w, 'fire', 6)).toBe(0);
    expect(count(w, 'oak_planks', 5)).toBeGreaterThan(70);
  });

  it('la TNT touchée s’enflamme', () => {
    const primed: string[] = [];
    const { w, run } = sim({ primeTnt: (x, y, z) => primed.push(`${x},${y},${z}`) });
    w.setBlock(0, G, 0, B.TNT);
    w.setBlock(1, G, 0, id('fire'));
    run(4000);
    expect(primed).toContain(`0,${G},0`);
  });

  it('sans support le feu disparaît ; règle doFireTick', () => {
    const { w, run, fire } = sim({ enabled: () => false });
    w.setBlock(0, G + 3, 0, id('fire'));
    run(60);
    expect(w.getBlock(0, G + 3, 0)).toBe(B.AIR);
    for (let x = -2; x <= 2; x++) w.setBlock(x, G, 0, id('oak_planks'));
    w.setBlock(0, G + 1, 0, id('fire'));
    run(3000);
    expect(count(w, 'oak_planks', 3)).toBe(5);
    expect(fire.size).toBeGreaterThan(0);
  });

  it('la lave enflamme les planches proches', () => {
    const { w, fire } = sim();
    w.setBlock(0, G, 0, B.LAVA);
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) if (x || z) w.setBlock(x, G, z, id('oak_planks'));
    for (let i = 0; i < 400; i++) fire.lavaTick(0, G, 0);
    expect(count(w, 'fire', 3)).toBeGreaterThan(0);
  });
});
