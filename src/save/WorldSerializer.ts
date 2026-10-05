/** Sérialisation compacte : RLE des tableaux de blocs + checksums anti-corruption. */

export function rleEncode(a: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length * 2 + 2);
  let o = 0;
  let i = 0;
  while (i < a.length) {
    const v = a[i];
    let n = 1;
    while (i + n < a.length && a[i + n] === v && n < 255) n++;
    out[o++] = n;
    out[o++] = v;
    i += n;
  }
  return out.slice(0, o);
}

export function rleDecode(e: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i + 1 < e.length; i += 2) {
    const n = e[i], v = e[i + 1];
    if (o + n > length) throw new Error('RLE corrompu (dépassement)');
    out.fill(v, o, o + n);
    o += n;
  }
  if (o !== length) throw new Error(`RLE corrompu (${o}/${length})`);
  return out;
}

/** RLE 16 bits : triplets [longueur, octet bas, octet haut]. */
export function rleEncode16(a: Uint16Array): Uint8Array {
  const out = new Uint8Array(a.length * 3 + 3);
  let o = 0;
  let i = 0;
  while (i < a.length) {
    const v = a[i];
    let n = 1;
    while (i + n < a.length && a[i + n] === v && n < 255) n++;
    out[o++] = n;
    out[o++] = v & 255;
    out[o++] = v >> 8;
    i += n;
  }
  return out.slice(0, o);
}

export function rleDecode16(e: Uint8Array, length: number): Uint16Array {
  const out = new Uint16Array(length);
  let o = 0;
  for (let i = 0; i + 2 < e.length; i += 3) {
    const n = e[i], v = e[i + 1] | (e[i + 2] << 8);
    if (o + n > length) throw new Error('RLE corrompu (dépassement)');
    out.fill(v, o, o + n);
    o += n;
  }
  if (o !== length) throw new Error(`RLE corrompu (${o}/${length})`);
  return out;
}

/** FNV-1a 32 bits sur une chaîne. */
export function checksumString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function checksumBytes(a: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < a.length; i++) {
    h ^= a[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
