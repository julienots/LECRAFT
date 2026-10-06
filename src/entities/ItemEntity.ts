import * as THREE from 'three';
import type { GameContext } from '../core/GameContext';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { Entity } from './Entity';

/** Nombre de modèles affichés pour une pile (comme l'édition Java). */
function copiesFor(count: number) {
  return count > 48 ? 5 : count > 32 ? 4 : count > 16 ? 3 : count > 1 ? 2 : 1;
}

/**
 * Objet tombé au sol, comme dans l'édition Java : flotte et tourne, fusionne avec les piles
 * identiques voisines, est ramassé quand le joueur passe à environ un bloc (il vole alors vers lui),
 * est éclairé par la lumière du monde et affiche 1 à 5 modèles selon la taille de la pile.
 */
export class ItemEntity extends Entity {
  readonly kind = 'item' as const;
  object3d = new THREE.Group();
  pickupDelay = 0.6;
  /** Animation de ramassage en cours : temps restant (s). */
  collecting = 0;
  private target = new THREE.Vector3();
  private from = new THREE.Vector3();
  /** Décalage de rotation et de flottement propre à chaque objet (comme bobOffs en Java). */
  private bobOffs = Math.random() * Math.PI * 2;
  private mats: THREE.MeshBasicMaterial[];
  private shown = 0;
  private brightness = 1;
  private mergeTimer = Math.random() * 0.5;

  constructor(public itemId: string, public count: number, x: number, y: number, z: number, private mesh: THREE.Mesh, public durability?: number) {
    super(0.125, 0.25);
    this.body.setPos(x, y, z);
    this.body.vx = (Math.random() - 0.5) * 3;
    this.body.vz = (Math.random() - 0.5) * 3;
    this.body.vy = 4;
    // matériaux propres à l'objet (la texture reste partagée) pour l'éclairer selon l'endroit
    const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    this.mats = src.map((m) => (m as THREE.MeshBasicMaterial).clone());
    mesh.material = Array.isArray(mesh.material) ? this.mats : this.mats[0];
    this.syncCopies();
  }

  get half() {
    return (this.mesh.userData.half as number | undefined) ?? 0.2;
  }

  /** Ajuste le nombre de modèles affichés à la taille de la pile. */
  syncCopies() {
    const n = copiesFor(this.count);
    if (n === this.shown) return;
    this.shown = n;
    this.object3d.clear();
    const flat = this.half > 0.2;
    for (let i = 0; i < n; i++) {
      const m = i === 0 ? this.mesh : this.mesh.clone();
      // décalages pseudo-aléatoires stables, comme le rendu Java (plus serrés pour les objets plats)
      const r = (k: number) => (Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453) % 1;
      if (i > 0) m.position.set(r(1) * (flat ? 0.08 : 0.15), r(2) * 0.15, flat ? -0.03 * i : r(3) * 0.15);
      this.object3d.add(m);
    }
  }

  /** Commence l'animation de ramassage (l'objet vole vers le joueur en 3 ticks). */
  collect(ctx: GameContext) {
    this.collecting = 0.15;
    this.from.copy(this.object3d.position);
    const p = ctx.player;
    this.target.set(p.x, p.y + 0.5, p.z);
  }

  /** Fusionne avec une pile identique voisine (même objet, sans usure), comme le jeu original. */
  tryMerge(others: ItemEntity[], dt: number) {
    this.mergeTimer -= dt;
    if (this.mergeTimer > 0 || this.collecting > 0 || this.removed || this.durability !== undefined) return;
    this.mergeTimer = 0.5;
    const max = ItemRegistry.maxStack(this.itemId);
    if (this.count >= max) return;
    for (const o of others) {
      if (o === this || o.removed || o.collecting > 0 || o.itemId !== this.itemId || o.durability !== undefined) continue;
      if (Math.abs(o.body.x - this.body.x) > 0.75 || Math.abs(o.body.z - this.body.z) > 0.75 || Math.abs(o.body.y - this.body.y) > 0.25) continue;
      // la plus grosse pile absorbe la plus petite
      const [big, small] = this.count >= o.count ? [this, o] : [o, this];
      const moved = Math.min(small.count, max - big.count);
      if (moved <= 0) continue;
      big.count += moved;
      small.count -= moved;
      big.pickupDelay = Math.max(big.pickupDelay, small.pickupDelay);
      if (small.count <= 0) small.removed = true;
      big.syncCopies();
      small.syncCopies();
      if (this.removed) return;
    }
  }

  update(ctx: GameContext, dt: number) {
    if (this.collecting > 0) {
      this.collecting -= dt;
      const p = ctx.player;
      this.target.set(p.x, p.y + 0.5, p.z);
      if (this.collecting <= 0) this.removed = true;
      return;
    }
    this.age += dt;
    this.pickupDelay -= dt;
    if (this.age > 300) {
      this.removed = true;
      return;
    }
    const b = this.body;
    if (b.onGround) {
      b.vx *= 0.8;
      b.vz *= 0.8;
    }
    b.step(ctx.world, dt);
    // lumière du monde (comme les créatures)
    const l = ctx.world.getLight(Math.floor(b.x), Math.floor(b.y + 0.2), Math.floor(b.z));
    const sky = (l.sky / 15) * ctx.dayCycle.daylight, blk = l.block / 15;
    this.brightness = Math.max(ctx.dimension === 'nether' ? 0.45 : ctx.dimension === 'end' ? 0.6 : 0.12, Math.pow(Math.max(sky, blk), 1.3));
  }

  /** Le joueur est-il assez près pour ramasser (boîte du joueur élargie de 1 × 0,5 × 1, comme en Java) ? */
  inPickupRange(px: number, py: number, pz: number, height: number) {
    const b = this.body;
    return Math.abs(b.x - px) < 1.425 && Math.abs(b.z - pz) < 1.425 && b.y + 0.25 > py - 0.5 && b.y < py + height + 0.5;
  }

  syncObject(t: number) {
    const b = this.body;
    for (const m of this.mats) m.color.setScalar(this.brightness);
    if (this.collecting > 0) {
      const k = 1 - Math.max(0, this.collecting) / 0.15;
      this.object3d.position.lerpVectors(this.from, this.target, k * k);
      return;
    }
    // flotte (sin(âge/10 ticks) × 0,1 + 0,1) et tourne d'un radian par seconde, comme l'édition Java
    this.object3d.position.set(b.x, b.y + this.half + 0.1 + Math.sin(t * 2 + this.bobOffs) * 0.1, b.z);
    this.object3d.rotation.y = t + this.bobOffs;
  }

  dispose() {
    // seuls les matériaux clonés sont propres à l'objet (géométrie et textures partagées)
    for (const m of this.mats) m.dispose();
  }
}
