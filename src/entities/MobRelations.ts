/**
 * Relations entre créatures, comme le jeu original : chasse (loups, renards, chats, ocelots,
 * axolotls, grenouilles, ours polaires), ennemis naturels (zombies et illageois contre les
 * villageois et les golems, golem de neige contre les monstres, lama contre les loups, piglins
 * contre squelettes wither…), fuite (creeper devant les chats, squelettes devant les loups,
 * villageois devant les zombies…), vengeance (une créature frappée par une autre se défend),
 * ours polaire qui protège son petit, chèvre qui charge, abeille qui perd son dard.
 *
 * Le balayage est fait environ une fois par seconde (Mob.update) ; la poursuite et l'attaque
 * sont l'état HUNT de l'IA (ai/AIController.ts → huntStep).
 */
import type { GameContext } from '../core/GameContext';
import { AIState } from '../ai/StateMachine';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { PROJECTILE_DEFS, type Projectile } from './Projectile';
import type { Mob } from './Mob';

const ZOMBIES = ['zombie', 'husk', 'drowned', 'zombie_villager', 'zombie_chief'];
const SKELETONS = ['skeleton', 'stray', 'bogged', 'parched'];
const ILLAGERS = ['pillager', 'vindicator', 'evoker'];
const FISH = ['cod', 'salmon', 'tropical_fish'];

export interface HuntRule {
  prey: string[] | 'monsters' | 'all';
  /** Chance par balayage (proies « nourriture » : chasse occasionnelle). */
  chance?: number;
  /** Seulement les petits (tortues, petits slimes). */
  baby?: boolean;
  /** Seulement dans l'eau (axolotl, gardien). */
  water?: boolean;
  /** Dégâts du coup (sinon ceux de la créature). */
  dmg?: number;
  /** Projectile (golem de neige, lama). */
  ranged?: 'snowball' | 'spit';
  /** Avale la proie (grenouille). */
  eat?: boolean;
}

export const HUNTS: Record<string, HuntRule[]> = {
  wolf: [{ prey: ['sheep', 'rabbit', 'fox'], chance: 0.12 }, { prey: SKELETONS }, { prey: ['turtle'], baby: true, chance: 0.12 }],
  fox: [{ prey: ['chicken', 'rabbit', ...FISH], chance: 0.12 }, { prey: ['turtle'], baby: true, chance: 0.12 }],
  ocelot: [{ prey: ['chicken'], chance: 0.12, dmg: 3 }, { prey: ['turtle'], baby: true, chance: 0.12, dmg: 3 }],
  cat: [{ prey: ['rabbit'], chance: 0.12, dmg: 3 }, { prey: ['turtle'], baby: true, chance: 0.12, dmg: 3 }],
  polar_bear: [{ prey: ['fox'], chance: 0.25 }],
  axolotl: [{ prey: [...FISH, 'pufferfish', 'squid', 'glow_squid', 'tadpole', 'drowned', 'guardian', 'elder_guardian'], water: true, dmg: 2, chance: 0.5 }],
  frog: [{ prey: ['slime', 'magma_cube'], baby: true, eat: true }],
  snow_golem: [{ prey: 'monsters', ranged: 'snowball' }],
  llama: [{ prey: ['wolf'], ranged: 'spit' }],
  trader_llama: [{ prey: ['wolf'], ranged: 'spit' }],
  piglin: [{ prey: ['wither_skeleton'] }],
  piglin_brute: [{ prey: ['wither_skeleton'] }],
  wither_skeleton: [{ prey: ['piglin', 'piglin_brute'] }],
  enderman: [{ prey: ['endermite'] }],
  guardian: [{ prey: ['squid', 'glow_squid', 'axolotl'], water: true }],
  elder_guardian: [{ prey: ['squid', 'glow_squid', 'axolotl'], water: true }],
  zoglin: [{ prey: 'all' }],
};
for (const z of ZOMBIES) HUNTS[z] = [{ prey: ['villager', 'wandering_trader', 'iron_golem', 'snow_golem'] }, { prey: ['turtle'], baby: true }];
for (const i of ILLAGERS) HUNTS[i] = [{ prey: ['villager', 'wandering_trader', 'iron_golem'] }];

/** Créatures fuies (à moins de 6 blocs, 8 pour les villageois). */
export const FEARS: Record<string, string[]> = {
  creeper: ['cat', 'ocelot'],
  rabbit: ['wolf', 'fox'],
  fox: ['wolf', 'polar_bear'],
  wolf: ['llama', 'trader_llama'],
  piglin: ['zombified_piglin', 'zoglin'],
  villager: [...ZOMBIES, ...ILLAGERS, 'zoglin'],
  wandering_trader: [...ZOMBIES, ...ILLAGERS, 'zoglin'],
};
for (const s of SKELETONS) FEARS[s] = ['wolf'];

const NEVER_PREY = new Set(['armor_stand', 'end_crystal', 'ender_dragon', 'wither', 'creeper', 'zoglin', 'ghast', 'shulker']);

type Rel = Mob & { tamed?: boolean };

const mobsOf = (m: Mob): Mob[] => (m as unknown as { spawner: { mobs?: Mob[] } }).spawner.mobs ?? [];
const canFight = (m: Mob) => m.def.damage > 0 || !!m.def.ranged || !!HUNTS[m.def.key];

function matches(h: HuntRule, hunter: Mob, t: Mob): boolean {
  if (t === hunter || t.dead || t.removed || t.net || NEVER_PREY.has(t.def.key)) return false;
  if (h.baby && !t.baby) return false;
  if (h.water && !t.body.inWater) return false;
  if (h.prey === 'all') return t.def.key !== hunter.def.key && t.def.category !== 'boss';
  if (h.prey === 'monsters') return t.def.category === 'hostile';
  return h.prey.includes(t.def.key);
}

/** Balayage périodique : proie, fuite, protection des petits, charge de la chèvre. */
export function scanRelations(mob: Mob, ctx: GameContext) {
  const m = mob as Rel;
  if (m.dead || m.baby || m.net || m.tamed || m.def.category === 'boss') return;
  const st = m.ai.state;
  const free = st === AIState.IDLE || st === AIState.WANDER || st === AIState.RETURN;
  const all = mobsOf(m);
  // fuite devant un prédateur
  const fears = FEARS[m.def.key];
  if (fears && st !== AIState.FLEE && st !== AIState.CHASE && st !== AIState.ATTACK) {
    const r = m.def.key === 'villager' || m.def.key === 'wandering_trader' ? 8 : 6;
    for (const o of all)
      if (!o.dead && fears.includes(o.def.key) && !(o as Rel).tamed && Math.hypot(o.x - m.x, o.z - m.z) < r && Math.abs(o.y - m.y) < 4) {
        m.fleeFrom = o;
        m.fleeTimer = 3;
        m.prey = null;
        m.ai.fsm.set(AIState.FLEE);
        return;
      }
  }
  // ours polaire : défend son petit contre le joueur
  if (m.def.key === 'polar_bear' && !ctx.player.dead && !ctx.player.creative && m.distToPlayer < 10) {
    if (all.some((o) => o.def.key === 'polar_bear' && o.baby && !o.dead && Math.hypot(o.x - m.x, o.z - m.z) < 16)) {
      m.anger = Math.max(m.anger, 8);
      return;
    }
  }
  // chèvre : charge de temps en temps une créature proche (ou le joueur)
  if (m.def.key === 'goat') {
    const g = m as Rel & { ramCooldown?: number };
    g.ramCooldown = (g.ramCooldown ?? 30 + Math.random() * 270) - 1;
    if (g.ramCooldown > 0 || !free) return;
    g.ramCooldown = 30 + Math.random() * 270;
    const near = all.filter((o) => o !== m && !o.dead && o.def.key !== 'goat' && !NEVER_PREY.has(o.def.key) && Math.hypot(o.x - m.x, o.z - m.z) < 8);
    if (near.length) {
      m.prey = near[Math.floor(Math.random() * near.length)];
      m.relHunt = { prey: 'all', dmg: 2 };
      m.revenge = false;
      m.ai.fsm.set(AIState.HUNT);
    }
    return;
  }
  const hunts = HUNTS[m.def.key];
  if (!hunts || !free || (m.prey && !m.prey.dead)) return;
  const range = Math.min(16, Math.max(10, m.def.detectionRange));
  let best: Mob | null = null, bh: HuntRule | null = null, bd = range;
  for (const h of hunts) {
    if (h.chance !== undefined && Math.random() > h.chance) continue;
    for (const o of all) {
      if (!matches(h, m, o)) continue;
      const d = Math.hypot(o.x - m.x, o.z - m.z);
      if (d < bd && Math.abs(o.y - m.y) < 6) {
        bd = d;
        best = o;
        bh = h;
      }
    }
  }
  if (best) {
    m.prey = best;
    m.relHunt = bh;
    m.revenge = false;
    m.ai.fsm.set(AIState.HUNT);
  }
}

/** Poursuite et attaque de la proie (état HUNT). Retourne faux quand la chasse est finie. */
export function huntStep(mob: Mob, ctx: GameContext): boolean {
  const m = mob as Rel;
  const t = m.prey;
  if (!t || t.dead || t.removed) return finish(m);
  const dx = t.x - m.x, dz = t.z - m.z, d = Math.hypot(dx, dz) || 0.001;
  if (d > 24 || Math.abs(t.y - m.y) > 8 || m.ai.fsm.timeInState > 30) return finish(m);
  const h = m.relHunt ?? { prey: [t.def.key] };
  const ranged = h.ranged ?? (m.def.ranged && !h.eat ? 'own' : null);
  if (ranged) {
    // garde ses distances et tire
    if (d > 9) m.ai.navigateTo(t.x, t.y, t.z, 1);
    else m.ai.stop();
    m.yaw = Math.atan2(dx, dz);
    if (m.attackTimer <= 0 && d <= 11) shoot(m, t, ranged, ctx);
    return true;
  }
  const reach = Math.max(1.2, m.def.attackRange) + t.body.halfWidth;
  if (d > reach) {
    m.ai.navigateTo(t.x, t.y, t.z, m.def.key === 'goat' ? 1.6 : 1.25);
    return true;
  }
  m.ai.stop();
  m.yaw = Math.atan2(dx, dz);
  if (m.attackTimer > 0) return true;
  m.attackTimer = Math.max(0.6, m.def.attackCooldown);
  m.attackAnim = 1;
  if (h.eat) {
    // grenouille : avale le petit slime (boule de slime) ou le petit cube de magma (lumifrog)
    t.dead = true;
    t.removed = true;
    ctx.particles.burst('poof', t.x, t.y + 0.3, t.z, 8);
    const drop = t.def.key === 'magma_cube' ? 'ochre_froglight' : 'slime_ball';
    if (ItemRegistry.has(drop)) (m as unknown as { spawner: { spawnItem(i: string, n: number, x: number, y: number, z: number): void } }).spawner.spawnItem(drop, 1, t.x, t.y + 0.3, t.z);
    ctx.audio.play('pop', { x: m.x, y: m.y, z: m.z });
    return finish(m);
  }
  const dmg = h.dmg ?? (m.def.damage > 0 ? m.def.damage : 2);
  const kb = m.def.key === 'goat' ? 9 : m.def.key === 'iron_golem' ? 5 : 3;
  ctx.combat.damageMob(t, dmg, { kind: 'bot', attacker: m as never, knockX: (dx / d) * kb, knockZ: (dz / d) * kb, cause: 'entityAttack' });
  if (m.def.key === 'goat') return finish(m); // une seule charge
  return true;
}

function finish(m: Rel): false {
  m.prey = null;
  m.relHunt = null;
  m.revenge = false;
  return false;
}

function shoot(m: Rel, t: Mob, kind: 'snowball' | 'spit' | 'own', ctx: GameContext) {
  const sp = m as unknown as { spawner: { spawnProjectile(k: string, x: number, y: number, z: number, vx: number, vy: number, vz: number, dmg: number, fromPlayer: boolean, def?: unknown): Projectile } };
  const sx = m.x, sy = m.y + m.body.height * 0.8, sz = m.z;
  const tx = t.x, ty = t.y + t.body.height * 0.6, tz = t.z;
  const dx = tx - sx, dz = tz - sz, dh = Math.hypot(dx, dz) || 1;
  const def = kind === 'snowball' ? PROJECTILE_DEFS.get('minecraft:snowball') : kind === 'spit' ? PROJECTILE_DEFS.get('minecraft:llama_spit') : m.def.ranged?.customId ? PROJECTILE_DEFS.get(m.def.ranged.customId) : undefined;
  const speed = kind === 'own' ? m.def.ranged!.speed : 14;
  const tt = dh / speed;
  const grav = def ? def.gravity : kind === 'own' && (m.def.ranged!.projectile === 'arrow' || m.def.ranged!.projectile === 'boulder') ? 12 : 0;
  const vy = (ty - sy) / tt + 0.5 * grav * tt;
  // boule de neige : 3 dégâts aux blazes seulement (comme le jeu original)
  const dmg = kind === 'snowball' ? (t.def.key === 'blaze' ? 3 : 0) : kind === 'spit' ? 1 : def?.damage || m.def.ranged!.damage;
  const pk = def ? 'custom' : m.def.ranged!.projectile;
  // « fromPlayer » : le projectile touche les créatures (et pas le joueur) ; son lanceur est la créature
  const pr = sp.spawner.spawnProjectile(pk, sx, sy, sz, (dx / dh) * speed, vy, (dz / dh) * speed, dmg, true, def);
  pr.owner = m as never;
  m.attackTimer = kind === 'snowball' ? 1 : Math.max(1, m.def.attackCooldown);
  m.attackAnim = 1;
  ctx.audio.play(kind === 'own' && m.def.ranged!.projectile === 'arrow' ? 'bow' : 'pop', { x: sx, y: sy, z: sz, volume: 0.6 });
}

/**
 * Vengeance : une créature frappée par une autre se défend (neutres et hostiles), fuit
 * (passives) ; la meute des loups sauvages se joint au combat.
 */
export function onMobHurtByMob(victim: Mob, attacker: Mob) {
  const v = victim as Rel;
  if (victim === attacker || v.dead || v.net || v.def.category === 'boss' || v.def.key === 'iron_golem' || v.def.key === 'creeper') return;
  if (v.tamed) {
    (v as unknown as { target: Mob | null }).target = attacker;
    return;
  }
  if (v.def.category === 'passive' && !HUNTS[v.def.key]) {
    v.fleeFrom = attacker;
    v.fleeTimer = 4;
    v.ai.fsm.set(AIState.FLEE);
    return;
  }
  if (!canFight(v) || v.ai.state === AIState.CHASE || v.ai.state === AIState.ATTACK) return;
  const join = [v];
  if (v.def.key === 'wolf') for (const o of mobsOf(v)) if (o !== v && o.def.key === 'wolf' && !o.dead && !(o as Rel).tamed && Math.hypot(o.x - v.x, o.z - v.z) < 16) join.push(o);
  for (const w of join as Rel[]) {
    w.prey = attacker;
    w.relHunt = { prey: [attacker.def.key] };
    w.revenge = true;
    w.ai.fsm.set(AIState.HUNT);
  }
}
