/**
 * Bot joueur du serveur : modèle de joueur (skin du pack), pseudo au-dessus de la tête, objet en
 * main, et comportements de « vrai joueur » réutilisables par les mini-jeux : se déplacer avec
 * la recherche de chemin, combattre (approche en sprint, coups critiques en sautant, esquive
 * latérale, recul et pomme dorée quand la vie est basse), construire des ponts, casser des blocs.
 * Le niveau (`skill`, 0..1) règle la précision, les réflexes et la cadence de clics.
 */
import * as THREE from 'three';
import { B } from '../blocks/BlockRegistry';
import type { GameContext } from '../core/GameContext';
import type { MobDef } from '../data/mobs';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { AIState } from '../ai/StateMachine';
import { Mob, type EntitySpawner } from '../entities/Mob';
import { extrudeIcon } from '../render/ItemExtrude';

/** Cible de combat : le joueur ou un autre bot. */
export interface Fighter {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dead: boolean;
}

const DEF: Omit<MobDef, 'key'> = {
  name: 'Joueur', category: 'neutral', health: 20, damage: 1, speed: 4.3, detectionRange: 48, attackRange: 3,
  attackCooldown: 0.5, width: 0.6, height: 1.8, drops: [], xp: 0, sounds: { idle: '', hurt: 'hurt', death: 'hurt' }, scale: 0.9,
};

const noop = { update: () => undefined };
const IDLE_HANDLERS = Object.fromEntries(Object.values(AIState).map((s) => [s, noop]));

/** Couleurs de rang (style des serveurs de mini-jeux). */
export const RANKS: { tag: string; color: string; weight: number }[] = [
  { tag: '', color: '§7', weight: 6 },
  { tag: '§a[VIP] ', color: '§a', weight: 3 },
  { tag: '§a[VIP§6+§a] ', color: '§a', weight: 2 },
  { tag: '§b[MVP] ', color: '§b', weight: 2 },
  { tag: '§b[MVP§c+§b] ', color: '§b', weight: 1 },
];

export class Bot extends Mob {
  /** Pseudo et rang (codes couleur §). */
  readonly botName: string;
  rank = RANKS[0];
  /** PNJ du hub (ouvre un jeu quand on le touche) : invulnérable et immobile. */
  npc: string | null = null;
  invulnerable = false;
  /** Réduction des dégâts par l'armure (1 = aucune). */
  armorFactor = 1;
  /** Arme tenue (id d'objet) et ressources. */
  weapon = '';
  blocks = 0;
  blockId: number = B.OAK_PLANKS;
  gapples = 0;
  /** Niveau 0..1 (précision, réflexes, cadence). */
  skill: number;
  kills = 0;
  /** Dernier attaquant (pour créditer les éliminations). */
  lastAttacker: Bot | 'player' | null = null;
  /** Comportement courant (fourni par le mini-jeu). */
  brain: ((b: Bot, ctx: GameContext, dt: number) => void) | null = null;
  private strafeDir = 1;
  private strafeTimer = 0;
  private retreat = 0;
  private eating = 0;
  private placeTimer = 0;
  private tag: THREE.Sprite;
  private item: THREE.Mesh;
  private itemShown = '';

  constructor(name: string, skin: string, skill: number, x: number, y: number, z: number, spawner: EntitySpawner) {
    super({ ...DEF, key: `bot:${skin}`, name }, -1, x, y, z, spawner, IDLE_HANDLERS);
    this.botName = name;
    this.skill = skill;
    this.persistent = true;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true }));
    this.tag.position.y = 2.25 / 0.9;
    this.tag.renderOrder = 5;
    this.object3d.add(this.tag);
    this.setTag(name);
    this.item = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ alphaTest: 0.1 }));
    this.item.position.set(-1 / 16, -10 / 16, 3 / 16);
    this.item.rotation.set(0, Math.PI / 2, 0);
    this.item.visible = false;
    this.model.parts.get('armR')?.[0]?.add(this.item);
  }

  /** Pseudo (ou titre de PNJ, sur deux lignes séparées par \n) affiché au-dessus de la tête. */
  setTag(text: string) {
    const lines = text.split('\n');
    const c = document.createElement('canvas');
    const fs = 28;
    const ctx = c.getContext('2d')!;
    ctx.font = `${fs}px monospace`;
    const plain = lines.map((l) => l.replace(/§./g, ''));
    c.width = Math.max(64, ...plain.map((l) => Math.ceil(ctx.measureText(l).width) + 16));
    c.height = lines.length * (fs + 8);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = `${fs}px monospace`;
    ctx.textBaseline = 'top';
    const COLORS: Record<string, string> = { '0': '#000', '1': '#00a', '2': '#0a0', '3': '#0aa', '4': '#a00', '5': '#a0a', '6': '#fa0', '7': '#aaa', '8': '#555', '9': '#55f', a: '#5f5', b: '#5ff', c: '#f55', d: '#f5f', e: '#ff5', f: '#fff' };
    lines.forEach((line, i) => {
      const w = ctx.measureText(plain[i]).width;
      let x = (c.width - w) / 2, color = '#fff';
      for (let k = 0; k < line.length; k++) {
        if (line[k] === '§' && k + 1 < line.length) {
          color = COLORS[line[++k]] ?? color;
          continue;
        }
        ctx.fillStyle = color;
        ctx.fillText(line[k], x, i * (fs + 8) + 4);
        x += ctx.measureText(line[k]).width;
      }
    });
    const m = this.tag.material;
    m.map?.dispose();
    m.map = new THREE.CanvasTexture(c);
    m.map.colorSpace = THREE.SRGBColorSpace;
    m.needsUpdate = true;
    const h = (lines.length * 0.28) / 0.9;
    this.tag.scale.set((h * c.width) / c.height, h, 1);
    this.tag.position.y = (2.1 + lines.length * 0.14) / 0.9;
  }

  /** Nom formaté pour le chat (rang + couleur). */
  get chatName() {
    return `${this.rank.tag}${this.rank.color}${this.botName}`;
  }

  get maxHealth() {
    return 20;
  }

  protected customUpdate(ctx: GameContext, dt: number) {
    this.placeTimer -= dt;
    this.strafeTimer -= dt;
    if (this.eating > 0) {
      this.eating -= dt;
      this.body.vx *= 0.6;
      this.body.vz *= 0.6;
      if (this.eating <= 0) {
        this.health = Math.min(20, this.health + 8);
        ctx.audio.play('eat', { x: this.x, y: this.y, z: this.z, volume: 0.6 });
      }
      return;
    }
    if (this.npc) {
      // PNJ : regarde le joueur
      const p = ctx.player;
      this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
      this.body.vx = this.body.vz = 0;
      return;
    }
    this.brain?.(this, ctx, dt);
    // objet en main
    const held = this.eating > 0 ? 'golden_apple' : this.weapon;
    if (held !== this.itemShown) this.showItem(ctx, held);
  }

  private showItem(ctx: GameContext, id: string) {
    this.itemShown = id;
    const mat = this.item.material as THREE.MeshBasicMaterial;
    if (!id || !ItemRegistry.has(id)) {
      this.item.visible = false;
      return;
    }
    const tex = (ctx as unknown as { iconTexture(i: string): THREE.Texture }).iconTexture(id);
    mat.map = tex;
    mat.needsUpdate = true;
    if (tex.image instanceof HTMLCanvasElement) {
      this.item.geometry.dispose();
      this.item.geometry = extrudeIcon(tex.image).scale(0.5, 0.5, 0.5);
    }
    this.item.visible = true;
  }

  render(ctx: GameContext, alpha: number, t: number) {
    super.render(ctx, alpha, t);
    const c = this.model.material.color;
    (this.item.material as THREE.MeshBasicMaterial).color.copy(c);
    this.tag.visible = !this.dead;
  }

  // ---------- comportements ----------

  /** Dégâts de l'arme tenue (poing : 1). */
  get attackDamage() {
    return Math.max(1, ItemRegistry.has(this.weapon) ? ItemRegistry.get(this.weapon)?.damage ?? 1 : 1);
  }

  /** Va vers (x, y, z) avec la recherche de chemin ; `sprint` : vitesse de course. */
  goTo(x: number, y: number, z: number, sprint = false) {
    return this.ai.navigateTo(x, y, z, sprint ? 1.3 : 1);
  }

  private faceTo(x: number, z: number) {
    this.yaw = Math.atan2(x - this.x, z - this.z);
  }

  /**
   * Combat rapproché contre `t`. `hit` applique les dégâts (le jeu sait si c'est le joueur ou
   * un bot). Retourne la distance à la cible.
   */
  fight(ctx: GameContext, t: Fighter, dt: number, hit: (dmg: number, kx: number, kz: number, crit: boolean) => void): number {
    const dx = t.x - this.x, dz = t.z - this.z, d = Math.hypot(dx, dz) || 0.01;
    const b = this.body;
    // vie basse : on recule et on mange une pomme dorée
    if (this.health <= 7 && this.gapples > 0 && this.retreat <= 0 && Math.random() < dt * 2) this.retreat = 1.2 + Math.random();
    if (this.retreat > 0) {
      this.retreat -= dt;
      this.ai.moveTowards(this.x - (dx / d) * 4, this.z - (dz / d) * 4, 1.3, true);
      if (this.retreat <= 0 && this.gapples > 0) {
        this.gapples--;
        this.eating = 1.6;
      }
      return d;
    }
    if (d > 3.2 || Math.abs(t.y - this.y) > 2.5) {
      this.goTo(t.x, t.y, t.z, d > 4);
      // saut d'approche : arrive en tombant pour placer un coup critique
      if (d < 5 && b.onGround && Math.random() < dt * 3 * this.skill) b.vy = 8.2;
      return d;
    }
    this.faceTo(t.x, t.z);
    // esquive latérale (change de sens régulièrement), garde ~2,4 blocs
    if (this.strafeTimer <= 0) {
      this.strafeTimer = 0.5 + Math.random() * (1.4 - this.skill * 0.6);
      this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }
    const keep = d < 1.8 ? -1 : d > 2.6 ? 1 : 0;
    const px = -dz / d, pz = dx / d;
    const sx = this.x + (dx / d) * keep * 2 + px * this.strafeDir * 2 * this.skill;
    const sz = this.z + (dz / d) * keep * 2 + pz * this.strafeDir * 2 * this.skill;
    this.ai.moveTowards(sx, sz, 1.1, true);
    // coup : cadence 6 à 10 clics/s selon le niveau ; précision selon le niveau
    if (this.attackTimer <= 0 && d <= 3.1) {
      this.attackTimer = 0.62 - this.skill * 0.2 + Math.random() * 0.12;
      this.attackAnim = 1;
      if (Math.random() < 0.55 + this.skill * 0.4) {
        const crit = !b.onGround && b.vy < -1;
        const dmg = this.attackDamage * (crit ? 1.5 : 1);
        hit(dmg, (dx / d) * 5, (dz / d) * 5, crit);
        if (crit) ctx.particles.burst('crit', t.x, t.y + 1.2, t.z, 10);
        ctx.audio.play(crit ? 'crit' : 'hit', { x: t.x, y: t.y, z: t.z });
      }
      // saut pour le coup critique suivant
      if (b.onGround && Math.random() < this.skill * 0.6) b.vy = 8.2;
    }
    return d;
  }

  /**
   * Avance vers (x, z) en posant des blocs sous ses pieds au-dessus du vide (pont), comme un
   * joueur accroupi au bord. Retourne la distance restante.
   */
  bridgeTo(ctx: GameContext, x: number, z: number, y: number): number {
    const w = ctx.world;
    const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz) || 0.01;
    const fy = y - 1;
    // case suivante dans la direction (et celle sous les pieds)
    for (const ahead of [0, 0.8]) {
      const cx = Math.floor(this.x + (dx / d) * ahead), cz = Math.floor(this.z + (dz / d) * ahead);
      if (w.getBlock(cx, fy, cz) === B.AIR && this.blocks > 0 && this.placeTimer <= 0) {
        w.setBlock(cx, fy, cz, this.blockId);
        this.blocks--;
        this.placeTimer = 0.28 - this.skill * 0.1;
        this.attackAnim = 1;
        ctx.audio.blockSound('place', 'wood', cx + 0.5, fy + 0.5, cz + 0.5);
      }
    }
    const below = w.getBlock(Math.floor(this.x + (dx / d) * 0.8), fy, Math.floor(this.z + (dz / d) * 0.8));
    // sans bloc devant : on s'arrête au bord
    if (below === B.AIR) {
      this.ai.stop();
      this.faceTo(x, z);
      return d;
    }
    this.ai.moveTowards(x, z, 0.75, false);
    return d;
  }

  /** Casse un bloc à portée (animation de bras, particules, son). */
  breakBlock(ctx: GameContext, x: number, y: number, z: number) {
    const w = ctx.world;
    const id = w.getBlock(x, y, z);
    if (id <= 0) return false;
    w.setBlock(x, y, z, B.AIR);
    ctx.particles.blockBreak(x, y, z, id);
    ctx.audio.blockSound('break', 'snow', x + 0.5, y + 0.5, z + 0.5);
    this.attackAnim = 1;
    this.faceTo(x + 0.5, z + 0.5);
    return true;
  }
}
