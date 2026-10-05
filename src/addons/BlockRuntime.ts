/**
 * Comportements « moteur » des blocs d'add-ons Bedrock qui ne nécessitent pas de script :
 * connexions cardinales (barrières, murs, vitres), mises à jour au changement d'un voisin.
 */
import { BlockRegistry } from '../blocks/BlockRegistry';
import { decodeStates, encodeStates } from './BedrockBlocks';

interface WorldLike {
  getBlock(x: number, y: number, z: number): number;
  getMeta(x: number, y: number, z: number): number;
}

const DIRS: [string, number, number][] = [
  ['north', 0, -1],
  ['east', 1, 0],
  ['south', 0, 1],
  ['west', -1, 0],
];

/** États minecraft:connection_* selon les voisins (même bloc, même famille d'étiquettes, ou bloc plein). */
export function connectionStates(world: WorldLike, x: number, y: number, z: number, block: number): Record<string, boolean> {
  const tags = BlockRegistry.get(block).def.bedrock?.tags ?? [];
  const out: Record<string, boolean> = {};
  for (const [name, dx, dz] of DIRS) {
    const n = world.getBlock(x + dx, y, z + dz);
    let ok = n === block || (n > 0 && BlockRegistry.opaque[n] === 1);
    if (!ok && n > 0) {
      const nt = BlockRegistry.get(n).def.bedrock?.tags ?? [];
      ok = nt.some((t) => tags.includes(t) && /fence|wall|pane|bars|connect/.test(t));
      const key = BlockRegistry.get(n).key;
      if (!ok && /fence|wall|pane|bars/.test(BlockRegistry.get(block).key)) ok = /fence|wall|pane|bars/.test(key) || BlockRegistry.shape[n] === BlockRegistry.shape[block];
    }
    out[`minecraft:connection_${name}`] = ok;
  }
  return out;
}

/** Nouvelle méta d'un bloc connecté après la modification d'un voisin (ou null si inchangée). */
export function updatedConnectionMeta(world: WorldLike, x: number, y: number, z: number, block: number): number | null {
  const info = BlockRegistry.get(block).def.bedrock;
  if (!info?.placement.connections) return null;
  const meta = world.getMeta(x, y, z);
  const next = encodeStates(info, connectionStates(world, x, y, z, block), meta);
  return next === meta ? null : next;
}

export { decodeStates };
