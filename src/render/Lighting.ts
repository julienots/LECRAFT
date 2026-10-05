/**
 * Éclairage voxel : lumière du ciel (0..15) + lumière des blocs (0..15) propagées par BFS
 * sur un volume « padded » (chunk + marge) pour obtenir des transitions correctes aux bords.
 * Exécuté dans le worker de meshing.
 */
import { BlockRegistry } from '../blocks/BlockRegistry';
import { WORLD_HEIGHT } from '../core/Config';

export class LightVolume {
  readonly sky: Uint8Array;
  readonly blk: Uint8Array;
  private queue: Int32Array;
  constructor(readonly W: number, readonly H = WORLD_HEIGHT) {
    const n = W * W * H;
    this.sky = new Uint8Array(n);
    this.blk = new Uint8Array(n);
    this.queue = new Int32Array(n);
  }

  compute(blocks: Uint16Array) {
    const { W, H, sky, blk, queue } = this;
    const area = W * W;
    const opaque = BlockRegistry.opaque;
    const filter = BlockRegistry.lightFilter;
    const emit = BlockRegistry.lightEmit;
    sky.fill(0);
    blk.fill(0);
    let head = 0, tail = 0;
    const n = area * H;

    // 1) Colonnes de ciel
    for (let c = 0; c < area; c++) {
      let level = 15;
      for (let y = H - 1; y >= 0; y--) {
        const i = c + y * area;
        const b = blocks[i];
        if (opaque[b]) {
          level = 0;
          break;
        }
        level -= filter[b];
        if (level <= 0) break;
        sky[i] = level;
      }
    }
    // 2) Sources de propagation : cellules éclairées adjacentes à une cellule plus sombre
    for (let i = 0; i < n; i++) {
      const s = sky[i];
      const e = emit[blocks[i]];
      if (e > 0) blk[i] = e;
      if (s < 2) continue;
      const x = i % W, z = ((i / W) | 0) % W;
      if ((x > 0 && sky[i - 1] < s - 1) || (x < W - 1 && sky[i + 1] < s - 1) || (z > 0 && sky[i - W] < s - 1) || (z < W - 1 && sky[i + W] < s - 1) || (i >= area && sky[i - area] < s - 1)) queue[tail++] = i;
    }
    this.bfs(blocks, sky, head, tail);
    // 3) Lumière des blocs
    tail = 0;
    for (let i = 0; i < n; i++) if (blk[i] > 1) queue[tail++] = i;
    this.bfs(blocks, blk, 0, tail);
  }

  private bfs(blocks: Uint16Array, light: Uint8Array, head: number, tail: number) {
    const { W, H, queue } = this;
    const area = W * W;
    const opaque = BlockRegistry.opaque;
    const filter = BlockRegistry.lightFilter;
    const cap = queue.length;
    let count = tail - head;
    while (count > 0) {
      const i = queue[head];
      head = (head + 1) % cap;
      count--;
      const l = light[i];
      if (l <= 1) continue;
      const x = i % W, z = ((i / W) | 0) % W, y = (i / area) | 0;
      for (let d = 0; d < 6; d++) {
        let j: number;
        switch (d) {
          case 0: if (x === W - 1) continue; j = i + 1; break;
          case 1: if (x === 0) continue; j = i - 1; break;
          case 2: if (z === W - 1) continue; j = i + W; break;
          case 3: if (z === 0) continue; j = i - W; break;
          case 4: if (y === H - 1) continue; j = i + area; break;
          default: if (y === 0) continue; j = i - area; break;
        }
        const b = blocks[j];
        if (opaque[b]) continue;
        const nl = l - 1 - filter[b];
        if (nl > light[j]) {
          light[j] = nl;
          if (count < cap) {
            queue[(head + count) % cap] = j;
            count++;
          }
        }
      }
    }
  }
}
