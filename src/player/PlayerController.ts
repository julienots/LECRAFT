import type { InputState } from '../input/InputState';
import type { Settings } from '../core/Settings';
import type { World } from '../world/World';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { enchLevel, unbreakingSaves } from '../inventory/Enchantments';
import type { Player } from './Player';
import { PLAYER_HEIGHT, PLAYER_SNEAK_HEIGHT } from './PlayerPhysics';
import { GLIDE_TICK, canGlideWith, glideTick, rocketTick, rocketTicks, wallDamage } from './Elytra';

const WALK = 4.3;
const SPRINT = 5.8;
const SNEAK = 1.4;
const SWIM = 2.6;
const FLY = 10;
/** Nage rapide (sprint sous l'eau), comme le jeu de référence (~5,6 blocs/s). */
const SWIM_FAST = 5.6;
const LOW_HEIGHT = 0.6;
const JUMP_V = 8.6;

/** Transforme les entrées en mouvement : marche, sprint, accroupi, saut, nage, vol (créatif). */
export class PlayerController {
  private jumpWasDown = false;
  private lastJumpTap = 0;
  bobPhase = 0;
  stepDistance = 0;
  onStep: (blockBelow: number) => void = () => {};
  onJump: () => void = () => {};
  /** Vol plané en élytres (corps à l'horizontale, 0,6 bloc de haut). */
  gliding = false;
  /** Ticks de vol plané (usure des élytres) et ticks de poussée de fusée restants. */
  private glideTicks = 0;
  private rocketLeft = 0;
  private tickAcc = 0;

  constructor(private player: Player, private input: InputState, private settings: Settings) {}

  look() {
    const [dx, dy] = this.input.consumeLook();
    const p = this.player;
    p.yaw -= dx * 0.0042;
    p.pitch -= dy * 0.0042;
    const lim = Math.PI / 2 - 0.01;
    if (p.pitch > lim) p.pitch = lim;
    if (p.pitch < -lim) p.pitch = -lim;
  }

  private stopGliding() {
    this.gliding = false;
    this.rocketLeft = 0;
  }

  /**
   * Fusée d'artifice utilisée en vol plané : poussée vers le regard (~1 s pour une durée de vol 1).
   * Retourne vrai si l'objet a été consommé (la session l'appelle avant les autres usages).
   */
  useFirework(itemId: string): boolean {
    if (!this.gliding || itemId !== 'firework_rocket') return false;
    const p = this.player, inv = p.inventory;
    this.rocketLeft = rocketTicks(1);
    if (!p.creative) {
      const st = inv.selectedStack;
      if (st && st.id === itemId) {
        st.count--;
        if (st.count <= 0) inv.slots[inv.selected] = null;
        inv.changed();
      }
    }
    return true;
  }

  /** Physique du vol plané : formules Java par tick (blocs/tick), le déplacement reste par image. */
  private glide(world: World, dt: number) {
    const p = this.player, b = p.body;
    b.gravity = 0;
    p.sneaking = p.sprinting = p.swimming = p.crawling = false;
    // hitbox couchée (0,6 bloc), comme la nage
    b.height = 0.6;
    this.tickAcc += dt;
    const v = { x: b.vx / 20, y: b.vy / 20, z: b.vz / 20 };
    let ticked = false;
    while (this.tickAcc >= GLIDE_TICK) {
      this.tickAcc -= GLIDE_TICK;
      ticked = true;
      if (this.rocketLeft > 0) {
        this.rocketLeft--;
        rocketTick(v, p.yaw, p.pitch);
      }
      // Chute lente : gravité réduite en descente
      glideTick(v, p.yaw, p.pitch, v.y <= 0 && p.effects.level('slow_falling') ? 0.01 : 0.08);
      // usure : 1 point toutes les 20 ticks, jamais en dessous de 1 (élytres cassées)
      if (++this.glideTicks % 20 === 0 && !p.creative) {
        const st = p.inventory.armor.chest;
        if (st && st.durability !== undefined && st.durability > 1 && !unbreakingSaves(st, true)) {
          st.durability--;
          p.inventory.changed();
        }
      }
    }
    if (ticked) {
      b.vx = v.x * 20;
      b.vy = v.y * 20;
      b.vz = v.z * 20;
    }
    // la distance de chute ne compte qu'en piqué (Java : remise à 1 si vy > -0,5 bloc/tick)
    if (b.vy > -10) b.fallDistance = 1;
    const before = Math.hypot(b.vx, b.vz) / 20;
    b.step(world, dt);
    // choc contre un mur : dégâts selon la vitesse horizontale perdue
    if (b.collidedH) {
      const dmg = wallDamage(before, Math.hypot(b.vx, b.vz) / 20);
      if (dmg > 0) p.damage(dmg, 'fall');
    }
    if (b.onGround || b.inWater || b.inLava) this.stopGliding();
  }

  update(world: World, dt: number) {
    const p = this.player;
    const b = p.body;
    const i = this.input;
    if (p.dead) {
      if (this.gliding) this.stopGliding();
      b.vx *= 0.8;
      b.vz *= 0.8;
      b.step(world, dt);
      return;
    }
    // vol créatif : double appui sur saut
    const jumpPressed = i.jump && !this.jumpWasDown;
    if (jumpPressed && p.creative) {
      const now = performance.now();
      if (now - this.lastJumpTap < 300) {
        b.flying = !b.flying;
        b.vy = 0;
      }
      this.lastJumpTap = now;
    }
    this.jumpWasDown = i.jump;
    b.noClip = false;
    // élytres : saut en l'air pendant la chute → vol plané ; on s'arrête au sol, dans un liquide ou sans élytres
    const elytra = p.inventory.armor.chest;
    if (this.gliding && (b.onGround || b.inWater || b.inLava || b.flying || !canGlideWith(elytra))) this.stopGliding();
    else if (!this.gliding && jumpPressed && !b.onGround && !b.inWater && !b.inLava && !b.flying && !b.onLadder && b.vy < 0 && canGlideWith(elytra) && !p.effects.level('levitation')) {
      this.gliding = true;
      this.glideTicks = 0;
      this.tickAcc = 0;
    }
    p.gliding = this.gliding;
    if (this.gliding) return this.glide(world, dt);
    b.gravity = b.flying ? 0 : 28;

    let mag = Math.hypot(i.moveX, i.moveY);
    const mx = mag > 1 ? i.moveX / mag : i.moveX, my = mag > 1 ? i.moveY / mag : i.moveY;
    mag = Math.min(1, mag);
    // nage rapide : sprint avec la tête sous l'eau ; on rampe si le plafond empêche de se relever
    // sous l'eau, avancer suffit pour nager (sur mobile le sprint est difficile à tenir) ; le sprint nage plus vite
    p.swimming = !b.flying && b.inWater && (p.swimming ? b.inWater : b.headInWater) && my > 0.3 && (i.sprint || b.headInWater) && (p.hunger > 6 || p.creative || !i.sprint);
    const wantH = p.swimming ? LOW_HEIGHT : i.sneak && !b.flying ? PLAYER_SNEAK_HEIGHT : PLAYER_HEIGHT;
    if (wantH > b.height && b.collides(world, b.x, b.y, b.z, wantH)) {
      p.crawling = !(i.sneak && !b.collides(world, b.x, b.y, b.z, PLAYER_SNEAK_HEIGHT));
      b.height = p.crawling ? LOW_HEIGHT : PLAYER_SNEAK_HEIGHT;
    } else {
      p.crawling = false;
      b.height = wantH;
    }
    p.sneaking = i.sneak && !b.flying && !p.swimming && !p.crawling;
    p.sprinting = i.sprint && my > 0.3 && !p.sneaking && !p.crawling && (p.hunger > 6 || p.creative);
    let speed = b.flying ? FLY * (p.sprinting ? 1.8 : 1) : p.sneaking || p.crawling ? SNEAK : p.sprinting ? SPRINT : WALK;
    // Furtivité (jambières) : on avance plus vite accroupi (30 % → +15 % par niveau)
    const swift = enchLevel(p.inventory.armor.legs, 'swift_sneak');
    if (swift && (p.sneaking || p.crawling)) speed *= (0.3 + 0.15 * swift) / 0.3;
    if (b.inWater || b.inLava) speed = b.inLava ? 1.5 : p.swimming ? (i.sprint ? SWIM_FAST : SWIM * 1.5) : SWIM * (p.sprinting ? 1.3 : 1);
    // Agilité aquatique (bottes) : la lenteur dans l'eau disparaît par tiers
    const ds = Math.min(3, enchLevel(p.inventory.armor.feet, 'depth_strider'));
    if (b.inWater && ds && !p.swimming) speed += ((p.sprinting ? SPRINT : WALK) - speed) * (ds / 3);
    // Grâce du dauphin : nage bien plus rapide
    if (b.inWater && p.effects.level('dolphins_grace')) speed *= 2.2;
    if (p.slowTimer > 0) speed *= 0.55;
    if (!b.flying) speed *= p.effects.speedMul();
    // objet en cours d'utilisation (manger, boire, arc, bouclier) : 20 % de la vitesse, sans sprint
    if (p.usingItem && !b.flying && !b.inWater) {
      speed *= 0.2;
      p.sprinting = false;
    }
    // friction du bloc sous les pieds
    const below = world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.05), Math.floor(b.z));
    // Agilité des âmes (bottes) : plus de lenteur sur le sable et la terre des âmes, et un bonus
    const soul = below > 0 && /^soul_(sand|soil)$/.test(BlockRegistry.blocks[below].key) ? enchLevel(p.inventory.armor.feet, 'soul_speed') : 0;
    if (soul) speed *= 1.3 + 0.105 * soul;
    else if (below > 0 && BlockRegistry.blocks[below].def.friction) speed *= 1 - BlockRegistry.blocks[below].def.friction! * 0.5;
    // direction monde (yaw = rotation autour de Y, 0 = regarde vers -Z)
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const fx = -sin, fz = -cos, rx = cos, rz = -sin;
    const tvx = (fx * my + rx * mx) * speed, tvz = (fz * my + rz * mx) * speed;
    const accel = b.onGround || b.flying ? 18 : b.inWater ? 6 : 4;
    const k = 1 - Math.exp(-accel * dt);
    b.vx += (tvx - b.vx) * k;
    b.vz += (tvz - b.vz) * k;

    if (b.flying) {
      const tvy = (i.jump ? 1 : 0) * 8 - (i.sneak ? 1 : 0) * 8;
      b.vy += (tvy - b.vy) * (1 - Math.exp(-10 * dt));
    } else if (p.swimming) {
      // nage : on suit la direction du regard (monter / plonger)
      const cp = Math.cos(p.pitch);
      const tx = fx * cp * my * speed, ty = Math.sin(p.pitch) * my * speed, tz = fz * cp * my * speed;
      const ks = 1 - Math.exp(-6 * dt);
      b.vx += (tx + rx * mx * speed * 0.5 - b.vx) * ks;
      b.vz += (tz + rz * mx * speed * 0.5 - b.vz) * ks;
      b.vy += (ty - b.vy) * ks;
      b.vy += b.gravity * 0.18 * dt; // annule la gravité de l'eau appliquée par la physique
      if (i.jump) b.vy = Math.min(b.vy + 22 * dt, 3.2);
      else if (i.sneak) b.vy = Math.max(b.vy - 22 * dt, -3.2);
    } else if (b.inWater || b.inLava) {
      if (i.jump) b.vy = Math.min(b.vy + 22 * dt, 3.2);
      // accroupi : on plonge
      else if (i.sneak) b.vy = Math.max(b.vy - 18 * dt, -2.6);
      // à la surface sans toucher : on flotte (la tête reste hors de l'eau)
      else if (b.inWater && !b.headInWater && mag > 0.1) b.vy = Math.max(b.vy, 0);
    } else if (i.jump && b.onGround) {
      b.vy = JUMP_V * Math.sqrt(1 + 0.75 * p.effects.level('jump_boost'));
      // saut en sprint : élan vers l'avant (≈ 0,2 bloc/tick dans le jeu de référence)
      if (p.sprinting) {
        b.vx += fx * 4;
        b.vz += fz * 4;
      }
      this.onJump();
      p.addExhaustion(p.sprinting ? 0.2 : 0.05);
    }

    // échelles : monter (saut ou marche contre l'échelle), rester accroché (accroupi), descente lente
    if (b.onLadder && !b.flying && !b.inWater) {
      if (i.jump || (b.collidedH && mag > 0.1)) b.vy = 2.35 + b.gravity * dt;
      else if (p.sneaking) b.vy = b.gravity * dt;
      else b.vy = Math.max(b.vy, -2.35);
    }

    // bord : l'accroupissement empêche de tomber
    if (p.sneaking && b.onGround) {
      const nx = b.x + b.vx * dt, nz = b.z + b.vz * dt;
      if (!hasGround(world, b, nx, b.z)) b.vx = 0;
      if (!hasGround(world, b, b.x, nz)) b.vz = 0;
    }

    const ox = b.x, oz = b.z;
    b.step(world, dt);
    // contre un bord en nageant : on se hisse hors de l'eau (comme un saut depuis l'eau)
    if ((b.inWater || b.inLava) && b.collidedH && mag > 0.3 && !b.flying && !i.sneak) {
      const fy = Math.floor(b.y + 0.2);
      const ax = Math.floor(b.x + (tvx / (speed || 1)) * 0.6), az = Math.floor(b.z + (tvz / (speed || 1)) * 0.6);
      // obstacle d'au plus un bloc au-dessus de la surface, avec de l'espace libre au-dessus
      if (!world.isSolid(ax, fy + 1, az) && !world.isSolid(ax, fy + 2, az)) b.vy = Math.max(b.vy, 5.2);
    }

    // saut automatique (option mobile) : obstacle d'un bloc devant
    if (this.settings.autoJump && b.collidedH && b.onGround && mag > 0.3 && !p.sneaking) {
      const ahead = 0.6;
      const ax = b.x + (tvx / (speed || 1)) * ahead, az = b.z + (tvz / (speed || 1)) * ahead;
      if (b.collides(world, ax, b.y + 0.05, az) && !b.collides(world, ax, b.y + 1.05, az) && !b.collides(world, b.x, b.y + 1.05, b.z)) {
        b.vy = JUMP_V * Math.sqrt(1 + 0.75 * p.effects.level('jump_boost'));
      }
    }

    // pas & balancement de la vue
    const moved = Math.hypot(b.x - ox, b.z - oz);
    if (b.onGround && moved > 0.001) {
      this.bobPhase += moved * 2.2;
      this.stepDistance += moved;
      if (this.stepDistance > 1.7) {
        this.stepDistance = 0;
        this.onStep(below);
      }
    }
  }
}

function hasGround(world: World, b: { halfWidth: number; y: number }, x: number, z: number) {
  const hw = b.halfWidth;
  for (const [ox, oz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) if (world.isSolid(Math.floor(x + ox), Math.floor(b.y - 0.5), Math.floor(z + oz))) return true;
  return false;
}
