import * as THREE from 'three';

/**
 * Pluie / neige : un nuage de segments réutilisé autour de la caméra, animé dans le shader
 * (aucune mise à jour CPU par particule). Masqué quand le joueur est sous un toit.
 */
export class WeatherRenderer {
  readonly mesh: THREE.LineSegments;
  private mat: THREE.ShaderMaterial;
  constructor(count = 1400) {
    const pos = new Float32Array(count * 6);
    const seed = new Float32Array(count * 2);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 32, y = Math.random() * 24, z = (Math.random() - 0.5) * 32;
      pos.set([x, y, z, x, y - 0.5, z], i * 6);
      const s = Math.random();
      seed[i * 2] = s;
      seed[i * 2 + 1] = s;
      end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSnow: { value: 0 }, uAlpha: { value: 0 }, uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(0.7, 0.75, 0.9) } },
      vertexShader: `attribute float aSeed; attribute float aEnd; uniform float uTime; uniform float uSnow; uniform vec3 uCam; varying float vA;
        void main(){ vec3 p = position; float speed = mix(18.0, 2.5, uSnow);
          float y = mod(position.y + aEnd * 0.5 - uTime * speed * (0.8 + aSeed * 0.4), 24.0);
          float stretch = mix(1.0, 0.15, uSnow);
          p.y = y - aEnd * 0.5 * stretch;
          p.x += sin(uTime * 1.5 + aSeed * 30.0) * uSnow * 0.6;
          vec3 wp = vec3(uCam.x + p.x, uCam.y - 10.0 + p.y, uCam.z + p.z);
          vA = 1.0 - smoothstep(10.0, 16.0, length(p.xz));
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
      fragmentShader: `uniform float uAlpha; uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor, uAlpha * vA); }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  update(t: number, cam: THREE.Vector3, intensity: number, snow: boolean, sheltered: boolean) {
    const a = sheltered ? 0 : intensity;
    this.mesh.visible = a > 0.02;
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uSnow.value = snow ? 1 : 0;
    this.mat.uniforms.uAlpha.value = a * (snow ? 0.9 : 0.45);
    this.mat.uniforms.uCam.value.copy(cam);
    this.mat.uniforms.uColor.value.setRGB(snow ? 1 : 0.65, snow ? 1 : 0.72, snow ? 1 : 0.9);
    this.mesh.geometry.setDrawRange(0, Math.floor(this.mesh.geometry.getAttribute('position').count * Math.max(0.25, intensity)));
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
