/**
 * Pose d'une structure (fichier .mcstructure ou copie en mémoire) dans le monde, avec rotation
 * par pas de 90° et miroir ; les états d'orientation des blocs d'add-ons sont tournés aussi.
 */
import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { closestBlock } from '../blocks/BlockAliases';
import { decodeStates, encodeStates } from './BedrockBlocks';
import type { StructureData } from './McStructure';

interface WorldLike {
  setBlock(x: number, y: number, z: number, id: number, meta?: number, schedule?: boolean): boolean;
}

const CARD = ['north', 'east', 'south', 'west'];
const IGNORE = new Set(['structure_void']);

/** Tourne les états d'orientation (« cardinal_direction », « facing_direction »…). */
export function rotateMeta(id: number, meta: number, steps: number, mirror: string): number {
  const info = BlockRegistry.get(id)?.def.bedrock;
  if (!info || (!steps && mirror === 'None')) return meta;
  const st = decodeStates(info, meta) as Record<string, unknown>;
  const next: Record<string, string> = {};
  for (const name of ['minecraft:cardinal_direction', 'minecraft:facing_direction']) {
    const v = st[name];
    if (typeof v !== 'string' || !CARD.includes(v)) continue;
    let i = CARD.indexOf(v);
    if ((mirror === 'X' && (v === 'east' || v === 'west')) || (mirror === 'Z' && (v === 'north' || v === 'south')) || mirror === 'XZ') i = (i + 2) % 4;
    next[name] = CARD[(i + steps) % 4];
  }
  return Object.keys(next).length ? encodeStates(info, next, meta) : meta;
}

/** Identifiant moteur et méta d'un bloc nommé (avec ses états). -1 si inconnu. */
export function resolveNamedBlock(name: string, states: Record<string, string | number | boolean>): [number, number] {
  const k = name.replace(/^minecraft:/, '');
  if (k === 'air' || k === 'cave_air') return [B.AIR, 0];
  const id = BlockRegistry.has(name) ? BlockRegistry.byName(name).id : closestBlock(k);
  if (id < 0) return [-1, 0];
  const info = BlockRegistry.get(id).def.bedrock;
  if (!info) return [id, 0];
  // les booléens sont stockés en octets (0/1) dans le NBT
  const fixed: Record<string, string | number | boolean> = {};
  for (const [s, v] of Object.entries(states)) {
    const def = info.states.find((d) => d.name === s);
    fixed[s] = def && typeof def.values[0] === 'boolean' && typeof v === 'number' ? v !== 0 : v;
  }
  return [id, encodeStates(info, fixed, 0)];
}

export function placeStructure(w: WorldLike, data: StructureData, ox: number, oy: number, oz: number, rotation = 0, mirror = 'None', includeAir = true): number {
  const [sx, , sz] = data.size;
  const steps = ((rotation % 4) + 4) % 4;
  let n = 0;
  const cache = new Map<string, [number, number]>();
  for (const b of data.blocks) {
    if (IGNORE.has(b.name.replace(/^minecraft:/, ''))) continue;
    const key = `${b.name}|${JSON.stringify(b.states)}`;
    let r = cache.get(key);
    if (!r) cache.set(key, (r = resolveNamedBlock(b.name, b.states)));
    const [id, meta] = r;
    if (id < 0 || (id === B.AIR && !includeAir)) continue;
    let x = b.x, z = b.z, wd = sx, dp = sz;
    if (mirror === 'X' || mirror === 'XZ') x = sx - 1 - x;
    if (mirror === 'Z' || mirror === 'XZ') z = sz - 1 - z;
    for (let i = 0; i < steps; i++) {
      [x, z] = [dp - 1 - z, x];
      [wd, dp] = [dp, wd];
    }
    if (w.setBlock(ox + x, oy + b.y, oz + z, id, rotateMeta(id, meta, steps, mirror), false)) n++;
  }
  return n;
}
