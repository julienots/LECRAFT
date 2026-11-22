import { BlockRegistry, SHAPES } from '../blocks/BlockRegistry';
import { FACING_DIR } from '../blocks/Shapes';

/**
 * Logique pure de la redstone (sans état ni minuterie) : partagée par le moteur (thread principal),
 * les pistons et le mesher (forme de la poudre). Les règles suivent le jeu de référence :
 *  - puissance 0..15 ; la poudre perd 1 par bloc ;
 *  - un bloc plein (conducteur) est « fortement » alimenté par une torche dessous, un répéteur ou un
 *    comparateur tourné vers lui, un levier / bouton fixé dessus, une plaque posée dessus ; il est
 *    « faiblement » alimenté par la poudre posée dessus ou pointée vers lui ;
 *  - un bloc fortement alimenté alimente la poudre voisine ; un bloc alimenté (fort ou faible)
 *    alimente les composants voisins (torches fixées, répéteurs, comparateurs, lampes, pistons…).
 *
 * Méta :
 *  - poudre : bits 0-3 = puissance ;
 *  - répéteur : bits 0-1 sortie (0 sud, 1 ouest, 2 nord, 3 est), bits 2-3 délai - 1, bit 4 verrouillé ;
 *  - comparateur : bits 0-1 sortie, bit 2 mode soustraction, bits 3-6 puissance de sortie ;
 *  - torche, levier, bouton : bits 0-2 support (0 sol, 1..4 mur : FACING_DIR[n - 1]) ; levier / bouton bit 3 = activé ;
 *  - plaque : bit 0 enfoncée ; observateur : 0..3 face avant horizontale, 4 vers le haut, 5 vers le bas ;
 *  - ouvrants (portes, trappes, portillons) : bit 5 = alimenté au dernier calcul.
 */
export interface RsReader {
  getBlock(x: number, y: number, z: number): number;
  getMeta(x: number, y: number, z: number): number;
}

export enum K {
  NONE = 0,
  WIRE,
  TORCH_ON,
  TORCH_OFF,
  REPEATER,
  REPEATER_ON,
  COMPARATOR,
  COMPARATOR_ON,
  LAMP,
  LAMP_ON,
  RS_BLOCK,
  OBSERVER,
  OBSERVER_ON,
  LEVER,
  BUTTON,
  PLATE,
  DAYLIGHT,
  DAYLIGHT_INV,
  JUKEBOX,
  TARGET,
  PISTON,
  OPENABLE,
  TNT,
  MACHINE,
  BULB,
  POWERED_RAIL,
  NOTE_BLOCK,
}

/** Directions : 0 +X (est), 1 -X (ouest), 2 +Y, 3 -Y, 4 +Z (sud), 5 -Z (nord). */
export const DIR6: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const UP = 2, DOWN = 3;
export const oppositeDir = (d: number) => d ^ 1;
/** Orientation horizontale (0 sud, 1 ouest, 2 nord, 3 est) → direction 6. */
export const H2D = [4, 1, 5, 0];
/** Direction 6 horizontale → orientation (0 sud, 1 ouest, 2 nord, 3 est). */
export const D2H = [3, 1, -1, -1, 0, 2];
export const dirOf = (dx: number, dy: number, dz: number) => DIR6.findIndex(([a, b, c]) => a === dx && b === dy && c === dz);

let table: Uint8Array | null = null;
let tableSize = 0;
/** Teinte de la poudre selon sa puissance (formule du jeu de référence). */
export function wireColor(power: number): number {
  const f = power / 15;
  const r = f * 0.6 + (f > 0 ? 0.4 : 0.3);
  const g = Math.max(0, Math.min(1, f * f * 0.7 - 0.5));
  const b = Math.max(0, Math.min(1, f * f * 0.6 - 0.7));
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

const KEYS: Record<string, K> = {
  redstone_wire: K.WIRE,
  redstone_torch: K.TORCH_ON,
  redstone_torch_off: K.TORCH_OFF,
  repeater: K.REPEATER,
  repeater_on: K.REPEATER_ON,
  comparator: K.COMPARATOR,
  comparator_on: K.COMPARATOR_ON,
  redstone_lamp: K.LAMP,
  redstone_lamp_on: K.LAMP_ON,
  redstone_block: K.RS_BLOCK,
  observer: K.OBSERVER,
  observer_on: K.OBSERVER_ON,
  daylight_detector: K.DAYLIGHT,
  daylight_detector_inverted: K.DAYLIGHT_INV,
  jukebox: K.JUKEBOX,
  target: K.TARGET,
  piston: K.PISTON,
  sticky_piston: K.PISTON,
  tnt: K.TNT,
  powered_rail: K.POWERED_RAIL,
  powered_rail_on: K.POWERED_RAIL,
  note_block: K.NOTE_BLOCK,
  noteblock: K.NOTE_BLOCK,
};

/** Type de composant de redstone d'un bloc (table recalculée si le registre grandit). */
export function rsKind(id: number): K {
  if (id <= 0) return K.NONE;
  const n = BlockRegistry.blocks.length;
  if (!table || tableSize !== n) {
    table = new Uint8Array(n + 1);
    tableSize = n;
    for (const b of BlockRegistry.blocks) {
      if (!b) continue;
      let k = KEYS[b.key] ?? K.NONE;
      const shape = b.shape;
      if (!k && shape === 'lever') k = K.LEVER;
      else if (!k && shape === 'button') k = K.BUTTON;
      else if (!k && shape === 'plate') k = K.PLATE;
      else if (!k && (shape === 'door' || shape === 'trapdoor' || shape === 'fence_gate') && !b.def.keyItem) k = K.OPENABLE;
      else if (!k && (b.interact === 'dispenser' || b.interact === 'hopper')) k = K.MACHINE;
      else if (!k && /^(exposed_|weathered_|oxidized_|waxed_)*copper_bulb(_lit)?(_powered)?$/.test(b.key)) k = K.BULB;
      table[b.id] = k;
    }
  }
  return id < table.length ? (table[id] as K) : K.NONE;
}

/** Bloc conducteur : cube plein opaque (pas une source ni un piston). */
export function isConductor(id: number): boolean {
  if (id <= 0 || !BlockRegistry.opaque[id]) return false;
  const k = rsKind(id);
  return k !== K.RS_BLOCK && k !== K.OBSERVER && k !== K.OBSERVER_ON && k !== K.PISTON;
}

const shapeOf = (id: number) => (id > 0 ? SHAPES[BlockRegistry.shape[id] - 1] : undefined);

/** Direction 6 du support d'une torche / d'un levier / d'un bouton. */
export function attachDir(meta: number): number {
  const a = meta & 7;
  if (a === 0 || a > 4) return DOWN;
  const [dx, dz] = FACING_DIR[(a - 1) & 3];
  return dirOf(dx, 0, dz);
}

/** Direction 6 de sortie d'un répéteur / comparateur. */
export const outDir = (meta: number) => H2D[meta & 3];
/** Direction 6 de la face avant d'un observateur (sa sortie est à l'opposé). */
export const observerFront = (meta: number) => ((meta & 7) === 4 ? UP : (meta & 7) === 5 ? DOWN : H2D[meta & 3]);
export const comparatorOutput = (meta: number) => (meta >> 3) & 15;

/** Puissance du détecteur de lumière (fournie par le moteur : lumière du ciel et heure). */
export let daylightPower: (r: RsReader, x: number, y: number, z: number, inverted: boolean) => number = () => 0;
export function setDaylightPower(f: typeof daylightPower) {
  daylightPower = f;
}
/** Juke-box en lecture (méta bit 1). */
const jukeboxOn = (meta: number) => (meta & 2) !== 0;

/**
 * Puissance « faible » (directe) émise par le bloc en P vers son voisin dans la direction d
 * (le voisin est en P + d). La poudre n'émet que vers le bas et les côtés où elle pointe.
 */
export function emitWeak(r: RsReader, x: number, y: number, z: number, d: number): number {
  const id = r.getBlock(x, y, z);
  const k = rsKind(id);
  if (!k) return 0;
  const m = r.getMeta(x, y, z);
  switch (k) {
    case K.RS_BLOCK:
      return 15;
    case K.TORCH_ON:
      return d === attachDir(m) ? 0 : 15;
    case K.LEVER:
    case K.BUTTON:
      return m & 8 ? 15 : 0;
    case K.PLATE:
      return m & 1 ? plateLevel(id, m) : 0;
    case K.REPEATER_ON:
      return d === outDir(m) ? 15 : 0;
    case K.COMPARATOR:
    case K.COMPARATOR_ON:
      return d === outDir(m) ? comparatorOutput(m) : 0;
    case K.OBSERVER_ON:
      return d === oppositeDir(observerFront(m)) ? 15 : 0;
    case K.DAYLIGHT:
    case K.DAYLIGHT_INV:
      return daylightPower(r, x, y, z, k === K.DAYLIGHT_INV);
    case K.JUKEBOX:
      return jukeboxOn(m) ? 15 : 0;
    case K.TARGET:
      return m & 15;
    case K.WIRE: {
      const p = m & 15;
      if (!p || d === UP) return 0;
      if (d === DOWN) return p;
      return wirePoints(r, x, y, z) & (1 << D2H[d]) ? p : 0;
    }
  }
  return 0;
}

/** Plaques pondérées : la puissance est enregistrée dans les bits 4-7 (1..15) ; sinon 15. */
function plateLevel(id: number, m: number) {
  const k = BlockRegistry.get(id).key;
  if (k.includes('weighted')) return Math.max(1, (m >> 4) & 15);
  return 15;
}

/** Puissance « forte » émise par P vers P + d (seul un bloc conducteur la propage à la poudre). */
export function emitStrong(r: RsReader, x: number, y: number, z: number, d: number): number {
  const id = r.getBlock(x, y, z);
  const k = rsKind(id);
  if (!k) return 0;
  const m = r.getMeta(x, y, z);
  switch (k) {
    case K.TORCH_ON:
      return d === UP ? 15 : 0;
    case K.LEVER:
    case K.BUTTON:
      return m & 8 && d === attachDir(m) ? 15 : 0;
    case K.PLATE:
      return m & 1 && d === DOWN ? plateLevel(id, m) : 0;
    case K.REPEATER_ON:
      return d === outDir(m) ? 15 : 0;
    case K.COMPARATOR:
    case K.COMPARATOR_ON:
      return d === outDir(m) ? comparatorOutput(m) : 0;
    case K.OBSERVER_ON:
      return d === oppositeDir(observerFront(m)) ? 15 : 0;
  }
  return 0;
}

/** Puissance forte reçue par le bloc conducteur en S (max des voisins qui pointent vers lui). */
export function strongPowerOf(r: RsReader, x: number, y: number, z: number): number {
  let best = 0;
  for (let d = 0; d < 6 && best < 15; d++) {
    const [dx, dy, dz] = DIR6[d];
    best = Math.max(best, emitStrong(r, x + dx, y + dy, z + dz, oppositeDir(d)));
  }
  return best;
}

/** Puissance totale (forte ou faible) du bloc conducteur en S : ce qu'il donne aux composants voisins. */
export function blockPowerOf(r: RsReader, x: number, y: number, z: number): number {
  let best = 0;
  for (let d = 0; d < 6 && best < 15; d++) {
    const [dx, dy, dz] = DIR6[d];
    const nx = x + dx, ny = y + dy, nz = z + dz;
    const od = oppositeDir(d);
    const k = rsKind(r.getBlock(nx, ny, nz));
    best = Math.max(best, k === K.WIRE ? emitWeak(r, nx, ny, nz, od) : emitStrong(r, nx, ny, nz, od));
  }
  return best;
}

/** Signal reçu par P depuis son voisin dans la direction d (composant, ou bloc conducteur alimenté). */
export function signalFrom(r: RsReader, x: number, y: number, z: number, d: number): number {
  const [dx, dy, dz] = DIR6[d];
  const nx = x + dx, ny = y + dy, nz = z + dz;
  const id = r.getBlock(nx, ny, nz);
  if (rsKind(id)) return emitWeak(r, nx, ny, nz, oppositeDir(d));
  if (isConductor(id)) return blockPowerOf(r, nx, ny, nz);
  return 0;
}

/** Signal maximal reçu par un consommateur en P (portes, lampes, pistons, TNT…), sauf la direction `skip`. */
export function inputPower(r: RsReader, x: number, y: number, z: number, skip = -1): number {
  let best = 0;
  for (let d = 0; d < 6 && best < 15; d++) if (d !== skip) best = Math.max(best, signalFrom(r, x, y, z, d));
  return best;
}

// ---------- poudre de redstone ----------

/** La poudre se raccorde-t-elle au composant voisin (dans la direction horizontale h, orientation 0..3) ? */
function connectsTo(r: RsReader, x: number, y: number, z: number, h: number): boolean {
  const id = r.getBlock(x, y, z);
  const k = rsKind(id);
  if (!k) return false;
  const m = r.getMeta(x, y, z);
  switch (k) {
    case K.WIRE:
    case K.TORCH_ON:
    case K.TORCH_OFF:
    case K.RS_BLOCK:
    case K.LEVER:
    case K.BUTTON:
    case K.PLATE:
    case K.DAYLIGHT:
    case K.DAYLIGHT_INV:
    case K.COMPARATOR:
    case K.COMPARATOR_ON:
    case K.TARGET:
      return true;
    case K.REPEATER:
    case K.REPEATER_ON:
      return ((m & 3) & 1) === (h & 1);
    case K.OBSERVER:
    case K.OBSERVER_ON:
      // la sortie (dos) de l'observateur fait face à la poudre
      return oppositeDir(observerFront(m)) === oppositeDir(H2D[h]);
  }
  return false;
}

/**
 * Raccordements de la poudre en P : 2 bits par côté (orientation 0 sud, 1 ouest, 2 nord, 3 est) :
 * 0 aucun, 1 côté, 2 vers le haut (poudre sur le bloc voisin), 3 vers le bas.
 */
export function wireConnections(r: RsReader, x: number, y: number, z: number): number {
  let out = 0;
  const aboveConductor = isConductor(r.getBlock(x, y + 1, z));
  for (let h = 0; h < 4; h++) {
    const [dx, dz] = FACING_DIR[h];
    const nx = x + dx, nz = z + dz;
    const nid = r.getBlock(nx, y, nz);
    let c = 0;
    if (connectsTo(r, nx, y, nz, h)) c = 1;
    else {
      if (!aboveConductor && nid > 0 && BlockRegistry.solid[nid] && rsKind(r.getBlock(nx, y + 1, nz)) === K.WIRE) c = 2;
      else if (!isConductor(nid) && rsKind(r.getBlock(nx, y - 1, nz)) === K.WIRE) c = 3;
    }
    out |= c << (h * 2);
  }
  return out;
}

/** Côtés vers lesquels la poudre pointe (masque 4 bits par orientation) : ligne prolongée, croix si isolée. */
export function wirePoints(r: RsReader, x: number, y: number, z: number): number {
  const c = wireConnections(r, x, y, z);
  let mask = 0;
  for (let h = 0; h < 4; h++) if ((c >> (h * 2)) & 3) mask |= 1 << h;
  if (mask === 0) return 15;
  // une seule connexion : la ligne se prolonge de l'autre côté
  if (mask === 1 || mask === 2 || mask === 4 || mask === 8) {
    const h = Math.log2(mask);
    mask |= 1 << ((h + 2) & 3);
  }
  return mask;
}

/** Positions des poudres raccordées à la poudre en P. */
export function wireNeighbors(r: RsReader, x: number, y: number, z: number): [number, number, number][] {
  const c = wireConnections(r, x, y, z);
  const out: [number, number, number][] = [];
  for (let h = 0; h < 4; h++) {
    const s = (c >> (h * 2)) & 3;
    if (!s) continue;
    const [dx, dz] = FACING_DIR[h];
    const ny = s === 2 ? y + 1 : s === 3 ? y - 1 : y;
    if (rsKind(r.getBlock(x + dx, ny, z + dz)) === K.WIRE) out.push([x + dx, ny, z + dz]);
  }
  return out;
}

/** Puissance reçue par la poudre en P hors des autres poudres (sources voisines, blocs fortement alimentés). */
export function wireSourcePower(r: RsReader, x: number, y: number, z: number): number {
  let best = 0;
  for (let d = 0; d < 6 && best < 15; d++) {
    const [dx, dy, dz] = DIR6[d];
    const nx = x + dx, ny = y + dy, nz = z + dz;
    const id = r.getBlock(nx, ny, nz);
    const k = rsKind(id);
    if (k === K.WIRE) continue;
    if (k) best = Math.max(best, emitWeak(r, nx, ny, nz, oppositeDir(d)));
    else if (isConductor(id)) best = Math.max(best, strongPowerOf(r, nx, ny, nz));
  }
  return best;
}

// ---------- répéteur, comparateur, torche ----------

/** Entrée arrière d'un répéteur / comparateur en P. */
export function rearInput(r: RsReader, x: number, y: number, z: number): number {
  const out = outDir(r.getMeta(x, y, z));
  return signalFrom(r, x, y, z, oppositeDir(out));
}

/** Entrée latérale (max des deux côtés) : poudre, répéteurs, comparateurs et blocs de redstone seulement. */
export function sideInput(r: RsReader, x: number, y: number, z: number, diodesOnly = false): number {
  const m = r.getMeta(x, y, z);
  const h = m & 3;
  let best = 0;
  for (const sh of [(h + 1) & 3, (h + 3) & 3]) {
    const d = H2D[sh];
    const [dx, dy, dz] = DIR6[d];
    const nx = x + dx, ny = y + dy, nz = z + dz;
    const k = rsKind(r.getBlock(nx, ny, nz));
    const isDiode = k === K.REPEATER_ON || k === K.COMPARATOR || k === K.COMPARATOR_ON;
    if (diodesOnly ? !isDiode : !(isDiode || k === K.WIRE || k === K.RS_BLOCK)) continue;
    best = Math.max(best, k === K.RS_BLOCK ? 15 : emitWeak(r, nx, ny, nz, oppositeDir(d)));
  }
  return best;
}

/** Le support d'une torche de redstone est-il alimenté ? */
export function torchSupportPowered(r: RsReader, x: number, y: number, z: number): boolean {
  const ad = attachDir(r.getMeta(x, y, z));
  return signalFrom(r, x, y, z, ad) > 0;
}

/** Le bloc est-il une porte, une trappe ou un portillon pilotable par la redstone ? */
export function isOpenableId(id: number) {
  return rsKind(id) === K.OPENABLE;
}
export { shapeOf };
