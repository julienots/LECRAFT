/**
 * Blocs de redstone : poudre posée (bloc ajouté en dernier pour garder les identifiants des mondes
 * existants), états allumés / éteints qui redonnent l'objet de base, orientations.
 * Textures dessinées ici (aucune image du jeu de référence) ; elles sont en niveaux de gris pour
 * être teintées selon la puissance (src/render/ChunkMesher.ts).
 */
import type { BlockDef } from '../blocks/Block';
import { registerPainter } from '../render/TextureGenerator';

export const REDSTONE_WIRE_DEF: BlockDef = {
  key: 'redstone_wire',
  name: 'Poudre de redstone',
  textures: { top: 'redstone_dust_dot', bottom: 'redstone_dust_dot', side: 'redstone_dust_line0' },
  hardness: 0,
  render: 'model',
  shape: 'carpet',
  solid: false,
  needsSupport: true,
  sound: 'stone',
  drops: [{ item: 'redstone' }],
  color: '#b01000',
};

/** Variante d'état → objet de base (casser une torche éteinte redonne une torche…). */
const BASE: Record<string, string> = {
  redstone_torch_off: 'redstone_torch',
  repeater_on: 'repeater',
  comparator_on: 'comparator',
  redstone_lamp_on: 'redstone_lamp',
  observer_on: 'observer',
  powered_rail_on: 'powered_rail',
  daylight_detector_inverted: 'daylight_detector',
};

export function patchRedstoneDefs(defs: BlockDef[]) {
  for (const d of defs) {
    const base = BASE[d.key] ?? (/copper_bulb(_lit)?(_powered)?$/.test(d.key) && /_(lit|powered)$/.test(d.key) ? d.key.replace(/_powered$/, '').replace(/_lit$/, '') : undefined);
    if (base) d.drops = [{ item: base }];
    if (d.key === 'repeater' || d.key === 'repeater_on' || d.key === 'comparator' || d.key === 'comparator_on') {
      d.hardness = 0;
      d.tool = undefined;
      d.sound = 'stone';
      d.needsSupport = true;
    }
    if (d.key === 'redstone_torch' || d.key === 'redstone_torch_off') d.sound = 'wood';
    if (d.key === 'observer' || d.key === 'observer_on') d.orientable = true;
    // observateur activé : garde sa face avant (seul le dos s'allume)
    if (d.key === 'observer_on' && d.textures && !d.textures.front) d.textures = { ...d.textures, front: 'observer' };
    if (d.key === 'redstone_lamp') d.sound = 'glass';
    if (d.key === 'redstone_lamp_on') {
      d.sound = 'glass';
      d.light = 15;
    }
  }
}

// ---------- textures de la poudre (niveaux de gris, teintées au rendu) ----------
const g = (v: number): [number, number, number] => [v, v, v];
const noise = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

registerPainter('redstone_dust_dot', (t) => {
  t.clear();
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      const n = noise(x, y) % 7;
      if (d < 3.2 || (d < 4.6 && n > 2)) t.set(x, y, g(d < 2 ? 255 : 215 + n * 5), 200);
    }
});
registerPainter('redstone_dust_line0', (t) => {
  t.clear();
  for (let y = 0; y < 16; y++)
    for (let x = 5; x <= 10; x++) {
      const n = noise(x, y) % 7;
      const edge = x === 5 || x === 10;
      if (edge && n < 4) continue;
      t.set(x, y, g(edge ? 200 + n * 5 : x === 7 || x === 8 ? 255 : 230), 200);
    }
});
registerPainter('redstone_dust_line1', (t) => {
  t.clear();
  for (let x = 0; x < 16; x++)
    for (let y = 5; y <= 10; y++) {
      const n = noise(y, x) % 7;
      const edge = y === 5 || y === 10;
      if (edge && n < 4) continue;
      t.set(x, y, g(edge ? 200 + n * 5 : y === 7 || y === 8 ? 255 : 230), 200);
    }
});
