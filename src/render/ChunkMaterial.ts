import * as THREE from 'three';
import { ATLAS_COLS } from './TileRegistry';

const vert = /* glsl */ `
attribute vec2 aUv;
attribute vec4 aInfo;
attribute vec4 aTint;
uniform float uTime;
uniform float uSway;
uniform float uWaterAnim;
varying vec2 vUv;
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
  if (flag(f, 4.0) > 0.5 && (!liquid || uWaterAnim > 0.5)) tile += mod(floor(uTime * 3.0), 4.0);
  vTile = tile;
  vFlags = f;
  vUv = aUv;
  vLight = vec2(aInfo.z, aInfo.w) / 240.0;
  vTint = aTint;
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
varying vec2 vUv;
varying float vTile;
varying vec2 vLight;
varying vec4 vTint;
varying float vDist;
varying float vFlags;

void main() {
  float tile = floor(vTile + 0.5);
  float col = mod(tile, ${ATLAS_COLS}.0);
  float row = floor(tile / ${ATLAS_COLS}.0);
  vec2 f = clamp(fract(vUv), 0.0005, 0.9995);
  vec2 uv = vec2((col + f.x) / ${ATLAS_COLS}.0, 1.0 - (row + 1.0 - f.y) / ${ATLAS_COLS}.0);
  vec4 tex = texture2D(uAtlas, uv);
  if (tex.a < 0.1) discard;
  vec3 c = tex.rgb;
  if (tex.a < 0.95 && tex.a > 0.5) c *= vTint.rgb;
  float sky = vLight.x * uDaylight;
  float blk = vLight.y;
  float bs = pow(sky, 1.45);
  float bb = pow(blk, 1.5);
  vec3 light = max(uSkyColor * bs, vec3(1.0, 0.82, 0.58) * bb * 1.05);
  light = max(light, vec3(uAmbient));
  float shade = mix(1.0, vTint.a, uAO);
  c *= light * shade;
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  c = mix(c, uFogColor, fog);
  float a = uAlphaMode > 0.5 ? max(tex.a, 0.55) : 1.0;
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
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // uniforms partagés : les deux matériaux pointent vers les mêmes objets IUniform
  return { opaque, trans, uniforms };
}
