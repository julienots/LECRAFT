import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { getDrops } from '../blocks/BlockBehaviors';
import { FACING_DIR } from '../blocks/Shapes';
import { WORLD_HEIGHT } from '../core/Config';
import type { GameContext } from '../core/GameContext';
import type { Entity } from '../entities/Entity';
import type { EntitySpawner } from '../entities/Mob';
import { isRailKey } from './Rails';
import { sourceActive } from './Redstone';
import type { World } from './World';

/**
 * Pistons et pistons collants (règles du jeu de référence, Java 1.21).
 *
 * Méta de la base : bits 0-2 = orientation (0 sud +Z, 1 ouest -X, 2 nord -Z, 3 est +X, 4 haut, 5 bas),
 * bit 3 = sorti. Méta de la tête : orientation + bit 3 = collante.
 * Alimentation : mêmes sources que les distributeurs (levier, bouton, plaque dans le cube 3×3×3),
 * plus bloc et torche de redstone adjacents ; la case au-dessus compte aussi (quasi-connectivité).
 * La face avant n'alimente pas le piston.
 */
export const PISTON_DIRS: [number, number, number][] = [
  [FACING_DIR[0][0], 0, FACING_DIR[0][1]],
  [FACING_DIR[1][0], 0, FACING_DIR[1][1]],
  [FACING_DIR[2][0], 0, FACING_DIR[2][1]],
  [FACING_DIR[3][0], 0, FACING_DIR[3][1]],
  [0, 1, 0],
  [0, -1, 0],
];
export const PISTON_EXTENDED = 8;
export const HEAD_STICKY = 8;
/** Nombre maximal de blocs poussés. */
export const PUSH_LIMIT = 12;
/** Délai avant de sortir / rentrer (ticks de 1/20 s). */
export const PISTON_DELAY = 2;

type Vec = [number, number, number];
export interface BlockReader {
  getBlock(x: number, y: number, z: number): number;
  getMeta(x: number, y: number, z: number): number;
}

const idOf = (k: string) => (BlockRegistry.has(k) ? BlockRegistry.id(k) : -2);
/** Identifiants résolus à la demande (blocs supplémentaires : numéros attribués au chargement). */
let ids: { piston: number; sticky: number; head: number; slime: number; honey: number; rsBlock: number; rsTorch: number } | null = null;
function I() {
  if (!ids || ids.piston < 0) ids = { piston: idOf('piston'), sticky: idOf('sticky_piston'), head: idOf('piston_head'), slime: idOf('slime_block'), honey: idOf('honey_block'), rsBlock: idOf('redstone_block'), rsTorch: idOf('redstone_torch') };
  return ids;
}
export const isPistonBase = (id: number) => id > 0 && (id === I().piston || id === I().sticky);
export const isPistonHead = (id: number) => id > 0 && id === I().head;
export const pistonFacing = (meta: number) => Math.min(5, meta & 7);

export type PushReaction = 'normal' | 'destroy' | 'block' | 'push_only';

/** Blocs immobiles (en plus des blocs incassables et des entités de bloc). */
const IMMOVABLE = /^(obsidian|crying_obsidian|bedrock|end_portal_frame.*|end_portal|end_gateway|nether_portal|enchanting_table|ender_chest(_block)?|respawn_anchor.*|reinforced_deepslate|spawner|trial_spawner.*|vault.*|beacon|conduit|lectern|jukebox|.*shulker_box|.*campfire|beehive|bee_nest|chiseled_bookshelf|crafter|.*command_block.*|structure_block.*|jigsaw|sculk_(sensor|catalyst|shrieker).*|calibrated_sculk_sensor|daylight_detector.*|comparator.*|boss_altar|barrier|light)$/;
/** Blocs cassés (avec leurs objets) au lieu d'être poussés. */
const FRAGILE = /(_sign|_banner|_head|_skull|candle|_carpet)$|^(flower_pot|potted_.*|cake.*|cobweb|dragon_egg|pumpkin_stem|melon_stem|attached_.*_stem|scaffolding|bell|sea_pickle|turtle_egg|.*_bed|.*_door)$/;
const FRAGILE_SHAPES = new Set(['door', 'bed', 'torch', 'lever', 'button', 'plate', 'ladder', 'snow_layer', 'carpet', 'lily_pad', 'lantern', 'cactus']);
const BLOCK_ENTITY_KINDS = new Set(['chest', 'dispenser', 'hopper', 'furnace', 'brewing', 'ender_chest', 'enchanting']);

/** Réaction d'un bloc poussé (comme PushReaction du jeu de référence). */
export function pushReaction(id: number, meta: number): PushReaction {
  if (id < 0) return 'block'; // chunk non chargé
  if (id === B.AIR) return 'normal';
  if (isPistonBase(id)) return meta & PISTON_EXTENDED ? 'block' : 'normal';
  if (isPistonHead(id)) return 'block';
  const b = BlockRegistry.get(id);
  if (b.liquid) return 'destroy';
  if (b.hardness < 0 || IMMOVABLE.test(b.key)) return 'block';
  if (b.replaceable || b.render === 'cross' || b.def.doublePlant || FRAGILE.test(b.key) || (b.shape && FRAGILE_SHAPES.has(b.shape)) || (b.needsSupport && !isRailKey(b.key))) return 'destroy';
  if (b.interact && BLOCK_ENTITY_KINDS.has(b.interact)) return 'block';
  if (b.key.endsWith('glazed_terracotta')) return 'push_only';
  return 'normal';
}

export interface PushPlan {
  ok: boolean;
  /** Sens du déplacement des blocs. */
  dir: Vec;
  /** Blocs déplacés (ordre du jeu de référence). */
  push: Vec[];
  /** Blocs cassés (avec leurs objets). */
  destroy: Vec[];
}

const eq = (a: Vec, b: Vec) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const add = (a: Vec, d: Vec, k = 1): Vec => [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k];
const neg = (d: Vec): Vec => [-d[0], -d[1], -d[2]];
const ALL_DIRS: Vec[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/**
 * Liste des blocs déplacés par le piston en (px, py, pz) orienté `facing` (port de
 * PistonStructureResolver) : sortie (pousse vers l'avant) ou rentrée d'un piston collant (tire le bloc
 * devant la tête ; la tête est considérée comme déjà retirée). Gère les blocs de slime et de miel
 * (qui entraînent leurs voisins, mais ne collent pas l'un à l'autre) et la limite de 12 blocs.
 */
export function computePushList(w: BlockReader, px: number, py: number, pz: number, facing: number, extending: boolean): PushPlan {
  const fd = PISTON_DIRS[facing];
  const piston: Vec = [px, py, pz];
  const head = add(piston, fd);
  const dir = extending ? fd : neg(fd);
  const start = extending ? head : add(piston, fd, 2);
  let toPush: Vec[] = [];
  const toDestroy: Vec[] = [];
  const { slime, honey } = I();
  const get = (p: Vec) => (!extending && eq(p, head) ? B.AIR : w.getBlock(p[0], p[1], p[2]));
  const reaction = (p: Vec) => pushReaction(get(p), w.getMeta(p[0], p[1], p[2]));
  const sticky = (id: number) => id > 0 && (id === slime || id === honey);
  const stick = (a: number, b: number) => !((a === honey && b === slime) || (a === slime && b === honey)) && (sticky(a) || sticky(b));
  const indexOf = (p: Vec) => toPush.findIndex((q) => eq(q, p));
  // isPushable : `line` = direction de la ligne (blocs « poussée seulement » : seulement dans l'axe du piston)
  const pushable = (p: Vec, allowDestroy: boolean, line: Vec): boolean => {
    if (p[1] < 0 || p[1] >= WORLD_HEIGHT) return false;
    if ((dir[1] < 0 && p[1] === 0) || (dir[1] > 0 && p[1] === WORLD_HEIGHT - 1)) return false;
    const r = reaction(p);
    if (r === 'block') return false;
    if (r === 'destroy') return allowDestroy;
    if (r === 'push_only') return eq(dir, line);
    return true;
  };
  const fail = (): PushPlan => ({ ok: false, dir, push: [], destroy: [] });

  const reorder = (i: number, j: number) => {
    const a = toPush.slice(0, j), b = toPush.slice(toPush.length - i), c = toPush.slice(j, toPush.length - i);
    toPush = [...a, ...b, ...c];
  };
  const branch = (from: Vec): boolean => {
    const s = get(from);
    for (const d of ALL_DIRS) {
      if ((d[0] !== 0 && dir[0] !== 0) || (d[1] !== 0 && dir[1] !== 0) || (d[2] !== 0 && dir[2] !== 0)) continue; // même axe
      const p = add(from, d);
      if (stick(get(p), s) && !line(p, d)) return false;
    }
    return true;
  };
  const line = (origin: Vec, lineDir: Vec): boolean => {
    let s = get(origin);
    if (s === B.AIR) return true;
    if (!pushable(origin, false, lineDir)) return true;
    if (eq(origin, piston) || indexOf(origin) >= 0) return true;
    let i = 1;
    if (i + toPush.length > PUSH_LIMIT) return false;
    // blocs collés derrière (entraînés par le slime / miel)
    while (sticky(s)) {
      const p = add(origin, dir, -i);
      const prev = s;
      s = get(p);
      if (s === B.AIR || !stick(prev, s) || !pushable(p, false, neg(dir)) || eq(p, piston)) break;
      if (++i + toPush.length > PUSH_LIMIT) return false;
    }
    let l = 0;
    for (let j = i - 1; j >= 0; j--) {
      toPush.push(add(origin, dir, -j));
      l++;
    }
    for (let k = 1; ; k++) {
      const p = add(origin, dir, k);
      const at = indexOf(p);
      if (at > -1) {
        reorder(l, at);
        for (let m = 0; m <= at + l; m++) if (sticky(get(toPush[m])) && !branch(toPush[m])) return false;
        return true;
      }
      if (get(p) === B.AIR) return true;
      if (!pushable(p, true, dir) || eq(p, piston)) return false;
      if (reaction(p) === 'destroy') {
        toDestroy.push(p);
        return true;
      }
      if (toPush.length >= PUSH_LIMIT) return false;
      toPush.push(p);
      l++;
    }
  };

  if (!pushable(start, false, fd)) {
    if (extending && reaction(start) === 'destroy') return { ok: true, dir, push: [], destroy: [start] };
    return fail();
  }
  if (!line(start, dir)) return fail();
  for (let i = 0; i < toPush.length; i++) if (sticky(get(toPush[i])) && !branch(toPush[i])) return fail();
  const seen = new Set<string>();
  const destroy = toDestroy.filter((p) => !seen.has(p.join()) && !!seen.add(p.join()));
  return { ok: true, dir, push: toPush, destroy };
}

/** Le piston est-il alimenté ? (sources voisines, sauf sa face avant ; case du dessus comprise) */
export function pistonPowered(w: BlockReader, x: number, y: number, z: number, facing: number): boolean {
  const [fx, fy, fz] = PISTON_DIRS[facing];
  const { rsBlock, rsTorch } = I();
  const around = (cx: number, cy: number, cz: number, skipX: number, skipY: number, skipZ: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy && !dz) continue;
          const ax = cx + dx, ay = cy + dy, az = cz + dz;
          if (ax === skipX && ay === skipY && az === skipZ) continue;
          if (sourceActive(w as World, ax, ay, az)) return true;
          // bloc et torche de redstone : faces adjacentes seulement
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1) {
            const id = w.getBlock(ax, ay, az);
            if (id > 0 && (id === rsBlock || id === rsTorch)) return true;
          }
        }
    return false;
  };
  if (around(x, y, z, x + fx, y + fy, z + fz)) return true;
  // quasi-connectivité : alimenté comme s'il occupait aussi la case du dessus
  return around(x, y + 1, z, x, y, z);
}

/** Bloc cassé par un piston : objets lâchés, moitié jumelle (porte, lit, plante haute) retirée. */
function breakBlock(w: World, spawner: EntitySpawner | null, x: number, y: number, z: number) {
  const id = w.getBlock(x, y, z);
  if (id <= 0) return;
  const meta = w.getMeta(x, y, z);
  const b = BlockRegistry.get(id);
  let partner: Vec | null = null;
  if (b.shape === 'door') partner = [x, meta & 8 ? y - 1 : y + 1, z];
  else if (b.def.doublePlant) partner = [x, meta & 1 ? y - 1 : y + 1, z];
  else if (b.shape === 'bed') {
    const [dx, dz] = FACING_DIR[meta & 3];
    const k = meta & 4 ? -1 : 1;
    partner = [x + dx * k, y, z + dz * k];
  }
  w.setBlock(x, y, z, B.AIR);
  if (partner && w.getBlock(partner[0], partner[1], partner[2]) === id) w.setBlock(partner[0], partner[1], partner[2], B.AIR);
  if (!spawner || b.liquid) return;
  for (const d of getDrops(id, b.def.doublePlant ? meta & ~1 : meta, undefined)) spawner.spawnItem(d.id, d.count, x + 0.5, y + 0.3, z + 0.5);
}

/** Déplace les blocs d'un plan (casse d'abord, puis retire et repose d'une case). */
export function applyPushPlan(w: World, plan: PushPlan, spawner: EntitySpawner | null) {
  for (const [x, y, z] of plan.destroy) breakBlock(w, spawner, x, y, z);
  const states = plan.push.map(([x, y, z]) => [w.getBlock(x, y, z), w.getMeta(x, y, z)]);
  for (const [x, y, z] of plan.push) w.setBlock(x, y, z, B.AIR, 0, false);
  const filled = new Set<string>();
  plan.push.forEach(([x, y, z], i) => {
    const [nx, ny, nz] = add([x, y, z], plan.dir);
    filled.add(`${nx},${ny},${nz}`);
    w.setBlock(nx, ny, nz, states[i][0], states[i][1]);
  });
  // cases libérées : voisins prévenus (sable qui tombe, torches sans support…)
  for (const [x, y, z] of plan.push) {
    if (filled.has(`${x},${y},${z}`)) continue;
    w.scheduleUpdate(x, y, z);
    for (const [dx, dy, dz] of ALL_DIRS) w.scheduleUpdate(x + dx, y + dy, z + dz);
  }
}

/** Sort le piston : pousse les blocs, pose la tête. Faux si bloqué. */
export function extendPiston(w: World, x: number, y: number, z: number, spawner: EntitySpawner | null = null): PushPlan | null {
  const id = w.getBlock(x, y, z);
  if (!isPistonBase(id)) return null;
  const meta = w.getMeta(x, y, z);
  if (meta & PISTON_EXTENDED) return null;
  const f = pistonFacing(meta);
  const plan = computePushList(w, x, y, z, f, true);
  if (!plan.ok) return null;
  applyPushPlan(w, plan, spawner);
  const [dx, dy, dz] = PISTON_DIRS[f];
  w.setBlock(x, y, z, id, f | PISTON_EXTENDED, false);
  w.setBlock(x + dx, y + dy, z + dz, I().head, f | (id === I().sticky ? HEAD_STICKY : 0));
  return plan;
}

/** Rentre le piston : retire la tête ; un piston collant tire le bloc devant (s'il est déplaçable). */
export function retractPiston(w: World, x: number, y: number, z: number, spawner: EntitySpawner | null = null): PushPlan | null {
  const id = w.getBlock(x, y, z);
  if (!isPistonBase(id)) return null;
  const meta = w.getMeta(x, y, z);
  if (!(meta & PISTON_EXTENDED)) return null;
  const f = pistonFacing(meta);
  const [dx, dy, dz] = PISTON_DIRS[f];
  w.setBlock(x, y, z, id, f, false);
  if (isPistonHead(w.getBlock(x + dx, y + dy, z + dz))) w.setBlock(x + dx, y + dy, z + dz, B.AIR);
  if (id !== I().sticky) return { ok: true, dir: [-dx, -dy, -dz], push: [], destroy: [] };
  // seuls les blocs « normaux » (et les pistons rentrés) sont tirés
  const fx = x + dx * 2, fy = y + dy * 2, fz = z + dz * 2;
  const front = w.getBlock(fx, fy, fz);
  if (front <= 0 || pushReaction(front, w.getMeta(fx, fy, fz)) !== 'normal') return { ok: true, dir: [-dx, -dy, -dz], push: [], destroy: [] };
  const plan = computePushList(w, x, y, z, f, false);
  if (!plan.ok) return { ok: true, dir: plan.dir, push: [], destroy: [] };
  applyPushPlan(w, plan, spawner);
  return plan;
}

/** Entités (joueur, créatures, objets) dont la boîte touche les cases d'arrivée : déplacées d'une case. */
function pushEntities(ctx: GameContext, entities: Entity[], cells: Vec[], dir: Vec) {
  if (!cells.length) return;
  const eps = 1e-3;
  const hits = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
    cells.some(([cx, cy, cz]) => x0 < cx + 1 - eps && x1 > cx + eps && y0 < cy + 1 - eps && y1 > cy + eps && z0 < cz + 1 - eps && z1 > cz + eps);
  const move = (b: { x: number; y: number; z: number; vy: number; halfWidth: number; height: number }) => {
    if (!hits(b.x - b.halfWidth, b.y, b.z - b.halfWidth, b.x + b.halfWidth, b.y + b.height, b.z + b.halfWidth)) return;
    b.x += dir[0];
    b.y += dir[1];
    b.z += dir[2];
    if (dir[1] > 0) b.vy = Math.max(0, b.vy);
  };
  if (!ctx.player.dead) move(ctx.player.body);
  for (const e of entities) if (!e.removed && e.kind !== 'projectile') move(e.body);
}

/**
 * Pistons du monde : réagissent aux mises à jour voisines (alimentation, tête cassée) avec un délai
 * de 2 ticks.
 * Branché sur WorldTicker (20 Hz).
 */
export class PistonSystem {
  /** Pistons à actionner : « x,y,z » → ticks restants. */
  private pending = new Map<string, number>();
  tick(ctx: GameContext, spawner: EntitySpawner) {
    if (!this.pending.size) return;
    for (const [k, t] of [...this.pending]) {
      if (t > 1) {
        this.pending.set(k, t - 1);
        continue;
      }
      this.pending.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      this.actuate(ctx, spawner, x, y, z);
    }
  }

  /** Mise à jour voisine d'une base ou d'une tête de piston. */
  neighborUpdate(ctx: GameContext, spawner: EntitySpawner, x: number, y: number, z: number, id: number) {
    const w = ctx.world;
    const meta = w.getMeta(x, y, z);
    const f = pistonFacing(meta);
    const [dx, dy, dz] = PISTON_DIRS[f];
    if (isPistonHead(id)) {
      // tête sans sa base (base cassée) : retirée sans objet
      const b = w.getBlock(x - dx, y - dy, z - dz);
      if (!isPistonBase(b) || !(w.getMeta(x - dx, y - dy, z - dz) & PISTON_EXTENDED) || pistonFacing(w.getMeta(x - dx, y - dy, z - dz)) !== f) w.setBlock(x, y, z, B.AIR);
      return;
    }
    const extended = (meta & PISTON_EXTENDED) !== 0;
    if (extended && !isPistonHead(w.getBlock(x + dx, y + dy, z + dz))) {
      // tête cassée : la base casse aussi (un seul objet : le piston)
      w.setBlock(x, y, z, B.AIR);
      if (!ctx.player.creative) spawner.spawnItem(BlockRegistry.get(id).key, 1, x + 0.5, y + 0.3, z + 0.5);
      ctx.particles.blockBreak(x, y, z, id);
      return;
    }
    if (pistonPowered(w, x, y, z, f) !== extended && !this.pending.has(`${x},${y},${z}`)) this.pending.set(`${x},${y},${z}`, PISTON_DELAY);
  }

  private actuate(ctx: GameContext, spawner: EntitySpawner, x: number, y: number, z: number) {
    const w = ctx.world;
    const id = w.getBlock(x, y, z);
    if (!isPistonBase(id)) return;
    const meta = w.getMeta(x, y, z);
    const f = pistonFacing(meta);
    const extended = (meta & PISTON_EXTENDED) !== 0;
    const powered = pistonPowered(w, x, y, z, f);
    if (powered === extended) return;
    const entities = (spawner as EntitySpawner & { entities?: Entity[] }).entities ?? [];
    const [dx, dy, dz] = PISTON_DIRS[f];
    const pos = { x: x + 0.5, y: y + 0.5, z: z + 0.5, pitch: 0.6 + Math.random() * 0.25 };
    if (powered) {
      const plan = extendPiston(w, x, y, z, spawner);
      if (!plan) return;
      pushEntities(ctx, entities, [[x + dx, y + dy, z + dz], ...plan.push.map((p) => add(p, plan.dir))], plan.dir);
      ctx.audio.play('piston_out', pos);
    } else {
      const plan = retractPiston(w, x, y, z, spawner);
      if (!plan) return;
      pushEntities(ctx, entities, plan.push.map((p) => add(p, plan.dir)), plan.dir);
      ctx.audio.play('piston_in', pos);
    }
  }
}
