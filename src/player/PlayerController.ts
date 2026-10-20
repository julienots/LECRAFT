import type { InputState } from '../input/InputState';
import type { Settings } from '../core/Settings';
import type { World } from '../world/World';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { enchLevel, unbreakingSaves } from '../inventory/Enchantments';
import type { Player } from './Player';
import { MOVE, PLAYER_HEIGHT, PLAYER_SNEAK_HEIGHT } from './PlayerPhysics';
import { GLIDE_TICK, canGlideWith, glideTick, rocketTick, rocketTicks, wallDamage } from './Elytra';

/** Vitesses de référence (blocs/s) du modèle continu des liquides : marche 4,317, sprint 5,612, accroupi 1,295. */
const WALK = 4.317;
const SPRINT = 5.612;
const SNEAK = 1.295;
const SWIM = 2.6;
const FLY = 10;
/** Nage rapide (sprint sous l'eau), comme le jeu de référence (~5,6 blocs/s). */
const SWIM_FAST = 5.6;
const LOW_HEIGHT = 0.6;

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
  /** Mouvement par ticks Java : temps accumulé, premier tick, collision horizontale du tick, délai de saut. */
  private moveAcc = 0;
  private started = false;
  private hitH = false;
  private jumpDelay = 0;
  private autoJump = false;
  private wasGround = false;
  private tickGround = false;
  private tickFriction = 0.6;

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
      b.gravity = 28;
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
    // sprint : faim > 6 (3 cuisses), vers l'avant, pas accroupi ni en utilisant un objet
    p.sprinting = i.sprint && my > 0.3 && !p.sneaking && !p.crawling && (p.hunger > 6 || p.creative || b.flying) && !(p.usingItem && !b.flying);
    // Furtivité (jambières) : on avance plus vite accroupi (30 % → +15 % par niveau)
    const swift = enchLevel(p.inventory.armor.legs, 'swift_sneak');
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const fx = -sin, fz = -cos, rx = cos, rz = -sin;
    const below = world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.05), Math.floor(b.z));
    const ox = b.x, oz = b.z, oy = b.y;

    if (b.inWater || b.inLava) {
      this.liquidMove(world, dt, mx, my, mag, swift, below);
    } else {
      // terre ferme, air, échelles, vol créatif : formules Java exactes, appliquées à chaque tick
      // (20 Hz) ; la position avance à chaque image avec la vitesse du tick en cours
      b.gravity = 0;
      this.moveAcc += dt;
      let n = 0;
      while (this.moveAcc >= MOVE.TICK - 1e-9) {
        this.moveAcc -= MOVE.TICK;
        if (++n <= 4) this.moveTick(world, mx, my, swift, fx, fz, rx, rz);
      }
      // bord : l'accroupissement empêche de tomber
      if (p.sneaking && b.onGround) {
        const nx = b.x + b.vx * dt, nz = b.z + b.vz * dt;
        if (!hasGround(world, b, nx, b.z)) b.vx = 0;
        if (!hasGround(world, b, b.x, nz)) b.vz = 0;
      }
      const vyBefore = b.vy;
      b.step(world, dt);
      if (b.collidedH) this.hitH = true;
      // atterrissage : rebond (slime, lit) et facteur de dégâts de chute du bloc
      if (b.onGround && !this.wasGround) {
        // la physique commune ne compte pas la dernière portion de chute (image d'atterrissage) : Java si
        if (vyBefore < 0 && !b.inWater && !b.onLadder && oy > b.y) b.landed += oy - b.y;
        this.land(world, vyBefore);
      }
      // Chute lente : la distance de chute est remise à zéro (aucun dégât)
      if (p.effects.level('slow_falling') && b.vy <= 0) b.fallDistance = 0;
      // fatigue : 0,1 par mètre en sprint au sol
      if (p.sprinting && b.onGround && !b.flying) p.addExhaustion(0.1 * Math.hypot(b.x - ox, b.z - oz));
    }
    this.wasGround = b.onGround;
    // feu : la lave enflamme 15 s, le feu 8 s ; l'eau éteint
    this.checkFire(world, p);

    // saut automatique (option mobile) : obstacle d'un bloc devant
    if (this.settings.autoJump && b.collidedH && b.onGround && mag > 0.3 && !p.sneaking) {
      const ahead = 0.6;
      const dx = fx * my + rx * mx, dz = fz * my + rz * mx, dl = Math.hypot(dx, dz) || 1;
      const ax = b.x + (dx / dl) * ahead, az = b.z + (dz / dl) * ahead;
      if (b.collides(world, ax, b.y + 0.05, az) && !b.collides(world, ax, b.y + 1.05, az) && !b.collides(world, b.x, b.y + 1.05, b.z)) this.autoJump = true;
    }

    // pas & balancement de la vue
    const moved = Math.hypot(b.x - ox, b.z - oz);
    if (b.onGround && moved > 0.001 && Math.abs(b.y - oy) < 1) {
      this.bobPhase += moved * 2.2;
      this.stepDistance += moved;
      if (this.stepDistance > 1.7) {
        this.stepDistance = 0;
        this.onStep(below);
      }
    }
  }

  /** Bloc sous les pieds qui règle la glissance (0,5 bloc plus bas, comme Java). */
  private frictionAt(world: World, b: { x: number; y: number; z: number }): number {
    const id = world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.5000001), Math.floor(b.z));
    if (id <= 0) return MOVE.BLOCK_FRICTION;
    return SLIPPERINESS[BlockRegistry.blocks[id].key] ?? MOVE.BLOCK_FRICTION;
  }

  /** Facteur de vitesse du bloc (sable des âmes, miel : 0,4), Agilité des âmes l'annule. */
  private speedFactorAt(world: World, p: Player): number {
    const b = p.body;
    const at = (dy: number) => world.getBlock(Math.floor(b.x), Math.floor(b.y + dy), Math.floor(b.z));
    let id = at(0.01);
    let f = id > 0 ? blockSpeedFactor(id) : 1;
    if (f === 1 && (id <= 0 || !BlockRegistry.liquid[id])) {
      id = at(-0.5000001);
      f = id > 0 ? blockSpeedFactor(id) : 1;
    }
    if (f < 1 && id > 0 && /^soul_(sand|soil)$/.test(BlockRegistry.blocks[id].key) && enchLevel(p.inventory.armor.feet, 'soul_speed')) return 1;
    return f;
  }

  /**
   * Un tick de mouvement (LivingEntity.aiStep + travel, Java 1.21), vitesses en blocs/tick :
   * 1) fin du tick précédent : gravité (0,08) et frottements (×0,98 vertical, ×0,91 en l'air,
   *    ×glissance·0,91 au sol) ; 2) saut ; 3) accélération des entrées pour le tick suivant.
   */
  private moveTick(world: World, mx: number, my: number, swift: number, fx: number, fz: number, rx: number, rz: number) {
    const p = this.player, b = p.body, i = this.input;
    let vx = b.vx / 20, vy = b.vy / 20, vz = b.vz / 20;
    const ladder = b.onLadder && !b.flying;
    // --- fin du tick précédent (après le déplacement) ---
    if (this.started) {
      if (ladder && (this.hitH || i.jump)) vy = MOVE.LADDER_UP;
      const lev = p.effects.level('levitation');
      if (b.flying) vy *= MOVE.FLY_VERTICAL_DRAG;
      else if (lev) vy = (vy + (0.05 * lev - vy) * 0.2) * MOVE.AIR_DRAG_Y;
      else vy = (vy - (vy <= 0 && p.effects.level('slow_falling') ? MOVE.SLOW_FALL_GRAVITY : MOVE.GRAVITY)) * MOVE.AIR_DRAG_Y;
      // Java évalue le sol et la glissance AVANT le déplacement du tick (même valeur que l'accélération)
      const sf = this.speedFactorAt(world, p);
      const f1 = this.tickGround ? this.tickFriction * MOVE.AIR_DRAG_XZ : MOVE.AIR_DRAG_XZ;
      vx *= sf * f1;
      vz *= sf * f1;
    }
    this.started = true;
    this.hitH = false;
    // vitesses infimes annulées (Java : < 0,003)
    if (Math.abs(vx) < 0.003) vx = 0;
    if (Math.abs(vz) < 0.003) vz = 0;
    if (Math.abs(vy) < 0.003 && !b.onGround) vy = 0;
    // --- saut ---
    const wantJump = (i.jump || this.autoJump) && !b.flying;
    this.autoJump = false;
    if (wantJump && b.onGround && this.jumpDelay === 0) {
      const below = world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.5000001), Math.floor(b.z));
      const factor = below > 0 && BlockRegistry.blocks[below].key === 'honey_block' ? 0.5 : 1;
      vy = Math.max(vy, MOVE.JUMP_POWER * factor + MOVE.JUMP_BOOST * p.effects.level('jump_boost'));
      if (p.sprinting) {
        vx += fx * MOVE.SPRINT_JUMP_BOOST;
        vz += fz * MOVE.SPRINT_JUMP_BOOST;
      }
      this.jumpDelay = MOVE.JUMP_DELAY;
      this.onJump();
      p.addExhaustion(p.sprinting ? 0.2 : 0.05);
    } else if (!wantJump) this.jumpDelay = 0;
    else if (this.jumpDelay > 0) this.jumpDelay--;
    // vol créatif : saut / accroupi = ±3 × vitesse de vol
    if (b.flying) vy += ((i.jump ? 1 : 0) - (i.sneak ? 1 : 0)) * MOVE.FLY_SPEED * 3;
    // --- accélération des entrées ---
    let fwd = my * MOVE.INPUT_SCALE, str = mx * MOVE.INPUT_SCALE;
    let k = 1;
    if (!b.flying && (p.sneaking || p.crawling)) k *= MOVE.SNEAK_MUL + 0.15 * swift;
    if (p.usingItem && !b.flying) k *= MOVE.USE_ITEM_MUL;
    if (p.slowTimer > 0) k *= 0.55;
    fwd *= k;
    str *= k;
    let speed: number;
    this.tickGround = b.onGround;
    this.tickFriction = this.frictionAt(world, b);
    if (b.flying) speed = MOVE.FLY_SPEED * (p.sprinting ? 2 : 1);
    else if (b.onGround) {
      // attribut de vitesse (sprint ×1,3, Rapidité/Lenteur) × 0,216 / glissance³
      const fr = this.tickFriction;
      let attr = MOVE.WALK_SPEED * (p.sprinting ? MOVE.SPRINT_MUL : 1) * p.effects.speedMul();
      const id = world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.5000001), Math.floor(b.z));
      const soul = id > 0 && /^soul_(sand|soil)$/.test(BlockRegistry.blocks[id].key) ? enchLevel(p.inventory.armor.feet, 'soul_speed') : 0;
      if (soul) attr += 0.03 * (1 + soul * 0.35);
      speed = attr * (0.21600002 / (fr * fr * fr));
    } else speed = p.sprinting ? MOVE.AIR_SPRINT_SPEED : MOVE.AIR_SPEED;
    const len2 = fwd * fwd + str * str;
    if (len2 > 1e-7) {
      const l = len2 > 1 ? Math.sqrt(len2) : 1;
      vx += ((fx * fwd + rx * str) / l) * speed;
      vz += ((fz * fwd + rz * str) / l) * speed;
    }
    // échelles : vitesse bornée, descente lente, accroupi = rester accroché
    if (ladder) {
      vx = Math.max(-MOVE.LADDER_CLAMP, Math.min(MOVE.LADDER_CLAMP, vx));
      vz = Math.max(-MOVE.LADDER_CLAMP, Math.min(MOVE.LADDER_CLAMP, vz));
      vy = Math.max(vy, -MOVE.LADDER_CLAMP);
      if (vy < 0 && p.sneaking) vy = 0;
    }
    b.vx = vx * 20;
    b.vy = Math.max(-78.4, vy * 20);
    b.vz = vz * 20;
  }

  /** Atterrissage : slime (rebond, pas de dégâts sauf accroupi), lit (rebond, ½ dégâts), botte de foin et miel (⅕). */
  private land(world: World, vyBefore: number) {
    const p = this.player, b = p.body;
    const id = world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.2), Math.floor(b.z));
    const key = id > 0 ? BlockRegistry.blocks[id].key : '';
    const bed = /_bed$|^bed$/.test(key);
    p.fallMultiplier = key === 'slime_block' ? (p.sneaking ? 1 : 0) : key === 'hay_block' || key === 'honey_block' ? 0.2 : bed ? 0.5 : key === 'pointed_dripstone' ? 2 : 1;
    if (!p.sneaking && vyBefore < 0 && (key === 'slime_block' || bed)) {
      b.vy = -vyBefore * (bed ? 0.66 : 1);
      b.onGround = false;
    }
  }

  /** Feu sur le joueur : lave (15 s), feu ou feu des âmes (8 s) ; l'eau l'éteint. */
  private checkFire(world: World, p: Player) {
    const b = p.body;
    if (b.inWater) {
      p.fireTicks = 0;
      return;
    }
    if (b.inLava) {
      p.setOnFire(300);
      return;
    }
    for (let y = Math.floor(b.y); y <= Math.floor(b.y + b.height - 0.01); y++) {
      const id = world.getBlock(Math.floor(b.x), y, Math.floor(b.z));
      if (id > 0 && /^(soul_)?fire$/.test(BlockRegistry.blocks[id].key)) {
        p.setOnFire(160);
        return;
      }
    }
  }

  /** Eau et lave : modèle continu historique (nage, nage rapide, plongée, sortie de l'eau). */
  private liquidMove(world: World, dt: number, mx: number, my: number, mag: number, swift: number, below: number) {
    const p = this.player, b = p.body, i = this.input;
    b.gravity = b.flying ? 0 : 28;
    this.started = false;
    this.moveAcc = 0;
    let speed = b.flying ? FLY * (p.sprinting ? 1.8 : 1) : p.sneaking || p.crawling ? SNEAK : p.sprinting ? SPRINT : WALK;
    if (swift && (p.sneaking || p.crawling)) speed *= (0.3 + 0.15 * swift) / 0.3;
    if (b.inWater || b.inLava) speed = b.inLava ? 1.5 : p.swimming ? (i.sprint ? SWIM_FAST : SWIM * 1.5) : SWIM * (p.sprinting ? 1.3 : 1);
    // Agilité aquatique (bottes) : la lenteur dans l'eau disparaît par tiers
    const ds = Math.min(3, enchLevel(p.inventory.armor.feet, 'depth_strider'));
    if (b.inWater && ds && !p.swimming) speed += ((p.sprinting ? SPRINT : WALK) - speed) * (ds / 3);
    // Grâce du dauphin : nage bien plus rapide
    if (b.inWater && p.effects.level('dolphins_grace')) speed *= 2.2;
    if (p.slowTimer > 0) speed *= 0.55;
    if (!b.flying) speed *= p.effects.speedMul();
    void below;
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const fx = -sin, fz = -cos, rx = cos, rz = -sin;
    const tvx = (fx * my + rx * mx) * speed, tvz = (fz * my + rz * mx) * speed;
    const accel = b.onGround || b.flying ? 18 : 6;
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
    } else {
      if (i.jump) b.vy = Math.min(b.vy + 22 * dt, 3.2);
      // accroupi : on plonge
      else if (i.sneak) b.vy = Math.max(b.vy - 18 * dt, -2.6);
      // à la surface sans toucher : on flotte (la tête reste hors de l'eau)
      else if (b.inWater && !b.headInWater && mag > 0.1) b.vy = Math.max(b.vy, 0);
    }
    // échelles immergées : montée à 2,35 blocs/s
    if (b.onLadder && !b.flying && (i.jump || (b.collidedH && mag > 0.1))) b.vy = 2.35;
    b.step(world, dt);
    // fatigue de nage : 0,01 par mètre
    if (b.inWater) p.addExhaustion(0.01 * Math.hypot(b.vx, b.vy, b.vz) * dt);
    // contre un bord en nageant : on se hisse hors de l'eau (comme un saut depuis l'eau)
    if ((b.inWater || b.inLava) && b.collidedH && mag > 0.3 && !b.flying && !i.sneak) {
      const fy = Math.floor(b.y + 0.2);
      const ax = Math.floor(b.x + (tvx / (speed || 1)) * 0.6), az = Math.floor(b.z + (tvz / (speed || 1)) * 0.6);
      // obstacle d'au plus un bloc au-dessus de la surface, avec de l'espace libre au-dessus
      if (!world.isSolid(ax, fy + 1, az) && !world.isSolid(ax, fy + 2, az)) b.vy = Math.max(b.vy, 5.2);
    }
  }
}

/** Glissance des blocs (Block.friction de Java) ; les autres valent 0,6. */
const SLIPPERINESS: Record<string, number> = { ice: 0.98, packed_ice: 0.98, frosted_ice: 0.98, blue_ice: 0.989, slime_block: 0.8 };
/** Facteur de vitesse des blocs (Block.speedFactor de Java). */
const SPEED_FACTOR: Record<string, number> = { soul_sand: 0.4, honey_block: 0.4 };
function blockSpeedFactor(id: number): number {
  const blk = BlockRegistry.blocks[id];
  const f = SPEED_FACTOR[blk.key];
  if (f !== undefined) return f;
  // blocs d'add-ons ou du jeu avec un ralentissement déclaré (0..1)
  const fr = BlockRegistry.liquid[id] ? 0 : blk.def.friction ?? 0;
  return fr > 0 ? 1 - fr * 0.5 : 1;
}

function hasGround(world: World, b: { halfWidth: number; y: number }, x: number, z: number) {
  const hw = b.halfWidth;
  for (const [ox, oz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw]]) if (world.isSolid(Math.floor(x + ox), Math.floor(b.y - 0.5), Math.floor(z + oz))) return true;
  return false;
}
