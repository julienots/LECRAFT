import { describe, expect, it } from 'vitest';
import { World } from '../src/world/World';
import { Chunk } from '../src/world/Chunk';
import { createChunkData, idx, computeHeights } from '../src/world/ChunkData';
import { B } from '../src/blocks/BlockRegistry';
import { PhysicsBody } from '../src/entities/Physics';

function flatWorld(groundY = 10) {
  const w = new World(1);
  for (let cx = -1; cx <= 1; cx++)
    for (let cz = -1; cz <= 1; cz++) {
      const d = createChunkData(cx, cz);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y <= groundY; y++) d.blocks[idx(x, y, z)] = B.STONE;
      computeHeights(d);
      w.chunks.set(`${cx},${cz}`, new Chunk(d, `${cx},${cz}`));
    }
  return w;
}

describe('PhysicsBody', () => {
  it('tombe et se pose sur le sol', () => {
    const w = flatWorld(10);
    const b = new PhysicsBody();
    b.setPos(0.5, 20, 0.5);
    for (let i = 0; i < 200; i++) b.step(w, 1 / 60);
    expect(b.y).toBeCloseTo(11, 3);
    expect(b.onGround).toBe(true);
  });
  it('est bloqué par un mur', () => {
    const w = flatWorld(10);
    w.setBlock(3, 11, 0, B.STONE);
    w.setBlock(3, 12, 0, B.STONE);
    const b = new PhysicsBody();
    b.setPos(0.5, 11, 0.5);
    for (let i = 0; i < 120; i++) {
      b.vx = 5;
      b.step(w, 1 / 60);
    }
    expect(b.x).toBeLessThan(3 - 0.29);
    expect(b.x).toBeGreaterThan(2.6);
  });
  it('ne traverse pas le sol à grande vitesse', () => {
    const w = flatWorld(10);
    const b = new PhysicsBody();
    b.setPos(0.5, 60, 0.5);
    b.vy = -55;
    for (let i = 0; i < 60; i++) b.step(w, 1 / 20);
    expect(b.y).toBeCloseTo(11, 3);
  });
  it('flotte dans l’eau (ralentit la chute)', () => {
    const w = flatWorld(5);
    for (let y = 6; y <= 12; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) w.setBlock(x, y, z, B.WATER);
    const b = new PhysicsBody();
    b.setPos(0.5, 12, 0.5);
    b.step(w, 1 / 60);
    expect(b.inWater).toBe(true);
    for (let i = 0; i < 10; i++) b.step(w, 1 / 60);
    expect(b.vy).toBeGreaterThan(-3.01);
  });
});
