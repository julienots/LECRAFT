/// <reference lib="webworker" />
/**
 * Worker monde : génération procédurale + éclairage + meshing.
 * Il conserve un miroir des données de chunks (mis à jour par les messages 'set')
 * afin d'éviter de recopier les volumes voisins à chaque meshing.
 */
import { CHUNK_SIZE, LIGHT_PADDING, WORLD_HEIGHT } from '../core/Config';
import { chunkKey } from '../util/math';
import { WorldGenerator, scanSpecials } from '../world/WorldGenerator';
import { NetherGenerator } from '../world/NetherGenerator';
import { computeHeights, createChunkData, idx, type ChunkData } from '../world/ChunkData';
import { ChunkMesher, PADDED_W, PADDED_AREA } from '../render/ChunkMesher';
import { LightVolume } from '../render/Lighting';
import { buildPadded } from '../render/Padded';
import { BiomeManager } from '../world/BiomeManager';
import type { FromWorker, ToWorker } from './protocol';
import { registerAddonBlocks } from '../addons/AddonRegistry';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let gen: WorldGenerator | NetherGenerator | null = null;
const chunks = new Map<string, ChunkData>();
const mesher = new ChunkMesher();
const light = new LightVolume(PADDED_W);
const padded = new Uint16Array(PADDED_AREA * WORLD_HEIGHT);
const P = LIGHT_PADDING;

function post(msg: FromWorker, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

function load(cx: number, cz: number, saved?: { blocks: Uint16Array; meta: Uint8Array }) {
  if (!gen) throw new Error('Worker non initialisé');
  const key = chunkKey(cx, cz);
  let c = chunks.get(key);
  let generated = false;
  let specials;
  if (!c) {
    if (saved) {
      c = createChunkData(cx, cz);
      c.blocks.set(saved.blocks);
      c.meta.set(saved.meta);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) c.biomes[x + z * 16] = gen.biomeAt(cx * 16 + x, cz * 16 + z);
      computeHeights(c);
      specials = scanSpecials(c);
    } else {
      const r = gen.generateChunk(cx, cz);
      c = r.data;
      specials = r.specials;
      generated = true;
    }
    chunks.set(key, c);
  } else specials = scanSpecials(c);
  post({ type: 'chunk', cx, cz, blocks: c.blocks.slice(), meta: c.meta.slice(), biomes: c.biomes.slice(), heights: c.heights.slice(), specials, generated });
}

function applyEdits(e: Int32Array) {
  for (let i = 0; i < e.length; i += 5) {
    const x = e[i], y = e[i + 1], z = e[i + 2];
    if (y < 0 || y >= WORLD_HEIGHT) continue;
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const c = chunks.get(chunkKey(cx, cz));
    if (!c) continue;
    const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
    const j = idx(lx, y, lz);
    c.blocks[j] = e[i + 3];
    c.meta[j] = e[i + 4];
    const col = lx + lz * CHUNK_SIZE;
    if (e[i + 3] !== 0 && y > c.heights[col]) c.heights[col] = y;
    else if (e[i + 3] === 0 && y === c.heights[col]) {
      let yy = y;
      while (yy > 0 && c.blocks[idx(lx, yy, lz)] === 0) yy--;
      c.heights[col] = yy;
    }
  }
}

const grassTint = new Uint8Array(256 * 3);
const foliageTint = new Uint8Array(256 * 3);
function computeTints(cx: number, cz: number) {
  const g = gen!;
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      let gr = 0, gg = 0, gb = 0, fr = 0, fg = 0, fb = 0, n = 0;
      for (let dz = -2; dz <= 2; dz += 2)
        for (let dx = -2; dx <= 2; dx += 2) {
          const b = BiomeManager.get(g.biomeAt(cx * 16 + x + dx, cz * 16 + z + dz));
          gr += b.grassRGB[0]; gg += b.grassRGB[1]; gb += b.grassRGB[2];
          fr += b.foliageRGB[0]; fg += b.foliageRGB[1]; fb += b.foliageRGB[2];
          n++;
        }
      const k = (x + z * 16) * 3;
      grassTint[k] = gr / n; grassTint[k + 1] = gg / n; grassTint[k + 2] = gb / n;
      foliageTint[k] = fr / n; foliageTint[k + 1] = fg / n; foliageTint[k + 2] = fb / n;
    }
}

function mesh(cx: number, cz: number, job: number) {
  const center = chunks.get(chunkKey(cx, cz));
  if (!center) {
    post({ type: 'meshSkipped', cx, cz, job });
    return;
  }
  const t0 = performance.now();
  const maxY = buildPadded((x, z) => chunks.get(chunkKey(x, z)), cx, cz, padded);
  light.compute(padded);
  computeTints(cx, cz);
  const out = mesher.mesh({ blocks: padded, meta: center.meta, sky: light.sky, blk: light.blk, grassTint, foliageTint, maxY });
  // lumière du chunk central (nibbles ciel<<4 | bloc) pour le jeu (apparitions, éclairage des entités)
  const lightOut = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
  for (let y = 0; y < WORLD_HEIGHT; y++)
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const pi = x + P + (z + P) * PADDED_W + y * PADDED_AREA;
        lightOut[idx(x, y, z)] = (light.sky[pi] << 4) | light.blk[pi];
      }
  const ms = performance.now() - t0;
  const tr: Transferable[] = [];
  for (const m of [out.opaque, out.trans]) tr.push(m.pos.buffer, m.uv.buffer, m.info.buffer, m.tint.buffer, m.index.buffer);
  tr.push(lightOut.buffer);
  post({ type: 'mesh', cx, cz, job, opaque: out.opaque, trans: out.trans, light: lightOut, ms }, tr);
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'init':
        if (m.addonBlocks?.length) registerAddonBlocks(m.addonBlocks, m.addonTiles ?? []);
        gen = m.dimension === 'nether' ? new NetherGenerator(m.seed) : new WorldGenerator(m.seed);
        chunks.clear();
        break;
      case 'load':
        load(m.cx, m.cz, m.saved);
        break;
      case 'unload':
        chunks.delete(chunkKey(m.cx, m.cz));
        break;
      case 'set':
        applyEdits(m.edits);
        break;
      case 'mesh':
        mesh(m.cx, m.cz, m.job);
        break;
      case 'locate': {
        const r = gen?.structures.locate(m.key, m.x, m.z);
        post({ type: 'located', req: m.req, x: r?.x ?? 0, z: r?.z ?? 0, found: !!r });
        break;
      }
    }
  } catch (e) {
    post({ type: 'error', message: String((e as Error)?.stack ?? e) });
  }
};
