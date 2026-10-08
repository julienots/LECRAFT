import type { InputState } from '../input/InputState';
import type { Settings } from '../core/Settings';
import type { World } from '../world/World';
import { BlockRegistry } from '../blocks/BlockRegistry';
import type { Player } from './Player';
import { PLAYER_HEIGHT, PLAYER_SNEAK_HEIGHT } from './PlayerPhysics';

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

  update(world: World, dt: number) {
    const p = this.player;
    const b = p.body;
    const i = this.input;
    if (p.dead) {
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
    if (b.inWater || b.inLava) speed = b.inLava ? 1.5 : p.swimming ? (i.sprint ? SWIM_FAST : SWIM * 1.5) : SWIM * (p.sprinting ? 1.3 : 1);
    if (p.slowTimer > 0) speed *= 0.55;
    if (!b.flying) speed *= p.effects.speedMul();
    // friction du bloc sous les pieds
    const below = world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.05), Math.floor(b.z));
    if (below > 0 && BlockRegistry.blocks[below].def.friction) speed *= 1 - BlockRegistry.blocks[below].def.friction! * 0.5;
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
