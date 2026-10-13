/**
 * Particules d'ambiance des blocs, comme l'« animateTick » du jeu original : à chaque image, des
 * blocs tirés au hasard autour du joueur peuvent émettre des particules — flamme et fumée des
 * torches et bougies, fumée des feux de camp, éclats de lave, gouttes sous les plafonds humides,
 * particules de portail, glyphes vers la table d'enchantement, barres de l'End, fumée du feu et
 * du fourneau allumé, spores. Dans le Nether, cendres et spores flottent selon le biome.
 */
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { FACING_DIR } from '../blocks/Shapes';
import type { World } from '../world/World';
import type { ParticleSystem } from './ParticleSystem';

const enum K {
  NONE, TORCH, SOUL_TORCH, REDSTONE_TORCH, CAMPFIRE, SOUL_CAMPFIRE, LAVA, WATER, PORTAL, ENCHANT, END_ROD, FIRE, FURNACE, CANDLE, SPORE, CRYING,
}

export class AmbientParticles {
  private kind: Uint8Array | null = null;
  private bookshelf = -1;

  private build() {
    const k = new Uint8Array(BlockRegistry.blocks.length + 1);
    const set = (key: string, v: K) => BlockRegistry.has(key) && (k[BlockRegistry.byName(key).id] = v);
    set('torch', K.TORCH);
    set('soul_torch', K.SOUL_TORCH);
    set('redstone_torch', K.REDSTONE_TORCH);
    set('campfire', K.CAMPFIRE);
    set('soul_campfire', K.SOUL_CAMPFIRE);
    set('nether_portal', K.PORTAL);
    set('enchanting_table', K.ENCHANT);
    set('end_rod', K.END_ROD);
    set('fire', K.FIRE);
    set('soul_fire', K.FIRE);
    set('lit_furnace', K.FURNACE);
    set('spore_blossom', K.SPORE);
    set('crying_obsidian', K.CRYING);
    k[B.LAVA] = K.LAVA;
    k[B.WATER] = K.WATER;
    for (const b of BlockRegistry.blocks) if (/_candle_lit$|^candle_lit$/.test(b.key)) k[b.id] = K.CANDLE;
    this.kind = k;
    this.bookshelf = BlockRegistry.has('bookshelf') ? BlockRegistry.byName('bookshelf').id : -1;
  }

  /** Tirages autour de (px, py, pz) ; `budget` : nombre de blocs examinés cette image. */
  update(w: World, p: ParticleSystem, px: number, py: number, pz: number, budget: number, dimension: string, biome: string) {
    if (!this.kind) this.build();
    const kind = this.kind!;
    const R = Math.random;
    for (let n = 0; n < budget; n++) {
      // moitié des tirages à 16 blocs, moitié à 32 (comme le jeu original)
      const r = n & 1 ? 16 : 32;
      const x = Math.floor(px + (R() - R()) * r), y = Math.floor(py + (R() - R()) * r * 0.5), z = Math.floor(pz + (R() - R()) * r);
      const id = w.getBlock(x, y, z);
      if (id <= 0) continue;
      const k = kind[id];
      if (!k) continue;
      switch (k) {
        case K.TORCH: case K.SOUL_TORCH: case K.REDSTONE_TORCH: {
          const m = w.getMeta(x, y, z);
          let fx = x + 0.5, fy = y + 0.7, fz = z + 0.5;
          // torche murale : penchée, flamme décalée à l'opposé du mur
          if (m >= 1 && m <= 4) {
            const [dx, dz] = FACING_DIR[(m - 1) & 3];
            fx -= dx * 0.27;
            fz -= dz * 0.27;
            fy = y + 0.92;
          }
          if (k === K.REDSTONE_TORCH) {
            if (R() < 0.3) p.sprite('generic', fx, fy, fz, 0, 0.2, 0, 1, 0.1, 0.1, 0.05, 0.7, 0, 1);
          } else {
            p.burst('small_smoke', fx, fy, fz, 1);
            p.burst(k === K.SOUL_TORCH ? 'soul_flame' : 'flame', fx, fy, fz, 1);
          }
          break;
        }
        case K.CANDLE:
          p.burst('small_smoke', x + 0.5, y + 0.55, z + 0.5, 1);
          p.burst('flame', x + 0.5, y + 0.5, z + 0.5, 1);
          break;
        case K.CAMPFIRE: case K.SOUL_CAMPFIRE:
          if (R() < 0.4) p.burst('campfire_smoke', x + 0.5, y + 0.6, z + 0.5, 1);
          if (R() < 0.3) p.burst('lava', x + 0.5, y - 0.3, z + 0.5, 1);
          break;
        case K.LAVA:
          // éclats de lave à la surface (air au-dessus)
          if (w.getBlock(x, y + 1, z) === B.AIR && R() < 0.12) p.burst('lava', x + 0.5, y, z + 0.5, 1);
          // goutte sous un plafond qui porte de la lave
          if (R() < 0.15) this.drip(w, p, x, y, z, 'drip_lava');
          break;
        case K.WATER:
          if (R() < 0.08) this.drip(w, p, x, y, z, 'drip_water');
          break;
        case K.PORTAL:
          if (R() < 0.6) p.burst('portal', x + 0.5, y + 0.5, z + 0.5, 1);
          break;
        case K.ENCHANT:
          // glyphes depuis les bibliothèques autour (anneau à 2 blocs, comme le jeu original)
          if (this.bookshelf > 0)
            for (let dz = -2; dz <= 2; dz++)
              for (let dx = -2; dx <= 2; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2 || R() > 0.07) continue;
                for (let dy = 0; dy <= 1; dy++)
                  if (w.getBlock(x + dx, y + dy, z + dz) === this.bookshelf) p.enchantGlyph(x + dx + 0.5, y + dy + 1.2, z + dz + 0.5, x + 0.5, y + 1.1, z + 0.5);
              }
          break;
        case K.END_ROD:
          if (R() < 0.25) p.burst('end_rod', x + 0.5, y + 0.9, z + 0.5, 1);
          break;
        case K.FIRE:
          if (R() < 0.5) p.burst('smoke', x + 0.5, y + 0.5, z + 0.5, 1);
          break;
        case K.FURNACE: {
          if (R() > 0.3) break;
          const [dx, dz] = FACING_DIR[w.getMeta(x, y, z) & 3];
          p.burst('small_smoke', x + 0.5 + dx * 0.52, y + 0.3, z + 0.5 + dz * 0.52, 1);
          p.burst('flame', x + 0.5 + dx * 0.52, y + 0.25, z + 0.5 + dz * 0.52, 1);
          break;
        }
        case K.SPORE:
          if (R() < 0.6) p.sprite('generic', x + R() * 10 - 5, y - R() * 4, z + R() * 10 - 5, 0, -0.1, 0, 0.6, 0.85, 0.35, 0.04, 3, 0, 1);
          break;
        case K.CRYING:
          if (R() < 0.2) this.drip(w, p, x, y + 1, z, 'drip_lava', 0.4, 0.15, 0.9);
          break;
      }
    }
    // Nether : cendres et spores dans l'air selon le biome
    if (dimension === 'nether') {
      const kindP = biome === 'basalt_deltas' ? 'white_ash' : biome === 'soul_sand_valley' ? 'ash' : biome === 'crimson_forest' ? 'crimson_spore' : biome === 'warped_forest' ? 'warped_spore' : null;
      if (kindP && R() < budget / 60) p.burst(kindP, px, py, pz, 2);
    }
  }

  /** Goutte qui tombe sous un bloc solide portant de l'eau ou de la lave (comme le jeu original). */
  private drip(w: World, p: ParticleSystem, x: number, y: number, z: number, kind: 'drip_water' | 'drip_lava', r = -1, g = 0, b = 0) {
    // le liquide est posé sur un bloc solide dont le dessous est à l'air libre
    if (!w.isSolid(x, y - 1, z) || w.getBlock(x, y - 2, z) !== B.AIR) return;
    const fx = x + 0.2 + Math.random() * 0.6, fz = z + 0.2 + Math.random() * 0.6;
    if (r >= 0) p.sprite('drip_fall', fx, y - 1.05, fz, 0, -0.2, 0, r, g, b, 0.06, 1.2, 9);
    else p.burst(kind, fx, y - 1.05, fz, 1);
  }
}
