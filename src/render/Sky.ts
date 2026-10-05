import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../util/math';

const C = (h: string) => new THREE.Color(h);
const DAY_ZENITH = C('#3f86ee');
const DAY_HORIZON = C('#a9d2ff');
const SUNSET_HORIZON = C('#f28c4c');
const SUNSET_ZENITH = C('#3a58a0');
const NIGHT_ZENITH = C('#03060f');
const NIGHT_HORIZON = C('#0c1428');
const RAIN_TINT = C('#7a8494');

function pixelTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Dôme céleste dégradé, soleil, lune, étoiles et couche de nuages pixelisés. */
export class Sky {
  readonly group = new THREE.Group();
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private sun: THREE.Mesh;
  private moon: THREE.Mesh;
  private stars: THREE.Points;
  private clouds: THREE.Mesh;
  private cloudTex: THREE.Texture;
  readonly horizon = new THREE.Color();
  readonly zenith = new THREE.Color();
  readonly skyLightColor = new THREE.Color(1, 1, 1);
  private disposables: { dispose(): void }[] = [];

  constructor() {
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunGlow: { value: new THREE.Color() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunGlow; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y, -0.2, 1.0); float t = pow(clamp(h,0.0,1.0), 0.55);
          vec3 c = mix(uHorizon, uZenith, t); if (h < 0.0) c = mix(uHorizon, uHorizon*0.6, -h*4.0);
          float g = pow(max(dot(normalize(vDir), uSunDir), 0.0), 8.0); c += uSunGlow * g * 0.5;
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 12), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    const sunTex = pixelTexture(16, (c) => {
      c.fillStyle = '#fff3a0';
      c.fillRect(0, 0, 16, 16);
      c.fillStyle = '#ffe060';
      c.fillRect(2, 2, 12, 12);
      c.fillStyle = '#fffbe0';
      c.fillRect(4, 4, 8, 8);
    });
    const moonTex = pixelTexture(16, (c) => {
      c.fillStyle = '#d8dce8';
      c.fillRect(0, 0, 16, 16);
      c.fillStyle = '#a8aec0';
      for (const [x, y, s] of [[3, 3, 3], [9, 5, 2], [5, 10, 3], [11, 11, 2]]) c.fillRect(x, y, s, s);
    });
    const mk = (tex: THREE.Texture, size: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false }));
      m.renderOrder = -9;
      m.frustumCulled = false;
      this.disposables.push(tex, m.geometry, m.material as THREE.Material);
      return m;
    };
    this.sun = mk(sunTex, 50);
    this.moon = mk(moonTex, 34);
    this.group.add(this.sun, this.moon);

    const starPos = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      starPos.set([Math.cos(a) * r * 400, Math.abs(u) * 400, Math.sin(a) * r * 400], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }));
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    this.cloudTex = pixelTexture(64, (c) => {
      c.clearRect(0, 0, 64, 64);
      c.fillStyle = '#ffffff';
      let s = 1234567;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 26; i++) {
        const x = Math.floor(rnd() * 64), y = Math.floor(rnd() * 64), w = 3 + Math.floor(rnd() * 9), h = 2 + Math.floor(rnd() * 6);
        for (const [ox, oy] of [[0, 0], [-64, 0], [0, -64], [-64, -64]]) c.fillRect(x + ox, y + oy, w, h);
      }
    });
    this.cloudTex.wrapS = this.cloudTex.wrapT = THREE.RepeatWrapping;
    this.cloudTex.repeat.set(6, 6);
    const cm = new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, opacity: 0.82, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1536, 1536), cm);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.renderOrder = 2;
    this.disposables.push(this.dome.geometry, this.domeMat, sg, this.stars.material as THREE.Material, this.cloudTex, this.clouds.geometry, cm);
  }

  get cloudMesh() {
    return this.clouds;
  }

  /**
   * Met à jour couleurs et positions. time ∈ [0,1), rain ∈ [0,1], flash ∈ [0,1] (éclair).
   */
  update(time: number, camPos: THREE.Vector3, rain: number, flash: number, elapsed: number, cloudsVisible: boolean) {
    const ang = time * Math.PI * 2;
    const h = Math.sin(ang);
    const day = smoothstep(-0.2, 0.25, h);
    const sunset = clamp(1 - Math.abs(h) / 0.32, 0, 1) * (Math.cos(ang) > -2 ? 1 : 0);
    this.zenith.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, day);
    this.horizon.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, day);
    this.horizon.lerp(SUNSET_HORIZON, sunset * 0.75);
    this.zenith.lerp(SUNSET_ZENITH, sunset * 0.35);
    if (rain > 0) {
      const k = rain * 0.65;
      const dim = lerp(1, 0.55, rain);
      this.zenith.lerp(RAIN_TINT, k).multiplyScalar(dim);
      this.horizon.lerp(RAIN_TINT, k).multiplyScalar(dim);
    }
    if (flash > 0) {
      this.zenith.lerp(new THREE.Color(1, 1, 1), flash * 0.7);
      this.horizon.lerp(new THREE.Color(1, 1, 1), flash * 0.7);
    }
    // couleur de la lumière du ciel : chaude au crépuscule, bleutée la nuit
    this.skyLightColor.setRGB(1, 1, 1).lerp(new THREE.Color(1.0, 0.78, 0.6), sunset * 0.6).lerp(new THREE.Color(0.55, 0.62, 0.95), (1 - day) * 0.8);
    this.domeMat.uniforms.uZenith.value.copy(this.zenith);
    this.domeMat.uniforms.uHorizon.value.copy(this.horizon);
    const sunDir = new THREE.Vector3(Math.cos(ang), h, 0.25).normalize();
    this.domeMat.uniforms.uSunDir.value.copy(sunDir);
    this.domeMat.uniforms.uSunGlow.value.setRGB(1, 0.6, 0.3).multiplyScalar(sunset * (1 - rain));
    this.group.position.copy(camPos);
    this.sun.position.copy(sunDir).multiplyScalar(380);
    this.sun.lookAt(0, 0, 0);
    (this.sun.material as THREE.MeshBasicMaterial).opacity = 1 - rain * 0.9;
    this.moon.position.copy(sunDir).multiplyScalar(-380);
    this.moon.lookAt(0, 0, 0);
    (this.moon.material as THREE.MeshBasicMaterial).opacity = 1 - rain * 0.9;
    (this.stars.material as THREE.PointsMaterial).opacity = clamp((1 - day) * 1.2 - rain, 0, 1);
    this.stars.rotation.z = ang * 0.2;
    // nuages : suivent la caméra, défilent lentement
    this.clouds.visible = cloudsVisible;
    if (cloudsVisible) {
      this.clouds.position.set(camPos.x, 118, camPos.z);
      const span = 1536 / 6;
      this.cloudTex.offset.set((camPos.x + elapsed * 1.2) / span, -camPos.z / span);
      const cm = this.clouds.material as THREE.MeshBasicMaterial;
      cm.color.setRGB(1, 1, 1).multiplyScalar(lerp(0.25, 1, day) * lerp(1, 0.6, rain));
      cm.opacity = lerp(0.8, 0.95, rain);
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
