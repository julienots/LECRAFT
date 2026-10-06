import * as THREE from 'three';
import { MobModel, type SkinProvider } from './MobModels';

/** Échelle du modèle (32 px de haut → 1,8 bloc). */
const SCALE = 0.9;
const HALF_PI = Math.PI / 2;

/**
 * Modèle du joueur affiché dans les vues à la 3e personne (arrière et avant), avec
 * l'objet tenu dans la main droite.
 */
export class PlayerAvatar {
  readonly model: MobModel;
  private item: THREE.Mesh;
  private itemId = '';

  constructor(shadow: THREE.Texture, skins: SkinProvider, private icon: (id: string) => THREE.Texture) {
    this.model = new MobModel('player', SCALE, shadow, skins);
    this.model.setShadowSize(0.6, true);
    this.item = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
    // dans la main droite (repère du bras : y vers le bas, 10 px sous l'épaule)
    this.item.position.set(-1 / 16, -10 / 16, 3 / 16);
    this.item.rotation.set(0, HALF_PI, 0);
    this.item.visible = false;
    this.model.parts.get('armR')?.[0]?.add(this.item);
  }

  get group() {
    return this.model.group;
  }

  update(o: {
    x: number; y: number; z: number; yaw: number; pitch: number; phase: number; speed: number; swing: number;
    sneaking: boolean; held: string; light: number; hurt: boolean; visible: boolean; prone?: boolean;
  }) {
    const g = this.model.group;
    g.visible = o.visible;
    if (!o.visible) return;
    g.position.set(o.x, o.y, o.z);
    g.rotation.y = o.yaw + Math.PI;
    this.model.animate(o.phase / 2.2, Math.min(1, o.speed / 4.3), 0, o.swing, 0, o.pitch);
    // nage / rampe : corps à l'horizontale
    g.rotation.order = 'YXZ';
    g.rotation.x = o.prone ? Math.PI / 2 : 0;
    if (o.prone) {
      // corps allongé centré sur la boîte du joueur
      g.position.x -= Math.sin(g.rotation.y) * 0.9;
      g.position.z -= Math.cos(g.rotation.y) * 0.9;
      g.position.y += 0.3;
    }
    g.scale.set(SCALE, SCALE * (o.sneaking ? 0.92 : 1), SCALE);
    if (o.held !== this.itemId) {
      this.itemId = o.held;
      const m = this.item.material as THREE.MeshBasicMaterial;
      m.map = o.held ? this.icon(o.held) : null;
      m.needsUpdate = true;
      this.item.visible = !!o.held;
    }
    const b = o.light;
    if (o.hurt) this.model.setTint(1, 0.35, 0.35);
    else this.model.setTint(b, b, b);
    (this.item.material as THREE.MeshBasicMaterial).color.setRGB(b, b, b);
  }

  dispose() {
    this.item.geometry.dispose();
    (this.item.material as THREE.Material).dispose();
    this.model.dispose();
  }
}
