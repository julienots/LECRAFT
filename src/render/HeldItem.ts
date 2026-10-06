import * as THREE from 'three';
import { BlockRegistry } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { TextureManager } from './TextureManager';
import { cachedCube } from './MobModels';
import { extrudeIcon } from './ItemExtrude';

const D = Math.PI / 180;
const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Y = new THREE.Vector3(0, 1, 0), AXIS_Z = new THREE.Vector3(0, 0, 1);

/** Pose « première personne, main droite » des modèles du jeu original (degrés, pixels, échelle). */
interface Display {
  rot: [number, number, number];
  t: [number, number, number];
  s: number;
}
/** Bloc plein (block/block.json). */
const BLOCK_DISPLAY: Display = { rot: [0, 45, 0], t: [0, 0, 0], s: 0.4 };
/** Objet et outil (item/generated.json, item/handheld.json) : épée en diagonale, face visible. */
const ITEM_DISPLAY: Display = { rot: [0, -90, 25], t: [1.13, 3.2, 1.13], s: 0.68 };
/** Position du bras droit dans la vue (applyItemArmTransform du jeu original). */
const ARM_POS: [number, number, number] = [0.56, -0.52, -0.72];

/**
 * Objet tenu en main (vue à la première personne), rendu dans une scène dédiée au-dessus du monde,
 * avec les transformations de l'édition Java : position du bras, pose de l'objet (bloc tourné de 45°,
 * outils et objets en modèle 3D extrudé d'un pixel d'épaisseur, tenus en biais) et animation de coup.
 */
export class HeldItem {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Bras et animation de coup. */
  private holder = new THREE.Group();
  /** Pose d'affichage de l'objet courant. */
  private pose = new THREE.Group();
  private current = '';
  private obj: THREE.Object3D | null = null;
  private cache = new Map<string, THREE.Object3D>();
  private textures = new Map<number, THREE.Texture>();
  private tint = new THREE.Color(1, 1, 1);
  private mats: THREE.MeshBasicMaterial[] = [];
  private q = new THREE.Quaternion();
  private mat = new THREE.Matrix4();
  private tmpM = new THREE.Matrix4();
  private tq = new THREE.Quaternion();

  constructor(private tm: TextureManager) {
    // le jeu original dessine la main avec un champ de vision fixe de 70°
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.holder.add(this.pose);
    this.scene.add(this.holder);
    // lumière de la main (deux sources fixes, comme l'éclairage des objets du jeu original)
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.3, 1, 0.6);
    this.scene.add(sun);
  }

  private tileTex(i: number): THREE.Texture {
    let t = this.textures.get(i);
    if (!t) {
      t = new THREE.CanvasTexture(this.tm.tile(i, BlockRegistry.blocks.find((b) => b.faceTiles.includes(i) && (b.key.endsWith('leaves') || b.key === 'grass_block' || b.key === 'short_grass')) ? [124, 189, 74] : undefined));
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
      this.textures.set(i, t);
    }
    return t;
  }

  /**
   * Bras droit du joueur (skin du pack ou générée, UV du modèle 64×64), dans le repère brut du modèle
   * du jeu original (y vers le bas) : pivot de l'épaule (−5, 2, 0) px.
   */
  private makeArm(): THREE.Object3D {
    // ombrage par face comme le jeu original (dessus clair, côtés plus sombres)
    const m = new THREE.MeshLambertMaterial({ map: this.tm.skin('player'), alphaTest: 0.3, side: THREE.DoubleSide });
    m.userData.sharedMap = true; // skin partagée : ne pas la libérer ici
    this.mats.push(m as unknown as THREE.MeshBasicMaterial);
    const geo = cachedCube({ uv: [40, 16], box: [-3, -2, -2, 4, 12, 4], pivot: [0, 0, 0] }, 64, 64).clone();
    geo.computeVertexNormals();
    const arm = new THREE.Mesh(geo, m);
    // la géométrie est convertie (x, −y, −z) : on revient au repère brut du modèle
    arm.scale.set(1, -1, -1);
    arm.position.set(-5 / 16, 2 / 16, 0);
    arm.name = 'arm';
    return arm;
  }

  /** Modèle de l'objet : cube pour un bloc plein, modèle extrudé (1 px) à partir de l'icône sinon. */
  private makeItem(id: string): THREE.Mesh | null {
    const def = ItemRegistry.get(id);
    if (!id || !def) return null;
    if ('block' in def.icon) {
      const b = BlockRegistry.byName(def.icon.block);
      if (!this.tm.flatIcon(b)) {
        const mats = [0, 1, 2, 3, 4, 5].map((f) => {
          const m = new THREE.MeshBasicMaterial({ map: this.tileTex(b.faceTiles[f]), transparent: b.render !== 'cube', alphaTest: 0.3 });
          this.mats.push(m);
          return m;
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats);
        mesh.userData.block = true;
        return mesh;
      }
    }
    const canvas = this.tm.iconCanvas(id);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.1 });
    this.mats.push(m);
    const mesh = new THREE.Mesh(extrudeIcon(canvas), m);
    mesh.name = 'item3d';
    return mesh;
  }

  /**
   * Main vide : le bras seul. Objet : modèle posé comme dans le jeu original (pose « première
   * personne »), avec le bras visible dont le poing tient la poignée de l'objet.
   */
  private build(id: string): THREE.Object3D {
    const g = new THREE.Group();
    const item = this.makeItem(id);
    if (!item) {
      g.add(this.makeArm());
      g.userData.empty = true;
      return g;
    }
    const d = item.userData.block ? BLOCK_DISPLAY : ITEM_DISPLAY;
    const pose = new THREE.Group();
    pose.position.set(d.t[0] / 16, d.t[1] / 16, d.t[2] / 16);
    pose.rotation.set(d.rot[0] * D, d.rot[1] * D, d.rot[2] * D, 'XYZ');
    pose.scale.setScalar(d.s);
    pose.add(item);
    g.add(pose);
    return g;
  }

  setItem(id: string) {
    if (id === this.current) return;
    this.current = id;
    if (this.obj) this.pose.remove(this.obj);
    let o = this.cache.get(id);
    if (!o) {
      o = this.build(id);
      this.cache.set(id, o);
    }
    this.obj = o;
    this.pose.add(o);
  }

  /** `swing` : 1 au début du coup, décroît jusqu'à 0. */
  update(aspect: number, swing: number, bob: number, moving: number, light: number, sneak: boolean) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const bx = Math.sin(bob) * 0.025 * moving, by = Math.abs(Math.cos(bob)) * 0.02 * moving;
    if (this.obj?.userData.empty) {
      // main vide : renderPlayerArm du jeu original (main droite, progression du coup a)
      const a = swing > 0 ? 1 - swing : 0;
      const f1 = Math.sqrt(a);
      const f2 = -0.3 * Math.sin(f1 * Math.PI), f3 = 0.4 * Math.sin(f1 * Math.PI * 2), f4 = -0.4 * Math.sin(a * Math.PI);
      const f5 = Math.sin(a * a * Math.PI), f6 = Math.sin(f1 * Math.PI);
      // remonté de 0,14 par rapport au calcul d'origine pour suivre la référence (poing vers 65 % de la hauteur)
      const M = this.mat.makeTranslation(f2 + 0.64 + bx, f3 - 0.46 + by - (sneak ? 0.03 : 0), f4 - 0.72);
      M.multiply(this.tmpM.makeRotationY(45 * D));
      M.multiply(this.tmpM.makeRotationY(f6 * 70 * D));
      M.multiply(this.tmpM.makeRotationZ(f5 * -20 * D));
      M.multiply(this.tmpM.makeTranslation(-1, 3.6, 3.5));
      M.multiply(this.tmpM.makeRotationZ(120 * D));
      M.multiply(this.tmpM.makeRotationX(200 * D));
      M.multiply(this.tmpM.makeRotationY(-135 * D));
      M.multiply(this.tmpM.makeTranslation(5.6, 0, 0));
      this.holder.matrixAutoUpdate = false;
      this.holder.matrix.copy(M);
      this.holder.matrixWorldNeedsUpdate = true;
    } else {
      this.holder.matrixAutoUpdate = true;
      // objet : animation de coup du jeu original (progression 0 → 1)
      const a = swing > 0 ? 1 - swing : 0;
      const sq = Math.sqrt(a);
      const tx = -0.4 * Math.sin(sq * Math.PI), ty = 0.2 * Math.sin(sq * Math.PI * 2), tz = -0.2 * Math.sin(a * Math.PI);
      this.holder.position.set(ARM_POS[0] + tx + bx, ARM_POS[1] + ty + by - (sneak ? 0.03 : 0), ARM_POS[2] + tz);
      const f = Math.sin(a * a * Math.PI), f1 = Math.sin(sq * Math.PI);
      // Y(45 − 20·f) · Z(−20·f1) · X(−80·f1) · Y(−45)
      this.q.setFromAxisAngle(AXIS_Y, (45 + f * -20) * D);
      this.q.multiply(this.tq.setFromAxisAngle(AXIS_Z, f1 * -20 * D));
      this.q.multiply(this.tq.setFromAxisAngle(AXIS_X, f1 * -80 * D));
      this.q.multiply(this.tq.setFromAxisAngle(AXIS_Y, -45 * D));
      this.holder.quaternion.copy(this.q);
    }
    this.tint.setScalar(light);
    for (const m of this.mats) m.color.copy(this.tint);
  }

  dispose() {
    this.cache.forEach((o) => o.traverse((c) => (c as THREE.Mesh).geometry?.dispose()));
    this.mats.forEach((m) => {
      if (!m.userData.sharedMap) m.map?.dispose();
      m.dispose();
    });
    this.textures.forEach((t) => t.dispose());
  }
}
