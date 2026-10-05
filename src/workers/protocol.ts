import type { MeshArrays } from '../render/ChunkMesher';
import type { SpecialBlock } from '../world/ChunkData';

/** Messages thread principal -> worker. */
export type ToWorker =
  | { type: 'init'; seed: number; addonBlocks?: import('../blocks/Block').BlockDef[] }
  | { type: 'load'; cx: number; cz: number; saved?: { blocks: Uint8Array; meta: Uint8Array } }
  | { type: 'unload'; cx: number; cz: number }
  | { type: 'set'; edits: Int32Array } // [x,y,z,id,meta]*
  | { type: 'mesh'; cx: number; cz: number; job: number }
  | { type: 'locate'; key: string; x: number; z: number; req: number };

/** Messages worker -> thread principal. */
export type FromWorker =
  | { type: 'chunk'; cx: number; cz: number; blocks: Uint8Array; meta: Uint8Array; biomes: Uint8Array; heights: Uint8Array; specials: SpecialBlock[]; generated: boolean }
  | { type: 'mesh'; cx: number; cz: number; job: number; opaque: MeshArrays; trans: MeshArrays; light: Uint8Array; ms: number }
  | { type: 'meshSkipped'; cx: number; cz: number; job: number }
  | { type: 'located'; req: number; x: number; z: number; found: boolean }
  | { type: 'error'; message: string };
