import { BlockRegistry } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { ItemStack } from '../inventory/Item';
import { jukeboxSignal } from './Jukebox';
import {
  DIR6, DOWN, H2D, K, comparatorOutput, emitWeak, inputPower, isConductor, observerFront, oppositeDir, outDir,
  rearInput, rsKind, shapeOf, sideInput, torchSupportPowered, wireNeighbors, wireSourcePower, type RsReader,
} from './RedstoneLogic';
import type { World } from './World';

/**
 * Moteur de redstone (comme le jeu de référence) : propagation de la poudre (0..15, -1 par bloc),
 * torches inverseuses (2 ticks, grillées si elles clignotent trop vite), répéteurs (délai 1..4,
 * verrouillage latéral, prolongation des impulsions), comparateurs (comparaison / soustraction,
 * lecture des conteneurs), lampes (extinction après 4 ticks), observateurs (impulsion de 2 ticks),
 * ampoules en cuivre (bascule sur front montant), blocs musicaux, rails de propulsion, détecteurs
 * de lumière, TNT, portes / trappes / portillons, pistons, distributeurs, droppers et entonnoirs.
 *
 * Les règles d'alimentation sont dans RedstoneLogic.ts ; ce fichier gère l'état et le temps (ticks
 * de 1/20 s) : les mises à jour voisines arrivent par notify() ; les changements différés passent
 * par une file de ticks programmés.
 */

export interface RedstoneHost {
  sound?(name: string, x: number, y: number, z: number, pitch?: number): void;
  primeTnt?(x: number, y: number, z: number): void;
  /** Lumière du jour (0..1) pour les détecteurs. */
  daylight?(): number;
}

const engines = new WeakMap<World, RedstoneEngine>();
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const idOf = (k: string) => (BlockRegistry.has(k) ? BlockRegistry.id(k) : -1);

/** Délai d'un répéteur en ticks de jeu (1..4 ticks de redstone). */
export const repeaterDelay = (meta: number) => (((meta >> 2) & 3) + 1) * 2;
const BURNOUT_TOGGLES = 8, BURNOUT_WINDOW = 60, BURNOUT_COOLDOWN = 160;

export class RedstoneEngine {
  host: RedstoneHost = {};
  tickCount = 0;
  private queue: number[] = [];
  private dirtyWires = new Map<string, [number, number, number]>();
  /** Ticks programmés : clé → tick d'échéance. */
  private scheduled = new Map<string, number>();
  private torchOff = new Map<string, number[]>();
  private burnt = new Map<string, number>();
  /** Composants surveillés périodiquement (comparateurs : conteneurs ; détecteurs : lumière). */
  private watched = new Map<string, [number, number, number]>();
  private internal = 0;

  constructor(readonly world: World) {
    engines.set(world, this);
  }

  static for(world: World): RedstoneEngine {
    return engines.get(world) ?? new RedstoneEngine(world);
  }

  // ---------- entrées ----------

  /** Mise à jour voisine d'une position. */
  notify(x: number, y: number, z: number) {
    this.queue.push(x, y, z);
  }

  /** La position et tout ce qui est à 2 blocs (distance de Manhattan) : voisins des blocs alimentés compris. */
  notifyAround(x: number, y: number, z: number) {
    for (let dy = -2; dy <= 2; dy++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= 2) this.queue.push(x + dx, y + dy, z + dz);
  }

  /** Changement de bloc (monde) : observateurs voisins, composants posés ou retirés. */
  blockChanged(e: { x: number; y: number; z: number; prev: number; id: number }) {
    const w = this.world;
    // observateurs dont la face avant regarde ce bloc
    for (let d = 0; d < 6; d++) {
      const [dx, dy, dz] = DIR6[d];
      const ox = e.x + dx, oy = e.y + dy, oz = e.z + dz;
      const k = rsKind(w.getBlock(ox, oy, oz));
      if ((k === K.OBSERVER || k === K.OBSERVER_ON) && observerFront(w.getMeta(ox, oy, oz)) === oppositeDir(d)) this.schedule(ox, oy, oz, 2);
    }
    if (this.internal) return;
    const kp = rsKind(Math.max(0, e.prev)), kn = rsKind(e.id);
    if (kp || kn) this.notifyAround(e.x, e.y, e.z);
    if (kn === K.COMPARATOR || kn === K.COMPARATOR_ON || kn === K.DAYLIGHT || kn === K.DAYLIGHT_INV) this.watched.set(key(e.x, e.y, e.z), [e.x, e.y, e.z]);
    // observateur posé : il regarde déjà son bloc (pas d'impulsion), juste les voisins
  }

  /** Chunk chargé : composants à recalculer (les ticks programmés ne sont pas sauvegardés). */
  chunkLoaded(c: { cx: number; cz: number; blocks: Uint16Array }) {
    const b = c.blocks;
    for (let i = 0; i < b.length; i++) {
      const id = b[i];
      if (!id) continue;
      const k = rsKind(id);
      if (!k || k === K.PISTON || k === K.MACHINE || k === K.OPENABLE || k === K.TNT || k === K.NOTE_BLOCK || k === K.JUKEBOX) continue;
      const x = c.cx * 16 + (i & 15), z = c.cz * 16 + ((i >> 4) & 15), y = i >> 8;
      this.queue.push(x, y, z);
      if (k === K.COMPARATOR || k === K.COMPARATOR_ON || k === K.DAYLIGHT || k === K.DAYLIGHT_INV) this.watched.set(key(x, y, z), [x, y, z]);
    }
  }

  schedule(x: number, y: number, z: number, delay: number) {
    const k = key(x, y, z);
    if (this.scheduled.has(k)) return;
    this.scheduled.set(k, this.tickCount + Math.max(1, delay));
  }
  isScheduled(x: number, y: number, z: number) {
    return this.scheduled.has(key(x, y, z));
  }

  // ---------- boucle ----------

  /** Un tick de jeu (1/20 s). */
  tick() {
    this.tickCount++;
    if (this.scheduled.size) {
      const due: [number, number, number][] = [];
      for (const [k, t] of this.scheduled)
        if (t <= this.tickCount) {
          this.scheduled.delete(k);
          const [x, y, z] = k.split(',').map(Number);
          due.push([x, y, z]);
        }
      for (const [x, y, z] of due) this.fire(x, y, z);
    }
    // comparateurs (contenu des conteneurs) tous les 2 ticks, détecteurs de lumière toutes les secondes
    if (this.watched.size && this.tickCount % 2 === 0) {
      const w = this.world;
      for (const [k, [x, y, z]] of this.watched) {
        const kind = rsKind(w.getBlock(x, y, z));
        if (kind === K.COMPARATOR || kind === K.COMPARATOR_ON) this.queue.push(x, y, z);
        else if (kind === K.DAYLIGHT || kind === K.DAYLIGHT_INV) {
          if (this.tickCount % 20 === 0) this.refreshDaylight(x, y, z);
        } else if (w.getBlock(x, y, z) >= 0) this.watched.delete(k);
      }
    }
    this.flush();
  }

  /** Traite toutes les mises à jour en attente (propagation instantanée de la poudre). */
  flush() {
    let budget = 200000;
    while ((this.queue.length || this.dirtyWires.size) && budget > 0) {
      const q = this.queue;
      this.queue = [];
      const seen = new Set<string>();
      for (let i = 0; i < q.length && budget > 0; i += 3) {
        const x = q[i], y = q[i + 1], z = q[i + 2];
        const k = key(x, y, z);
        if (seen.has(k)) continue;
        seen.add(k);
        budget--;
        this.update(x, y, z);
      }
      if (this.dirtyWires.size) budget -= this.processWires();
    }
    if (budget <= 0) {
      this.queue = [];
      this.dirtyWires.clear();
    }
  }

  private set(x: number, y: number, z: number, id: number, meta: number, notify = true) {
    this.internal++;
    try {
      this.world.setBlock(x, y, z, id, meta, false);
    } finally {
      this.internal--;
    }
    if (notify) this.notifyAround(x, y, z);
  }

  // ---------- mise à jour immédiate ----------

  private update(x: number, y: number, z: number) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    const k = rsKind(id);
    if (!k) return;
    const m = w.getMeta(x, y, z);
    switch (k) {
      case K.WIRE:
        this.dirtyWires.set(key(x, y, z), [x, y, z]);
        return;
      case K.TORCH_ON:
      case K.TORCH_OFF: {
        const want = !torchSupportPowered(w, x, y, z);
        if (want !== (k === K.TORCH_ON)) this.schedule(x, y, z, 2);
        return;
      }
      case K.REPEATER:
      case K.REPEATER_ON: {
        const locked = sideInput(w, x, y, z, true) > 0;
        if (locked !== ((m & 16) !== 0)) this.set(x, y, z, id, locked ? m | 16 : m & ~16, false);
        if (locked) return;
        const want = rearInput(w, x, y, z) > 0;
        if (want !== (k === K.REPEATER_ON)) this.schedule(x, y, z, repeaterDelay(m));
        return;
      }
      case K.COMPARATOR:
      case K.COMPARATOR_ON: {
        this.watched.set(key(x, y, z), [x, y, z]);
        const out = this.comparatorValue(x, y, z);
        if (out !== comparatorOutput(m) || (out > 0) !== (k === K.COMPARATOR_ON)) this.schedule(x, y, z, 2);
        return;
      }
      case K.LAMP:
        if (inputPower(w, x, y, z) > 0) this.set(x, y, z, idOf('redstone_lamp_on'), m, false);
        return;
      case K.LAMP_ON:
        if (inputPower(w, x, y, z) === 0) this.schedule(x, y, z, 4);
        return;
      case K.DAYLIGHT:
      case K.DAYLIGHT_INV:
        this.watched.set(key(x, y, z), [x, y, z]);
        return;
      case K.OPENABLE:
        this.updateOpenable(x, y, z, id, m);
        return;
      case K.TNT:
        if (inputPower(w, x, y, z) > 0 && this.host.primeTnt) {
          this.set(x, y, z, 0, 0, true);
          this.host.primeTnt(x, y, z);
        }
        return;
      case K.MACHINE: {
        // distributeur, dropper, entonnoir : bit 8 = alimenté (front montant : tir ; entonnoir bloqué)
        const p = inputPower(w, x, y, z) > 0 || inputPower(w, x, y + 1, z, DOWN) > 0 && BlockRegistry.get(id).interact === 'dispenser';
        if (p !== ((m & 8) !== 0)) this.set(x, y, z, id, p ? m | 8 : m & ~8, false);
        return;
      }
      case K.PISTON:
        w.scheduleUpdate(x, y, z);
        return;
      case K.BULB:
        this.updateBulb(x, y, z, id, m);
        return;
      case K.POWERED_RAIL:
        this.updateRail(x, y, z, id, m);
        return;
      case K.NOTE_BLOCK: {
        // bit 7 : alimenté au dernier calcul (front montant : une note) ; bits 0-4 : hauteur
        const p = inputPower(w, x, y, z) > 0;
        if (p === ((m & 128) !== 0)) return;
        this.set(x, y, z, id, p ? m | 128 : m & ~128, false);
        if (p) this.playNote(x, y, z, m & 31);
        return;
      }
    }
  }

  /** Bloc musical : note jouée (hauteur 0..24, deux octaves comme le jeu de référence). */
  playNote(x: number, y: number, z: number, note: number) {
    if (this.world.getBlock(x, y + 1, z) !== 0) return;
    this.host.sound?.('note', x + 0.5, y + 0.5, z + 0.5, Math.pow(2, (note - 12) / 12));
  }

  // ---------- ticks programmés ----------

  private fire(x: number, y: number, z: number) {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    const k = rsKind(id);
    if (!k) return;
    const m = w.getMeta(x, y, z);
    const pk = key(x, y, z);
    switch (k) {
      case K.TORCH_ON: {
        if (!torchSupportPowered(w, x, y, z)) return;
        // grillage : plus de 8 extinctions en 60 ticks → reste éteinte un moment
        const hist = (this.torchOff.get(pk) ?? []).filter((t) => t > this.tickCount - BURNOUT_WINDOW);
        hist.push(this.tickCount);
        this.torchOff.set(pk, hist);
        if (hist.length >= BURNOUT_TOGGLES) {
          this.burnt.set(pk, this.tickCount + BURNOUT_COOLDOWN);
          this.host.sound?.('fizz', x + 0.5, y + 0.5, z + 0.5, 1.6);
        }
        this.set(x, y, z, idOf('redstone_torch_off'), m);
        return;
      }
      case K.TORCH_OFF: {
        if (torchSupportPowered(w, x, y, z)) return;
        const until = this.burnt.get(pk);
        if (until !== undefined && until > this.tickCount) {
          this.schedule(x, y, z, until - this.tickCount);
          return;
        }
        this.burnt.delete(pk);
        this.set(x, y, z, idOf('redstone_torch'), m);
        return;
      }
      case K.REPEATER:
      case K.REPEATER_ON: {
        if (m & 16) return;
        const want = rearInput(w, x, y, z) > 0;
        if (k === K.REPEATER_ON && !want) this.set(x, y, z, idOf('repeater'), m);
        else if (k === K.REPEATER) {
          this.set(x, y, z, idOf('repeater_on'), m);
          // impulsion plus courte que le délai : prolongée jusqu'au délai
          if (!want) this.schedule(x, y, z, repeaterDelay(m));
        }
        return;
      }
      case K.COMPARATOR:
      case K.COMPARATOR_ON: {
        const out = this.comparatorValue(x, y, z);
        const nid = idOf(out > 0 ? 'comparator_on' : 'comparator');
        const nm = (m & 7) | (out << 3);
        if (nid !== id || nm !== m) this.set(x, y, z, nid, nm);
        return;
      }
      case K.LAMP_ON:
        if (inputPower(w, x, y, z) === 0) this.set(x, y, z, idOf('redstone_lamp'), m, false);
        return;
      case K.OBSERVER:
        this.set(x, y, z, idOf('observer_on'), m);
        this.schedule(x, y, z, 2);
        this.host.sound?.('click', x + 0.5, y + 0.5, z + 0.5, 1.8);
        return;
      case K.OBSERVER_ON:
        this.set(x, y, z, idOf('observer'), m);
        return;
    }
  }

  // ---------- poudre ----------

  /** Recalcule les réseaux de poudre marqués. Renvoie le coût (nombre de poudres traitées). */
  private processWires(): number {
    const w = this.world;
    const todo = [...this.dirtyWires.values()];
    this.dirtyWires.clear();
    const done = new Set<string>();
    let cost = 0;
    for (const start of todo) {
      const sk = key(...start);
      if (done.has(sk) || rsKind(w.getBlock(...start)) !== K.WIRE) continue;
      // réseau connecté (limité pour rester fluide)
      const nodes = new Map<string, { p: [number, number, number]; nb: string[]; power: number }>();
      const stack: [number, number, number][] = [start];
      nodes.set(sk, { p: start, nb: [], power: 0 });
      while (stack.length && nodes.size < 8192) {
        const p = stack.pop()!;
        const n = nodes.get(key(...p))!;
        for (const q of wireNeighbors(w, ...p)) {
          const qk = key(...q);
          n.nb.push(qk);
          if (!nodes.has(qk)) {
            nodes.set(qk, { p: q, nb: [], power: 0 });
            stack.push(q);
          }
        }
      }
      cost += nodes.size;
      // sources, puis propagation par niveaux décroissants
      const levels: string[][] = Array.from({ length: 16 }, () => []);
      for (const [k, n] of nodes) {
        done.add(k);
        n.power = wireSourcePower(w, ...n.p);
        if (n.power > 0) levels[n.power].push(k);
      }
      for (let lv = 15; lv > 1; lv--)
        for (const k of levels[lv]) {
          const n = nodes.get(k)!;
          if (n.power !== lv) continue;
          for (const qk of n.nb) {
            const q = nodes.get(qk);
            if (q && q.power < lv - 1) {
              q.power = lv - 1;
              levels[lv - 1].push(qk);
            }
          }
        }
      for (const n of nodes.values()) {
        const [x, y, z] = n.p;
        const m = w.getMeta(x, y, z);
        if ((m & 15) === n.power) continue;
        this.set(x, y, z, w.getBlock(x, y, z), (m & ~15) | n.power, false);
        this.notifyConsumers(x, y, z);
      }
    }
    return cost;
  }

  /** Voisins d'une poudre modifiée (sauf les poudres du même réseau, déjà à jour). */
  private notifyConsumers(x: number, y: number, z: number) {
    const w = this.world;
    for (let dy = -2; dy <= 2; dy++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
          const k = rsKind(w.getBlock(x + dx, y + dy, z + dz));
          if (k && k !== K.WIRE) this.queue.push(x + dx, y + dy, z + dz);
        }
  }

  // ---------- comparateur ----------

  /** Signal analogique d'un conteneur (formule du jeu de référence), -1 si ce n'est pas un conteneur. */
  containerSignal(x: number, y: number, z: number): number {
    const w = this.world;
    const id = w.getBlock(x, y, z);
    if (id <= 0) return -1;
    const b = BlockRegistry.get(id);
    if (b.key === 'jukebox') return jukeboxSignal(w, x, y, z);
    let slots: (ItemStack | null)[] | null = null;
    if (b.interact === 'chest' || b.interact === 'dispenser' || b.interact === 'hopper') {
      const inv = w.getChest(x, y, z, false);
      if (b.key.includes('ender_chest')) return -1;
      slots = inv?.slots ?? [];
      const size = inv?.slots.length ?? (b.interact === 'hopper' ? 5 : b.interact === 'dispenser' ? 9 : 27);
      return fillSignal(slots, size);
    }
    if (b.interact === 'furnace') {
      const f = w.getFurnace(x, y, z, false);
      return fillSignal(f ? [f.input, f.fuel, f.output] : [], 3);
    }
    if (b.interact === 'brewing') {
      const s = w.brewing.get(key(x, y, z));
      return fillSignal(s ? [...s.bottles, s.ingredient, s.fuelItem] : [], 5);
    }
    if (/^cake/.test(b.key)) return Math.max(0, 14 - 2 * (w.getMeta(x, y, z) & 7));
    if (/^composter/.test(b.key)) return b.key === 'composter_ready' ? 8 : Math.min(7, w.getMeta(x, y, z) & 7);
    if (b.key === 'lectern' || b.key === 'chiseled_bookshelf') return 0;
    return -1;
  }

  comparatorValue(x: number, y: number, z: number): number {
    const w = this.world;
    const m = w.getMeta(x, y, z);
    const [bx, by, bz] = DIR6[oppositeDir(outDir(m))];
    let rear = rearInput(w, x, y, z);
    const c = this.containerSignal(x + bx, y + by, z + bz);
    if (c >= 0) rear = c;
    else if (rear < 15 && isConductor(w.getBlock(x + bx, y + by, z + bz))) {
      const c2 = this.containerSignal(x + 2 * bx, y + 2 * by, z + 2 * bz);
      if (c2 >= 0) rear = Math.max(rear, c2);
    }
    const side = sideInput(w, x, y, z);
    if (m & 4) return Math.max(0, rear - side);
    return side > rear ? 0 : rear;
  }

  // ---------- consommateurs ----------

  private updateOpenable(x: number, y: number, z: number, id: number, m: number) {
    const w = this.world;
    const door = shapeOf(id) === 'door';
    if (door && m & 8) {
      if (w.getBlock(x, y - 1, z) === id) this.queue.push(x, y - 1, z);
      return;
    }
    const powered = inputPower(w, x, y, z) > 0 || (door && inputPower(w, x, y + 1, z) > 0);
    if (powered === ((m & 32) !== 0)) return;
    // mémorise l'état d'alimentation (bit 5), puis ouvre / ferme
    this.internal++;
    try {
      w.setBlock(x, y, z, id, powered ? m | 32 : m & ~32, false);
      if (setOpen(w, x, y, z, powered)) {
        const iron = BlockRegistry.get(id).key.startsWith('iron');
        this.host.sound?.(powered ? 'door_open' : 'door_close', x + 0.5, y + 0.5, z + 0.5, iron ? 0.8 : 1);
      }
    } finally {
      this.internal--;
    }
  }

  private updateBulb(x: number, y: number, z: number, id: number, m: number) {
    const k = BlockRegistry.get(id).key;
    const powered = inputPower(this.world, x, y, z) > 0;
    const wasPowered = k.endsWith('_powered');
    if (powered === wasPowered) return;
    const base = k.replace(/_powered$/, '').replace(/_lit$/, '');
    let lit = k.includes('_lit');
    if (powered) lit = !lit;
    const nk = `${base}${lit ? '_lit' : ''}${powered ? '_powered' : ''}`;
    if (!BlockRegistry.has(nk)) return;
    this.set(x, y, z, BlockRegistry.id(nk), m);
    if (powered) this.host.sound?.('click', x + 0.5, y + 0.5, z + 0.5, lit ? 1.4 : 1.1);
  }

  /** Rail de propulsion : alimenté directement ou par un rail voisin alimenté (jusqu'à 8 rails). */
  private updateRail(x: number, y: number, z: number, id: number, m: number) {
    const w = this.world;
    const on = BlockRegistry.get(id).key === 'powered_rail_on';
    const want = this.railPowered(x, y, z, m, 0, new Set());
    if (want === on) return;
    this.set(x, y, z, idOf(want ? 'powered_rail_on' : 'powered_rail'), m);
    // les rails voisins de la ligne recalculent leur état
    const axisX = (m & 7) === 1 || (m & 7) === 2 || (m & 7) === 3;
    for (let i = 1; i <= 8; i++)
      for (const s of [-1, 1])
        for (const dy of [-1, 0, 1]) {
          const nx = x + (axisX ? s * i : 0), nz = z + (axisX ? 0 : s * i);
          if (rsKind(w.getBlock(nx, y + dy, nz)) === K.POWERED_RAIL) this.queue.push(nx, y + dy, nz);
        }
  }

  private railPowered(x: number, y: number, z: number, m: number, depth: number, seen: Set<string>): boolean {
    const w = this.world;
    seen.add(key(x, y, z));
    if (inputPower(w, x, y, z) > 0 || inputPower(w, x, y - 1, z) > 0 && isConductor(w.getBlock(x, y - 1, z))) return true;
    if (depth >= 8) return false;
    const axisX = (m & 7) === 1 || (m & 7) === 2 || (m & 7) === 3;
    for (const s of [-1, 1])
      for (const dy of [0, 1, -1]) {
        const nx = x + (axisX ? s : 0), nz = z + (axisX ? 0 : s), ny = y + dy;
        if (seen.has(key(nx, ny, nz)) || rsKind(w.getBlock(nx, ny, nz)) !== K.POWERED_RAIL) continue;
        const nm = w.getMeta(nx, ny, nz);
        const nAxisX = (nm & 7) === 1 || (nm & 7) === 2 || (nm & 7) === 3;
        if (nAxisX === axisX && this.railPowered(nx, ny, nz, nm, depth + 1, seen)) return true;
      }
    return false;
  }

  private daylightCache = new Map<string, number>();
  private refreshDaylight(x: number, y: number, z: number) {
    const k = key(x, y, z);
    const v = emitWeak(this.world, x, y, z, 0);
    if (this.daylightCache.get(k) === v) return;
    this.daylightCache.set(k, v);
    this.notifyAround(x, y, z);
  }
}

/** Remplissage → signal (0 vide, 1..15 sinon), comme le jeu de référence. */
export function fillSignal(slots: (ItemStack | null | undefined)[], size: number): number {
  let f = 0, any = false;
  for (const s of slots) {
    if (!s) continue;
    any = true;
    f += s.count / ItemRegistry.maxStack(s.id);
  }
  if (!any) return 0;
  return Math.floor(1 + (f / Math.max(1, size)) * 14);
}

// ---------- API historique (portes, leviers, boutons, plaques, pistons, juke-box) ----------

const kindOf = (id: number) => shapeOf(id);

export function isOpenable(id: number) {
  const k = kindOf(id);
  // porte à carte : la redstone ne l'ouvre pas
  if (k === 'door' && BlockRegistry.get(id).def.keyItem) return false;
  return k === 'door' || k === 'trapdoor' || k === 'fence_gate';
}

/** Source de redstone active à cette position (levier, bouton, plaque, bloc, torche, juke-box en lecture…) ? */
export function sourceActive(world: RsReader, x: number, y: number, z: number): boolean {
  const k = rsKind(world.getBlock(x, y, z));
  if (!k || k === K.WIRE) return false;
  for (let d = 0; d < 6; d++) if (emitWeak(world, x, y, z, d) > 0) return true;
  return false;
}

/** Un ouvrant (une porte : l'une ou l'autre moitié) est-il alimenté ? */
export function isPowered(world: RsReader, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  if (kindOf(id) === 'door') {
    const by = world.getMeta(x, y, z) & 8 ? y - 1 : y;
    return inputPower(world, x, by, z) > 0 || inputPower(world, x, by + 1, z) > 0;
  }
  return inputPower(world, x, y, z) > 0;
}

/** Ouvre / ferme un ouvrant (les deux moitiés d'une porte). Renvoie vrai s'il a changé. */
export function setOpen(world: World, x: number, y: number, z: number, open: boolean): boolean {
  const id = world.getBlock(x, y, z);
  const k = kindOf(id);
  if (!k) return false;
  const ys = k === 'door' ? (world.getMeta(x, y, z) & 8 ? [y - 1, y] : [y, y + 1]) : [y];
  let changed = false;
  for (const yy of ys) {
    if (world.getBlock(x, yy, z) !== id) continue;
    const m = world.getMeta(x, yy, z);
    const next = open ? m | 4 : m & ~4;
    if (next !== m) {
      world.setBlock(x, yy, z, id, next, false);
      changed = true;
    }
  }
  return changed;
}

/**
 * Après le changement d'une source en (x, y, z) (levier, bouton, plaque, juke-box) : propagation
 * immédiate par le moteur. `onChange` reçoit chaque ouvrant modifié (son de la porte).
 */
export function updatePowerAround(world: World, x: number, y: number, z: number, onChange?: (x: number, y: number, z: number, open: boolean) => void) {
  const e = RedstoneEngine.for(world);
  const prev = e.host.sound;
  if (onChange && !prev) e.host.sound = (n, sx, sy, sz) => (n === 'door_open' || n === 'door_close') && onChange(Math.floor(sx), Math.floor(sy), Math.floor(sz), n === 'door_open');
  e.notifyAround(x, y, z);
  e.flush();
  if (onChange && !prev) e.host.sound = prev;
}

export { H2D };
