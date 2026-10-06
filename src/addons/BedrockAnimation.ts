/**
 * Animations des entités Bedrock (packs de ressources) : animations à images clés
 * (rotation / position / échelle des os, expressions Molang) et contrôleurs d'animation
 * (états, transitions, mélange), pilotés par l'état de la créature (marche, attaque…).
 */
import { molang, molangNum, type MolangContext, type MolangValue } from './Molang';

type Vec = [MolangValue, MolangValue, MolangValue];
interface Key {
  t: number;
  pre: Vec;
  post: Vec;
  smooth: boolean;
}
type Channel = { kind: 'const'; v: Vec } | { kind: 'keys'; keys: Key[] };

export interface AnimDef {
  loop: boolean | 'hold';
  length: number;
  bones: Map<string, { rotation?: Channel; position?: Channel; scale?: Channel }>;
}
export interface ControllerDef {
  initial: string;
  states: Map<string, { animations: (string | Record<string, string>)[]; transitions: Record<string, string>[]; onEntry?: string[] }>;
}
/** Animations d'une entité cliente (noms courts → animation ou contrôleur). */
export interface EntityAnimSet {
  map: Record<string, string>;
  animate: (string | Record<string, string>)[];
  initialize: string[];
  preAnimation: string[];
}

export const ANIMATIONS = new Map<string, AnimDef>();
export const CONTROLLERS = new Map<string, ControllerDef>();
/** Entité (identifiant) → animations déclarées par son entité cliente. */
export const ENTITY_ANIMS = new Map<string, EntityAnimSet>();

const vec = (v: unknown): Vec => {
  if (Array.isArray(v)) return [v[0] ?? 0, v[1] ?? v[0] ?? 0, v[2] ?? v[0] ?? 0] as Vec;
  return [v as MolangValue, v as MolangValue, v as MolangValue];
};

function channel(v: unknown): Channel | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v) || typeof v === 'number' || typeof v === 'string') return { kind: 'const', v: vec(v) };
  if (typeof v === 'object') {
    const keys: Key[] = [];
    for (const [t, kv] of Object.entries(v as Record<string, unknown>)) {
      const time = Number(t);
      if (!Number.isFinite(time)) continue;
      if (kv && typeof kv === 'object' && !Array.isArray(kv)) {
        const o = kv as { pre?: unknown; post?: unknown; lerp_mode?: string };
        const post = vec(o.post ?? o.pre ?? 0);
        keys.push({ t: time, pre: vec(o.pre ?? o.post ?? 0), post, smooth: o.lerp_mode === 'catmullrom' });
      } else keys.push({ t: time, pre: vec(kv), post: vec(kv), smooth: false });
    }
    keys.sort((a, b) => a.t - b.t);
    if (keys.length) return { kind: 'keys', keys };
  }
  return undefined;
}

/** Lit un fichier « animations » d'un pack de ressources. */
export function readAnimations(json: unknown) {
  const all = (json as { animations?: Record<string, Record<string, unknown>> })?.animations ?? {};
  for (const [id, a] of Object.entries(all)) {
    if (!a || typeof a !== 'object') continue;
    const bones = new Map<string, { rotation?: Channel; position?: Channel; scale?: Channel }>();
    for (const [bone, b] of Object.entries((a.bones ?? {}) as Record<string, Record<string, unknown>>)) {
      if (!b) continue;
      bones.set(bone.toLowerCase(), { rotation: channel(b.rotation), position: channel(b.position), scale: channel(b.scale) });
    }
    let length = Number(a.animation_length ?? 0);
    if (!length) for (const b of bones.values()) for (const c of [b.rotation, b.position, b.scale]) if (c?.kind === 'keys') length = Math.max(length, c.keys[c.keys.length - 1].t);
    ANIMATIONS.set(id, { loop: a.loop === true ? true : a.loop === 'hold_on_last_frame' ? 'hold' : false, length, bones });
  }
}

/** Lit un fichier « animation_controllers ». */
export function readControllers(json: unknown) {
  const all = (json as { animation_controllers?: Record<string, { initial_state?: string; states?: Record<string, Record<string, unknown>> }> })?.animation_controllers ?? {};
  for (const [id, c] of Object.entries(all)) {
    const states = new Map<string, { animations: (string | Record<string, string>)[]; transitions: Record<string, string>[]; onEntry?: string[] }>();
    for (const [name, s] of Object.entries(c.states ?? {})) {
      states.set(name, {
        animations: (s.animations as (string | Record<string, string>)[] | undefined) ?? [],
        transitions: (s.transitions as Record<string, string>[] | undefined) ?? [],
        onEntry: s.on_entry as string[] | undefined,
      });
    }
    CONTROLLERS.set(id, { initial: c.initial_state ?? 'default', states });
  }
}

export interface BonePose {
  rot: [number, number, number];
  pos: [number, number, number];
  scale: [number, number, number];
}

/** État d'animation d'une créature. */
export class AnimPlayer {
  private start = new Map<string, number>();
  private ctrlState = new Map<string, { state: string; since: number }>();
  readonly vars: Record<string, MolangValue> = {};
  private animTime = 0;
  private initialized = false;
  constructor(readonly set: EntityAnimSet) {}

  /**
   * Calcule les poses des os à l'instant `t` (secondes) ; `q` fournit les requêtes Molang
   * (vitesse, au sol, attaque…).
   */
  evaluate(t: number, q: (name: string, args: MolangValue[]) => MolangValue | undefined): Map<string, BonePose> {
    const ctx: MolangContext = {
      query: (n, a) => (n === 'anim_time' ? this.animTime : n === 'life_time' ? t : q(n, a)),
      variables: this.vars,
    };
    if (!this.initialized) {
      this.initialized = true;
      for (const e of this.set.initialize) safe(() => molang(e, ctx));
    }
    for (const e of this.set.preAnimation) safe(() => molang(e, ctx));
    const poses = new Map<string, BonePose>();
    const active = new Set<string>();
    const run = (entry: string | Record<string, string>, weight: number, depth: number) => {
      if (depth > 6) return;
      const [name, blend] = typeof entry === 'string' ? [entry, undefined] : Object.entries(entry)[0] ?? [];
      if (!name) return;
      const w = weight * (blend === undefined ? 1 : safeNum(blend, ctx, 1));
      if (w <= 0.001) return;
      const id = this.set.map[name] ?? name;
      const ctrl = CONTROLLERS.get(id);
      if (ctrl) {
        let cs = this.ctrlState.get(id);
        if (!cs || !ctrl.states.has(cs.state)) {
          cs = { state: ctrl.states.has(ctrl.initial) ? ctrl.initial : [...ctrl.states.keys()][0], since: t };
          this.ctrlState.set(id, cs);
        }
        const st = ctrl.states.get(cs.state);
        if (!st) return;
        // transitions (évaluées avant de jouer l'état)
        for (const tr of st.transitions) {
          const [to, cond] = Object.entries(tr)[0] ?? [];
          if (to && to !== cs.state && ctrl.states.has(to) && safeNum(cond, ctx, 0) !== 0) {
            cs.state = to;
            cs.since = t;
            for (const e of ctrl.states.get(to)!.onEntry ?? []) safe(() => molang(e, ctx));
            for (const a of ctrl.states.get(to)!.animations) {
              const an = typeof a === 'string' ? a : Object.keys(a)[0];
              this.start.delete(this.set.map[an] ?? an);
            }
            break;
          }
        }
        for (const a of ctrl.states.get(cs.state)!.animations) run(a, w, depth + 1);
        return;
      }
      const anim = ANIMATIONS.get(id);
      if (!anim) return;
      active.add(id);
      let st = this.start.get(id);
      if (st === undefined) this.start.set(id, (st = t));
      let at = t - st;
      if (anim.length > 0) {
        if (anim.loop === true) at %= anim.length;
        else if (at > anim.length) at = anim.length;
      }
      this.animTime = at;
      for (const [bone, b] of anim.bones) {
        let p = poses.get(bone);
        if (!p) poses.set(bone, (p = { rot: [0, 0, 0], pos: [0, 0, 0], scale: [1, 1, 1] }));
        if (b.rotation) {
          const v = sample(b.rotation, at, ctx);
          p.rot[0] += v[0] * w;
          p.rot[1] += v[1] * w;
          p.rot[2] += v[2] * w;
        }
        if (b.position) {
          const v = sample(b.position, at, ctx);
          p.pos[0] += v[0] * w;
          p.pos[1] += v[1] * w;
          p.pos[2] += v[2] * w;
        }
        if (b.scale) {
          const v = sample(b.scale, at, ctx);
          p.scale[0] *= 1 + (v[0] - 1) * w;
          p.scale[1] *= 1 + (v[1] - 1) * w;
          p.scale[2] *= 1 + (v[2] - 1) * w;
        }
      }
    };
    for (const e of this.set.animate) run(e, 1, 0);
    // une animation qui n'est plus jouée repart du début la prochaine fois
    for (const k of [...this.start.keys()]) if (!active.has(k)) this.start.delete(k);
    return poses;
  }
}

function safe(fn: () => unknown) {
  try {
    fn();
  } catch {
    /* expression non prise en charge */
  }
}
function safeNum(e: unknown, ctx: MolangContext, d: number): number {
  try {
    return molangNum(e as MolangValue, ctx);
  } catch {
    return d;
  }
}

function evalVec(v: Vec, ctx: MolangContext): [number, number, number] {
  return [safeNum(v[0], ctx, 0), safeNum(v[1], ctx, 0), safeNum(v[2], ctx, 0)];
}

function sample(c: Channel, t: number, ctx: MolangContext): [number, number, number] {
  if (c.kind === 'const') return evalVec(c.v, ctx);
  const k = c.keys;
  if (t <= k[0].t) return evalVec(k[0].pre, ctx);
  const last = k[k.length - 1];
  if (t >= last.t) return evalVec(last.post, ctx);
  let i = 0;
  while (i < k.length - 1 && k[i + 1].t < t) i++;
  const a = k[i], b = k[i + 1];
  const f = (t - a.t) / (b.t - a.t || 1);
  const s = a.smooth || b.smooth ? f * f * (3 - 2 * f) : f;
  const va = evalVec(a.post, ctx), vb = evalVec(b.pre, ctx);
  return [va[0] + (vb[0] - va[0]) * s, va[1] + (vb[1] - va[1]) * s, va[2] + (vb[2] - va[2]) * s];
}
