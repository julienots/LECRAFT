import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { WORLD_HEIGHT } from '../core/Config';
import type { World } from './World';

/**
 * Feu comme le jeu de référence (FireBlock) :
 *  - âge 0..15 (méta) ; un tick programmé toutes les 1,5 à 2 s ;
 *  - s'éteint sans support (bloc plein dessous ou bloc inflammable voisin), avec la pluie, ou en
 *    vieillissant ; brûle indéfiniment sur le netherrack et le magma (et la bedrock de l'End) ;
 *  - brûle les blocs inflammables voisins (« inflammabilité ») et se propage dans un volume de
 *    3×6×3 vers les cases d'air touchant un bloc inflammable (« encouragement ») ;
 *  - la TNT touchée s'enflamme ; les biomes humides ralentissent la propagation ;
 *  - la lave enflamme les blocs inflammables proches (tick aléatoire).
 * Le feu des âmes ne se propage pas et ne survit que sur le sable / la terre des âmes.
 */

/** [encouragement, inflammabilité] par bloc (valeurs du jeu de référence). */
const RULES: [RegExp, number, number][] = [
  [/_(planks|slab|stairs|fence|fence_gate)$/, 5, 20],
  [/^(oak|spruce|birch|jungle|acacia|dark_oak|cherry|mangrove|pale_oak|bamboo)_(planks|slab|stairs|fence|fence_gate)$/, 5, 20],
  [/^(stripped_)?(oak|spruce|birch|jungle|acacia|dark_oak|cherry|mangrove|pale_oak)_(log|wood)$/, 5, 5],
  [/^bamboo_(block|mosaic.*)$|^stripped_bamboo_block$/, 5, 20],
  [/_leaves$/, 30, 60],
  [/^(bookshelf|chiseled_bookshelf|lectern)$/, 30, 20],
  [/^tnt$/, 15, 100],
  [/^(short_grass|grass|tall_grass|fern|large_fern|dead_bush|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|sweet_berry_bush|torchflower|pink_petals|pitcher_plant|spore_blossom|hanging_roots|glow_lichen|cave_vines.*|big_dripleaf.*|small_dripleaf.*|short_dry_grass|tall_dry_grass|bush|firefly_bush|wildflowers|leaf_litter)$/, 60, 100],
  [/_wool$/, 30, 60],
  [/^(vine|weeping_vines.*|twisting_vines.*)$/, 15, 100],
  [/^coal_block$/, 5, 5],
  [/^hay_block$/, 60, 20],
  [/^target$/, 15, 20],
  [/_carpet$/, 60, 20],
  [/^dried_kelp_block$/, 30, 60],
  [/^(bamboo|bamboo_plant|scaffolding)$/, 60, 60],
  [/^composter.*$/, 5, 20],
  [/^(beehive|bee_nest)$/, 5, 20],
  [/^(azalea|flowering_azalea|azalea_leaves|flowering_azalea_leaves)$/, 30, 60],
  [/^(moss_block|moss_carpet|pale_moss_block|pale_moss_carpet)$/, 5, 100],
  [/^(cave_vines|cave_vines_plant)$/, 15, 60],
  [/^(barrel|crafting_table|cartography_table|fletching_table|smithing_table|loom|note_block|noteblock|jukebox|chest|trapped_chest)$/, 0, 0],
];

let enc: Uint8Array | null = null, fla: Uint8Array | null = null;
function tables() {
  const n = BlockRegistry.blocks.length;
  if (!enc || enc.length !== n + 1) {
    enc = new Uint8Array(n + 1);
    fla = new Uint8Array(n + 1);
    for (const b of BlockRegistry.blocks) {
      if (!b) continue;
      let e = 0, f = 0;
      for (const [re, a, c] of RULES)
        if (re.test(b.key)) {
          e = a;
          f = c;
          break;
        }
      if (!e && b.flammable) {
        e = 5;
        f = 20;
      }
      enc[b.id] = e;
      fla[b.id] = f;
    }
  }
  return { enc, fla: fla! };
}
export const encouragement = (id: number) => (id > 0 ? tables().enc[id] ?? 0 : 0);
export const flammability = (id: number) => (id > 0 ? tables().fla[id] ?? 0 : 0);

export interface FireHost {
  raining(): boolean;
  difficulty(): number;
  primeTnt?(x: number, y: number, z: number): void;
  /** Le feu peut-il se propager (règle doFireTick) ? */
  enabled?(): boolean;
  /** Biome humide (jungle, marais…) : propagation ralentie. */
  humid?(x: number, z: number): boolean;
  /** Dimension de l'End : feu infini sur la bedrock. */
  end?(): boolean;
}

const DIRS: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const idOf = (k: string) => (BlockRegistry.has(k) ? BlockRegistry.id(k) : -1);

export class FireSystem {
  tickCount = 0;
  /** Feux à mettre à jour : clé → tick d'échéance. */
  private scheduled = new Map<string, number>();
  rand: () => number = Math.random;
  constructor(readonly world: World, public host: FireHost) {}

  private r(n: number) {
    return Math.floor(this.rand() * n);
  }
  isFire(id: number) {
    return id > 0 && (id === idOf('fire') || id === idOf('soul_fire'));
  }

  schedule(x: number, y: number, z: number, delay = 30 + this.r(10)) {
    const k = key(x, y, z);
    if (!this.scheduled.has(k)) this.scheduled.set(k, this.tickCount + delay);
  }
  get size() {
    return this.scheduled.size;
  }

  /** Changement de bloc : feu posé → programmé ; voisin d'un feu modifié → revérifié bientôt. */
  blockChanged(e: { x: number; y: number; z: number; id: number }) {
    if (this.isFire(e.id)) this.schedule(e.x, e.y, e.z);
  }
  chunkLoaded(c: { cx: number; cz: number; blocks: Uint16Array }) {
    const f = idOf('fire'), s = idOf('soul_fire');
    const b = c.blocks;
    for (let i = 0; i < b.length; i++) if (b[i] && (b[i] === f || b[i] === s)) this.schedule(c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15), 1 + this.r(40));
  }

  /** Feu possible ici : bloc plein dessous ou bloc inflammable voisin. */
  canSurvive(x: number, y: number, z: number, soul = false): boolean {
    const w = this.world;
    const below = w.getBlock(x, y - 1, z);
    if (soul) return below > 0 && /^soul_(sand|soil)$/.test(BlockRegistry.get(below).key);
    if (below > 0 && BlockRegistry.solid[below] && !this.isFire(below)) return true;
    return this.validLocation(x, y, z);
  }
  private validLocation(x: number, y: number, z: number) {
    for (const [dx, dy, dz] of DIRS) if (flammability(this.world.getBlock(x + dx, y + dy, z + dz)) > 0) return true;
    return false;
  }
  private igniteOdds(x: number, y: number, z: number) {
    if (this.world.getBlock(x, y, z) !== B.AIR) return 0;
    let best = 0;
    for (const [dx, dy, dz] of DIRS) best = Math.max(best, encouragement(this.world.getBlock(x + dx, y + dy, z + dz)));
    return best;
  }
  /** Pluie sur cette case ou une case voisine (exposée au ciel). */
  private rainNear(x: number, y: number, z: number) {
    if (!this.host.raining()) return false;
    const w = this.world;
    const open = (a: number, b: number) => w.heightAt(a, b) <= y;
    return open(x, z) || open(x - 1, z) || open(x + 1, z) || open(x, z - 1) || open(x, z + 1);
  }
  private infinite(x: number, y: number, z: number) {
    const k = BlockRegistry.get(Math.max(0, this.world.getBlock(x, y - 1, z))).key;
    return k === 'netherrack' || k === 'magma' || k === 'magma_block' || (k === 'bedrock' && !!this.host.end?.());
  }

  tick() {
    this.tickCount++;
    if (!this.scheduled.size) return;
    let budget = 400;
    for (const [k, t] of this.scheduled) {
      if (t > this.tickCount) continue;
      if (budget-- <= 0) break;
      this.scheduled.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      this.fireTick(x, y, z);
    }
  }

  private place(x: number, y: number, z: number, age: number) {
    const f = idOf('fire');
    if (f < 0 || y < 0 || y >= WORLD_HEIGHT) return;
    this.world.setBlock(x, y, z, f, Math.min(15, age));
  }

  fireTick(x: number, y: number, z: number) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    if (!this.isFire(id)) return;
    const soul = id === idOf('soul_fire');
    if (!this.canSurvive(x, y, z, soul)) {
      w.setBlock(x, y, z, B.AIR);
      return;
    }
    if (soul) return; // feu des âmes : permanent sur son support, ne se propage pas
    this.schedule(x, y, z);
    if (this.host.enabled && !this.host.enabled()) return;
    const infinite = this.infinite(x, y, z);
    const age = w.getMeta(x, y, z) & 15;
    if (!infinite && this.rainNear(x, y, z) && this.rand() < 0.2 + age * 0.03) {
      w.setBlock(x, y, z, B.AIR);
      return;
    }
    const next = Math.min(15, age + (this.r(3) >> 1));
    if (next !== age) w.setBlock(x, y, z, id, next, false);
    if (!infinite) {
      if (!this.validLocation(x, y, z)) {
        const below = w.getBlock(x, y - 1, z);
        if (!(below > 0 && BlockRegistry.solid[below]) || age > 3) w.setBlock(x, y, z, B.AIR);
        return;
      }
      if (age === 15 && this.r(4) === 0 && flammability(w.getBlock(x, y - 1, z)) === 0) {
        w.setBlock(x, y, z, B.AIR);
        return;
      }
    }
    const humid = this.host.humid?.(x, z) ? -50 : 0;
    this.burn(x + 1, y, z, 300 + humid, age);
    this.burn(x - 1, y, z, 300 + humid, age);
    this.burn(x, y - 1, z, 250 + humid, age);
    this.burn(x, y + 1, z, 250 + humid, age);
    this.burn(x, y, z - 1, 300 + humid, age);
    this.burn(x, y, z + 1, 300 + humid, age);
    const diff = this.host.difficulty();
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 4; dy++) {
          if (!dx && !dy && !dz) continue;
          const k = dy > 1 ? 100 + (dy - 1) * 100 : 100;
          const odds = this.igniteOdds(x + dx, y + dy, z + dz);
          if (odds <= 0) continue;
          let l = Math.floor((odds + 40 + diff * 7) / (age + 30));
          if (humid) l = Math.floor(l / 2);
          if (l > 0 && this.r(k) <= l && !this.rainNear(x + dx, y + dy, z + dz)) this.place(x + dx, y + dy, z + dz, age + Math.floor(this.r(5) / 4));
        }
  }

  /** Bloc voisin du feu : brûle (remplacé par du feu ou détruit) selon son inflammabilité. */
  private burn(x: number, y: number, z: number, chance: number, age: number) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    const f = flammability(id);
    if (f <= 0 || this.r(chance) >= f) return;
    const tnt = id === B.TNT;
    if (this.r(age + 10) < 5 && !this.rainNear(x, y, z)) this.place(x, y, z, age + Math.floor(this.r(5) / 4));
    else w.setBlock(x, y, z, B.AIR);
    if (tnt) this.host.primeTnt?.(x, y, z);
  }

  /** Tick aléatoire d'une lave (source ou coulante) : peut enflammer les blocs proches. */
  lavaTick(x: number, y: number, z: number) {
    if (this.host.enabled && !this.host.enabled()) return;
    const w = this.world;
    const n = this.r(3);
    if (n > 0) {
      let px = x, py = y, pz = z;
      for (let i = 0; i < n; i++) {
        px += this.r(3) - 1;
        py += 1;
        pz += this.r(3) - 1;
        const b = w.getBlock(px, py, pz);
        if (b === B.AIR) {
          if (this.validLocation(px, py, pz)) {
            this.place(px, py, pz, 0);
            return;
          }
        } else if (b < 0 || BlockRegistry.solid[b]) return;
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const px = x + this.r(3) - 1, pz = z + this.r(3) - 1;
        if (w.getBlock(px, y + 1, pz) === B.AIR && flammability(w.getBlock(px, y, pz)) > 0) this.place(px, y + 1, pz, 0);
      }
    }
  }
}
