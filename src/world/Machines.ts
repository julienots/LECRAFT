/**
 * Blocs à mécanisme (comme le jeu original) :
 *  - distributeur : sur une impulsion de redstone (levier, bouton, plaque), éjecte un objet
 *    vers l'avant — flèches tirées, boules de neige et potions jetables lancées, seaux vidés ou
 *    remplis, TNT amorcée, briquet qui allume, sinon l'objet tombe devant ;
 *  - dropper : lâche l'objet, ou le range dans le conteneur placé devant ;
 *  - entonnoir : aspire les objets posés dessus et ceux du conteneur au-dessus, puis les pousse
 *    dans le conteneur en dessous (sinon devant) ; bloqué tant qu'il est alimenté.
 */
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { FACING_DIR } from '../blocks/Shapes';
import type { ItemStack } from '../inventory/Item';
import { canMerge } from '../inventory/Inventory';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { potionColor, potionOf } from '../inventory/Potions';
import { RecipeRegistry } from '../crafting/RecipeRegistry';
import { PROJECTILE_DEFS } from '../entities/Projectile';
import type { ItemEntity } from '../entities/ItemEntity';
import type { Session } from '../core/Session';

type Slots = (ItemStack | null)[];

/** Cases d'un conteneur vues par un entonnoir (coffre, distributeur, entonnoir, fourneau, alambic). */
function slotsOf(s: Session, x: number, y: number, z: number, from: 'top' | 'side' | 'bottom'): { get: () => Slots; set: (i: number, v: ItemStack | null) => void; accept: (i: number, st: ItemStack) => boolean; take: number[]; put: number[] } | null {
  const w = s.world;
  const id = w.getBlock(x, y, z);
  if (id <= 0) return null;
  const kind = BlockRegistry.get(id).interact;
  if (kind === 'chest' || kind === 'dispenser' || kind === 'hopper') {
    const inv = w.getChest(x, y, z, true, kind === 'chest' ? 27 : kind === 'hopper' ? 5 : 9)!;
    const all = inv.slots.map((_, i) => i);
    return { get: () => inv.slots, set: (i, v) => ((inv.slots[i] = v), inv.changed()), accept: () => true, take: all, put: all };
  }
  if (kind === 'furnace') {
    const f = w.getFurnace(x, y, z)!;
    const arr = () => [f.input, f.fuel, f.output];
    return {
      get: arr,
      set: (i, v) => (i === 0 ? (f.input = v) : i === 1 ? (f.fuel = v) : (f.output = v)),
      accept: (i, st) => (i === 0 ? !!RecipeRegistry.smeltingFor(st.id) : i === 1 ? (ItemRegistry.get(st.id)?.burnTime ?? 0) > 0 : false),
      // le dessus remplit l'entrée, les côtés le combustible ; le résultat sort par en dessous
      take: [2],
      put: from === 'top' ? [0] : [1],
    };
  }
  if (kind === 'brewing') {
    const b = w.getBrewing(x, y, z)!;
    return {
      get: () => [...b.bottles, b.ingredient, b.fuelItem],
      set: (i, v) => (i < 3 ? (b.bottles[i] = v) : i === 3 ? (b.ingredient = v) : (b.fuelItem = v)),
      accept: (i, st) => (i === 4 ? st.id === 'blaze_powder' : i === 3 ? st.id !== 'potion' && st.id !== 'splash_potion' : st.id === 'potion' || st.id === 'splash_potion'),
      take: b.time > 0 ? [] : [0, 1, 2],
      put: from === 'top' ? [3] : [4, 0, 1, 2],
    };
  }
  return null;
}

/** Ajoute (au plus `n`) objets d'une pile dans des cases ; retourne le nombre ajouté. */
function insert(c: NonNullable<ReturnType<typeof slotsOf>>, st: ItemStack, n: number): number {
  const slots = c.get();
  const max = ItemRegistry.maxStack(st.id);
  for (const i of c.put) {
    const cur = slots[i];
    if (!c.accept(i, st)) continue;
    if (cur && canMerge(cur, st) && cur.count < max) {
      const k = Math.min(n, max - cur.count);
      cur.count += k;
      c.set(i, cur);
      return k;
    }
  }
  for (const i of c.put) {
    if (slots[i] || !c.accept(i, st)) continue;
    const k = Math.min(n, max);
    c.set(i, { ...st, count: k });
    return k;
  }
  return 0;
}

export class Machines {
  private timer = 0;
  private hopperTimer = 0;
  private fired = new Set<string>();

  update(s: Session, dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    this.hopperTimer -= 0.1;
    const hopperTick = this.hopperTimer <= 0;
    if (hopperTick) this.hopperTimer = 0.4;
    const w = s.world;
    for (const k of [...w.chests.keys()]) {
      const [x, y, z] = k.split(',').map(Number);
      const id = w.getBlock(x, y, z);
      if (id <= 0) continue;
      const b = BlockRegistry.get(id);
      const powered = (w.getMeta(x, y, z) & 8) !== 0;
      if (b.interact === 'dispenser') {
        // front montant de l'alimentation : un tir
        if (powered && !this.fired.has(k)) {
          this.fired.add(k);
          this.fire(s, x, y, z, b.key === 'dropper');
        } else if (!powered) this.fired.delete(k);
      } else if (b.interact === 'hopper' && hopperTick && !powered) this.hopper(s, x, y, z);
    }
  }

  /** Tir d'un distributeur / dropper : un objet pris au hasard parmi les cases occupées. */
  fire(s: Session, x: number, y: number, z: number, dropper: boolean) {
    const w = s.world;
    const inv = w.getChest(x, y, z, true, 9)!;
    const full = inv.slots.map((st, i) => (st ? i : -1)).filter((i) => i >= 0);
    const [dx, dz] = FACING_DIR[w.getMeta(x, y, z) & 3];
    const fx = x + dx, fz = z + dz;
    const cx = x + 0.5 + dx * 0.7, cy = y + 0.5, cz = z + 0.5 + dz * 0.7;
    if (!full.length) {
      s.audio.play('click', { x: cx, y: cy, z: cz, pitch: 1.4 });
      return;
    }
    const i = full[Math.floor(Math.random() * full.length)];
    const st = inv.slots[i]!;
    const take = () => {
      st.count--;
      if (st.count <= 0) inv.slots[i] = null;
      inv.changed();
    };
    s.particles.burst('smoke', cx, cy, cz, 5);
    // dropper : range l'objet dans le conteneur devant s'il y en a un
    if (dropper) {
      const c = slotsOf(s, fx, y, fz, 'side');
      if (c && insert(c, st, 1) > 0) {
        take();
        s.audio.play('click', { x: cx, y: cy, z: cz });
        return;
      }
    }
    if (!dropper) {
      const sp = 18;
      if (st.id === 'arrow' || st.id === 'spectral_arrow') {
        const pr = s.entities.spawnProjectile('arrow', cx, cy, cz, dx * sp, 1, dz * sp, 3, false);
        pr.pickable = true;
        take();
        s.audio.play('bow', { x: cx, y: cy, z: cz });
        return;
      }
      const thrown = st.id === 'snowball' ? 'minecraft:snowball' : st.id === 'egg' ? 'minecraft:egg' : null;
      if (thrown && PROJECTILE_DEFS.get(thrown)) {
        s.entities.spawnProjectile('custom', cx, cy, cz, dx * 14, 2, dz * 14, 0, false, PROJECTILE_DEFS.get(thrown));
        take();
        s.audio.play('bow', { x: cx, y: cy, z: cz, pitch: 1.3 });
        return;
      }
      if (st.id === 'splash_potion') {
        const pot = potionOf(st)!;
        s.entities.spawnProjectile('custom', cx, cy, cz, dx * 10, 3, dz * 10, 0, false, { id: `splash_potion${potionColor(st)}`, color: potionColor(st), size: 0.3, gravity: 20, damage: 0, splash: pot });
        take();
        s.audio.play('paper_whoosh', { x: cx, y: cy, z: cz });
        return;
      }
      const front = w.getBlock(fx, y, fz);
      const free = front >= 0 && (front === B.AIR || BlockRegistry.replaceable[front] === 1);
      if ((st.id === 'water_bucket' || st.id === 'lava_bucket') && free) {
        w.setBlock(fx, y, fz, st.id === 'water_bucket' ? B.WATER : B.LAVA, 0);
        inv.slots[i] = { id: 'bucket', count: 1 };
        inv.changed();
        s.audio.play('bucket_empty', { x: cx, y: cy, z: cz });
        return;
      }
      if (st.id === 'bucket' && (front === B.WATER || front === B.LAVA) && w.getMeta(fx, y, fz) === 0) {
        w.setBlock(fx, y, fz, B.AIR);
        inv.slots[i] = { id: front === B.WATER ? 'water_bucket' : 'lava_bucket', count: 1 };
        inv.changed();
        s.audio.play('bucket_fill', { x: cx, y: cy, z: cz });
        return;
      }
      if (st.id === 'tnt' && free) {
        take();
        s.explosions.prime(s, fx, y, fz, 4);
        return;
      }
      if (st.id === 'flint_and_steel' && free && BlockRegistry.has('fire')) {
        w.setBlock(fx, y, fz, BlockRegistry.byName('fire').id);
        if (st.durability !== undefined && --st.durability <= 0) inv.slots[i] = null;
        inv.changed();
        s.audio.play('ignite', { x: cx, y: cy, z: cz });
        return;
      }
    }
    // par défaut : l'objet tombe devant, avec un peu d'élan
    take();
    s.entities.spawnItem(st.id, 1, cx + dx * 0.3, cy - 0.2, cz + dz * 0.3, st.durability, st.meta);
    const it = s.entities.entities[s.entities.entities.length - 1] as ItemEntity;
    if (it?.kind === 'item') {
      it.body.vx = dx * 4;
      it.body.vz = dz * 4;
      it.body.vy = 1.5;
    }
    s.audio.play('click', { x: cx, y: cy, z: cz });
  }

  /** Entonnoir : aspire (objets au-dessus, conteneur au-dessus) puis pousse vers le bas ou l'avant. */
  hopper(s: Session, x: number, y: number, z: number) {
    const w = s.world;
    const self = slotsOf(s, x, y, z, 'top')!;
    // 1) pousser un objet
    const below = slotsOf(s, x, y - 1, z, 'top');
    const [dx, dz] = FACING_DIR[w.getMeta(x, y, z) & 3];
    const out = below ?? slotsOf(s, x + dx, y, z + dz, 'side');
    if (out) {
      const slots = self.get();
      for (let i = 0; i < slots.length; i++) {
        const st = slots[i];
        if (!st) continue;
        if (insert(out, st, 1) > 0) {
          st.count--;
          self.set(i, st.count > 0 ? st : null);
          break;
        }
      }
    }
    // 2) aspirer depuis le conteneur au-dessus
    const above = slotsOf(s, x, y + 1, z, 'bottom');
    if (above) {
      const slots = above.get();
      for (const i of above.take) {
        const st = slots[i];
        if (!st) continue;
        if (insert(self, st, 1) > 0) {
          st.count--;
          above.set(i, st.count > 0 ? st : null);
          break;
        }
      }
    }
    // 3) objets posés sur l'entonnoir
    for (const e of s.entities.entities) {
      if (e.kind !== 'item' || e.removed) continue;
      const it = e as ItemEntity;
      if (Math.abs(it.x - x - 0.5) > 0.6 || Math.abs(it.z - z - 0.5) > 0.6 || it.y < y + 0.5 || it.y > y + 1.6) continue;
      const st: ItemStack = { id: it.itemId, count: it.count, ...(it.durability !== undefined ? { durability: it.durability } : {}), ...(it.meta ? { meta: it.meta } : {}) };
      const n = insert(self, st, it.count);
      if (n > 0) {
        it.count -= n;
        if (it.count <= 0) it.removed = true;
        else it.syncCopies();
      }
    }
  }
}
