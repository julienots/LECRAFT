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
const Z_AXIS = new THREE.Vector3(0, 0, 1);

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
  /** Shaders : direction de la lumière dominante (soleil, ou lune la nuit), sa couleur et la lueur du couchant. */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  readonly lightColor = new THREE.Color(0, 0, 0);
  readonly sunGlow = new THREE.Color(0, 0, 0);
  private disposables: { dispose(): void }[] = [];
  private tmp = new THREE.Vector3();
  private defaultSun!: THREE.Texture;
  private defaultMoon!: THREE.Texture;
  private packTex: THREE.Texture[] = [];
  private packMoon = false;
  private defaultClouds!: HTMLCanvasElement;
  /** Ciel de l'End : cube texturé (end_sky.png répété 16 fois par face, assombri comme le jeu original). */
  private endBox: THREE.Mesh;
  private defaultEnd: THREE.Texture;
  /** Largeur (en blocs) d'une répétition de la texture des nuages. */
  private cloudSpan = 1536 / 6;
  /** Phase de la lune (0 = pleine lune), comme le jeu original : jour % 8. */
  moonPhase = 0;

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
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, fog: false }));
      m.renderOrder = -9;
      m.frustumCulled = false;
      this.disposables.push(tex, m.geometry, m.material as THREE.Material);
      return m;
    };
    this.sun = mk(sunTex, 50);
    this.moon = mk(moonTex, 34);
    this.defaultSun = sunTex;
    this.defaultMoon = moonTex;
    this.group.add(this.sun, this.moon);

    const starPos = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      starPos.set([Math.cos(a) * r * 400, Math.abs(u) * 400, Math.sin(a) * r * 400], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, depthTest: true, fog: false }));
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
    this.defaultClouds = this.cloudTex.image as HTMLCanvasElement;
    this.defaultEnd = pixelTexture(128, (c) => {
      let seed = 987654321;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let y = 0; y < 128; y++)
        for (let x = 0; x < 128; x++) {
          const v = 40 + Math.floor(rnd() * 60);
          c.fillStyle = `rgb(${v + 10},${v},${v + 25})`;
          c.fillRect(x, y, 1, 1);
        }
    });
    this.defaultEnd.wrapS = this.defaultEnd.wrapT = THREE.RepeatWrapping;
    this.defaultEnd.repeat.set(16, 16);
    const em = new THREE.MeshBasicMaterial({ map: this.defaultEnd, color: 0x505050, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    this.endBox = new THREE.Mesh(new THREE.BoxGeometry(600, 600, 600), em);
    this.endBox.renderOrder = -9.5;
    this.endBox.frustumCulled = false;
    this.endBox.visible = false;
    this.group.add(this.endBox);
    this.disposables.push(this.defaultEnd, this.endBox.geometry, em);
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
  /** Nether : ni soleil, ni lune, ni étoiles, ni nuages ; dôme de la couleur du brouillard. */
  updateNether(camPos: THREE.Vector3, fog: THREE.Color, end = false) {
    this.endBox.visible = end;
    this.zenith.copy(fog);
    this.horizon.copy(fog);
    this.skyLightColor.setRGB(1, 1, 1);
    this.domeMat.uniforms.uZenith.value.copy(fog);
    this.domeMat.uniforms.uHorizon.value.copy(fog);
    this.domeMat.uniforms.uSunGlow.value.setRGB(0, 0, 0);
    this.group.position.copy(camPos);
    this.sun.visible = this.moon.visible = this.stars.visible = this.clouds.visible = false;
    this.lightColor.setRGB(0, 0, 0);
    this.sunGlow.setRGB(0, 0, 0);
  }

  /**
   * Soleil et lune du pack de ressources (environment/sun.png, environment/moon_phases.png) :
   * rendus en mélange additif (le fond noir disparaît) à la taille du jeu original.
   */
  usePack(sun?: ImageBitmap | HTMLCanvasElement, moon?: ImageBitmap | HTMLCanvasElement, clouds?: ImageBitmap | HTMLCanvasElement, endSky?: ImageBitmap | HTMLCanvasElement) {
    // nuages : clouds.png du jeu original, 1 pixel = 12 blocs (nouvelle texture : la taille change)
    let img: HTMLCanvasElement = this.defaultClouds;
    if (clouds) {
      img = document.createElement('canvas');
      img.width = clouds.width;
      img.height = clouds.height;
      img.getContext('2d')!.drawImage(clouds, 0, 0);
    }
    if (this.cloudTex.image !== img) {
      if (this.cloudTex.image !== this.defaultClouds || clouds) {
        const t = new THREE.CanvasTexture(img);
        t.magFilter = t.minFilter = THREE.NearestFilter;
        t.generateMipmaps = false;
        t.colorSpace = THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        if (!this.disposables.includes(this.cloudTex)) this.cloudTex.dispose();
        this.cloudTex = t;
        (this.clouds.material as THREE.MeshBasicMaterial).map = t;
        (this.clouds.material as THREE.MeshBasicMaterial).needsUpdate = true;
      }
    }
    this.cloudSpan = clouds ? clouds.width * 12 : 1536 / 6;
    this.cloudTex.repeat.set(1536 / this.cloudSpan, 1536 / this.cloudSpan);
    this.packTex.forEach((t) => t.dispose());
    this.packTex = [];
    const tex = (img: ImageBitmap | HTMLCanvasElement) => {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d')!.drawImage(img, 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
      this.packTex.push(t);
      return t;
    };
    const set = (mesh: THREE.Mesh, img: ImageBitmap | HTMLCanvasElement | undefined, fallback: THREE.Texture, scale: number) => {
      const m = mesh.material as THREE.MeshBasicMaterial;
      m.map = img ? tex(img) : fallback;
      m.blending = img ? THREE.AdditiveBlending : THREE.NormalBlending;
      m.needsUpdate = true;
      mesh.scale.setScalar(img ? scale : 1);
    };
    // jeu original : soleil ±30 et lune ±20 à 100 unités de distance (dôme de 380 ici)
    set(this.sun, sun, this.defaultSun, (60 * 3.8) / 50);
    set(this.moon, moon, this.defaultMoon, (40 * 3.8) / 34);
    this.packMoon = !!moon;
    const em = this.endBox.material as THREE.MeshBasicMaterial;
    if (endSky) {
      const t = tex(endSky);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(16, 16);
      em.map = t;
      em.color.setHex(0x282828); // le jeu original multiplie end_sky.png par 40/255
    } else {
      em.map = this.defaultEnd;
      em.color.setHex(0x505050);
    }
    em.needsUpdate = true;
    const mt = (this.moon.material as THREE.MeshBasicMaterial).map!;
    if (moon) mt.repeat.set(0.25, 0.5);
  }

  private basis = new THREE.Matrix4();
  private ax = new THREE.Vector3();
  private ay = new THREE.Vector3();
  /** Oriente un astre face au centre, ses bords alignés sur sa course (comme le jeu original). */
  private face(mesh: THREE.Mesh, normal: THREE.Vector3) {
    this.ax.crossVectors(Z_AXIS, normal).normalize();
    this.ay.crossVectors(normal, this.ax).normalize();
    this.basis.makeBasis(this.ax, this.ay, normal);
    mesh.quaternion.setFromRotationMatrix(this.basis);
  }

  update(time: number, camPos: THREE.Vector3, rain: number, flash: number, elapsed: number, cloudsVisible: boolean) {
    this.endBox.visible = false;
    this.sun.visible = this.moon.visible = this.stars.visible = true;
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
    this.sunGlow.copy(this.domeMat.uniforms.uSunGlow.value);
    // lumière directe : soleil (blanc chaud, orangé au couchant) ou lune (bleu pâle)
    const sunUp = smoothstep(-0.05, 0.15, h), moonUp = smoothstep(-0.05, 0.15, -h);
    if (h >= 0) {
      this.lightDir.copy(sunDir);
      this.lightColor.setRGB(1.0, 0.94, 0.82).lerp(new THREE.Color(1.0, 0.58, 0.32), sunset).multiplyScalar(sunUp * (1 - rain * 0.85));
    } else {
      this.lightDir.copy(sunDir).negate();
      this.lightColor.setRGB(0.2, 0.25, 0.4).multiplyScalar(moonUp * (1 - rain * 0.85));
    }
    this.group.position.copy(camPos);
    this.sun.position.copy(sunDir).multiplyScalar(380);
    this.face(this.sun, this.tmp.copy(sunDir).negate());
    (this.sun.material as THREE.MeshBasicMaterial).opacity = 1 - rain * 0.9;
    this.moon.position.copy(sunDir).multiplyScalar(-380);
    this.face(this.moon, sunDir);
    (this.moon.material as THREE.MeshBasicMaterial).opacity = 1 - rain * 0.9;
    if (this.packMoon) {
      // moon_phases.png : 4 colonnes × 2 lignes, phase 0 (pleine lune) en haut à gauche
      const ph = ((this.moonPhase % 8) + 8) % 8;
      (this.moon.material as THREE.MeshBasicMaterial).map!.offset.set((ph % 4) * 0.25, ph < 4 ? 0.5 : 0);
    }
    (this.stars.material as THREE.PointsMaterial).opacity = clamp((1 - day) * 1.2 - rain, 0, 1);
    this.stars.rotation.z = ang * 0.2;
    // nuages : suivent la caméra, défilent lentement
    this.clouds.visible = cloudsVisible;
    if (cloudsVisible) {
      this.clouds.position.set(camPos.x, 118, camPos.z);
      const span = this.cloudSpan;
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
