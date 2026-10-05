import * as THREE from 'three';
import { World } from '../world/World';
import { ChunkManager } from '../world/ChunkManager';
import { WorldGenerator } from '../world/WorldGenerator';
import { CHUNK_SIZE } from '../core/Config';
import type { Renderer } from './Renderer';

/** Graine du monde affiché derrière l'écran titre. */
const PANORAMA_SEED = 20161;

/**
 * Panorama de l'écran titre : un vrai morceau de monde généré (même moteur que le jeu),
 * vu depuis une caméra qui tourne lentement, comme le panorama du jeu de référence.
 */
export class MenuPanorama {
  private world: World;
  private chunks: ChunkManager;
  private center: { x: number; y: number; z: number };
  private t = Math.random() * 100;

  constructor(private r: Renderer, renderDistance: number) {
    this.world = new World(PANORAMA_SEED);
    this.chunks = new ChunkManager(this.world, r.materials, null, null, { renderDistance: Math.min(3, renderDistance), jobsInFlight: 2, meshUploadsPerFrame: 2 });
    this.chunks.onSpecials = () => {};
    r.scene.add(this.chunks.group);
    const s = new WorldGenerator(PANORAMA_SEED).findSpawn();
    this.center = { x: s.x + 0.5, y: s.y + 10, z: s.z + 0.5 };
  }

  get ready() {
    const { ready, total } = this.chunks.readyCount(1);
    return ready === total;
  }

  update(dt: number) {
    const r = this.r;
    const c = this.center;
    this.t += dt;
    this.chunks.update(c.x, c.z);
    const cam = r.camera;
    cam.position.set(c.x, c.y, c.z);
    cam.rotation.set(-0.12 + Math.sin(this.t * 0.05) * 0.04, this.t * 0.035, 0);
    if (Math.abs(cam.fov - 70) > 0.01) {
      cam.fov = 70;
      cam.updateProjectionMatrix();
    }
    const time = 0.16;
    r.sky.update(time, cam.position, 0, 0, this.t, true);
    const u = r.materials.uniforms;
    u.uTime.value = this.t;
    u.uDaylight.value = 1;
    u.uSkyColor.value.copy(r.sky.skyLightColor);
    u.uSway.value = 1;
    u.uWaterAnim.value = 1;
    u.uAO.value = 1;
    const far = Math.min(3, this.chunks.opts.renderDistance) * CHUNK_SIZE;
    r.setFog(far * 0.55, far, r.sky.horizon as THREE.Color);
    r.shake = 0;
    r.render();
  }

  dispose() {
    this.r.scene.remove(this.chunks.group);
    this.chunks.dispose();
  }
}
