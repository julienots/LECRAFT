import { describe, expect, it } from 'vitest';
import { WorldGenerator } from '../src/world/WorldGenerator';
import { ChunkMesher, PADDED_AREA, PADDED_W } from '../src/render/ChunkMesher';
import { LightVolume } from '../src/render/Lighting';
import { buildPadded } from '../src/render/Padded';
import { createChunkData, computeHeights, idx, type ChunkData } from '../src/world/ChunkData';
import { B } from '../src/blocks/BlockRegistry';
import { LIGHT_PADDING, WORLD_HEIGHT } from '../src/core/Config';

const tints = () => new Uint8Array(256 * 3).fill(200);

function meshOf(get: (x: number, z: number) => ChunkData | undefined, center: ChunkData) {
  const padded = new Uint8Array(PADDED_AREA * WORLD_HEIGHT);
  const maxY = buildPadded(get, center.cx, center.cz, padded);
  const light = new LightVolume(PADDED_W);
  light.compute(padded);
  return { out: new ChunkMesher().mesh({ blocks: padded, meta: center.meta, sky: light.sky, blk: light.blk, grassTint: tints(), foliageTint: tints(), maxY }), light };
}

describe('ChunkMesher', () => {
  it('un bloc isolé produit 6 faces (24 sommets)', () => {
    const c = createChunkData(0, 0);
    c.blocks[idx(5, 10, 5)] = B.STONE;
    computeHeights(c);
    const { out } = meshOf((x, z) => (x === 0 && z === 0 ? c : undefined), c);
    expect(out.opaque.vertexCount).toBe(24);
    expect(out.opaque.index.length).toBe(36);
  });

  it('le greedy meshing fusionne une dalle plate', () => {
    const c = createChunkData(0, 0);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) c.blocks[idx(x, 10, z)] = B.STONE;
    computeHeights(c);
    const { out } = meshOf((x, z) => (x === 0 && z === 0 ? c : undefined), c);
    // le dessus (uniformément éclairé) doit être un seul quad fusionné
    let top = 0;
    for (let v = 0; v < out.opaque.vertexCount; v++) if (out.opaque.pos[v * 3 + 1] === 11 * 16) top++;
    expect(top).toBeLessThanOrEqual(4 + 4 * 4 * 2);
    expect(out.opaque.vertexCount).toBeLessThan(16 * 16 * 4 * 2);
  });

  it('la lumière du ciel descend et la torche éclaire', () => {
    const c = createChunkData(0, 0);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y < 60; y++) c.blocks[idx(x, y, z)] = B.STONE;
    c.blocks[idx(8, 40, 8)] = B.AIR;
    c.blocks[idx(8, 41, 8)] = B.TORCH;
    computeHeights(c);
    const { light } = meshOf((x, z) => (x === 0 && z === 0 ? c : undefined), c);
    const P = LIGHT_PADDING;
    const pi = (x: number, y: number, z: number) => x + P + (z + P) * PADDED_W + y * PADDED_AREA;
    expect(light.sky[pi(8, 70, 8)]).toBe(15);
    expect(light.sky[pi(8, 40, 8)]).toBe(0);
    expect(light.blk[pi(8, 41, 8)]).toBe(14);
    expect(light.blk[pi(8, 40, 8)]).toBe(13);
  });

  it('meshe un chunk généré en un temps raisonnable', () => {
    const g = new WorldGenerator(839274928);
    const store = new Map<string, ChunkData>();
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) store.set(`${x},${z}`, g.generateChunk(x, z).data);
    const get = (x: number, z: number) => store.get(`${x},${z}`);
    meshOf(get, get(0, 0)!);
    const t0 = performance.now();
    const { out } = meshOf(get, get(0, 0)!);
    const ms = performance.now() - t0;
    console.log('mesh ms', ms.toFixed(1), 'verts', out.opaque.vertexCount, 'trans', out.trans.vertexCount);
    expect(out.opaque.vertexCount).toBeGreaterThan(100);
    expect(ms).toBeLessThan(250);
  });
});
