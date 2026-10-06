/**
 * Lecture des structures Bedrock (.mcstructure) : NBT petit-boutiste non compressé.
 * Donne la taille et la liste des blocs (nom + états) ; les entités sont ignorées.
 */

export interface StructureData {
  size: [number, number, number];
  /** Blocs hors « vide de structure » : position relative, nom et états. */
  blocks: { x: number; y: number; z: number; name: string; states: Record<string, string | number | boolean> }[];
}

type Nbt = number | bigint | string | Nbt[] | { [k: string]: Nbt } | Int8Array | Int32Array | BigInt64Array;

class Reader {
  private v: DataView;
  p = 0;
  constructor(private b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8() {
    return this.v.getUint8(this.p++);
  }
  i8() {
    return this.v.getInt8(this.p++);
  }
  i16() {
    const r = this.v.getInt16(this.p, true);
    this.p += 2;
    return r;
  }
  u16() {
    const r = this.v.getUint16(this.p, true);
    this.p += 2;
    return r;
  }
  i32() {
    const r = this.v.getInt32(this.p, true);
    this.p += 4;
    return r;
  }
  i64() {
    const r = this.v.getBigInt64(this.p, true);
    this.p += 8;
    return r;
  }
  f32() {
    const r = this.v.getFloat32(this.p, true);
    this.p += 4;
    return r;
  }
  f64() {
    const r = this.v.getFloat64(this.p, true);
    this.p += 8;
    return r;
  }
  str() {
    const n = this.u16();
    const s = new TextDecoder().decode(this.b.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
  payload(t: number, depth = 0): Nbt {
    if (depth > 64) throw new Error('NBT trop profond');
    switch (t) {
      case 1:
        return this.i8();
      case 2:
        return this.i16();
      case 3:
        return this.i32();
      case 4:
        return this.i64();
      case 5:
        return this.f32();
      case 6:
        return this.f64();
      case 7: {
        const n = this.i32();
        const a = new Int8Array(this.b.buffer.slice(this.b.byteOffset + this.p, this.b.byteOffset + this.p + n));
        this.p += n;
        return a;
      }
      case 8:
        return this.str();
      case 9: {
        const et = this.u8();
        const n = this.i32();
        if (n < 0 || n > 1e8) throw new Error('Liste NBT invalide');
        const out: Nbt[] = new Array(n);
        for (let i = 0; i < n; i++) out[i] = this.payload(et, depth + 1);
        return out;
      }
      case 10: {
        const o: { [k: string]: Nbt } = {};
        for (;;) {
          const tt = this.u8();
          if (tt === 0) break;
          const name = this.str();
          o[name] = this.payload(tt, depth + 1);
        }
        return o;
      }
      case 11: {
        const n = this.i32();
        const a = new Int32Array(n);
        for (let i = 0; i < n; i++) a[i] = this.i32();
        return a;
      }
      case 12: {
        const n = this.i32();
        const a = new BigInt64Array(n);
        for (let i = 0; i < n; i++) a[i] = this.i64();
        return a;
      }
      default:
        throw new Error(`Étiquette NBT inconnue : ${t}`);
    }
  }
}

/** Lit un NBT petit-boutiste (racine composée). */
export function readNbt(data: Uint8Array): { [k: string]: Nbt } {
  const r = new Reader(data);
  const t = r.u8();
  if (t !== 10) throw new Error('Racine NBT attendue');
  r.str();
  return r.payload(10) as { [k: string]: Nbt };
}

const num = (v: Nbt | undefined): number => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : 0);

export function parseMcStructure(data: Uint8Array): StructureData {
  const root = readNbt(data);
  const size = (root.size as Nbt[]).map(num) as [number, number, number];
  const st = root.structure as { [k: string]: Nbt };
  const layers = st.block_indices as Nbt[];
  const idx = (layers[0] as Nbt[] | Int32Array) ?? [];
  const pal = (((st.palette as { [k: string]: Nbt }).default as { [k: string]: Nbt }).block_palette as { [k: string]: Nbt }[]) ?? [];
  const palette = pal.map((p) => {
    const states: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries((p.states as { [k: string]: Nbt }) ?? {})) states[k] = typeof v === 'string' ? v : typeof v === 'bigint' ? Number(v) : (v as number);
    return { name: String(p.name), states };
  });
  const [sx, sy, sz] = size;
  const blocks: StructureData['blocks'] = [];
  for (let i = 0; i < idx.length; i++) {
    const pi = num(idx[i] as Nbt);
    if (pi < 0) continue;
    const e = palette[pi];
    if (!e) continue;
    const x = Math.floor(i / (sy * sz)), y = Math.floor(i / sz) % sy, z = i % sz;
    blocks.push({ x, y, z, name: e.name, states: e.states });
  }
  void sx;
  return { size, blocks };
}
