import { BlockRegistry } from '../blocks/BlockRegistry';
import { collisionBoxes } from '../blocks/Shapes';
import type { World } from '../world/World';

const EPS = 1e-7;

/** Boîtes de collision monde (en blocs) d'une zone. Les chunks non chargés sont pleins. */
export function gatherBoxes(world: World, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: number[] = []): number[] {
  out.length = 0;
  const R = BlockRegistry;
  for (let by = Math.floor(y0); by <= Math.floor(y1); by++)
    for (let bz = Math.floor(z0); bz <= Math.floor(z1); bz++)
      for (let bx = Math.floor(x0); bx <= Math.floor(x1); bx++) {
        const id = world.getBlock(bx, by, bz);
        if (id === 0) continue;
        if (id < 0) {
          out.push(bx, by, bz, bx + 1, by + 1, bz + 1);
          continue;
        }
        if (R.shape[id]) {
          const meta = world.getMeta(bx, by, bz);
          for (const b of collisionBoxes(id, meta, (dx, dy, dz) => Math.max(0, world.getBlock(bx + dx, by + dy, bz + dz))))
            out.push(bx + b[0] / 16, by + b[1] / 16, bz + b[2] / 16, bx + b[3] / 16, by + b[4] / 16, bz + b[5] / 16);
        } else if (R.solid[id]) out.push(bx, by, bz, bx + 1, by + 1, bz + 1);
      }
  return out;
}

/**
 * Corps physique AABB (position = centre des pieds) avec collisions par boîtes (formes de blocs),
 * balayage par axe façon vanilla et montée automatique des marches (dalles, escaliers).
 */
let WEB = -1;

export class PhysicsBody {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  onGround = false;
  inWater = false;
  inLava = false;
  headInWater = false;
  onLadder = false;
  collidedH = false;
  /** Distance de chute accumulée (dégâts de chute). */
  fallDistance = 0;
  gravity = 32;
  noClip = false;
  /** Hauteur de marche franchie automatiquement (0,6 bloc comme le jeu vanilla). */
  stepHeight = 0.6;
  private boxes: number[] = [];

  constructor(public halfWidth = 0.3, public height = 1.8) {}

  setPos(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /** Vrai si l'AABB à la position donnée chevauche une boîte de collision. */
  collides(world: World, x: number, y: number, z: number): boolean {
    const hw = this.halfWidth;
    const b = gatherBoxes(world, x - hw, y, z - hw, x + hw, y + this.height, z + hw, this.boxes);
    for (let i = 0; i < b.length; i += 6)
      if (b[i] < x + hw - EPS && b[i + 3] > x - hw + EPS && b[i + 1] < y + this.height - EPS && b[i + 4] > y + EPS && b[i + 2] < z + hw - EPS && b[i + 5] > z - hw + EPS) return true;
    return false;
  }

  private liquidAt(world: World, dy: number): number {
    const b = world.getBlock(Math.floor(this.x), Math.floor(this.y + dy), Math.floor(this.z));
    return b < 0 ? 0 : BlockRegistry.liquid[b];
  }

  updateEnvironment(world: World) {
    const feet = this.liquidAt(world, 0.1), mid = this.liquidAt(world, this.height * 0.5);
    this.inWater = feet === 1 || mid === 1;
    this.inLava = feet === 2 || mid === 2;
    this.headInWater = this.liquidAt(world, this.height * 0.9) === 1;
    const lb = world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.2), Math.floor(this.z));
    const lb2 = world.getBlock(Math.floor(this.x), Math.floor(this.y + 1), Math.floor(this.z));
    this.onLadder = (lb > 0 && BlockRegistry.climbable[lb] === 1) || (lb2 > 0 && BlockRegistry.climbable[lb2] === 1);
    if (WEB < 0 && BlockRegistry.has('cobweb')) WEB = BlockRegistry.byName('cobweb').id;
    this.inWeb = WEB > 0 && (lb === WEB || lb2 === WEB);
  }
  /** Dans une toile d'araignée : déplacements fortement ralentis. */
  inWeb = false;

  /** Déplacement balayé par axe ; retourne les déplacements effectifs. */
  private sweep(world: World, dx: number, dy: number, dz: number): [number, number, number] {
    const hw = this.halfWidth, h = this.height;
    let x0 = this.x - hw, x1 = this.x + hw, y0 = this.y, y1 = this.y + h, z0 = this.z - hw, z1 = this.z + hw;
    const b = gatherBoxes(world, Math.min(x0, x0 + dx) - 0.01, Math.min(y0, y0 + dy) - 0.01, Math.min(z0, z0 + dz) - 0.01, Math.max(x1, x1 + dx) + 0.01, Math.max(y1, y1 + dy) + 0.01, Math.max(z1, z1 + dz) + 0.01, this.boxes);
    // Y
    for (let i = 0; i < b.length; i += 6) {
      if (b[i + 3] <= x0 + EPS || b[i] >= x1 - EPS || b[i + 5] <= z0 + EPS || b[i + 2] >= z1 - EPS) continue;
      if (dy < 0 && b[i + 4] <= y0 + EPS) dy = Math.max(dy, b[i + 4] - y0);
      else if (dy > 0 && b[i + 1] >= y1 - EPS) dy = Math.min(dy, b[i + 1] - y1);
    }
    y0 += dy; y1 += dy;
    // X
    for (let i = 0; i < b.length; i += 6) {
      if (b[i + 4] <= y0 + EPS || b[i + 1] >= y1 - EPS || b[i + 5] <= z0 + EPS || b[i + 2] >= z1 - EPS) continue;
      if (dx < 0 && b[i + 3] <= x0 + EPS) dx = Math.max(dx, b[i + 3] - x0);
      else if (dx > 0 && b[i] >= x1 - EPS) dx = Math.min(dx, b[i] - x1);
    }
    x0 += dx; x1 += dx;
    // Z
    for (let i = 0; i < b.length; i += 6) {
      if (b[i + 4] <= y0 + EPS || b[i + 1] >= y1 - EPS || b[i + 3] <= x0 + EPS || b[i] >= x1 - EPS) continue;
      if (dz < 0 && b[i + 5] <= z0 + EPS) dz = Math.max(dz, b[i + 5] - z0);
      else if (dz > 0 && b[i + 2] >= z1 - EPS) dz = Math.min(dz, b[i + 2] - z1);
    }
    return [dx, dy, dz];
  }

  step(world: World, dt: number) {
    this.updateEnvironment(world);
    if (!this.noClip) {
      if (this.inWater || this.inLava) {
        const drag = this.inLava ? 0.5 : 0.8;
        this.vy -= this.gravity * 0.18 * dt;
        this.vy *= Math.pow(drag, dt * 10);
        if (this.vy < -3) this.vy = -3;
      } else {
        this.vy -= this.gravity * dt;
        if (this.vy < -78) this.vy = -78;
      }
    }
    if (this.inWeb) this.vy = Math.max(-2, Math.min(this.vy, 2));
    const web = this.inWeb && !this.noClip ? 0.25 : 1;
    const tdx = this.vx * dt * web, tdy = this.vy * dt * (this.inWeb ? 0.05 : 1), tdz = this.vz * dt * web;
    if (this.noClip) {
      this.x += tdx;
      this.y += tdy;
      this.z += tdz;
      return;
    }
    const wasGround = this.onGround;
    this.onGround = false;
    this.collidedH = false;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(tdx), Math.abs(tdy), Math.abs(tdz)) / 0.45));
    for (let i = 0; i < n; i++) {
      const wx = tdx / n, wy = tdy / n, wz = tdz / n;
      let [mx, my, mz] = this.sweep(world, wx, wy, wz);
      const blockedH = Math.abs(mx - wx) > 1e-6 || Math.abs(mz - wz) > 1e-6;
      // montée de marche (dalles, escaliers, chemins)
      if (blockedH && (wasGround || this.onGround || (wy < 0 && my > wy)) && this.stepHeight > 0) {
        const sx = this.x, sy = this.y, sz = this.z;
        const up = this.sweep(world, 0, this.stepHeight, 0)[1];
        this.y += up;
        const [ax, , az] = this.sweep(world, wx, 0, wz);
        this.x += ax;
        this.z += az;
        const down = this.sweep(world, 0, -up - 0.01, 0)[1];
        this.y += down;
        if (ax * ax + az * az > mx * mx + mz * mz + 1e-9 && down > -up - 0.01 + 1e-6) {
          mx = ax;
          mz = az;
          my = 0;
          this.onGround = true;
          this.x = sx; this.y = sy + up + down; this.z = sz;
          this.y -= my;
        } else {
          this.x = sx; this.y = sy; this.z = sz;
        }
      }
      if (Math.abs(my - wy) > 1e-9) {
        if (wy < 0) this.onGround = true;
        this.vy = 0;
      }
      if (Math.abs(mx - wx) > 1e-6) {
        this.vx = 0;
        this.collidedH = true;
      }
      if (Math.abs(mz - wz) > 1e-6) {
        this.vz = 0;
        this.collidedH = true;
      }
      this.x += mx;
      this.y += my;
      this.z += mz;
    }
    if (!this.onGround && this.vy <= 0 && this.collides(world, this.x, this.y - 0.02, this.z)) this.onGround = true;
    if (this.onGround) {
      if (!wasGround) this.landed = this.fallDistance;
      this.fallDistance = 0;
    } else if (this.vy < 0 && !this.inWater && !this.onLadder) this.fallDistance -= tdy;
    if (this.inWater || this.onLadder) this.fallDistance = 0;
  }

  /** Distance de chute à l'atterrissage (lue puis remise à 0 par le propriétaire). */
  landed = 0;
}
