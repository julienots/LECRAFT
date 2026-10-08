/**
 * Joueur distant affiché dans le monde (modèle de joueur avec sa skin, pseudo, objet en main) et,
 * côté hôte, « cible » que les créatures peuvent poursuivre et attaquer comme le joueur local.
 */
import type { GameContext } from '../core/GameContext';
import type { Player } from '../player/Player';
import type { EntitySpawner } from '../entities/Mob';
import { Bot } from '../server/Bot';
import type { PlayerState } from './Protocol';

export class RemotePlayer extends Bot {
  readonly netId: number;
  state: PlayerState;
  private tx: number;
  private ty: number;
  private tz: number;
  private tyaw = 0;
  /** Dernière fois que l'état a été reçu (secondes de jeu). */
  seen = 0;

  constructor(s: PlayerState, spawner: EntitySpawner) {
    super(s.name, s.skin || 'steve', 0.5, s.x, s.y, s.z, spawner);
    this.netId = s.id;
    this.state = s;
    this.tx = s.x;
    this.ty = s.y;
    this.tz = s.z;
    this.invulnerable = false;
    this.armorFactor = 1;
  }

  /** Nouvel état reçu (≈ 10 par seconde) : la position est interpolée entre deux états. */
  apply(s: PlayerState) {
    this.state = s;
    this.tx = s.x;
    this.ty = s.y;
    this.tz = s.z;
    this.tyaw = s.yaw + Math.PI;
    this.weapon = s.held;
    if (s.f & 4) this.attackAnim = 1;
    if (s.hp !== undefined) this.health = s.hp;
    this.dead = !!(s.f & 8);
  }

  get maxHealth() {
    return 20;
  }

  update(ctx: GameContext, dt: number) {
    this.age += dt;
    this.seen += dt;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.attackAnim = Math.max(0, this.attackAnim - dt * 3);
    const k = 1 - Math.exp(-14 * dt);
    const b = this.body;
    const ox = b.x, oz = b.z;
    // téléportation (respawn, /tp) : saut direct
    if (Math.hypot(this.tx - b.x, this.ty - b.y, this.tz - b.z) > 8) b.setPos(this.tx, this.ty, this.tz);
    else b.setPos(b.x + (this.tx - b.x) * k, b.y + (this.ty - b.y) * k, b.z + (this.tz - b.z) * k);
    b.vx = (b.x - ox) / Math.max(dt, 1e-3);
    b.vz = (b.z - oz) / Math.max(dt, 1e-3);
    this.walkPhase += Math.hypot(b.vx, b.vz) * dt * 3.2;
    let d = this.tyaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * k;
    // objet en main (logique du bot, sans cerveau)
    this.customUpdate(ctx, dt);
  }

  render(ctx: GameContext, alpha: number, t: number) {
    super.render(ctx, alpha, t);
    const s = this.state;
    // accroupi / nage : le modèle se baisse ou s'allonge
    this.model.group.rotation.x = s.f & 2 ? -Math.PI / 2.4 : 0;
    this.model.group.position.y = this.y - (s.f & 1 ? 0.15 : 0) + (s.f & 2 ? 0.3 : 0);
    this.model.group.visible = !this.dead;
  }
}

/**
 * Cible côté hôte : objet au format du joueur (position, vie, inventaire, dégâts) que l'IA des
 * créatures utilise à la place du joueur local quand un joueur distant est le plus proche.
 */
export function targetProxy(rp: RemotePlayer, host: Player, hurt: (dmg: number, kx: number, kz: number, src: string) => number): Player {
  const held = () => (rp.state.held ? { id: rp.state.held, count: 1 } : null);
  const p = {
    get x() {
      return rp.x;
    },
    get y() {
      return rp.y;
    },
    get z() {
      return rp.z;
    },
    get dead() {
      return rp.dead;
    },
    get creative() {
      return !!(rp.state.f & 16);
    },
    get yaw() {
      return rp.state.yaw;
    },
    get pitch() {
      return rp.state.pitch;
    },
    get body() {
      return rp.body;
    },
    get difficulty() {
      return host.difficulty;
    },
    get name() {
      return rp.botName;
    },
    eyeHeight: 1.62,
    sprinting: false,
    sneaking: false,
    slowTimer: 0,
    poisonTimer: 0,
    lastAttacker: null as unknown,
    lastAttackedAt: 0,
    inventory: {
      get selectedStack() {
        return held();
      },
      selected: 0,
      slots: [],
    },
    effects: { add: () => undefined, level: () => 0, speedMul: () => 1, damageMul: () => 1, map: new Map() },
    effectTarget: {},
    object: rp.object3d,
    damage(dmg: number, src = 'mob', kx = 0, kz = 0) {
      if (rp.dead || p.creative) return 0;
      return hurt(dmg, kx, kz, src);
    },
    addXp: () => undefined,
    addExhaustion: () => undefined,
  };
  return p as unknown as Player;
}
