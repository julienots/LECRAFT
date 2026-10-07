import * as THREE from 'three';
import { ATLAS_COLS } from './TileRegistry';

/** Profondeur seule, avec la découpe des textures (herbes, feuilles : l'ombre garde leurs trous). */
function depthMaterial(atlas: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: atlas } },
    vertexShader: `attribute vec2 aUv; attribute vec4 aInfo; varying vec2 vUv; varying float vTile;
      void main(){ vUv = aUv / 256.0; vTile = aInfo.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D uAtlas; varying vec2 vUv; varying float vTile;
      void main(){
        float tile = floor(vTile + 0.5);
        float col = mod(tile, ${ATLAS_COLS}.0), row = floor(tile / ${ATLAS_COLS}.0);
        vec2 f = clamp(fract(vUv), 0.0005, 0.9995);
        if (textureLod(uAtlas, vec2((col + f.x) / ${ATLAS_COLS}.0, 1.0 - (row + 1.0 - f.y) / ${ATLAS_COLS}.0), 0.0).a < 0.5) discard;
        gl_FragColor = vec4(1.0);
      }`,
    colorWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Ombres projetées du soleil (shaders « Ultra ») : les blocs proches sont rendus en profondeur
 * depuis la direction de la lumière (caméra orthographique centrée sur le joueur, alignée sur
 * les texels pour éviter le scintillement). Le shader des chunks compare ensuite chaque pixel à
 * cette carte (filtrage 3×3).
 */
export class ShadowMap {
  readonly target: THREE.WebGLRenderTarget;
  readonly camera: THREE.OrthographicCamera;
  /** Matrice monde → espace de la carte d'ombres (projection × vue). */
  readonly matrix = new THREE.Matrix4();
  private scene = new THREE.Scene();
  private material: THREE.ShaderMaterial;
  private frame = 0;
  readonly size: number;

  constructor(atlas: THREE.Texture, size = 1024, private radius = 40) {
    this.size = size;
    this.material = depthMaterial(atlas);
    const depth = new THREE.DepthTexture(size, size);
    depth.type = THREE.UnsignedIntType;
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.target = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, depthTexture: depth });
    this.camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 1, 400);
    this.scene.overrideMaterial = this.material;
  }

  get texture() {
    return this.target.depthTexture!;
  }

  /**
   * Met à jour la carte (une image sur deux) : `casters` (chunks et entités) est temporairement
   * déplacé dans la scène d'ombres puis rendu à sa place.
   */
  update(gl: THREE.WebGLRenderer, casters: THREE.Object3D[], center: THREE.Vector3, lightDir: THREE.Vector3) {
    if (this.frame++ % 2 === 1) return;
    // position alignée sur la taille d'un texel (dans le plan de la lumière)
    const cam = this.camera;
    const up = Math.abs(lightDir.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    cam.up.copy(up);
    cam.position.copy(center).addScaledVector(lightDir, 200);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    const texel = (this.radius * 2) / this.size;
    const inv = cam.matrixWorldInverse.clone();
    const c = center.clone().applyMatrix4(inv);
    const sx = Math.round(c.x / texel) * texel - c.x, sy = Math.round(c.y / texel) * texel - c.y;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const camUp = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    cam.position.addScaledVector(right, sx).addScaledVector(camUp, sy);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    this.matrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    // rendu des émetteurs d'ombre (ils sont rendus à leur place ensuite)
    // les objets transparents (eau, ombres rondes, particules) ne projettent pas d'ombre
    const hidden: THREE.Object3D[] = [];
    for (const o of casters)
      o.traverse((m) => {
        const mat = (m as THREE.Mesh).material as THREE.Material | undefined;
        if (m.visible && mat && !Array.isArray(mat) && mat.transparent) {
          m.visible = false;
          hidden.push(m);
        }
      });
    const parents = casters.map((o) => o.parent);
    for (const o of casters) this.scene.add(o);
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(this.target);
    gl.clear(false, true, false);
    gl.render(this.scene, cam);
    gl.setRenderTarget(prev);
    casters.forEach((o, i) => parents[i]?.add(o));
    for (const m of hidden) m.visible = true;
  }

  dispose() {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.material.dispose();
  }
}
