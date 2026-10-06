import { describe, it, expect } from 'vitest';
import { parseMcStructure } from '../src/addons/McStructure';

/** Encodeur NBT petit-boutiste minimal (tests). */
function nbt(root: Record<string, unknown>): Uint8Array {
  const out: number[] = [];
  const u8 = (v: number) => out.push(v & 255);
  const i16 = (v: number) => (u8(v), u8(v >> 8));
  const i32 = (v: number) => (u8(v), u8(v >> 8), u8(v >> 16), u8(v >> 24));
  const str = (s: string) => {
    const b = new TextEncoder().encode(s);
    i16(b.length);
    b.forEach(u8);
  };
  const type = (v: unknown): number => (typeof v === 'string' ? 8 : typeof v === 'number' ? 3 : Array.isArray(v) ? 9 : 10);
  const payload = (v: unknown) => {
    if (typeof v === 'string') str(v);
    else if (typeof v === 'number') i32(v);
    else if (Array.isArray(v)) {
      u8(v.length ? type(v[0]) : 3);
      i32(v.length);
      v.forEach(payload);
    } else {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        u8(type(x));
        str(k);
        payload(x);
      }
      u8(0);
    }
  };
  u8(10);
  str('');
  payload(root);
  return new Uint8Array(out);
}

describe('mcstructure', () => {
  it('lit taille, palette et indices (ordre x, y, z ; -1 = vide)', () => {
    const data = nbt({
      format_version: 1,
      size: [2, 1, 2],
      structure: {
        block_indices: [[0, -1, 1, 0], [-1, -1, -1, -1]],
        entities: [],
        palette: { default: { block_palette: [{ name: 'minecraft:stone', states: {}, version: 1 }, { name: 'test:lamp', states: { 'test:lit': 1 }, version: 1 }], block_position_data: {} } },
      },
      structure_world_origin: [0, 0, 0],
    });
    const s = parseMcStructure(data);
    expect(s.size).toEqual([2, 1, 2]);
    expect(s.blocks).toEqual([
      { x: 0, y: 0, z: 0, name: 'minecraft:stone', states: {} },
      { x: 1, y: 0, z: 0, name: 'test:lamp', states: { 'test:lit': 1 } },
      { x: 1, y: 0, z: 1, name: 'minecraft:stone', states: {} },
    ]);
  });
});
