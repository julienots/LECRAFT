import { describe, expect, it } from 'vitest';
import { World } from '../src/world/World';
import { Chunk } from '../src/world/Chunk';
import { createChunkData, idx, computeHeights } from '../src/world/ChunkData';
import { B } from '../src/blocks/BlockRegistry';
import { FluidSimulator } from '../src/world/FluidSimulator';

function flat() {
  const w = new World(1);
  for (let cx = -1; cx <= 1; cx++)
    for (let cz = -1; cz <= 1; cz++) {
      const d = createChunkData(cx, cz);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y <= 10; y++) d.blocks[idx(x, y, z)] = B.STONE;
      computeHeights(d);
      w.chunks.set(`${cx},${cz}`, new Chunk(d, `${cx},${cz}`));
    }
  return w;
}
function run(w: World, f: FluidSimulator, ticks: number) {
  for (let t = 0; t < ticks; t++) {
    const q = w.updateQueue;
    w.updateQueue = [];
    for (let i = 0; i < q.length; i += 3) {
      const b = w.getBlock(q[i], q[i + 1], q[i + 2]);
      if (b === B.WATER || b === B.LAVA) f.schedule(q[i], q[i + 1], q[i + 2], b);
    }
    f.tick(w);
  }
}

describe('FluidSimulator', () => {
  it("l'eau s'étend sur 7 blocs depuis une source", () => {
    const w = flat();
    const f = new FluidSimulator();
    w.setBlock(0, 11, 0, B.WATER, 0);
    run(w, f, 200);
    expect(w.getBlock(7, 11, 0)).toBe(B.WATER);
    expect(w.getMeta(7, 11, 0)).toBe(7);
    expect(w.getBlock(8, 11, 0)).toBe(B.AIR);
    // retrait de la source : l'eau se retire
    w.setBlock(0, 11, 0, B.AIR);
    run(w, f, 300);
    expect(w.getBlock(3, 11, 0)).toBe(B.AIR);
  });
  it('la lave coule moins loin et forme de l’obsidienne avec l’eau', () => {
    const w = flat();
    const f = new FluidSimulator();
    w.setBlock(0, 11, 0, B.LAVA, 0);
    run(w, f, 600);
    expect(w.getBlock(3, 11, 0)).toBe(B.LAVA);
    expect(w.getBlock(4, 11, 0)).toBe(B.AIR);
    w.setBlock(0, 12, 0, B.WATER, 0);
    run(w, f, 100);
    expect(w.getBlock(0, 11, 0)).toBe(B.OBSIDIAN);
  });
  it("l'eau tombe dans un trou", () => {
    const w = flat();
    const f = new FluidSimulator();
    for (let y = 5; y <= 10; y++) w.setBlock(2, y, 0, B.AIR);
    w.setBlock(0, 11, 0, B.WATER, 0);
    run(w, f, 200);
    expect(w.getBlock(2, 5, 0)).toBe(B.WATER);
  });
});
