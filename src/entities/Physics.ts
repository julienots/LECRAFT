import { BlockRegistry } from '../blocks/BlockRegistry';
import type { World } from '../world/World';

const EPS = 0.001;

/**
 * Corps physique AABB (position = centre des pieds) avec collisions voxel par axe.
 * Gère gravité, liquides (flottaison/ralentissement), sol, et contact avec blocs dangereux.
 */
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
  collidedH = false;
  /** Distance de chute accumulée (dégâts de chute). */
  fallDistance = 0;
  gravity = 28;
  noClip = false;

  constructor(public halfWidth = 0.3, public height = 1.8) {}

  setPos(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /** Vrai si l'AABB à la position donnée chevauche un bloc solide. */
  collides(world: World, x: number, y: number, z: number): boolean {
    const hw = this.halfWidth;
    const x0 = Math.floor(x - hw + EPS), x1 = Math.floor(x + hw - EPS);
    const y0 = Math.floor(y + EPS), y1 = Math.floor(y + this.height - EPS);
    const z0 = Math.floor(z - hw + EPS), z1 = Math.floor(z + hw - EPS);
    for (let by = y0; by <= y1; by++) for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) if (world.isSolid(bx, by, bz)) return true;
    return false;
  }

  /** Bloc liquide au niveau d'une hauteur relative du corps. */
  private liquidAt(world: World, dy: number): number {
    const b = world.getBlock(Math.floor(this.x), Math.floor(this.y + dy), Math.floor(this.z));
    return b < 0 ? 0 : BlockRegistry.liquid[b];
  }

  updateEnvironment(world: World) {
    const feet = this.liquidAt(world, 0.1), mid = this.liquidAt(world, this.height * 0.5);
    this.inWater = feet === 1 || mid === 1;
    this.inLava = feet === 2 || mid === 2;
    this.headInWater = this.liquidAt(world, this.height * 0.9) === 1;
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
        if (this.vy < -55) this.vy = -55;
      }
    }
    const tdx = this.vx * dt, tdy = this.vy * dt, tdz = this.vz * dt;
    if (this.noClip) {
      this.x += tdx;
      this.y += tdy;
      this.z += tdz;
      return;
    }
    const wasGround = this.onGround;
    this.onGround = false;
    this.collidedH = false;
    // sous-pas pour éviter de traverser les blocs à grande vitesse
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(tdx), Math.abs(tdy), Math.abs(tdz)) / 0.4));
    const dx = tdx / n, dy = tdy / n, dz = tdz / n;
    for (let i = 0; i < n; i++) {
      if (dy !== 0 && this.vy !== 0) {
        const ny = this.y + dy;
        if (this.collides(world, this.x, ny, this.z)) {
          const prev = this.y;
          this.y = dy < 0 ? Math.floor(ny) + 1 : Math.floor(ny + this.height) - this.height - EPS;
          if (this.collides(world, this.x, this.y, this.z)) this.y = prev;
          if (dy < 0) this.onGround = true;
          this.vy = 0;
        } else this.y = ny;
      }
      if (dx !== 0 && this.vx !== 0) {
        const nx = this.x + dx;
        if (this.collides(world, nx, this.y, this.z)) {
          const prev = this.x;
          this.x = dx > 0 ? Math.floor(nx + this.halfWidth) - this.halfWidth - EPS : Math.floor(nx - this.halfWidth) + 1 + this.halfWidth + EPS;
          if (this.collides(world, this.x, this.y, this.z)) this.x = prev;
          this.vx = 0;
          this.collidedH = true;
        } else this.x = nx;
      }
      if (dz !== 0 && this.vz !== 0) {
        const nz = this.z + dz;
        if (this.collides(world, this.x, this.y, nz)) {
          const prev = this.z;
          this.z = dz > 0 ? Math.floor(nz + this.halfWidth) - this.halfWidth - EPS : Math.floor(nz - this.halfWidth) + 1 + this.halfWidth + EPS;
          if (this.collides(world, this.x, this.y, this.z)) this.z = prev;
          this.vz = 0;
          this.collidedH = true;
        } else this.z = nz;
      }
    }
    // sol sous les pieds (même sans mouvement vertical)
    if (!this.onGround && this.vy <= 0 && this.collides(world, this.x, this.y - 0.02, this.z)) this.onGround = true;
    if (this.onGround) {
      if (!wasGround) this.landed = this.fallDistance;
      this.fallDistance = 0;
    } else if (this.vy < 0 && !this.inWater) this.fallDistance -= tdy;
    if (this.inWater) this.fallDistance = 0;
  }

  /** Distance de chute à l'atterrissage (lue puis remise à 0 par le propriétaire). */
  landed = 0;
}
