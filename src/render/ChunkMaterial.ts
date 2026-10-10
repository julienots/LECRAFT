import * as THREE from 'three';
import { ATLAS_COLS } from './TileRegistry';

const vert = /* glsl */ `
attribute vec2 aUv;
attribute vec4 aInfo;
attribute vec4 aTint;
uniform float uTime;
uniform float uSway;
uniform float uWaterAnim;
uniform mat4 uShadowMatrix;
varying vec2 vUv;
varying vec3 vWorld;
varying vec4 vShadow;
varying float vTile;
varying vec2 vLight;
varying vec4 vTint;
varying float vDist;
varying float vFlags;

float flag(float f, float bit) { return mod(floor(f / bit), 2.0); }

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float f = aInfo.y;
  if (uSway > 0.5 && flag(f, 1.0) > 0.5) {
    float t = uTime * 1.7 + wp.x * 0.55 + wp.z * 0.37;
    wp.x += sin(t) * 0.045;
    wp.z += cos(t * 0.8) * 0.035;
  }
  bool liquid = flag(f, 16.0) > 0.5;
  if (flag(f, 8.0) > 0.5 && uWaterAnim > 0.5) {
    wp.y += sin(uTime * 1.6 + wp.x * 0.9 + wp.z * 0.6) * 0.035 - 0.04;
  }
  float tile = aInfo.x;
  if (flag(f, 4.0) > 0.5 && (!liquid || uWaterAnim > 0.5)) tile += mod(floor(uTime * 8.0), 16.0);
  vTile = tile;
  vFlags = f;
  vUv = aUv / 256.0;
  vLight = vec2(aInfo.z, aInfo.w) / 240.0;
  vTint = aTint;
  vWorld = wp.xyz;
  vShadow = uShadowMatrix * wp;
  vec4 mv = viewMatrix * wp;
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uDaylight;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlphaMode;
uniform float uAmbient;
uniform float uAO;
uniform float uTime;
// shaders : 0 désactivés, 1 activés (lumière, eau, brouillard, couleurs), 2 ultra (+ ombres projetées)
uniform float uShaders;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSunGlow;
uniform sampler2D uShadowMap;
uniform float uShadowTexel;
uniform float uPortalTile;
uniform sampler2D uEndSky;
uniform sampler2D uEndPortal;
uniform float uEndTex;
uniform vec2 uResolution;
varying vec2 vUv;
varying float vTile;
varying vec2 vLight;
varying vec4 vTint;
varying float vDist;
varying float vFlags;
varying vec3 vWorld;
varying vec4 vShadow;

float flagBit(float f, float bit) { return mod(floor(f / bit), 2.0); }

// part de lumière directe reçue (carte d'ombres, filtrage 3×3)
float shadowAt(float ndl) {
  vec3 p = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float bias = 0.0006 + 0.0025 * (1.0 - ndl);
  float lit = 0.0;
  for (int i = -1; i <= 1; i++)
    for (int j = -1; j <= 1; j++) {
      float d = texture2D(uShadowMap, p.xy + vec2(float(i), float(j)) * uShadowTexel).r;
      lit += p.z - bias > d ? 0.0 : 1.0;
    }
  return lit / 9.0;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/**
 * Portail de l'End : ciel étoilé en espace écran (comme le jeu original) — plusieurs couches
 * d'étoiles colorées qui défilent à des vitesses et angles différents, indépendantes de la face.
 */
vec3 endPortalSky() {
  vec2 sp = gl_FragCoord.xy / max(uResolution.y, 1.0);
  vec3 c = vec3(0.02, 0.035, 0.05);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float a = fi * 1.3 + 0.4;
    mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
    float scale = 7.0 + fi * 5.0;
    vec2 q = r * sp * scale + vec2(uTime * (0.08 + fi * 0.02), uTime * 0.03 * fi);
    vec2 cell = floor(q), f = fract(q);
    float h = hash21(cell + fi * 17.0);
    vec2 pos = vec2(hash21(cell + 3.1 + fi), hash21(cell + 7.7 + fi));
    float d = length(f - pos);
    float star = smoothstep(0.09 - fi * 0.008, 0.0, d) * step(0.62, h);
    vec3 tint = mix(vec3(0.15, 0.55, 0.5), vec3(0.55, 0.9, 0.85), hash21(cell + 11.0));
    if (i > 3) tint = mix(tint, vec3(0.6, 0.45, 0.85), 0.5);
    c += tint * star * (1.2 - fi * 0.12);
  }
  return c;
}

/**
 * Portail de l'End du jeu original (rendertype_end_portal) : ciel de l'End teinté puis 15 couches
 * de la texture des étoiles (entity/end_portal.png), chacune avec sa couleur, sa rotation, son
 * échelle et sa dérive lente, en espace écran.
 */
const vec3 EPC[16] = vec3[](
  vec3(0.022087, 0.098399, 0.110818), vec3(0.011892, 0.095924, 0.089485), vec3(0.027636, 0.101689, 0.100326), vec3(0.046564, 0.109883, 0.114838),
  vec3(0.064901, 0.117696, 0.097189), vec3(0.063761, 0.086895, 0.123646), vec3(0.084817, 0.111994, 0.166380), vec3(0.097489, 0.154120, 0.091064),
  vec3(0.106152, 0.131144, 0.195191), vec3(0.097721, 0.110188, 0.187229), vec3(0.133516, 0.138278, 0.148582), vec3(0.070006, 0.243332, 0.235792),
  vec3(0.196766, 0.142899, 0.214696), vec3(0.047281, 0.315338, 0.321970), vec3(0.204675, 0.390010, 0.302066), vec3(0.080955, 0.314821, 0.661491)
);
vec3 endPortalPack() {
  vec2 sp = gl_FragCoord.xy / max(uResolution.y, 1.0) * 0.5 + 0.25;
  vec3 c = texture(uEndSky, sp).rgb * EPC[0];
  // temps de jeu du jeu original (fraction de journée) : dérive très lente
  float gt = uTime * (20.0 / 24000.0);
  for (int i = 0; i < 15; i++) {
    float l = float(i + 1);
    vec2 p = sp + vec2(17.0 / l, (2.0 + l / 1.5) * gt * 1.5);
    float a = radians((l * l * 4321.0 + l * 9.0) * 2.0);
    p = mat2(cos(a), sin(a), -sin(a), cos(a)) * p;
    p *= 4.5 - l / 4.0;
    c += texture(uEndPortal, p).rgb * EPC[i];
  }
  return c;
}

void main() {
  float tile = floor(vTile + 0.5);
  if (uPortalTile >= 0.0 && abs(tile - uPortalTile) < 0.5) {
    vec3 sky = uEndTex > 0.5 ? endPortalPack() : endPortalSky();
    float fogP = smoothstep(uFogNear, uFogFar, vDist);
    gl_FragColor = vec4(mix(sky, uFogColor, fogP), 1.0);
    return;
  }
  float col = mod(tile, ${ATLAS_COLS}.0);
  float row = floor(tile / ${ATLAS_COLS}.0);
  vec2 f = clamp(fract(vUv), 0.0005, 0.9995);
  vec2 uv = vec2((col + f.x) / ${ATLAS_COLS}.0, 1.0 - (row + 1.0 - f.y) / ${ATLAS_COLS}.0);
  // niveau de mipmap calculé sur les coordonnées continues (pas de couture au bord des tuiles répétées)
  vec2 gx = dFdx(vUv) * 16.0, gy = dFdy(vUv) * 16.0;
  // jusqu'au niveau 4 (1 texel par tuile) comme le jeu original : pas de scintillement au loin
  float lod = clamp(0.5 * log2(max(dot(gx, gx), dot(gy, gy))), 0.0, 4.0);
  vec4 tex = textureLod(uAtlas, uv, lod);
  if (tex.a < 0.1) discard;
  vec3 c = tex.rgb;
  // teinte (herbe, feuillage) : texels marqués (alpha < 1) ; la teinte des sommets est blanche pour
  // les blocs non teintés, et les niveaux de mipmap gardent la teinte (herbe verte au loin)
  if (tex.a < 0.95) c *= vTint.rgb;
  float sky = vLight.x * uDaylight;
  float blk = vLight.y;
  float bs = pow(sky, 1.45);
  float bb = pow(blk, 1.5);
  vec3 torch = vec3(1.0, 0.82, 0.58) * bb * 1.05;
  vec3 light;
  float shade = mix(1.0, vTint.a, uAO);
  bool water = uAlphaMode > 0.5 && flagBit(vFlags, 16.0) > 0.5;
  vec3 N = vec3(0.0, 1.0, 0.0);
  float ndl = 0.0;
  if (uShaders > 0.5) {
    // normale de la face (dérivées) ; la végétation reçoit la lumière comme une surface horizontale
    N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (flagBit(vFlags, 1.0) > 0.5) N = vec3(0.0, 1.0, 0.0);
    ndl = max(dot(N, uLightDir), 0.0);
    // à l'air libre (lumière du ciel) ; en ultra, ombres projetées réelles
    float vis = smoothstep(0.55, 0.95, vLight.x);
    if (uShaders > 1.5) vis *= shadowAt(ndl);
    vec3 amb = uSkyColor * bs * 0.56 + uSkyZenith * 0.1 * vLight.x;
    vec3 direct = uLightColor * ndl * vis * 0.9;
    light = max(amb + direct, torch);
    shade = mix(1.0, vTint.a, uAO * 0.75);
  } else {
    light = max(uSkyColor * bs, torch);
  }
  light = max(light, vec3(uAmbient));
  c *= light * shade;
  float a = uAlphaMode > 0.5 ? max(tex.a, 0.55) : 1.0;
  vec3 V = normalize(cameraPosition - vWorld);
  if (uShaders > 0.5 && water) {
    // eau : vaguelettes, reflet du ciel (Fresnel) et reflet du soleil
    vec3 n = N;
    if (N.y > 0.5) {
      vec2 q = vWorld.xz * 1.7 + uTime * vec2(0.6, 0.45);
      n = normalize(vec3(sin(q.x) * 0.06 + sin(q.y * 1.3 + 1.7) * 0.04, 1.0, cos(q.y) * 0.06 + cos(q.x * 0.8 + 0.6) * 0.04));
    }
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 R = reflect(-V, n);
    vec3 skyRefl = mix(uSkyHorizon, uSkyZenith, clamp(R.y, 0.0, 1.0)) * (0.35 + 0.65 * vLight.x);
    c = mix(c, skyRefl, fres * 0.75);
    float spec = pow(max(dot(R, uLightDir), 0.0), 180.0) * smoothstep(0.6, 1.0, vLight.x);
    c += uLightColor * spec * 1.6;
    a = mix(a, 1.0, fres * 0.55);
  }
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  vec3 fogC = uFogColor;
  if (uShaders > 0.5) {
    // brouillard éclairé par le soleil couchant dans sa direction
    float toward = pow(max(dot(-V, uLightDir), 0.0), 6.0);
    fogC += uSunGlow * toward * 0.6;
  }
  c = mix(c, fogC, fog);
  if (uShaders > 0.5) {
    // couleurs plus riches (saturation, léger contraste)
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, 1.16);
    c = c * (1.0 + 0.08 * (c - 0.5));
  }
  gl_FragColor = vec4(c, a);
}
`;

export interface ChunkUniforms {
  [k: string]: THREE.IUniform;
  uAtlas: THREE.IUniform<THREE.Texture>;
  uTime: THREE.IUniform<number>;
  uDaylight: THREE.IUniform<number>;
  uSkyColor: THREE.IUniform<THREE.Color>;
  uFogColor: THREE.IUniform<THREE.Color>;
  uFogNear: THREE.IUniform<number>;
  uFogFar: THREE.IUniform<number>;
  uSway: THREE.IUniform<number>;
  uWaterAnim: THREE.IUniform<number>;
  uAmbient: THREE.IUniform<number>;
  uAO: THREE.IUniform<number>;
  uShaders: THREE.IUniform<number>;
  uLightDir: THREE.IUniform<THREE.Vector3>;
  uLightColor: THREE.IUniform<THREE.Color>;
  uSkyZenith: THREE.IUniform<THREE.Color>;
  uSkyHorizon: THREE.IUniform<THREE.Color>;
  uSunGlow: THREE.IUniform<THREE.Color>;
  uShadowMap: THREE.IUniform<THREE.Texture | null>;
  uShadowMatrix: THREE.IUniform<THREE.Matrix4>;
  uShadowTexel: THREE.IUniform<number>;
  uPortalTile: THREE.IUniform<number>;
  uEndSky: THREE.IUniform<THREE.Texture | null>;
  uEndPortal: THREE.IUniform<THREE.Texture | null>;
  uEndTex: THREE.IUniform<number>;
  uResolution: THREE.IUniform<THREE.Vector2>;
}

/** Matériaux partagés par tous les chunks (opaque/cutout et translucide). */
export function createChunkMaterials(atlas: THREE.Texture) {
  const uniforms: ChunkUniforms = {
    uAtlas: { value: atlas },
    uTime: { value: 0 },
    uDaylight: { value: 1 },
    uSkyColor: { value: new THREE.Color(1, 1, 1) },
    uFogColor: { value: new THREE.Color(0.7, 0.8, 1) },
    uFogNear: { value: 40 },
    uFogFar: { value: 80 },
    uSway: { value: 1 },
    uWaterAnim: { value: 1 },
    uAmbient: { value: 0.035 },
    uAO: { value: 1 },
    uShaders: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uLightColor: { value: new THREE.Color(0, 0, 0) },
    uSkyZenith: { value: new THREE.Color(0.25, 0.5, 0.9) },
    uSkyHorizon: { value: new THREE.Color(0.65, 0.8, 1) },
    uSunGlow: { value: new THREE.Color(0, 0, 0) },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowTexel: { value: 1 / 1024 },
    uPortalTile: { value: -1 },
    uEndSky: { value: null },
    uEndPortal: { value: null },
    uEndTex: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };
  const opaque = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uAlphaMode: { value: 0 } },
    vertexShader: vert,
    fragmentShader: frag,
  });
  const trans = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uAlphaMode: { value: 1 } },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    // écrit la profondeur : seule la surface translucide la plus proche est visible
    // (sinon les faces d'eau et de glace situées derrière apparaissent en « parois fantômes »)
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  // uniforms partagés : les deux matériaux pointent vers les mêmes objets IUniform
  return { opaque, trans, uniforms };
}
