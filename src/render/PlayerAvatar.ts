import * as THREE from 'three';
import { MobModel, type SkinProvider } from './MobModels';
import { extrudeIcon } from './ItemExtrude';

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

  constructor(shadow: THREE.Texture, skins: SkinProvider, private icon: (id: string) => THREE.Texture, skinKey = 'player') {
    this.model = new MobModel('player', SCALE, shadow, skins, skinKey);
    this.model.setShadowSize(0.6, true);
    this.item = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
    // dans la main droite (repère du bras : 10 px sous l'épaule), tenu par le manche comme le jeu
    // original : le coin bas-gauche de l'icône (manche) dans le poing, la tête vers l'avant et le haut
    this.item.position.set(-1 / 16, -10 / 16 + 0.15, 3 / 16 + 0.15);
    this.item.rotation.set(0, -HALF_PI, 0);
    this.item.visible = false;
    this.model.parts.get('armR')?.[0]?.add(this.item);
  }

  private armRest: [number, number] | null = null;

  get group() {
    return this.model.group;
  }

  update(o: {
    x: number; y: number; z: number; yaw: number; pitch: number; phase: number; speed: number; swing: number;
    sneaking: boolean; held: string; light: number; hurt: boolean; visible: boolean; prone?: boolean;
    /** Pose des bras pendant l'utilisation d'un objet (HumanoidModel.ArmPose du jeu original). */
    use?: 'bow' | 'block' | 'spear' | null;
  }) {
    const g = this.model.group;
    g.visible = o.visible;
    if (!o.visible) return;
    g.position.set(o.x, o.y, o.z);
    g.rotation.y = o.yaw + Math.PI;
    this.model.animate(o.phase / 2.2, Math.min(1, o.speed / 4.3), 0, o.swing, 0, o.pitch);
    this.model.crouch(o.sneaking && !o.prone);
    const R = this.model.parts.get('armR')?.[0], L = this.model.parts.get('armL')?.[0];
    // angles de repos (l'animation de marche ne touche pas à la rotation Y des bras)
    if (R && L) {
      this.armRest ??= [R.rotation.y, L.rotation.y];
      R.rotation.y = this.armRest[0];
      L.rotation.y = this.armRest[1];
    }
    if (R && L && o.use) {
      const head = -o.pitch;
      if (o.use === 'bow') {
        // arc bandé (et arbalète) : les deux bras tendus vers le regard
        R.rotation.x = -Math.PI / 2 + head;
        L.rotation.x = -Math.PI / 2 + head;
        R.rotation.y = 0.1;
        L.rotation.y = -0.5;
      } else if (o.use === 'block') {
        // bouclier levé devant le torse
        R.rotation.x = R.rotation.x * 0.5 - 0.9425;
        R.rotation.y = Math.PI / 6;
      } else {
        // trident armé au-dessus de l'épaule
        R.rotation.x = R.rotation.x * 0.5 - Math.PI;
        R.rotation.y = 0;
      }
    }
    // nage / rampe : corps à l'horizontale
    g.rotation.order = 'YXZ';
    g.rotation.x = o.prone ? Math.PI / 2 : 0;
    if (o.prone) {
      // corps allongé centré sur la boîte du joueur
      g.position.x -= Math.sin(g.rotation.y) * 0.9;
      g.position.z -= Math.cos(g.rotation.y) * 0.9;
      g.position.y += 0.3;
    }
    // accroupi : le modèle descend de 2 px (la pose est faite par crouch())
    if (o.sneaking && !o.prone) g.position.y -= (2 / 16) * SCALE;
    if (o.held !== this.itemId) {
      this.itemId = o.held;
      const m = this.item.material as THREE.MeshBasicMaterial;
      m.map = o.held ? this.icon(o.held) : null;
      m.needsUpdate = true;
      this.item.visible = !!o.held;
      // objet en 3D (extrudé d'un pixel), comme dans le jeu original
      if (o.held && m.map?.image instanceof HTMLCanvasElement) {
        this.item.geometry.dispose();
        this.item.geometry = extrudeIcon(m.map.image).scale(0.5, 0.5, 0.5);
        m.side = THREE.FrontSide;
        m.transparent = false;
        m.alphaTest = 0.1;
      }
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
