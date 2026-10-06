/**
 * Commandes de chat dans la syntaxe du jeu de référence (/give, /tp, /time, /gamemode, /fill…).
 * Accepte les identifiants avec ou sans espace de noms (« minecraft:stone »), les coordonnées
 * absolues, relatives (~) et locales (^), et les sélecteurs @s @p @a @r @e avec leurs filtres
 * (type, name, tag, family, r, rm, c, x/y/z, dx/dy/dz, scores, m, l, lm).
 * Les commandes peuvent être exécutées par le joueur, par une entité (execute as, scripts) ou
 * par le « serveur » (fonctions, scripts de dimension) : @s désigne alors l'exécutant.
 */
import type { Session } from '../core/Session';
import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { makeStack } from '../inventory/Inventory';
import { MOB_DEFS, familiesOf } from '../data/mobs';
import { WORLD_HEIGHT } from '../core/Config';
import type { Entity } from '../entities/Entity';
import { Mob } from '../entities/Mob';
import { ItemEntity } from '../entities/ItemEntity';
import { Projectile } from '../entities/Projectile';
import { EFFECTS, effectId } from '../entities/Effects';
import { encodeStates, decodeStates } from '../addons/BedrockBlocks';
import { rollLoot, STRUCTURES } from '../addons/AddonRegistry';
import { placeStructure } from '../addons/StructurePlacer';
import { mapParticle } from '../audio/SoundMap';
import { hooks } from '../scripting/Hooks';
import { closestBlock } from '../blocks/BlockAliases';
import type { ItemStack } from '../inventory/Item';

export class CommandError extends Error {}

export interface GameRules {
  keepInventory: boolean;
  doDaylightCycle: boolean;
  doWeatherCycle: boolean;
  doMobSpawning: boolean;
  tntExplodes: boolean;
  showCoordinates: boolean;
  naturalRegeneration: boolean;
  fallDamage: boolean;
  doImmediateRespawn: boolean;
  commandBlockOutput: boolean;
}

export const DEFAULT_RULES: GameRules = {
  keepInventory: false,
  doDaylightCycle: true,
  doWeatherCycle: true,
  doMobSpawning: true,
  tntExplodes: true,
  showCoordinates: false,
  naturalRegeneration: true,
  fallDamage: true,
  doImmediateRespawn: false,
  commandBlockOutput: true,
};

export type Target = { kind: 'player' } | { kind: 'entity'; e: Entity };
export interface Origin {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

interface Ctx {
  s: Session;
  args: string[];
  /** Position et orientation d'exécution (joueur, entité, ou origine d'une fonction). */
  origin: Origin;
  /** Retour d'information (affiché seulement pour les commandes tapées par le joueur). */
  out: (msg: string) => void;
  depth: number;
  /** Exécutant (@s) : joueur, entité, ou personne (serveur). */
  executor: Target | null;
}

interface CommandDef {
  name: string;
  aliases?: string[];
  usage: string;
  desc: string;
  cheat?: boolean;
  run(c: Ctx): void | Promise<void>;
}

// ---------- analyse ----------

/** Découpe une ligne de commande (guillemets, échappements et crochets des sélecteurs respectés). */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '', quote = false, depth = 0, had = false;
  const s = line.trim();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote && ch === '\\' && i + 1 < s.length) {
      cur += depth > 0 ? ch + s[i + 1] : s[i + 1];
      i++;
      continue;
    }
    if (ch === '"') {
      if (depth === 0) {
        quote = !quote;
        had = true;
        continue;
      }
      quote = !quote;
    }
    if (!quote) {
      if (ch === '[' || ch === '{') depth++;
      if (ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
      if (ch === ' ' && depth === 0) {
        if (cur || had) out.push(cur);
        cur = '';
        had = false;
        continue;
      }
    }
    cur += ch;
  }
  if (cur || had) out.push(cur);
  return out;
}

const strip = (id: string) => id.toLowerCase().replace(/^minecraft:/, '');

/** Noms alternatifs (anciens noms ou noms de l'édition mobile). */
const ALIAS: Record<string, string> = {
  grass: 'grass_block', log: 'oak_log', planks: 'oak_planks', wool: 'white_wool', leaves: 'oak_leaves', sapling: 'oak_sapling',
  stone_slab: 'stone_slab', wooden_door: 'oak_door', bed: 'red_bed', fence: 'oak_fence', seeds: 'wheat_seeds', tallgrass: 'short_grass',
  yellow_flower: 'dandelion', red_flower: 'poppy', reeds: 'sugar_cane', snow_layer: 'snow', web: 'string', wooden_pickaxe: 'wooden_pickaxe',
  gold_pickaxe: 'golden_pickaxe', gold_sword: 'golden_sword', gold_axe: 'golden_axe', gold_shovel: 'golden_shovel', gold_hoe: 'golden_hoe',
  cooked_fish: 'cooked_beef', melon: 'melon_slice', monster_egg: 'spawner', lit_pumpkin: 'pumpkin',
  flowing_water: 'water', flowing_lava: 'lava', stonebrick: 'stone_bricks', brick_block: 'bricks', glass_pane: 'glass',
  wooden_slab: 'oak_slab', double_stone_slab: 'stone', concrete: 'white_concrete', undyed_shulker_box: 'chest',
};

export function resolveItem(id: string): string {
  const k = strip(id);
  const a = ALIAS[k] ?? k;
  if (ItemRegistry.has(a)) return a;
  if (ItemRegistry.has(k)) return k;
  if (ItemRegistry.has(id)) return id;
  throw new CommandError(`Objet inconnu : « ${id} »`);
}

export function resolveBlock(id: string): number {
  const k = strip(id);
  if (k === 'air' || k === 'structure_void') return B.AIR;
  for (const c of [ALIAS[k] ?? k, k, id]) {
    try {
      return BlockRegistry.byName(c).id;
    } catch {
      /* suivant */
    }
  }
  // bloc du jeu de référence absent : équivalent le plus proche
  const near = closestBlock(k);
  if (near >= 0) return near;
  throw new CommandError(`Bloc inconnu : « ${id} »`);
}

function resolveMob(id: string): string {
  const k = strip(id);
  const m = MOB_DEFS.find((d) => d.key === k || d.key === id || d.name.toLowerCase() === k);
  if (!m) throw new CommandError(`Entité inconnue : « ${id} »`);
  return m.key;
}

function num(v: string | undefined, what: string, min = -Infinity, max = Infinity): number {
  if (v === undefined) throw new CommandError(`${what} attendu`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new CommandError(`Nombre invalide : « ${v} »`);
  if (n < min || n > max) throw new CommandError(`${what} doit être entre ${min} et ${max}`);
  return n;
}

function bool(v: string | undefined): boolean {
  if (v === 'true' || v === '1' || v === 'vrai') return true;
  if (v === 'false' || v === '0' || v === 'faux') return false;
  throw new CommandError(`Booléen attendu (true/false) : « ${v ?? ''} »`);
}

/** Lit 3 coordonnées (absolues, ~relatives ou ^locales) à partir de args[i]. */
function coords(c: Ctx, i: number, center = true): [number, number, number] {
  const a = c.args.slice(i, i + 3);
  if (a.length < 3) throw new CommandError('Coordonnées incomplètes (x y z)');
  return parseCoords(a, c.origin, center);
}

function parseCoords(a: string[], o: Origin, center = true): [number, number, number] {
  if (a.length === 3 && a.every((v) => v.startsWith('^'))) {
    const [l, u, f] = a.map((v) => Number(v.slice(1) || 0));
    // repère local : gauche, haut, avant (regard de l'exécutant)
    const sy = Math.sin(o.yaw), cy = Math.cos(o.yaw), cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
    const fwd = [-sy * cp, sp, -cy * cp], left = [-cy, 0, sy];
    const up = [sy * sp, cp, cy * sp];
    return [o.x + left[0] * l + up[0] * u + fwd[0] * f, o.y + left[1] * l + up[1] * u + fwd[1] * f, o.z + left[2] * l + up[2] * u + fwd[2] * f];
  }
  if (a.length < 3) throw new CommandError('Coordonnées incomplètes (x y z)');
  const base = [o.x, o.y, o.z];
  return a.map((v, k) => {
    if (v.startsWith('~')) return base[k] + Number(v.slice(1) || 0);
    if (v.startsWith('^')) throw new CommandError('Impossible de mélanger ^ et des coordonnées absolues');
    const n = Number(v);
    if (!Number.isFinite(n)) throw new CommandError(`Coordonnée invalide : « ${v} »`);
    // un entier absolu désigne le centre du bloc pour les positions d'entités
    return center && k !== 1 && Number.isInteger(n) ? n + 0.5 : n;
  }) as [number, number, number];
}

function blockCoords(c: Ctx, i: number): [number, number, number] {
  return coords(c, i, false).map(Math.floor) as [number, number, number];
}

const isCoord = (v: string | undefined) => v !== undefined && /^([~^]-?\d*\.?\d*|-?\d+\.?\d*)$/.test(v);

// ---------- cibles ----------

export function targetPos(s: Session, t: Target): { x: number; y: number; z: number } {
  return t.kind === 'player' ? { x: s.player.x, y: s.player.y, z: s.player.z } : { x: t.e.x, y: t.e.y, z: t.e.z };
}

/** Identifiant de type d'une cible (« player », « zombie », « vc:giant », « item »…). */
export function targetType(t: Target): string {
  if (t.kind === 'player') return 'player';
  const e = t.e;
  if (e instanceof Mob) return e.def.key;
  if (e instanceof ItemEntity) return 'item';
  if (e instanceof Projectile) return e.type === 'player_arrow' || e.type === 'arrow' ? 'arrow' : e.type;
  return e.kind;
}

/** Participant du tableau des scores d'une cible. */
export function scoreId(t: Target): string {
  return t.kind === 'player' ? 'player' : `e:${t.e.id}`;
}

function targetTags(s: Session, t: Target): Set<string> {
  return t.kind === 'player' ? s.player.tags : t.e.tags;
}

export function targetName(s: Session, t: Target): string {
  if (t.kind === 'player') return s.player.name;
  if (t.e.nameTag) return t.e.nameTag;
  if (t.e instanceof Mob) return t.e.def.name;
  if (t.e instanceof ItemEntity) return ItemRegistry.get(t.e.itemId)?.name ?? 'Objet';
  return 'Entité';
}

function targetFamilies(t: Target): string[] {
  if (t.kind === 'player') return ['player', 'mob'];
  if (t.e instanceof Mob) return familiesOf(t.e.def);
  return [targetType(t)];
}

/** Découpe « a=1,b={x=1..2},c=[…] » en paires (les virgules imbriquées sont ignorées). */
function splitArgs(s: string): [string, string][] {
  const out: [string, string][] = [];
  let depth = 0, cur = '', quote = false;
  const push = () => {
    const i = cur.indexOf('=');
    if (i > 0) out.push([cur.slice(0, i).trim(), cur.slice(i + 1).trim().replace(/^"(.*)"$/, '$1')]);
    cur = '';
  };
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote && (ch === '{' || ch === '[')) depth++;
    if (!quote && (ch === '}' || ch === ']')) depth--;
    if (ch === ',' && depth === 0 && !quote) push();
    else cur += ch;
  }
  if (cur.trim()) push();
  return out;
}

/** Intervalle « 1..5 », « ..3 », « 2.. », « 4 », « !4 ». */
function inRange(spec: string, v: number): boolean {
  const neg = spec.startsWith('!');
  const r = neg ? spec.slice(1) : spec;
  let ok: boolean;
  if (r.includes('..')) {
    const [a, b] = r.split('..');
    ok = (a === '' || v >= Number(a)) && (b === '' || v <= Number(b));
  } else ok = v === Number(r);
  return neg ? !ok : ok;
}

/** Sélecteurs @s @p @a @r @e @initiator et filtres ; un nom quelconque désigne le joueur (partie solo). */
export function selectTargets(c: Ctx, sel: string | undefined, def = '@s'): Target[] {
  const s = c.s;
  const raw = sel ?? def;
  const m = /^@(s|p|a|r|e|initiator)(?:\[(.*)\])?$/.exec(raw);
  if (!m) return [{ kind: 'player' }];
  const kind = m[1];
  const opts = splitArgs(m[2] ?? '');
  const o = c.origin;
  let ox = o.x, oy = o.y, oz = o.z;
  for (const [k, v] of opts) {
    if (k === 'x') ox = v.startsWith('~') ? o.x + Number(v.slice(1) || 0) : Number(v);
    if (k === 'y') oy = v.startsWith('~') ? o.y + Number(v.slice(1) || 0) : Number(v);
    if (k === 'z') oz = v.startsWith('~') ? o.z + Number(v.slice(1) || 0) : Number(v);
  }
  let list: Target[];
  if (kind === 's') list = c.executor ? [c.executor] : [];
  else if (kind === 'p' || kind === 'a' || kind === 'r' || kind === 'initiator') list = s.player.dead && kind === 'p' ? [] : [{ kind: 'player' }];
  else {
    list = [{ kind: 'player' }];
    for (const e of s.entities.entities) if (!e.removed && !(e instanceof Mob && e.dead)) list.push({ kind: 'entity', e });
  }
  const typeFilters = opts.filter(([k]) => k === 'type');
  const r = opts.find(([k]) => k === 'r')?.[1];
  const rm = opts.find(([k]) => k === 'rm')?.[1];
  const dx = opts.find(([k]) => k === 'dx')?.[1], dy = opts.find(([k]) => k === 'dy')?.[1], dz = opts.find(([k]) => k === 'dz')?.[1];
  const dist = (t: Target) => {
    const p = targetPos(s, t);
    return Math.hypot(p.x - ox, p.y - oy, p.z - oz);
  };
  list = list.filter((t) => {
    const type = targetType(t);
    for (const [, v] of typeFilters) {
      const neg = v.startsWith('!');
      const want = strip(v.replace(/^!/, ''));
      if ((strip(type) === want) === neg) return false;
    }
    const d = dist(t);
    if (r !== undefined && d > Number(r)) return false;
    if (rm !== undefined && d < Number(rm)) return false;
    if (dx !== undefined || dy !== undefined || dz !== undefined) {
      const p = targetPos(s, t);
      const [x0, x1] = [Math.min(ox, ox + Number(dx ?? 0)), Math.max(ox, ox + Number(dx ?? 0)) + 1];
      const [y0, y1] = [Math.min(oy, oy + Number(dy ?? 0)), Math.max(oy, oy + Number(dy ?? 0)) + 1];
      const [z0, z1] = [Math.min(oz, oz + Number(dz ?? 0)), Math.max(oz, oz + Number(dz ?? 0)) + 1];
      if (p.x < x0 || p.x > x1 || p.y < y0 - 1.8 || p.y > y1 || p.z < z0 || p.z > z1) return false;
    }
    const tags = targetTags(s, t);
    const fam = targetFamilies(t);
    for (const [k, v] of opts) {
      if (k === 'name') {
        const neg = v.startsWith('!');
        if ((targetName(s, t) === v.replace(/^!/, '')) === neg) return false;
      } else if (k === 'tag') {
        const neg = v.startsWith('!');
        const tag = v.replace(/^!/, '');
        if (tag === '') {
          if ((tags.size > 0) !== neg) return false;
        } else if (tags.has(tag) === neg) return false;
      } else if (k === 'family') {
        const neg = v.startsWith('!');
        if (fam.includes(v.replace(/^!/, '').toLowerCase()) === neg) return false;
      } else if (k === 'm') {
        if (t.kind !== 'player') return false;
        const gm = s.player.gameMode;
        const neg = v.startsWith('!');
        const want = GAMEMODES[v.replace(/^!/, '').toLowerCase()] ?? v;
        if ((gm === want) === neg) return false;
      } else if (k === 'l' || k === 'lm') {
        if (t.kind !== 'player') return false;
        const lv = s.player.level;
        if (k === 'l' && lv > Number(v)) return false;
        if (k === 'lm' && lv < Number(v)) return false;
      } else if (k === 'scores') {
        for (const [obj, spec] of splitArgs(v.replace(/^\{|\}$/g, ''))) {
          const sc = s.scoreboard.score(obj, scoreId(t));
          if (sc === undefined || !inRange(spec, sc)) return false;
        }
      } else if (k === 'hasitem') {
        if (t.kind !== 'player') return false;
        const want = /item\s*=\s*([\w:.]+)/.exec(v)?.[1];
        if (want) {
          try {
            if (s.player.inventory.count(resolveItem(want)) <= 0) return false;
          } catch {
            return false;
          }
        }
      }
    }
    return true;
  });
  list.sort((a, b) => dist(a) - dist(b));
  const cv = opts.find(([k]) => k === 'c')?.[1];
  if (kind === 'r') {
    list.sort(() => Math.random() - 0.5);
    list = list.slice(0, cv ? Math.abs(Number(cv)) : 1);
  } else if (cv !== undefined) {
    const n = Number(cv);
    list = n < 0 ? list.reverse().slice(0, -n) : list.slice(0, n);
  } else if (kind === 'p') list = list.slice(0, 1);
  return list;
}

function select(c: Ctx, sel: string | undefined, def = '@s'): Target[] {
  return selectTargets(c, sel, def);
}

function listNames(c: Ctx, list: Target[]): string {
  if (list.length > 3) return `${list.length} entités`;
  return list.map((t) => targetName(c.s, t)).join(', ');
}

// ---------- texte formaté (tellraw, titleraw) ----------

/** Clés de traduction connues (textes des add-ons chargés), sinon la clé elle-même. */
export const LANG = new Map<string, string>();
export function translate(key: string): string {
  return LANG.get(key) ?? key;
}

/** Convertit un texte brut {"rawtext":[…]} (objet ou JSON) en texte. */
export function rawTextToString(v: unknown, resolve?: { selector?(sel: string): string; score?(name: string, objective: string): string }): string {
  const walk = (n: unknown): string => {
    if (typeof n === 'string') return n;
    if (Array.isArray(n)) return n.map(walk).join('');
    if (!n || typeof n !== 'object') return '';
    const o = n as Record<string, unknown>;
    if (o.rawtext) return walk(o.rawtext);
    if (typeof o.text === 'string') return o.text;
    if (typeof o.translate === 'string') {
      const w = o.with as unknown;
      const args = Array.isArray(w) ? w.map(walk) : w && typeof w === 'object' ? (Array.isArray((w as { rawtext?: unknown }).rawtext) ? ((w as { rawtext: unknown[] }).rawtext).map(walk) : [walk(w)]) : [];
      let i = 0;
      return translate(o.translate).replace(/%(\d+\$)?[sd]|%%/g, (m, n1) => (m === '%%' ? '%' : n1 ? args[Number(n1.slice(0, -1)) - 1] ?? '' : args[i++] ?? ''));
    }
    if (o.selector) return resolve?.selector?.(String(o.selector)) ?? '';
    if (o.score && typeof o.score === 'object') {
      const sc = o.score as { name?: string; objective?: string };
      return resolve?.score?.(sc.name ?? '', sc.objective ?? '') ?? '';
    }
    return '';
  };
  return walk(v);
}

function rawText(c: Ctx, json: string): string {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return json;
  }
  return rawTextToString(v, {
    selector: (sel) => select(c, sel).map((t) => targetName(c.s, t)).join(', '),
    score: (name, obj) => {
      const who = name.startsWith('@') ? select(c, name)[0] : name === '*' ? c.executor : null;
      const id = who ? scoreId(who) : `f:${name}`;
      return String(c.s.scoreboard.score(obj, id) ?? '');
    },
  });
}

// ---------- états de blocs ----------

/** « bloc["etat"=1] » collé : sépare l'identifiant et les états (hors sélecteurs @e[…]). */
function splitBlockStates(toks: string[]): string[] {
  const out: string[] = [];
  for (const t of toks) {
    const m = /^([a-z0-9_:.-]+)(\[.*\])$/i.exec(t);
    if (m && !t.startsWith('@')) out.push(m[1], m[2]);
    else out.push(t);
  }
  return out;
}

/** Lit « ["a"=1,"b"="x"] » en dictionnaire d'états. */
export function parseStates(tok: string | undefined): Record<string, string | number | boolean> | null {
  if (!tok || !tok.startsWith('[')) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const part of tok.slice(1, -1).split(',')) {
    const m = /^\s*"?([^"=]+?)"?\s*[=:]\s*"?([^"]*)"?\s*$/.exec(part);
    if (!m) continue;
    const v = m[2];
    out[m[1]] = v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? Number(v) : v;
  }
  return out;
}

function metaFor(id: number, states: Record<string, string | number | boolean> | null, legacy?: string): number {
  if (legacy && /^\d+$/.test(legacy)) return Number(legacy);
  const info = BlockRegistry.get(id).def.bedrock;
  if (!states || !info) return 0;
  return encodeStates(info, states, 0);
}

/** Correspondance d'un bloc avec des états (« if block », fill … replace). */
function blockMatches(s: Session, x: number, y: number, z: number, id: number, states: Record<string, string | number | boolean> | null): boolean {
  if (s.world.getBlock(x, y, z) !== id) return false;
  const info = BlockRegistry.get(id).def.bedrock;
  if (!states || !info) return true;
  const cur = decodeStates(info, s.world.getMeta(x, y, z));
  return Object.entries(states).every(([k, v]) => String(cur[k]) === String(v));
}

// ---------- commandes ----------

const TIME_NAMES: Record<string, number> = { sunrise: 23000, day: 1000, jour: 1000, noon: 6000, midi: 6000, sunset: 12000, night: 13000, nuit: 13000, midnight: 18000, minuit: 18000 };

export function setTimeTicks(s: Session, ticks: number) {
  const t = (((ticks % 24000) + 24000) % 24000) / 24000;
  if (t < s.dayCycle.time) s.dayCycle.day++;
  s.dayCycle.time = t;
}

function parseTime(v: string | undefined): number {
  if (!v) throw new CommandError('Durée attendue');
  if (TIME_NAMES[v] !== undefined) return TIME_NAMES[v];
  const m = /^(\d+(?:\.\d+)?)([dst]?)$/.exec(v);
  if (!m) throw new CommandError(`Durée invalide : « ${v} »`);
  const n = Number(m[1]);
  return m[2] === 'd' ? n * 24000 : m[2] === 's' ? n * 20 : n;
}

const GAMEMODES: Record<string, 'survival' | 'creative'> = { survival: 'survival', s: 'survival', '0': 'survival', survie: 'survival', adventure: 'survival', a: 'survival', '2': 'survival', creative: 'creative', c: 'creative', '1': 'creative', creatif: 'creative', créatif: 'creative', spectator: 'creative' };
const DIFFS: Record<string, 'peaceful' | 'easy' | 'normal' | 'hard'> = { peaceful: 'peaceful', p: 'peaceful', '0': 'peaceful', easy: 'easy', e: 'easy', '1': 'easy', normal: 'normal', n: 'normal', '2': 'normal', hard: 'hard', h: 'hard', '3': 'hard' };

/** Règles du jeu de référence → règles locales. */
export const RULE_ALIASES: Record<string, keyof GameRules> = { dodaylightcycle: 'doDaylightCycle', doweathercycle: 'doWeatherCycle', domobspawning: 'doMobSpawning', keepinventory: 'keepInventory', tntexplodes: 'tntExplodes', showcoordinates: 'showCoordinates', naturalregeneration: 'naturalRegeneration', falldamage: 'fallDamage', doimmediaterespawn: 'doImmediateRespawn', commandblockoutput: 'commandBlockOutput' };

/** Dégâts appliqués à une cible (commande /damage, scripts). */
export function damageTarget(s: Session, t: Target, amount: number, cause = 'entityAttack'): boolean {
  if (t.kind === 'player') return s.player.damage(amount, cause === 'fall' ? 'fall' : cause === 'lava' ? 'lava' : cause === 'fire' || cause === 'fireTick' ? 'fire' : cause === 'void' ? 'void' : cause === 'projectile' ? 'projectile' : cause.includes('xplosion') ? 'explosion' : 'mob') > 0;
  if (t.e instanceof Mob) return s.combat.damageMob(t.e, amount, { kind: 'environment', fire: /fire|lava/.test(cause) }) > 0;
  t.e.removed = true;
  return true;
}

/** Donne un stack au joueur (le surplus tombe au sol). */
function giveStack(s: Session, stack: ItemStack) {
  const rest = s.player.inventory.add(stack);
  if (rest > 0) s.entities.spawnItem(stack.id, rest, s.player.x, s.player.y + 1, s.player.z, stack.durability);
}

const EQUIP_SLOTS: Record<string, 'head' | 'chest' | 'legs' | 'feet'> = { 'slot.armor.head': 'head', 'slot.armor.chest': 'chest', 'slot.armor.legs': 'legs', 'slot.armor.feet': 'feet' };

/** Commandes acceptées sans effet visible dans cette version (animations, caméra, permissions…). */
const NOOP = ['playanimation', 'camera', 'ride', 'inputpermission', 'event', 'fog', 'hud', 'dialogue', 'gametest', 'tickingarea', 'mobevent', 'aimassist', 'controlscheme', 'volumearea', 'stopsound', 'music'];

const COMMANDS: CommandDef[] = [
  {
    name: 'help', aliases: ['?', 'aide'], usage: '/help [commande]', desc: 'Liste les commandes',
    run(c) {
      const name = c.args[0]?.replace(/^\//, '');
      if (name) {
        const d = find(name);
        if (!d) throw new CommandError(`Commande inconnue : ${name}`);
        c.out(`${d.usage} — ${d.desc}`);
        return;
      }
      c.out(COMMANDS.filter((d) => !NOOP.includes(d.name)).map((d) => `/${d.name}`).join(' '));
    },
  },
  {
    name: 'give', usage: '/give <cible> <objet> [quantité] [données]', desc: 'Donne un objet', cheat: true,
    run(c) {
      const who = select(c, c.args[0]).filter((t) => t.kind === 'player');
      const id = resolveItem(c.args[1] ?? '');
      const n = c.args[2] ? num(c.args[2], 'Quantité', 1, 32767) : 1;
      if (!who.length) throw new CommandError('Aucun joueur trouvé');
      let left = n;
      const max = ItemRegistry.maxStack(id);
      while (left > 0) {
        const k = Math.min(max, left);
        giveStack(c.s, makeStack(id, k));
        left -= k;
      }
      c.out(`${ItemRegistry.get(id)!.name} * ${n} donné(s) à ${c.s.player.name}`);
    },
  },
  {
    name: 'clear', usage: '/clear [cible] [objet] [données] [quantité max]', desc: "Vide l'inventaire", cheat: true,
    run(c) {
      if (!select(c, c.args[0]).some((t) => t.kind === 'player')) throw new CommandError('Aucun joueur trouvé');
      const inv = c.s.player.inventory;
      if (c.args[1]) {
        const id = resolveItem(c.args[1]);
        const max = c.args[3] !== undefined ? num(c.args[3], 'Quantité', -1) : c.args[2] !== undefined && c.args[2] !== '-1' && c.args[2] !== '0' ? num(c.args[2], 'Quantité', -1) : Infinity;
        const have = inv.count(id);
        const n = Math.min(have, max < 0 ? Infinity : max);
        if (n > 0) inv.remove(id, n);
        c.out(`${n} objet(s) retiré(s) de l'inventaire de ${c.s.player.name}`);
        return;
      }
      let n = 0;
      for (const s of inv.slots) if (s) n += s.count;
      inv.slots.fill(null);
      inv.changed();
      c.out(`${n} objet(s) retiré(s) de l'inventaire de ${c.s.player.name}`);
    },
  },
  {
    name: 'tp', aliases: ['teleport'], usage: '/tp [cible] <x y z> [yaw pitch] | /tp [cible] <destination>', desc: 'Téléporte', cheat: true,
    run(c) {
      let who: Target[] = c.executor ? [c.executor] : [];
      let i = 0;
      // forme « /tp <cible> … » : premier argument non numérique
      if (c.args[0] !== undefined && !isCoord(c.args[0]) && c.args.length !== 1) {
        who = select(c, c.args[0]);
        i = 1;
      }
      let dest: [number, number, number];
      let yaw: number | null = null, pitch: number | null = null;
      if (c.args.length - i === 1 || (c.args[i] !== undefined && !isCoord(c.args[i]))) {
        const t = select(c, c.args[i])[0];
        if (!t) throw new CommandError('Aucune entité trouvée');
        const p = targetPos(c.s, t);
        dest = [p.x, p.y, p.z];
      } else {
        dest = coords(c, i);
        const r = c.args[i + 3], pt = c.args[i + 4];
        if (r === 'facing') {
          let f: [number, number, number];
          if (isCoord(c.args[i + 4])) f = coords(c, i + 4);
          else {
            const t = select(c, c.args[i + 4])[0];
            const p = t ? targetPos(c.s, t) : { x: dest[0], y: dest[1], z: dest[2] + 1 };
            f = [p.x, p.y, p.z];
          }
          yaw = Math.atan2(-(f[0] - dest[0]), -(f[2] - dest[2]));
          pitch = Math.atan2(f[1] - dest[1], Math.hypot(f[0] - dest[0], f[2] - dest[2]));
        } else if (r !== undefined && isCoord(r)) {
          const base = c.origin;
          yaw = r.startsWith('~') ? base.yaw - (Number(r.slice(1) || 0) * Math.PI) / 180 : (-Number(r) * Math.PI) / 180 + Math.PI;
          if (pt !== undefined && isCoord(pt)) pitch = pt.startsWith('~') ? base.pitch - (Number(pt.slice(1) || 0) * Math.PI) / 180 : (-Number(pt) * Math.PI) / 180;
        }
      }
      if (!who.length) throw new CommandError('Aucune entité trouvée');
      for (const t of who) {
        if (t.kind === 'player') {
          const p = c.s.player;
          p.body.setPos(dest[0], Math.max(-10, Math.min(WORLD_HEIGHT + 50, dest[1])), dest[2]);
          p.body.vx = p.body.vy = p.body.vz = 0;
          p.body.fallDistance = 0;
          if (yaw !== null) p.yaw = yaw;
          if (pitch !== null) p.pitch = pitch;
        } else {
          t.e.body.setPos(dest[0], dest[1], dest[2]);
          if (yaw !== null) t.e.yaw = yaw;
        }
      }
      c.out(`${listNames(c, who)} téléporté(s) en ${dest.map((v) => v.toFixed(2)).join(', ')}`);
    },
  },
  {
    name: 'time', usage: '/time <set|add|query> <valeur>', desc: "Change l'heure", cheat: true,
    run(c) {
      const s = c.s;
      const ticks = Math.round(s.dayCycle.time * 24000);
      switch (c.args[0]) {
        case 'set':
          setTimeTicks(s, parseTime(c.args[1]));
          c.out(`Heure réglée sur ${Math.round(s.dayCycle.time * 24000)}`);
          return;
        case 'add':
          setTimeTicks(s, ticks + parseTime(c.args[1]));
          c.out(`Heure réglée sur ${Math.round(s.dayCycle.time * 24000)}`);
          return;
        case 'query': {
          const what = c.args[1] ?? 'daytime';
          const v = what === 'day' ? s.dayCycle.day : what === 'gametime' ? s.dayCycle.day * 24000 + ticks : ticks;
          c.out(`L'heure est ${v}`);
          return;
        }
        default:
          throw new CommandError('Utilisation : /time <set|add|query> <valeur>');
      }
    },
  },
  {
    name: 'weather', usage: '/weather <clear|rain|thunder> [durée en s]', desc: 'Change la météo', cheat: true,
    run(c) {
      const map: Record<string, 'clear' | 'rain' | 'storm'> = { clear: 'clear', rain: 'rain', thunder: 'storm' };
      if (c.args[0] === 'query') {
        c.out(`Météo actuelle : ${c.s.weather.state === 'storm' ? 'orage' : c.s.weather.state === 'rain' ? 'pluie' : 'dégagé'}`);
        return;
      }
      const st = map[c.args[0] ?? ''];
      if (!st) throw new CommandError('Utilisation : /weather <clear|rain|thunder> [durée]');
      const d = c.args[1] ? num(c.args[1], 'Durée', 1) : 300 + Math.random() * 600;
      c.s.weather.load({ state: st, timer: d });
      c.out(st === 'clear' ? 'Passage à un temps dégagé' : st === 'rain' ? 'Passage à un temps pluvieux' : 'Passage à un temps orageux');
    },
  },
  { name: 'toggledownfall', usage: '/toggledownfall', desc: 'Active/désactive la pluie', cheat: true, run(c) { c.s.weather.load({ state: c.s.weather.state === 'clear' ? 'rain' : 'clear', timer: 300 + Math.random() * 600 }); c.out('Précipitations basculées'); } },
  {
    name: 'gamemode', aliases: ['gm'], usage: '/gamemode <survival|creative> [cible]', desc: 'Change le mode de jeu', cheat: true,
    run(c) {
      const m = GAMEMODES[(c.args[0] ?? '').toLowerCase()];
      if (!m) throw new CommandError('Mode inconnu (survival, creative)');
      if (c.args[1] && !select(c, c.args[1]).some((t) => t.kind === 'player')) throw new CommandError('Aucun joueur trouvé');
      const p = c.s.player;
      p.gameMode = m;
      if (m === 'survival') p.body.flying = false;
      c.s.meta.gameMode = m;
      c.out(`Votre mode de jeu a été changé en ${m === 'creative' ? 'Créatif' : 'Survie'}`);
    },
  },
  {
    name: 'difficulty', usage: '/difficulty <peaceful|easy|normal|hard>', desc: 'Change la difficulté', cheat: true,
    run(c) {
      const d = DIFFS[(c.args[0] ?? '').toLowerCase()];
      if (!d) throw new CommandError('Difficulté inconnue');
      c.s.player.difficulty = d;
      c.s.settings.difficulty = d;
      c.s.meta.difficulty = d;
      if (d === 'peaceful') for (const m of c.s.entities.mobs) if (m.def.category === 'hostile') m.removed = true;
      c.out(`Difficulté réglée sur ${{ peaceful: 'Paisible', easy: 'Facile', normal: 'Normale', hard: 'Difficile' }[d]}`);
    },
  },
  {
    name: 'kill', usage: '/kill [cible]', desc: 'Tue des entités', cheat: true,
    run(c) {
      const list = select(c, c.args[0]);
      for (const t of list) {
        if (t.kind === 'player') c.s.player.damage(10000, 'void');
        else if (t.e instanceof Mob) c.s.combat.damageMob(t.e, 1e6, { kind: 'environment' });
        else t.e.removed = true;
      }
      c.out(list.length ? `${list.length === 1 ? targetName(c.s, list[0]) : `${list.length} entités`} tué(s)` : 'Aucune entité trouvée');
    },
  },
  {
    name: 'summon', usage: '/summon <entité> [x y z] [événement] [nom]', desc: 'Fait apparaître une créature', cheat: true,
    run(c) {
      const raw = c.args[0] ?? '';
      const key = strip(raw);
      const withPos = c.args.length >= 4 && isCoord(c.args[1]);
      const [x, y, z] = withPos ? coords(c, 1) : [c.origin.x, c.origin.y, c.origin.z];
      const extra = withPos ? c.args.slice(4) : c.args.slice(1);
      const nameArg = extra.find((a) => !isCoord(a) && !/^[a-z0-9_]+:[a-z0-9_]/i.test(a) && !/^minecraft:/.test(a));
      if (key === 'tnt') {
        const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
        c.s.world.setBlock(bx, by, bz, B.TNT);
        c.s.explosions.prime(c.s, bx, by, bz);
      } else if (key === 'lightning_bolt') c.s.lightning(x, y, z);
      else if (key === 'xp_orb' || key === 'experience_orb') c.s.player.addXp(3);
      else if (key === 'item') throw new CommandError('Utilisez /give pour obtenir un objet');
      else {
        const m = c.s.entities.spawnMob(resolveMob(raw), x, y, z, { persistent: true });
        if (!m) throw new CommandError("Impossible de faire apparaître l'entité ici");
        if (nameArg) m.nameTag = nameArg;
      }
      c.out('Entité invoquée avec succès');
    },
  },
  {
    name: 'setblock', usage: '/setblock <x y z> <bloc> [états] [replace|destroy|keep]', desc: 'Pose un bloc', cheat: true,
    run(c) {
      const [x, y, z] = blockCoords(c, 0);
      const id = resolveBlock(c.args[3] ?? '');
      const states = parseStates(c.args[4]);
      const meta = metaFor(id, states, c.args[4]);
      const mode = c.args.find((a, i) => i >= 4 && /^(replace|destroy|keep)$/.test(a)) ?? 'replace';
      if (y < 0 || y >= WORLD_HEIGHT) throw new CommandError('Impossible de placer un bloc hors du monde');
      if (c.s.world.getBlock(x, y, z) < 0) throw new CommandError('Impossible de placer un bloc hors du monde chargé');
      const cur = c.s.world.getBlock(x, y, z);
      if (mode === 'keep' && cur !== B.AIR) throw new CommandError('Impossible de placer le bloc');
      if (mode === 'destroy' && cur > 0) c.s.interaction.breakBlock(x, y, z, 'diamond_pickaxe');
      if (!c.s.world.setBlock(x, y, z, id, meta) && cur === id && mode !== 'destroy') throw new CommandError('Impossible de placer le bloc');
      c.out('Bloc placé');
    },
  },
  {
    name: 'fill', usage: '/fill <x1 y1 z1> <x2 y2 z2> <bloc> [états] [replace [ancien]|hollow|outline|keep|destroy]', desc: 'Remplit une zone', cheat: true,
    run(c) {
      const a = blockCoords(c, 0), b = blockCoords(c, 3);
      const id = resolveBlock(c.args[6] ?? '');
      let k = 7;
      const states = parseStates(c.args[k]);
      const legacy = /^\d+$/.test(c.args[k] ?? '') ? c.args[k] : undefined;
      if (states || legacy) k++;
      const meta = metaFor(id, states, legacy);
      const mode = c.args[k] ?? 'replace';
      const filter = mode === 'replace' && c.args[k + 1] ? resolveBlock(c.args[k + 1]) : -1;
      const filterStates = filter >= 0 ? parseStates(c.args[k + 2]) : null;
      const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
      const [y0, y1] = [Math.max(0, Math.min(a[1], b[1])), Math.min(WORLD_HEIGHT - 1, Math.max(a[1], b[1]))];
      const [z0, z1] = [Math.min(a[2], b[2]), Math.max(a[2], b[2])];
      const vol = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
      if (vol > 32768) throw new CommandError(`Trop de blocs dans la zone (${vol} > 32768)`);
      let n = 0;
      const w = c.s.world;
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          for (let x = x0; x <= x1; x++) {
            const cur = w.getBlock(x, y, z);
            if (cur < 0) continue;
            const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
            let target = id;
            if (mode === 'hollow' && !edge) target = B.AIR;
            if (mode === 'outline' && !edge) continue;
            if (mode === 'keep' && cur !== B.AIR) continue;
            if (filter >= 0 && !blockMatches(c.s, x, y, z, filter, filterStates)) continue;
            if (mode === 'destroy' && cur > 0) c.s.interaction.breakBlock(x, y, z, 'diamond_pickaxe');
            if (w.setBlock(x, y, z, target, target === id ? meta : 0, false)) {
              n++;
              // blocs d'add-ons connectés (barrières, barreaux…) : états recalculés au tick suivant
              if (BlockRegistry.get(target).def.bedrock?.placement.connections) w.scheduleUpdate(x, y, z);
            }
          }
      if (!n) throw new CommandError('Aucun bloc rempli');
      c.out(`${n} blocs remplis`);
    },
  },
  {
    name: 'clone', usage: '/clone <x1 y1 z1> <x2 y2 z2> <x y z> [replace|masked] [normal|move]', desc: 'Copie une zone', cheat: true,
    run(c) {
      const a = blockCoords(c, 0), b = blockCoords(c, 3), d = blockCoords(c, 6);
      const masked = c.args[9] === 'masked', move = c.args[10] === 'move';
      const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
      const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
      const [z0, z1] = [Math.min(a[2], b[2]), Math.max(a[2], b[2])];
      const vol = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
      if (vol > 32768) throw new CommandError(`Trop de blocs dans la zone (${vol} > 32768)`);
      const w = c.s.world;
      const copy: [number, number, number, number, number][] = [];
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) copy.push([x - x0, y - y0, z - z0, Math.max(0, w.getBlock(x, y, z)), w.getMeta(x, y, z)]);
      if (move) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) w.setBlock(x, y, z, B.AIR, 0, false);
      let n = 0;
      for (const [dx, dy, dz, id, meta] of copy) {
        if (masked && id === B.AIR) continue;
        if (w.setBlock(d[0] + dx, d[1] + dy, d[2] + dz, id, meta, false)) n++;
      }
      c.out(`${n} blocs clonés`);
    },
  },
  {
    name: 'effect', usage: '/effect <cible> <effet|clear> [secondes|infinite] [amplificateur] [true|false]', desc: 'Applique un effet', cheat: true,
    run(c) {
      let list: Target[];
      let effArg: string;
      let rest: string[];
      if (c.args[0] === 'clear') {
        list = select(c, c.args[1]);
        effArg = 'clear';
        rest = c.args.slice(2);
      } else {
        list = select(c, c.args[0]);
        effArg = c.args[1] ?? '';
        rest = c.args.slice(2);
      }
      if (!list.length) throw new CommandError('Aucune entité trouvée');
      const effectsOf = (t: Target) => (t.kind === 'player' ? c.s.player.effects : t.e.effects);
      if (effArg === 'clear') {
        const which = rest[0] ? effectId(rest[0]) : null;
        for (const t of list) {
          if (which) effectsOf(t).remove(which);
          else effectsOf(t).clear();
          if (t.kind === 'player' && !which) {
            c.s.player.poisonTimer = 0;
            c.s.player.regenEffect = 0;
          }
        }
        c.out(`Effets retirés de ${listNames(c, list)}`);
        return;
      }
      const id = effectId(effArg);
      if (!id) throw new CommandError(`Effet inconnu : ${effArg}`);
      const sec = rest[0] === 'infinite' ? -1 : rest[0] ? num(rest[0], 'Durée', 0, 1e6) : 30;
      const amp = rest[1] ? num(rest[1], 'Amplificateur', 0, 255) : 0;
      const hide = rest[2] === 'true';
      for (const t of list) {
        if (sec === 0) {
          effectsOf(t).remove(id);
          continue;
        }
        effectsOf(t).add(id, sec < 0 ? -1 : Math.round(sec * 20), amp, !hide, effectTargetOf(c.s, t));
      }
      c.out(`Effet ${EFFECTS[id]}${amp > 0 ? ` ${amp + 1}` : ''} appliqué à ${listNames(c, list)}`);
    },
  },
  {
    name: 'xp', aliases: ['experience'], usage: '/xp <quantité>[L] [cible]', desc: "Donne de l'expérience", cheat: true,
    run(c) {
      let v = c.args[0] ?? '';
      if (v === 'add') v = `${c.args[2] ?? ''}${c.args[3] === 'levels' ? 'L' : ''}`;
      const lv = /l$/i.test(v);
      const n = num(v.replace(/l$/i, ''), 'Quantité');
      const p = c.s.player;
      if (lv) p.level = Math.max(0, p.level + n);
      else p.addXp(n);
      c.out(`${lv ? `${n} niveaux` : `${n} points d'expérience`} donné(s) à ${p.name}`);
    },
  },
  {
    name: 'spawnpoint', usage: '/spawnpoint [cible] [x y z]', desc: "Définit le point d'apparition", cheat: true,
    run(c) {
      const pos = c.args.length >= 4 ? coords(c, 1) : c.args.length === 3 ? coords(c, 0) : [c.origin.x, c.origin.y, c.origin.z];
      c.s.player.spawn = [pos[0], pos[1], pos[2]];
      c.out(`Point d'apparition défini en ${pos.map((v) => Math.floor(v)).join(', ')}`);
    },
  },
  { name: 'setworldspawn', usage: '/setworldspawn [x y z]', desc: "Point d'apparition du monde", cheat: true, run(c) { find('spawnpoint')!.run({ ...c, args: c.args.length ? ['@s', ...c.args] : [] }); } },
  { name: 'seed', usage: '/seed', desc: 'Affiche la graine', run(c) { c.out(`Graine : [${c.s.world.seed}]`); } },
  { name: 'say', usage: '/say <message>', desc: 'Envoie un message', run(c) { c.s.chatMessage(`[${speaker(c)}] ${expandSelectors(c, c.args.join(' '))}`); } },
  { name: 'me', usage: '/me <action>', desc: 'Décrit une action', run(c) { c.s.chatMessage(`* ${speaker(c)} ${expandSelectors(c, c.args.join(' '))}`); } },
  {
    name: 'tell', aliases: ['msg', 'w'], usage: '/tell <cible> <message>', desc: 'Message privé',
    run(c) {
      const to = select(c, c.args[0]);
      const msg = expandSelectors(c, c.args.slice(1).join(' '));
      if (to.some((t) => t.kind === 'player') && c.executor?.kind !== 'player') c.s.chatMessage(`${speaker(c)} vous chuchote : ${msg}`);
      else c.out(`Vous chuchotez à ${c.args[0] ?? '?'} : ${msg}`);
    },
  },
  {
    name: 'tellraw', usage: '/tellraw <cible> <texte JSON>', desc: 'Message formaté', cheat: true,
    run(c) {
      if (select(c, c.args[0]).some((t) => t.kind === 'player')) c.s.chatMessage(rawText(c, c.args.slice(1).join(' ')));
    },
  },
  { name: 'list', usage: '/list', desc: 'Joueurs connectés', run(c) { c.out(`Il y a 1/1 joueurs connectés : ${c.s.player.name}`); } },
  {
    name: 'title', usage: '/title <cible> <title|subtitle|actionbar|clear|reset|times> <texte>', desc: 'Affiche un titre', cheat: true,
    run(c) {
      if (!select(c, c.args[0]).some((t) => t.kind === 'player')) return;
      const kind = c.args[1];
      if (kind === 'times') return;
      const text = expandSelectors(c, c.args.slice(2).join(' '));
      c.s.hud.showTitle?.(kind === 'clear' || kind === 'reset' ? '' : text, kind === 'subtitle' ? 'subtitle' : kind === 'actionbar' ? 'actionbar' : 'title');
    },
  },
  {
    name: 'titleraw', usage: '/titleraw <cible> <title|subtitle|actionbar|clear> <texte JSON>', desc: 'Titre formaté', cheat: true,
    run(c) {
      if (!select(c, c.args[0]).some((t) => t.kind === 'player')) return;
      const kind = c.args[1];
      if (kind === 'times') return;
      const text = kind === 'clear' || kind === 'reset' ? '' : rawText(c, c.args.slice(2).join(' '));
      c.s.hud.showTitle?.(text, kind === 'subtitle' ? 'subtitle' : kind === 'actionbar' ? 'actionbar' : 'title');
    },
  },
  {
    name: 'locate', usage: '/locate structure <nom>', desc: 'Trouve la structure la plus proche', cheat: true,
    async run(c) {
      const name = strip(c.args[0] === 'structure' ? c.args[1] ?? '' : c.args[0] ?? '');
      const map: Record<string, string> = { village: 'village', temple: 'temple', desert_pyramid: 'temple', mineshaft: 'mine', mine: 'mine', dungeon: 'dungeon', monster_room: 'dungeon', ruins: 'ruins', ruined_portal: 'ruins', tower: 'tower', pillager_outpost: 'tower', igloo: 'ice_temple', ice_temple: 'ice_temple', camp: 'camp', golem_lair: 'golem_lair', abandoned_house: 'abandoned_house' };
      const key = map[name];
      if (!key) throw new CommandError(`Structure inconnue : ${name} (${Object.keys(map).join(', ')})`);
      const p = c.s.player;
      const r = await c.s.chunks.locate(key, p.x, p.z);
      if (!r.found) c.out('Aucune structure de ce type à proximité');
      else c.out(`La structure ${name} la plus proche est en [${r.x}, ~, ${r.z}] (à ${Math.round(Math.hypot(r.x - p.x, r.z - p.z))} blocs)`);
    },
  },
  {
    name: 'gamerule', usage: '/gamerule [règle] [valeur]', desc: 'Règles du jeu', cheat: true,
    run(c) {
      const rules = c.s.gamerules;
      if (!c.args[0]) {
        c.out(Object.entries(rules).map(([k, v]) => `${k} = ${v}`).join(', '));
        return;
      }
      const key = (Object.keys(rules).find((k) => k.toLowerCase() === c.args[0].toLowerCase()) ?? RULE_ALIASES[c.args[0].toLowerCase()]) as keyof GameRules | undefined;
      if (!key) {
        // règles du jeu de référence sans équivalent : mémorisées, sans effet
        if (c.args[1] !== undefined) c.s.extraRules.set(c.args[0].toLowerCase(), c.args[1]);
        else c.out(`${c.args[0]} = ${c.s.extraRules.get(c.args[0].toLowerCase()) ?? 'true'}`);
        return;
      }
      if (c.args[1] === undefined) {
        c.out(`${key} = ${rules[key]}`);
        return;
      }
      rules[key] = bool(c.args[1]);
      c.out(`La règle ${key} a été mise à jour : ${rules[key]}`);
    },
  },
  {
    name: 'function', usage: '/function <nom>', desc: "Exécute une fonction d'un add-on", cheat: true,
    run(c) {
      const name = strip(c.args[0] ?? '');
      const body = c.s.functions.get(name) ?? c.s.functions.get(name.replace(/^[^:]+:/, ''));
      if (!body) throw new CommandError(`Fonction inconnue : ${name}`);
      if (c.depth > 16) throw new CommandError('Trop de fonctions imbriquées');
      let n = 0;
      for (const raw of body) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        execute(c.s, line, () => {}, c.depth + 1, c.origin, true, c.executor);
        n++;
      }
      c.out(`${n} commandes exécutées depuis la fonction « ${name} »`);
    },
  },
  {
    name: 'playsound', usage: '/playsound <son> [cible] [x y z] [volume] [hauteur]', desc: 'Joue un son', cheat: true,
    run(c) {
      const id = c.args[0] ?? '';
      if (c.args[1] && !select(c, c.args[1], '@a').some((t) => t.kind === 'player')) return;
      const pos = c.args.length >= 5 && isCoord(c.args[2]) ? coords(c, 2) : [c.origin.x, c.origin.y, c.origin.z];
      const vol = c.args[5] !== undefined ? Number(c.args[5]) : 1;
      const pitch = c.args[6] !== undefined ? Number(c.args[6]) : 1;
      c.s.audio.playId(id, { x: pos[0], y: pos[1], z: pos[2], volume: Number.isFinite(vol) ? vol : 1, pitch: Number.isFinite(pitch) ? pitch : 1 });
    },
  },
  {
    name: 'particle', usage: '/particle <effet> [x y z]', desc: 'Affiche des particules', cheat: true,
    run(c) {
      const pos = c.args.length >= 4 ? coords(c, 1, false) : [c.origin.x, c.origin.y, c.origin.z];
      const p = mapParticle(c.args[0] ?? '');
      c.s.particles.burst(p.kind, pos[0], pos[1], pos[2], p.count);
    },
  },
  {
    name: 'enchant', usage: '/enchant <cible> <enchantement> [niveau]', desc: "Enchante l'objet tenu", cheat: true,
    run(c) {
      if (!select(c, c.args[0]).some((t) => t.kind === 'player')) throw new CommandError('Aucun joueur trouvé');
      const inv = c.s.player.inventory;
      const st = inv.selectedStack;
      if (!st) throw new CommandError("Le joueur ne tient pas d'objet");
      const ench = strip(c.args[1] ?? '');
      if (!ench) throw new CommandError('Enchantement attendu');
      const lvl = c.args[2] ? num(c.args[2], 'Niveau', 1, 255) : 1;
      st.meta = { ...(st.meta ?? {}), ench: { ...((st.meta?.ench as Record<string, number>) ?? {}), [ench]: lvl } };
      inv.changed();
      c.out(`Enchantement ${ench} ${lvl} appliqué`);
    },
  },
  {
    name: 'tag', usage: '/tag <cible> <add|remove|list> [étiquette]', desc: 'Étiquettes des entités', cheat: true,
    run(c) {
      const list = select(c, c.args[0]);
      const op = c.args[1];
      const tag = c.args[2];
      if (!list.length) throw new CommandError('Aucune entité trouvée');
      if (op === 'list') {
        c.out(list.map((t) => `${targetName(c.s, t)} : ${[...targetTags(c.s, t)].join(', ') || '(aucune)'}`).join('\n'));
        return;
      }
      if (op !== 'add' && op !== 'remove') throw new CommandError('Utilisation : /tag <cible> <add|remove|list> [étiquette]');
      if (!tag) throw new CommandError('Étiquette attendue');
      let n = 0;
      for (const t of list) {
        const tags = targetTags(c.s, t);
        if (op === 'add' && !tags.has(tag)) {
          tags.add(tag);
          n++;
        } else if (op === 'remove' && tags.delete(tag)) n++;
      }
      if (!n) throw new CommandError(op === 'add' ? 'Aucune étiquette ajoutée (déjà présente)' : 'Aucune étiquette retirée');
      c.out(`Étiquette « ${tag} » ${op === 'add' ? 'ajoutée à' : 'retirée de'} ${n} entité(s)`);
    },
  },
  {
    name: 'scoreboard', usage: '/scoreboard <objectives|players> …', desc: 'Tableau des scores', cheat: true,
    run(c) {
      const sb = c.s.scoreboard;
      const [grp, op] = c.args;
      if (grp === 'objectives') {
        if (op === 'add') {
          const id = c.args[2];
          if (!id) throw new CommandError("Nom d'objectif attendu");
          try {
            sb.add(id, c.args.slice(4).join(' ') || id, c.args[3] ?? 'dummy');
          } catch (e) {
            throw new CommandError((e as Error).message);
          }
          c.out(`Objectif « ${id} » ajouté`);
        } else if (op === 'remove') {
          if (!sb.remove(c.args[2] ?? '')) throw new CommandError(`Objectif inconnu : ${c.args[2]}`);
          c.out(`Objectif « ${c.args[2]} » supprimé`);
        } else if (op === 'list') c.out([...sb.objectives.values()].map((o) => `${o.id} (${o.displayName})`).join(', ') || 'Aucun objectif');
        else if (op === 'setdisplay') {
          const slot = c.args[2] ?? 'sidebar';
          if (!c.args[3]) sb.display.delete(slot);
          else {
            if (!sb.get(c.args[3])) throw new CommandError(`Objectif inconnu : ${c.args[3]}`);
            sb.display.set(slot, { id: c.args[3], sort: c.args[4] === 'ascending' ? 'ascending' : 'descending' });
          }
          sb.version++;
        } else throw new CommandError('Utilisation : /scoreboard objectives <add|remove|list|setdisplay>');
        return;
      }
      if (grp !== 'players') throw new CommandError('Utilisation : /scoreboard <objectives|players> …');
      const who = (sel: string | undefined): string[] => {
        if (!sel) return [];
        if (sel === '*') return sb.participants();
        if (sel.startsWith('@')) return select(c, sel).map(scoreId);
        return [sel === c.s.player.name ? 'player' : `f:${sel}`];
      };
      const obj = (id: string | undefined) => {
        const o = id ? sb.get(id) : undefined;
        if (!o) throw new CommandError(`Objectif inconnu : ${id ?? ''}`);
        return o;
      };
      switch (op) {
        case 'set':
        case 'add':
        case 'remove': {
          const o = obj(c.args[3]);
          const v = num(c.args[4], 'Valeur');
          const ids = who(c.args[2]);
          if (!ids.length) throw new CommandError('Aucune cible trouvée');
          for (const id of ids) {
            if (op === 'set') sb.set(o.id, id, v);
            else sb.addTo(o.id, id, op === 'add' ? v : -v);
          }
          c.out(`Score de ${o.id} mis à jour pour ${ids.length} participant(s)`);
          return;
        }
        case 'reset':
          for (const id of who(c.args[2])) sb.resetParticipant(id, c.args[3]);
          return;
        case 'list': {
          const ids = c.args[2] ? who(c.args[2]) : sb.participants();
          c.out(ids.map((id) => `${id}: ${[...sb.objectives.values()].filter((o) => o.scores.has(id)).map((o) => `${o.id}=${o.scores.get(id)}`).join(' ')}`).join('\n') || 'Aucun score');
          return;
        }
        case 'test': {
          const o = obj(c.args[3]);
          const min = c.args[4] === '*' || c.args[4] === undefined ? -Infinity : Number(c.args[4]);
          const max = c.args[5] === '*' || c.args[5] === undefined ? Infinity : Number(c.args[5]);
          for (const id of who(c.args[2])) {
            const v = o.scores.get(id);
            if (v === undefined || v < min || v > max) throw new CommandError(`Score ${v ?? 'absent'} hors de l'intervalle`);
          }
          c.out("Score dans l'intervalle");
          return;
        }
        case 'random': {
          const o = obj(c.args[3]);
          const a = num(c.args[4], 'Min'), b = num(c.args[5], 'Max');
          for (const id of who(c.args[2])) sb.set(o.id, id, a + Math.floor(Math.random() * (b - a + 1)));
          return;
        }
        case 'operation': {
          const tgt = who(c.args[2]), to = obj(c.args[3]).id, oper = c.args[4], src = who(c.args[5]), so = obj(c.args[6]).id;
          for (const t of tgt)
            for (const sid of src) {
              const a = sb.score(to, t) ?? 0, b = sb.score(so, sid) ?? 0;
              let r = a;
              switch (oper) {
                case '+=': r = a + b; break;
                case '-=': r = a - b; break;
                case '*=': r = a * b; break;
                case '/=': r = b ? Math.floor(a / b) : a; break;
                case '%=': r = b ? ((a % b) + b) % b : a; break;
                case '=': r = b; break;
                case '<': r = Math.min(a, b); break;
                case '>': r = Math.max(a, b); break;
                case '><': sb.set(so, sid, a); r = b; break;
                default: throw new CommandError(`Opération inconnue : ${oper}`);
              }
              sb.set(to, t, r);
            }
          return;
        }
        default:
          throw new CommandError('Utilisation : /scoreboard players <set|add|remove|reset|list|test|random|operation> …');
      }
    },
  },
  {
    name: 'scriptevent', usage: '/scriptevent <identifiant> [message]', desc: 'Envoie un événement aux scripts', cheat: true,
    run(c) {
      const id = c.args[0] ?? '';
      if (!/^[\w-]+:[\w./-]+$/.test(id)) throw new CommandError('Identifiant attendu (espace:nom)');
      hooks.scriptEvent?.(id, c.args.slice(1).join(' '), c.executor ? (c.executor.kind === 'player' ? c.s.player : c.executor.e) : null);
    },
  },
  {
    name: 'damage', usage: '/damage <cible> <quantité> [cause] [entity <source>]', desc: 'Inflige des dégâts', cheat: true,
    run(c) {
      const list = select(c, c.args[0]);
      const amount = num(c.args[1], 'Quantité', 0);
      const cause = c.args[2] ?? 'entityAttack';
      let n = 0;
      for (const t of list) if (damageTarget(c.s, t, amount, cause)) n++;
      if (!n) throw new CommandError('Aucune entité blessée');
      c.out(`${n} entité(s) blessée(s)`);
    },
  },
  {
    name: 'camerashake', usage: '/camerashake add <cible> [intensité] [secondes]', desc: 'Secoue la caméra', cheat: true,
    run(c) {
      if (c.args[0] === 'stop') return;
      const intensity = c.args[2] ? Number(c.args[2]) : 0.5;
      c.s.shake(Math.max(0, Math.min(1, (Number.isFinite(intensity) ? intensity : 0.5) * 2)));
    },
  },
  {
    name: 'loot', usage: '/loot <spawn x y z|give <cible>> loot <table>', desc: 'Génère un butin', cheat: true,
    run(c) {
      const mode = c.args[0];
      let pos: [number, number, number] | null = null;
      let i: number;
      if (mode === 'spawn') {
        pos = coords(c, 1);
        i = 4;
      } else if (mode === 'give' || mode === 'insert' || mode === 'replace') i = 2;
      else throw new CommandError('Utilisation : /loot <spawn|give> …');
      if (c.args[i] !== 'loot') throw new CommandError('Seules les tables de butin (« loot <table> ») sont prises en charge');
      const drops = rollLoot(c.args[i + 1] ?? '');
      for (const d of drops) {
        if (pos) c.s.entities.spawnItem(d.item, d.count, pos[0], pos[1], pos[2]);
        else giveStack(c.s, makeStack(d.item, d.count));
      }
      c.out(`${drops.length} objet(s) générés`);
    },
  },
  {
    name: 'replaceitem', usage: '/replaceitem entity <cible> <emplacement> <n> <objet> [quantité]', desc: 'Remplace un objet équipé', cheat: true,
    run(c) {
      if (c.args[0] !== 'entity') throw new CommandError('Seule la forme « entity » est prise en charge');
      const list = select(c, c.args[1]);
      const slot = c.args[2] ?? '';
      const n = Number(c.args[3] ?? 0);
      let k = 4;
      if (c.args[k] === 'keep' || c.args[k] === 'destroy') k++;
      const itemArg = c.args[k] ?? '';
      const count = c.args[k + 1] ? num(c.args[k + 1], 'Quantité', 0, 64) : 1;
      const stack = strip(itemArg) === 'air' || count === 0 ? null : makeStack(resolveItem(itemArg), count);
      for (const t of list) {
        if (t.kind !== 'player') continue;
        const inv = c.s.player.inventory;
        if (slot === 'slot.hotbar') inv.slots[Math.max(0, Math.min(8, n))] = stack;
        else if (slot === 'slot.inventory') inv.slots[Math.max(0, Math.min(inv.size - 10, n)) + 9] = stack;
        else if (slot === 'slot.weapon.mainhand') inv.slots[inv.selected] = stack;
        else if (EQUIP_SLOTS[slot]) inv.armor[EQUIP_SLOTS[slot]] = stack;
        else if (slot === 'slot.weapon.offhand') continue;
        else throw new CommandError(`Emplacement inconnu : ${slot}`);
        inv.changed();
      }
    },
  },
  {
    name: 'spreadplayers', usage: '/spreadplayers <x> <z> <distance> <rayon> <cible>', desc: 'Disperse des entités', cheat: true,
    run(c) {
      const o = c.origin;
      const x = c.args[0]?.startsWith('~') ? o.x + Number(c.args[0].slice(1) || 0) : num(c.args[0], 'x');
      const z = c.args[1]?.startsWith('~') ? o.z + Number(c.args[1].slice(1) || 0) : num(c.args[1], 'z');
      const r = num(c.args[3], 'Rayon', 0);
      for (const t of select(c, c.args[4])) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * r;
        const tx = Math.floor(x + Math.cos(a) * d), tz = Math.floor(z + Math.sin(a) * d);
        const ty = c.s.world.surfaceBelow(tx, WORLD_HEIGHT - 2, tz) + 1;
        if (t.kind === 'player') c.s.player.body.setPos(tx + 0.5, ty, tz + 0.5);
        else t.e.body.setPos(tx + 0.5, ty, tz + 0.5);
      }
    },
  },
  {
    name: 'testfor', usage: '/testfor <cible>', desc: 'Teste la présence de cibles', cheat: true,
    run(c) {
      const n = select(c, c.args[0]).length;
      if (!n) throw new CommandError('Aucune cible trouvée');
      c.out(`${n} cible(s) trouvée(s)`);
    },
  },
  {
    name: 'testforblock', usage: '/testforblock <x y z> <bloc> [états]', desc: 'Teste un bloc', cheat: true,
    run(c) {
      const [x, y, z] = blockCoords(c, 0);
      if (!blockMatches(c.s, x, y, z, resolveBlock(c.args[3] ?? ''), parseStates(c.args[4]))) throw new CommandError('Le bloc ne correspond pas');
      c.out('Bloc trouvé');
    },
  },
  {
    name: 'alwaysday', aliases: ['daylock'], usage: '/alwaysday [true|false]', desc: 'Fige le jour', cheat: true,
    run(c) {
      const v = c.args[0] === undefined ? true : bool(c.args[0]);
      c.s.gamerules.doDaylightCycle = !v;
      if (v) setTimeTicks(c.s, 6000);
      c.out(v ? 'Cycle jour/nuit désactivé' : 'Cycle jour/nuit activé');
    },
  },
  {
    name: 'structure', usage: '/structure load <nom> <x y z> [0_degrees|90_degrees|180_degrees|270_degrees] [none|x|z|xz]', desc: "Pose une structure d'add-on", cheat: true,
    run(c) {
      if (c.args[0] !== 'load') throw new CommandError('Seul « /structure load » est pris en charge');
      const name = (c.args[1] ?? '').toLowerCase();
      const data = STRUCTURES.get(name) ?? STRUCTURES.get(`mystructure:${name}`);
      if (!data) throw new CommandError(`Structure inconnue : ${c.args[1] ?? ''}`);
      const [x, y, z] = c.args.length >= 5 ? blockCoords(c, 2) : [Math.floor(c.origin.x), Math.floor(c.origin.y), Math.floor(c.origin.z)];
      const rot = { '0_degrees': 0, '90_degrees': 1, '180_degrees': 2, '270_degrees': 3 }[c.args[5] ?? '0_degrees'] ?? 0;
      const mir = { none: 'None', x: 'X', z: 'Z', xz: 'XZ' }[(c.args[6] ?? 'none').toLowerCase()] ?? 'None';
      const n = placeStructure(c.s.world, data, x, y, z, rot, mir, c.args[7] !== 'false');
      c.out(`Structure ${name} posée (${n} blocs)`);
    },
  },
  ...NOOP.map((name): CommandDef => ({ name, usage: `/${name} …`, desc: 'Accepté (sans effet dans cette version)', cheat: true, run() {} })),
  {
    name: 'execute', usage: '/execute <as|at|positioned|align|anchored|facing|rotated|in|if|unless> … run <commande>', desc: 'Exécute une commande depuis une entité', cheat: true,
    run(c) {
      const args = c.args;
      // ancienne syntaxe : execute <cible> <x y z> [detect x y z bloc données] <commande>
      if (args[0] && !SUBCOMMANDS.has(args[0])) {
        const targets = select(c, args[0]);
        const detect = args[4] === 'detect';
        const rest = args.slice(detect ? 10 : 4).join(' ');
        for (const t of targets) {
          const p = targetPos(c.s, t);
          const base: Origin = { ...c.origin, x: p.x, y: p.y, z: p.z };
          const o = parseCoords(args.slice(1, 4), base, false);
          if (detect) {
            const d = parseCoords(args.slice(5, 8), { ...base, x: o[0], y: o[1], z: o[2] }, false).map(Math.floor);
            if (c.s.world.getBlock(d[0], d[1], d[2]) !== resolveBlock(args[8] ?? '')) continue;
          }
          execute(c.s, rest, c.out, c.depth + 1, { ...base, x: o[0], y: o[1], z: o[2] }, true, t);
        }
        return;
      }
      type St = { origin: Origin; executor: Target | null };
      let states: St[] = [{ origin: { ...c.origin }, executor: c.executor }];
      let i = 0;
      const sub = (st: St): Ctx => ({ ...c, origin: st.origin, executor: st.executor });
      const rotOf = (t: Target) => (t.kind === 'player' ? { yaw: c.s.player.yaw, pitch: c.s.player.pitch } : { yaw: t.e.yaw, pitch: 0 });
      while (i < args.length) {
        const kw = args[i++];
        if (kw === 'run') {
          const rest = args.slice(i).join(' ');
          let ok = 0;
          for (const st of states) if (execute(c.s, rest, c.out, c.depth + 1, st.origin, true, st.executor)) ok++;
          if (!ok && states.length) throw new CommandError('Échec de la commande exécutée');
          return;
        }
        switch (kw) {
          case 'as': {
            const sel = args[i++];
            states = states.flatMap((st) => select(sub(st), sel).map((t) => ({ origin: st.origin, executor: t })));
            break;
          }
          case 'at': {
            const sel = args[i++];
            states = states.flatMap((st) => select(sub(st), sel).map((t) => ({ origin: { ...targetPos(c.s, t), ...rotOf(t) }, executor: st.executor })));
            break;
          }
          case 'positioned': {
            if (args[i] === 'as') {
              const sel = args[i + 1];
              i += 2;
              states = states.flatMap((st) => select(sub(st), sel).map((t) => ({ origin: { ...st.origin, ...targetPos(c.s, t) }, executor: st.executor })));
            } else {
              const a = args.slice(i, i + 3);
              i += 3;
              states = states.map((st) => {
                const p = parseCoords(a, st.origin, false);
                return { origin: { ...st.origin, x: p[0], y: p[1], z: p[2] }, executor: st.executor };
              });
            }
            break;
          }
          case 'align': {
            const axes = args[i++] ?? '';
            states = states.map((st) => ({ ...st, origin: { ...st.origin, x: axes.includes('x') ? Math.floor(st.origin.x) : st.origin.x, y: axes.includes('y') ? Math.floor(st.origin.y) : st.origin.y, z: axes.includes('z') ? Math.floor(st.origin.z) : st.origin.z } }));
            break;
          }
          case 'anchored':
            if (args[i++] === 'eyes') states = states.map((st) => ({ ...st, origin: { ...st.origin, y: st.origin.y + 1.62 } }));
            break;
          case 'in':
            i++;
            break;
          case 'rotated': {
            if (args[i] === 'as') {
              const sel = args[i + 1];
              i += 2;
              states = states.flatMap((st) => select(sub(st), sel).map((t) => ({ ...st, origin: { ...st.origin, ...rotOf(t) } })));
            } else {
              const ry = args[i++] ?? '~', rx = args[i++] ?? '~';
              states = states.map((st) => ({ ...st, origin: { ...st.origin, yaw: ry.startsWith('~') ? st.origin.yaw - (Number(ry.slice(1) || 0) * Math.PI) / 180 : (-Number(ry) * Math.PI) / 180 + Math.PI, pitch: rx.startsWith('~') ? st.origin.pitch - (Number(rx.slice(1) || 0) * Math.PI) / 180 : (-Number(rx) * Math.PI) / 180 } }));
            }
            break;
          }
          case 'facing': {
            let target: (st: St) => { x: number; y: number; z: number } | null;
            if (args[i] === 'entity') {
              const sel = args[i + 1];
              i += 3;
              target = (st) => {
                const t = select(sub(st), sel)[0];
                return t ? targetPos(c.s, t) : null;
              };
            } else {
              const a = args.slice(i, i + 3);
              i += 3;
              target = (st) => {
                const p = parseCoords(a, st.origin, false);
                return { x: p[0], y: p[1], z: p[2] };
              };
            }
            states = states.flatMap((st) => {
              const t = target(st);
              if (!t) return [];
              const dx = t.x - st.origin.x, dy = t.y - st.origin.y, dz = t.z - st.origin.z;
              return [{ ...st, origin: { ...st.origin, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) } }];
            });
            break;
          }
          case 'if':
          case 'unless': {
            const want = kw === 'if';
            const what = args[i++];
            let test: (st: St) => boolean;
            if (what === 'entity') {
              const sel = args[i++];
              test = (st) => select(sub(st), sel).length > 0;
            } else if (what === 'block') {
              const a = args.slice(i, i + 3);
              const blk = args[i + 3];
              const stArg = parseStates(args[i + 4]);
              i += stArg || /^-?\d+$/.test(args[i + 4] ?? '') ? 5 : 4;
              const id = resolveBlock(blk ?? '');
              test = (st) => {
                const p = parseCoords(a, st.origin, false).map(Math.floor);
                return blockMatches(c.s, p[0], p[1], p[2], id, stArg);
              };
            } else if (what === 'blocks') {
              const a = args.slice(i, i + 3), b = args.slice(i + 3, i + 6), d = args.slice(i + 6, i + 9);
              const mode = args[i + 9];
              i += 10;
              test = (st) => {
                const p0 = parseCoords(a, st.origin, false).map(Math.floor), p1 = parseCoords(b, st.origin, false).map(Math.floor), pd = parseCoords(d, st.origin, false).map(Math.floor);
                const mx = Math.min(p0[0], p1[0]), my = Math.min(p0[1], p1[1]), mz = Math.min(p0[2], p1[2]);
                for (let y = my; y <= Math.max(p0[1], p1[1]); y++)
                  for (let z = mz; z <= Math.max(p0[2], p1[2]); z++)
                    for (let x = mx; x <= Math.max(p0[0], p1[0]); x++) {
                      const id1 = c.s.world.getBlock(x, y, z);
                      if (mode === 'masked' && id1 === B.AIR) continue;
                      if (id1 !== c.s.world.getBlock(pd[0] + x - mx, pd[1] + y - my, pd[2] + z - mz)) return false;
                    }
                return true;
              };
            } else if (what === 'score') {
              const tsel = args[i++], tobj = args[i++], opr = args[i++];
              const scoreOf = (st: St, sel: string, obj: string) => {
                const t = sel.startsWith('@') ? select(sub(st), sel)[0] : null;
                if (sel.startsWith('@') && !t) return undefined;
                return c.s.scoreboard.score(obj, t ? scoreId(t) : `f:${sel}`);
              };
              if (opr === 'matches') {
                const range = args[i++];
                test = (st) => {
                  const v = scoreOf(st, tsel, tobj);
                  return v !== undefined && inRange(range, v);
                };
              } else {
                const ssel = args[i++], sobj = args[i++];
                test = (st) => {
                  const a = scoreOf(st, tsel, tobj), b = scoreOf(st, ssel, sobj);
                  if (a === undefined || b === undefined) return false;
                  return opr === '<' ? a < b : opr === '<=' ? a <= b : opr === '=' ? a === b : opr === '>=' ? a >= b : opr === '>' ? a > b : false;
                };
              }
            } else throw new CommandError(`Condition inconnue : ${what}`);
            states = states.filter((st) => test(st) === want);
            if (i >= args.length) {
              if (!states.length) throw new CommandError('Condition non remplie');
              c.out('Condition remplie');
              return;
            }
            break;
          }
          default:
            throw new CommandError(`Sous-commande inconnue : ${kw}`);
        }
      }
      throw new CommandError('Mot-clé « run » attendu');
    },
  },
];

const SUBCOMMANDS = new Set(['as', 'at', 'positioned', 'align', 'anchored', 'facing', 'rotated', 'in', 'if', 'unless', 'run']);

/** Adaptateur d'effets de statut pour une cible. */
export function effectTargetOf(s: Session, t: Target) {
  if (t.kind === 'player') return s.player.effectTarget;
  const e = t.e;
  if (!(e instanceof Mob)) return undefined;
  return { heal: (n: number) => (e.health = Math.min(e.maxHealth, e.health + n)), hurt: (n: number) => void s.combat.damageMob(e, n, { kind: 'environment' }), hp: () => e.health, body: e.body };
}

function speaker(c: Ctx): string {
  return c.executor ? targetName(c.s, c.executor) : 'Serveur';
}

/** Remplace les sélecteurs présents dans un message (/say @p). */
function expandSelectors(c: Ctx, text: string): string {
  return text.replace(/@(s|p|a|r|e|initiator)(\[[^\]]*\])?/g, (m) => select(c, m).map((t) => targetName(c.s, t)).join(', '));
}

function find(name: string): CommandDef | undefined {
  const n = name.toLowerCase().replace(/^minecraft:/, '');
  return COMMANDS.find((d) => d.name === n || d.aliases?.includes(n));
}

export function commandList(): { name: string; usage: string; desc: string }[] {
  return COMMANDS.filter((d) => !NOOP.includes(d.name)).map(({ name, usage, desc }) => ({ name, usage, desc }));
}

/**
 * Exécute une ligne de commande (avec ou sans « / »). Les messages sont transmis à `out` ;
 * retourne vrai si la commande a réussi. `executor` désigne @s (le joueur par défaut).
 */
export function execute(s: Session, line: string, out: (m: string, error?: boolean) => void, depth = 0, origin?: Origin, force = false, executor: Target | null = { kind: 'player' }): boolean {
  const toks = splitBlockStates(tokenize(line.replace(/^\s*\//, '')));
  if (!toks.length) return false;
  if (depth > 64) {
    out('Trop de commandes imbriquées', true);
    return false;
  }
  const def = find(toks[0]);
  if (!def) {
    // commandes personnalisées enregistrées par les scripts d'add-ons (/espace:nom)
    if (hooks.customCommand?.(toks[0], toks.slice(1))) return true;
    out(`Commande inconnue : ${toks[0]}. Tapez /help pour la liste.`, true);
    return false;
  }
  if (def.cheat && !s.cheats && !force) {
    out('Les commandes de triche sont désactivées dans ce monde (activez-les dans « Modifier » depuis la liste des mondes).', true);
    return false;
  }
  const p = s.player;
  const ctx: Ctx = { s, args: toks.slice(1), origin: origin ?? { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch }, out: (m) => out(m), depth, executor };
  try {
    const r = def.run(ctx) as unknown;
    if (r instanceof Promise) r.catch((e) => out(e instanceof CommandError ? e.message : `Erreur : ${(e as Error).message}`, true));
    if (!force) s.progression.inc('commandsRun');
    return true;
  } catch (e) {
    out(e instanceof CommandError ? e.message : `Erreur : ${(e as Error).message}`, true);
    return false;
  }
}

/** Suggestions d'autocomplétion pour la saisie en cours. */
export function suggest(text: string): string[] {
  const t = text.replace(/^\//, '');
  const toks = tokenize(t);
  const endsSpace = /\s$/.test(t);
  if (toks.length <= 1 && !endsSpace) {
    const pre = (toks[0] ?? '').toLowerCase();
    return COMMANDS.filter((d) => d.name.startsWith(pre) && !NOOP.includes(d.name)).map((d) => d.usage);
  }
  const def = find(toks[0]);
  if (!def) return [];
  const argIdx = endsSpace ? toks.length - 1 : toks.length - 2;
  const cur = endsSpace ? '' : strip(toks[toks.length - 1]);
  const pick = (list: string[]) => list.filter((k) => k.startsWith(cur)).slice(0, 12);
  const items = () => pick(ItemRegistry.all().map((d) => d.key));
  const blocks = () => pick(BlockRegistry.blocks.map((b) => b.key));
  switch (def.name) {
    case 'give':
      return argIdx === 0 ? pick(['@s', '@p']) : argIdx === 1 ? items() : [];
    case 'clear':
      return argIdx === 1 ? items() : [];
    case 'setblock':
      return argIdx === 3 ? blocks() : argIdx < 3 ? ['~'] : pick(['replace', 'destroy', 'keep']);
    case 'fill':
      return argIdx === 6 ? blocks() : argIdx === 7 ? pick(['replace', 'hollow', 'outline', 'keep', 'destroy']) : argIdx < 6 ? ['~'] : [];
    case 'summon':
      return argIdx === 0 ? pick([...MOB_DEFS.map((m) => m.key), 'tnt', 'lightning_bolt']) : ['~'];
    case 'time':
      return argIdx === 0 ? pick(['set', 'add', 'query']) : argIdx === 1 && toks[1] === 'set' ? pick(['day', 'noon', 'night', 'midnight', 'sunrise', 'sunset']) : [];
    case 'weather':
      return argIdx === 0 ? pick(['clear', 'rain', 'thunder', 'query']) : [];
    case 'gamemode':
      return argIdx === 0 ? pick(['survival', 'creative']) : [];
    case 'difficulty':
      return argIdx === 0 ? pick(['peaceful', 'easy', 'normal', 'hard']) : [];
    case 'gamerule':
      return argIdx === 0 ? pick(Object.keys(DEFAULT_RULES).map((k) => k.toLowerCase())).map((k) => Object.keys(DEFAULT_RULES).find((x) => x.toLowerCase() === k)!) : argIdx === 1 ? pick(['true', 'false']) : [];
    case 'effect':
      return argIdx === 0 ? pick(['@s', '@e', 'clear']) : argIdx === 1 ? pick([...Object.keys(EFFECTS), 'clear']) : [];
    case 'kill':
      return argIdx === 0 ? pick(['@s', '@e', '@e[type=zombie]', '@e[type=item]', '@e[type=!player]']) : [];
    case 'tag':
      return argIdx === 0 ? pick(['@s', '@e', '@p']) : argIdx === 1 ? pick(['add', 'remove', 'list']) : [];
    case 'scoreboard':
      return argIdx === 0 ? pick(['objectives', 'players']) : argIdx === 1 ? pick(toks[1] === 'objectives' ? ['add', 'remove', 'list', 'setdisplay'] : ['set', 'add', 'remove', 'reset', 'list', 'test', 'random', 'operation']) : [];
    case 'execute':
      return pick(['as', 'at', 'positioned', 'if', 'unless', 'run', 'facing', 'rotated', 'align', 'anchored']);
    case 'locate':
      return argIdx === 0 ? ['structure'] : argIdx === 1 ? pick(['village', 'temple', 'mineshaft', 'dungeon', 'ruins', 'tower', 'igloo', 'camp', 'golem_lair']) : [];
    case 'tp':
      return ['~'];
    default:
      return [];
  }
}
