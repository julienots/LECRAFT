/**
 * Commandes de chat dans la syntaxe du jeu de référence (/give, /tp, /time, /gamemode, /fill…).
 * Accepte les identifiants avec ou sans espace de noms (« minecraft:stone »), les coordonnées
 * absolues, relatives (~) et locales (^), et les sélecteurs @s @p @a @r @e[type=…,r=…,c=…].
 */
import type { Session } from '../core/Session';
import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { makeStack } from '../inventory/Inventory';
import { MOB_DEFS } from '../data/mobs';
import { WORLD_HEIGHT } from '../core/Config';
import type { Entity } from '../entities/Entity';
import { Mob } from '../entities/Mob';

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

type Target = { kind: 'player' } | { kind: 'entity'; e: Entity };

interface Ctx {
  s: Session;
  args: string[];
  /** Position et orientation d'exécution (joueur, ou origine d'une fonction). */
  origin: { x: number; y: number; z: number; yaw: number; pitch: number };
  out: (msg: string) => void;
  depth: number;
}

interface CommandDef {
  name: string;
  aliases?: string[];
  usage: string;
  desc: string;
  cheat?: boolean;
  run(c: Ctx): void;
}

// ---------- analyse ----------

/** Découpe une ligne de commande (guillemets et crochets des sélecteurs respectés). */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '', quote = false, depth = 0;
  for (const ch of line.trim()) {
    if (ch === '"' && depth === 0) {
      quote = !quote;
      continue;
    }
    if (!quote) {
      if (ch === '[' || ch === '{') depth++;
      if (ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
      if (ch === ' ' && depth === 0) {
        if (cur) out.push(cur);
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur) out.push(cur);
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
};

export function resolveItem(id: string): string {
  const k = strip(id);
  const a = ALIAS[k] ?? k;
  if (ItemRegistry.has(a)) return a;
  if (ItemRegistry.has(k)) return k;
  throw new CommandError(`Objet inconnu : « ${id} »`);
}

export function resolveBlock(id: string): number {
  const k = strip(id);
  if (k === 'air') return B.AIR;
  for (const c of [ALIAS[k] ?? k, k]) {
    try {
      return BlockRegistry.byName(c).id;
    } catch {
      /* suivant */
    }
  }
  throw new CommandError(`Bloc inconnu : « ${id} »`);
}

function resolveMob(id: string): string {
  const k = strip(id);
  const m = MOB_DEFS.find((d) => d.key === k || d.name.toLowerCase() === k);
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
  const o = c.origin;
  if (a.every((v) => v.startsWith('^'))) {
    const [l, u, f] = a.map((v) => Number(v.slice(1) || 0));
    // repère local : gauche, haut, avant (regard du joueur)
    const sy = Math.sin(o.yaw), cy = Math.cos(o.yaw), cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
    const fwd = [-sy * cp, sp, -cy * cp], left = [-cy, 0, sy];
    const up = [sy * sp, cp, cy * sp];
    return [o.x + left[0] * l + up[0] * u + fwd[0] * f, o.y + left[1] * l + up[1] * u + fwd[1] * f, o.z + left[2] * l + up[2] * u + fwd[2] * f];
  }
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

/** Sélecteurs @s @p @a @r @e[type=…,r=…,c=…,name=…] ; un pseudonyme quelconque désigne le joueur. */
function select(c: Ctx, sel: string | undefined, def: '@s' | '@e' = '@s'): Target[] {
  const s = sel ?? def;
  const m = /^@([spare])(?:\[(.*)\])?$/.exec(s);
  if (!m) return [{ kind: 'player' }];
  const kind = m[1];
  const opts: Record<string, string> = {};
  for (const part of (m[2] ?? '').split(',')) {
    const [k, v] = part.split('=');
    if (k && v !== undefined) opts[k.trim()] = v.trim();
  }
  if (kind !== 'e') return [{ kind: 'player' }];
  const o = c.origin;
  let list: Target[] = [];
  const neg = opts.type?.startsWith('!');
  const type = opts.type ? strip(opts.type.replace(/^!/, '')) : null;
  const r = opts.r !== undefined ? Number(opts.r) : Infinity;
  const near = (x: number, y: number, z: number) => Math.hypot(x - o.x, y - o.y, z - o.z) <= r;
  if ((!type || (type === 'player') !== !!neg) && near(c.s.player.x, c.s.player.y, c.s.player.z)) list.push({ kind: 'player' });
  for (const e of c.s.entities.entities) {
    if (e.removed) continue;
    const key = e instanceof Mob ? e.def.key : e.kind === 'item' ? 'item' : e.kind;
    if (type && type !== 'player' && (key === type) === !!neg) continue;
    if (type === 'player' && !neg) continue;
    if (!near(e.x, e.y, e.z)) continue;
    list.push({ kind: 'entity', e });
  }
  const dist = (t: Target) => (t.kind === 'player' ? Math.hypot(c.s.player.x - o.x, c.s.player.z - o.z) : Math.hypot(t.e.x - o.x, t.e.z - o.z));
  list.sort((a, b) => dist(a) - dist(b));
  if (opts.c) list = list.slice(0, Math.max(0, Number(opts.c)));
  return list;
}

function targetName(t: Target): string {
  if (t.kind === 'player') return 'Joueur';
  return t.e instanceof Mob ? t.e.def.name : 'Entité';
}

// ---------- commandes ----------

const TIME_NAMES: Record<string, number> = { sunrise: 23000, day: 1000, jour: 1000, noon: 6000, midi: 6000, sunset: 12000, night: 13000, nuit: 13000, midnight: 18000, minuit: 18000 };

function setTimeTicks(s: Session, ticks: number) {
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

const GAMEMODES: Record<string, 'survival' | 'creative'> = { survival: 'survival', s: 'survival', '0': 'survival', survie: 'survival', creative: 'creative', c: 'creative', '1': 'creative', creatif: 'creative', créatif: 'creative' };
const DIFFS: Record<string, 'peaceful' | 'easy' | 'normal' | 'hard'> = { peaceful: 'peaceful', p: 'peaceful', '0': 'peaceful', easy: 'easy', e: 'easy', '1': 'easy', normal: 'normal', n: 'normal', '2': 'normal', hard: 'hard', h: 'hard', '3': 'hard' };

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
      c.out(COMMANDS.map((d) => `/${d.name}`).join(' '));
    },
  },
  {
    name: 'give', usage: '/give <cible> <objet> [quantité]', desc: 'Donne un objet', cheat: true,
    run(c) {
      select(c, c.args[0]);
      const id = resolveItem(c.args[1] ?? '');
      const n = c.args[2] ? num(c.args[2], 'Quantité', 1, 32767) : 1;
      let left = n;
      const max = ItemRegistry.maxStack(id);
      while (left > 0) {
        const k = Math.min(max, left);
        const rest = c.s.player.inventory.add(makeStack(id, k));
        if (rest > 0) c.s.entities.spawnItem(id, rest, c.s.player.x, c.s.player.y + 1, c.s.player.z);
        left -= k;
      }
      c.out(`${ItemRegistry.get(id)!.name} * ${n} donné(s) à Joueur`);
    },
  },
  {
    name: 'clear', usage: '/clear [cible] [objet] [quantité max]', desc: "Vide l'inventaire", cheat: true,
    run(c) {
      const inv = c.s.player.inventory;
      if (c.args[1]) {
        const id = resolveItem(c.args[1]);
        const max = c.args[2] ? num(c.args[2], 'Quantité', 0) : Infinity;
        const have = inv.count(id);
        const n = Math.min(have, max);
        if (n > 0) inv.remove(id, n);
        c.out(`${n} objet(s) retiré(s) de l'inventaire de Joueur`);
        return;
      }
      let n = 0;
      for (const s of inv.slots) if (s) n += s.count;
      inv.slots.fill(null);
      inv.changed();
      c.out(`${n} objet(s) retiré(s) de l'inventaire de Joueur`);
    },
  },
  {
    name: 'tp', aliases: ['teleport'], usage: '/tp [cible] <x y z> | /tp [cible] <destination>', desc: 'Téléporte', cheat: true,
    run(c) {
      let who: Target[] = [{ kind: 'player' }];
      let i = 0;
      if (c.args[0]?.startsWith('@') || (c.args.length === 2 || c.args.length === 4)) {
        if (c.args.length === 2 || c.args.length >= 4) {
          who = select(c, c.args[0]);
          i = 1;
        }
      }
      let dest: [number, number, number];
      if (c.args.length - i === 1) {
        const t = select(c, c.args[i])[0];
        if (!t) throw new CommandError('Aucune entité trouvée');
        dest = t.kind === 'player' ? [c.s.player.x, c.s.player.y, c.s.player.z] : [t.e.x, t.e.y, t.e.z];
      } else dest = coords(c, i);
      for (const t of who) {
        if (t.kind === 'player') {
          const p = c.s.player;
          p.body.setPos(dest[0], Math.max(-10, Math.min(WORLD_HEIGHT + 50, dest[1])), dest[2]);
          p.body.vx = p.body.vy = p.body.vz = 0;
          p.body.fallDistance = 0;
        } else t.e.body.setPos(dest[0], dest[1], dest[2]);
      }
      c.out(`${who.map(targetName).join(', ')} téléporté(s) en ${dest.map((v) => v.toFixed(2)).join(', ')}`);
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
      const map: Record<string, 'clear' | 'rain' | 'storm'> = { clear: 'clear', rain: 'rain', thunder: 'storm', query: 'clear' };
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
  {
    name: 'gamemode', aliases: ['gm'], usage: '/gamemode <survival|creative> [cible]', desc: 'Change le mode de jeu', cheat: true,
    run(c) {
      const m = GAMEMODES[(c.args[0] ?? '').toLowerCase()];
      if (!m) throw new CommandError('Mode inconnu (survival, creative)');
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
      c.out(list.length ? `${list.length === 1 ? targetName(list[0]) : `${list.length} entités`} tué(s)` : 'Aucune entité trouvée');
    },
  },
  {
    name: 'summon', usage: '/summon <entité> [x y z]', desc: 'Fait apparaître une créature', cheat: true,
    run(c) {
      const key = strip(c.args[0] ?? '');
      const [x, y, z] = c.args.length >= 4 ? coords(c, 1) : [c.origin.x, c.origin.y, c.origin.z];
      if (key === 'tnt') {
        const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
        c.s.world.setBlock(bx, by, bz, B.TNT);
        c.s.explosions.prime(c.s, bx, by, bz);
      } else if (key === 'item') throw new CommandError('Utilisez /give pour obtenir un objet');
      else {
        const m = c.s.entities.spawnMob(resolveMob(key), x, y, z, { persistent: true });
        if (!m) throw new CommandError("Impossible de faire apparaître l'entité ici");
      }
      c.out('Entité invoquée avec succès');
    },
  },
  {
    name: 'setblock', usage: '/setblock <x y z> <bloc> [replace|destroy|keep]', desc: 'Pose un bloc', cheat: true,
    run(c) {
      const [x, y, z] = blockCoords(c, 0);
      const id = resolveBlock(c.args[3] ?? '');
      const meta = c.args[4] && /^\d+$/.test(c.args[4]) ? Number(c.args[4]) : 0;
      const mode = c.args.find((a, i) => i >= 4 && /^(replace|destroy|keep)$/.test(a)) ?? 'replace';
      if (y < 0 || y >= WORLD_HEIGHT) throw new CommandError('Impossible de placer un bloc hors du monde');
      if (c.s.world.getBlock(x, y, z) < 0) throw new CommandError('Impossible de placer un bloc hors du monde chargé');
      const cur = c.s.world.getBlock(x, y, z);
      if (mode === 'keep' && cur !== B.AIR) throw new CommandError('Impossible de placer le bloc');
      if (mode === 'destroy' && cur > 0) c.s.interaction.breakBlock(x, y, z, 'diamond_pickaxe');
      if (!c.s.world.setBlock(x, y, z, id, meta) && cur === id) throw new CommandError('Impossible de placer le bloc');
      c.out('Bloc placé');
    },
  },
  {
    name: 'fill', usage: '/fill <x1 y1 z1> <x2 y2 z2> <bloc> [replace <ancien>|hollow|outline|keep|destroy]', desc: 'Remplit une zone', cheat: true,
    run(c) {
      const a = blockCoords(c, 0), b = blockCoords(c, 3);
      const id = resolveBlock(c.args[6] ?? '');
      const mode = c.args[7] ?? 'replace';
      const filter = mode === 'replace' && c.args[8] ? resolveBlock(c.args[8]) : -1;
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
            if (filter >= 0 && cur !== filter) continue;
            if (mode === 'destroy' && cur > 0) c.s.interaction.breakBlock(x, y, z, 'diamond_pickaxe');
            if (w.setBlock(x, y, z, target, 0, false)) {
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
    name: 'effect', usage: '/effect <cible> <effet|clear> [secondes] [amplificateur]', desc: 'Applique un effet', cheat: true,
    run(c) {
      const p = c.s.player;
      const eff = strip(c.args[1] ?? c.args[0] ?? '');
      if (eff === 'clear' || c.args[0] === 'clear') {
        p.poisonTimer = 0;
        p.regenEffect = 0;
        c.out('Effets retirés de Joueur');
        return;
      }
      const sec = c.args[2] ? num(c.args[2], 'Durée', 0, 1e6) : 30;
      if (eff === 'regeneration' || eff === 'regeneration_effect') p.regenEffect = sec;
      else if (eff === 'poison') p.poisonTimer = sec;
      else if (eff === 'instant_health' || eff === 'healing') p.heal(4 * (Number(c.args[3] ?? 0) + 1));
      else if (eff === 'saturation') p.hunger = 20;
      else if (eff === 'instant_damage') p.damage(6, 'mob');
      else throw new CommandError(`Effet non pris en charge : ${eff} (regeneration, poison, instant_health, saturation, instant_damage)`);
      c.out(`Effet ${eff} appliqué à Joueur`);
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
      c.out(`${lv ? `${n} niveaux` : `${n} points d'expérience`} donné(s) à Joueur`);
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
  { name: 'say', usage: '/say <message>', desc: 'Envoie un message', run(c) { c.out(`[Joueur] ${c.args.join(' ')}`); } },
  { name: 'me', usage: '/me <action>', desc: 'Décrit une action', run(c) { c.out(`* Joueur ${c.args.join(' ')}`); } },
  { name: 'tell', aliases: ['msg', 'w'], usage: '/tell <cible> <message>', desc: 'Message privé', run(c) { c.out(`Vous chuchotez à ${c.args[0] ?? '?'} : ${c.args.slice(1).join(' ')}`); } },
  { name: 'list', usage: '/list', desc: 'Joueurs connectés', run(c) { c.out('Il y a 1/1 joueurs connectés : Joueur'); } },
  {
    name: 'title', usage: '/title <cible> <title|subtitle|actionbar|clear> <texte>', desc: 'Affiche un titre', cheat: true,
    run(c) {
      const kind = c.args[1];
      const text = c.args.slice(2).join(' ');
      c.s.hud.showTitle?.(kind === 'clear' ? '' : text, kind === 'subtitle' ? 'subtitle' : kind === 'actionbar' ? 'actionbar' : 'title');
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
      const key = Object.keys(rules).find((k) => k.toLowerCase() === c.args[0].toLowerCase()) as keyof GameRules | undefined;
      if (!key) throw new CommandError(`Règle inconnue : ${c.args[0]}`);
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
        execute(c.s, line, () => {}, c.depth + 1, c.origin, true);
        n++;
      }
      c.out(`${n} commandes exécutées depuis la fonction « ${name} »`);
    },
  },
  {
    name: 'playsound', usage: '/playsound <son>', desc: 'Joue un son', cheat: true,
    run(c) {
      c.s.audio.play(strip(c.args[0] ?? '').replace(/\./g, '_'), { volume: 1 });
    },
  },
  {
    name: 'enchant', usage: '/enchant', desc: 'Non disponible', cheat: true,
    run() {
      throw new CommandError("Les enchantements n'existent pas dans cette version");
    },
  },
  {
    name: 'execute', usage: '/execute as|at <cible> run <commande>', desc: 'Exécute une commande depuis une entité', cheat: true,
    run(c) {
      // forme simplifiée : execute (as|at) <sélecteur> [positioned x y z] run <commande>
      const runAt = c.args.indexOf('run');
      if (runAt < 0) throw new CommandError('Mot-clé « run » attendu');
      const rest = c.args.slice(runAt + 1).join(' ');
      let targets: Target[] = [{ kind: 'player' }];
      let origin = { ...c.origin };
      for (let i = 0; i < runAt; i++) {
        if (c.args[i] === 'as' || c.args[i] === 'at') targets = select(c, c.args[++i]);
        else if (c.args[i] === 'positioned') {
          const p = coords({ ...c, args: c.args }, i + 1);
          origin = { ...origin, x: p[0], y: p[1], z: p[2] };
          i += 3;
        }
      }
      for (const t of targets) {
        const o = t.kind === 'player' ? origin : { ...origin, x: t.e.x, y: t.e.y, z: t.e.z };
        execute(c.s, rest, c.out, c.depth + 1, o);
      }
    },
  },
];

function find(name: string): CommandDef | undefined {
  const n = name.toLowerCase();
  return COMMANDS.find((d) => d.name === n || d.aliases?.includes(n));
}

export function commandList(): { name: string; usage: string; desc: string }[] {
  return COMMANDS.map(({ name, usage, desc }) => ({ name, usage, desc }));
}

/**
 * Exécute une ligne de commande (avec ou sans « / »). Les messages sont transmis à `out` ;
 * retourne vrai si la commande a réussi.
 */
export function execute(s: Session, line: string, out: (m: string, error?: boolean) => void, depth = 0, origin?: Ctx['origin'], force = false): boolean {
  const toks = tokenize(line.replace(/^\//, ''));
  if (!toks.length) return false;
  const def = find(toks[0]);
  if (!def) {
    out(`Commande inconnue : ${toks[0]}. Tapez /help pour la liste.`, true);
    return false;
  }
  if (def.cheat && !s.cheats && !force) {
    out('Les commandes de triche sont désactivées dans ce monde (activez-les dans « Modifier » depuis la liste des mondes).', true);
    return false;
  }
  const p = s.player;
  const ctx: Ctx = { s, args: toks.slice(1), origin: origin ?? { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch }, out: (m) => out(m), depth };
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
    return COMMANDS.filter((d) => d.name.startsWith(pre)).map((d) => d.usage);
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
      return argIdx === 0 ? pick([...MOB_DEFS.map((m) => m.key), 'tnt']) : ['~'];
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
      return argIdx === 0 ? pick(['@s', 'clear']) : argIdx === 1 ? pick(['regeneration', 'poison', 'instant_health', 'saturation', 'instant_damage', 'clear']) : [];
    case 'kill':
      return argIdx === 0 ? pick(['@s', '@e', '@e[type=zombie]', '@e[type=item]', '@e[type=!player]']) : [];
    case 'locate':
      return argIdx === 0 ? ['structure'] : argIdx === 1 ? pick(['village', 'temple', 'mineshaft', 'dungeon', 'ruins', 'tower', 'igloo', 'camp', 'golem_lair']) : [];
    case 'tp':
      return ['~'];
    default:
      return [];
  }
}
