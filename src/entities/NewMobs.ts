/**
 * Créatures récentes du jeu original et leurs comportements :
 *  - Allay : on lui donne un objet, il ramasse les objets identiques autour et les rapporte.
 *  - Renifleur : renifle le sol et déterre des graines anciennes (fleur-torche, amphore).
 *  - Warden : aveugle les joueurs proches (Obscurité) et lance un rayon sonique qui ignore l'armure.
 *  - Vex : invoqué par l'évocateur, il dépérit au bout de 30 à 120 s.
 *  - Grinceur : se fige quand le joueur le regarde.
 *  - Brise : bondit autour de sa cible en lançant des charges de vent.
 */
import type { GameContext } from '../core/GameContext';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { raycastBlocks } from '../util/Raycast';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { AIState } from '../ai/StateMachine';
import { Animal } from './Animal';
import type { Mob } from './Mob';

type Item = { kind: string; itemId: string; count: number; x: number; y: number; z: number; removed: boolean };
const itemsOf = (ctx: GameContext): Item[] => ((ctx as unknown as { entities?: { entities: Item[] } }).entities?.entities ?? []).filter((e) => e.kind === 'item' && !e.removed);

export class Allay extends Animal {
  private seek = 0;
  private target: Item | null = null;

  get held(): string | null {
    return (this.dynProps.get('__held') as string | undefined) ?? null;
  }
  private get carried(): number {
    return (this.dynProps.get('__carried') as number | undefined) ?? 0;
  }
  private set carried(n: number) {
    this.dynProps.set('__carried', n);
  }

  /** Donner un objet (il le garde comme modèle) ; main vide : il rend son objet. Retourne vrai si un objet est pris. */
  interact(ctx: GameContext, itemId: string | null): 'given' | 'returned' | null {
    if (this.dead) return null;
    if (itemId && !this.held) {
      this.dynProps.set('__held', itemId);
      this.persistent = true;
      ctx.particles.burst('hearts', this.x, this.y + 0.6, this.z, 2);
      ctx.audio.play('chirp', { x: this.x, y: this.y, z: this.z, pitch: 1.4 });
      return 'given';
    }
    if (!itemId && this.held) {
      this.spawner.spawnItem(this.held, 1 + this.carried, ctx.player.x, ctx.player.y + 0.5, ctx.player.z);
      this.dynProps.delete('__held');
      this.carried = 0;
      return 'returned';
    }
    return null;
  }

  protected customUpdate(ctx: GameContext, dt: number) {
    super.customUpdate(ctx, dt);
    const held = this.held;
    const p = ctx.player;
    if (!held) {
      // sans objet : voltige près du joueur
      if (this.distToPlayer > 6 && this.distToPlayer < 32) this.ai.moveTowards(p.x, p.z, 0.8, false);
      return;
    }
    this.ai.fsm.set(AIState.IDLE);
    this.idleTime = 1e9;
    this.seek -= dt;
    if (this.seek <= 0 && this.carried < 64) {
      this.seek = 1;
      let best: Item | null = null, bd = 16;
      for (const it of itemsOf(ctx)) {
        if (it.itemId !== held) continue;
        const d = Math.hypot(it.x - this.x, it.y - this.y, it.z - this.z);
        if (d < bd) {
          bd = d;
          best = it;
        }
      }
      this.target = best;
    }
    const t = this.target;
    if (t && !t.removed && this.carried < 64) {
      this.hoverHeight = Math.max(0.2, t.y - ctx.world.surfaceBelow(Math.floor(t.x), Math.floor(t.y + 1), Math.floor(t.z)) - 0.5);
      if (Math.hypot(t.x - this.x, t.y - this.y, t.z - this.z) < 1.2) {
        this.carried = this.carried + t.count;
        t.removed = true;
        this.target = null;
        ctx.audio.play('pop', { x: this.x, y: this.y, z: this.z, pitch: 1.6 });
      } else this.ai.moveTowards(t.x, t.z, 1, false);
      return;
    }
    this.hoverHeight = 2;
    // rapporte ce qu'il a ramassé au joueur
    if (this.carried > 0) {
      if (this.distToPlayer < 2.5) {
        this.spawner.spawnItem(held, this.carried, p.x, p.y + 0.6, p.z);
        this.carried = 0;
        ctx.audio.play('chirp', { x: this.x, y: this.y, z: this.z, pitch: 1.6 });
      } else this.ai.moveTowards(p.x, p.z, 1.2, false);
    } else if (this.distToPlayer > 5) this.ai.moveTowards(p.x, p.z, 0.8, false);
  }
}

export class Sniffer extends Animal {
  private sniff = 20 + Math.random() * 40;

  protected customUpdate(ctx: GameContext, dt: number) {
    super.customUpdate(ctx, dt);
    if (this.baby || this.dead) return;
    this.sniff -= dt;
    if (this.sniff > 0) return;
    this.sniff = 40 + Math.random() * 80;
    const w = ctx.world;
    const below = w.getBlock(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z));
    const key = below > 0 ? BlockRegistry.get(below).key : '';
    if (!/^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|moss_block|mud|muddy_mangrove_roots)$/.test(key)) return;
    // creuse : poussière, grognement, puis une graine ancienne
    this.ai.stop();
    ctx.particles.blockBreak(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z), below);
    ctx.audio.play('grunt', { x: this.x, y: this.y, z: this.z, pitch: 0.6 });
    const seed = Math.random() < 0.5 ? 'torchflower_seeds' : 'pitcher_pod';
    const id = ItemRegistry.has(seed) ? seed : ItemRegistry.has('torchflower_seeds') ? 'torchflower_seeds' : null;
    if (id) this.spawner.spawnItem(id, 1, this.x, this.y + 0.4, this.z);
  }
}

/** Comportements des monstres récents (appelé par Monster.customUpdate). */
export function newMonsterUpdate(m: Mob & { timer2?: number; life?: number }, ctx: GameContext, dt: number) {
  const p = ctx.player;
  switch (m.def.key) {
    case 'warden': {
      m.timer2 = (m.timer2 ?? 3) - dt;
      if (m.timer2 > 0 || p.dead || p.creative) break;
      m.timer2 = 6;
      // Obscurité pour les joueurs à moins de 20 blocs
      if (m.distToPlayer < 20) p.effects.add('darkness', 260, 0, false, p.effectTarget);
      // rayon sonique : touche à travers les blocs fins, ignore l'armure (10 dégâts)
      if (m.distToPlayer > 3 && m.distToPlayer < 15 && m.ai.canSee) {
        const steps = Math.ceil(m.distToPlayer);
        for (let i = 1; i < steps; i++) {
          const k = i / steps;
          ctx.particles.burst('sonic', m.x + (p.x - m.x) * k, m.y + 1.8 + (p.y + 1 - m.y - 1.8) * k, m.z + (p.z - m.z) * k, 1);
        }
        p.damage(10, 'player', ((p.x - m.x) / m.distToPlayer) * 6, ((p.z - m.z) / m.distToPlayer) * 6, m as never);
        ctx.audio.play('roar', { x: m.x, y: m.y, z: m.z, pitch: 0.5 });
        m.attackAnim = 1;
      }
      break;
    }
    case 'vex': {
      // invoqué : dépérit au bout de 30 à 120 s (1 dégât par seconde)
      m.life = (m.life ?? 30 + Math.random() * 90) - dt;
      if (m.life < 0 && Math.random() < dt) ctx.combat.damageMob(m, 1, { kind: 'environment' });
      break;
    }
    case 'creaking': {
      // se fige tant que le joueur le regarde (comme le jeu original)
      if (p.dead || m.distToPlayer > 32) break;
      const cp = Math.cos(p.pitch);
      const lx = -Math.sin(p.yaw) * cp, ly = Math.sin(p.pitch), lz = -Math.cos(p.yaw) * cp;
      const ex = p.x, ey = p.y + p.eyeHeight, ez = p.z;
      const hx = m.x - ex, hy = m.y + 1.5 - ey, hz = m.z - ez;
      const d = Math.hypot(hx, hy, hz) || 1;
      if ((hx * lx + hy * ly + hz * lz) / d > 0.55) {
        const hit = raycastBlocks(ctx.world, ex, ey, ez, hx / d, hy / d, hz / d, d);
        if (!hit || !BlockRegistry.opaque[hit.block]) {
          m.body.vx = m.body.vz = 0;
          m.attackTimer = Math.max(m.attackTimer, 0.3);
        }
      }
      break;
    }
    case 'breeze': {
      // bonds autour de la cible
      if (m.body.onGround && (m.ai.state === AIState.CHASE || m.ai.state === AIState.ATTACK) && Math.random() < dt * 0.8) {
        const a = Math.random() * Math.PI * 2;
        m.body.vy = 10;
        m.body.vx = Math.cos(a) * 4;
        m.body.vz = Math.sin(a) * 4;
        ctx.particles.burst('poof', m.x, m.y, m.z, 4);
      }
      break;
    }
    case 'evoker': {
      // invoque 3 vex quand il combat le joueur (toutes les 17 s)
      m.timer2 = (m.timer2 ?? 5) - dt;
      if (m.timer2 > 0 || (m.ai.state !== AIState.CHASE && m.ai.state !== AIState.ATTACK) || m.distToPlayer > 16) break;
      m.timer2 = 17;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const v = (m as unknown as { spawner: { spawnMob(k: string, x: number, y: number, z: number): Mob | null } }).spawner.spawnMob('vex', m.x + Math.cos(a), m.y + 1.5, m.z + Math.sin(a));
        if (v) v.anger = 60;
      }
      ctx.particles.burst('magic', m.x, m.y + 2, m.z, 20);
      ctx.audio.play('cast', { x: m.x, y: m.y, z: m.z });
      m.attackAnim = 1;
      break;
    }
  }
}
