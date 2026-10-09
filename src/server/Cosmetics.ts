/**
 * Cosmétiques du serveur HypXL : traînées de particules, chapeaux (blocs portés sur la tête),
 * compagnons (petites créatures qui suivent), couleurs de chat, rangs, gadgets et boîtes
 * mystères. Achetés avec les pièces gagnées dans les mini-jeux (profil local).
 */
import * as THREE from 'three';
import { BlockRegistry } from '../blocks/BlockRegistry';
import type { GameContext } from '../core/GameContext';
import { MOB_BY_KEY } from '../data/mobs';
import { Mob, type EntitySpawner } from '../entities/Mob';
import { AIState } from '../ai/StateMachine';
import type { TextureManager } from '../render/TextureManager';

export type CosmeticKind = 'trail' | 'hat' | 'pet' | 'color' | 'rank' | 'gadget';
export interface Cosmetic {
  id: string;
  kind: CosmeticKind;
  name: string;
  price: number;
  rarity: 'commun' | 'rare' | 'épique' | 'légendaire';
  /** Particule (traînée), bloc (chapeau), créature (compagnon), code couleur (chat, rang). */
  value: string;
  icon: string;
}

const R = { commun: 0, rare: 1, épique: 2, légendaire: 3 } as const;
export const RARITY_COLOR: Record<Cosmetic['rarity'], string> = { commun: '§a', rare: '§9', épique: '§5', légendaire: '§6' };

export const COSMETICS: Cosmetic[] = [
  // traînées
  { id: 'trail_dust', kind: 'trail', name: 'Poussière', price: 150, rarity: 'commun', value: 'dust', icon: 'sand' },
  { id: 'trail_smoke', kind: 'trail', name: 'Fumée', price: 200, rarity: 'commun', value: 'smoke', icon: 'gray_dye' },
  { id: 'trail_rain', kind: 'trail', name: 'Nuage de pluie', price: 350, rarity: 'rare', value: 'rain', icon: 'water_bucket' },
  { id: 'trail_ice', kind: 'trail', name: 'Givre', price: 400, rarity: 'rare', value: 'ice', icon: 'ice' },
  { id: 'trail_hearts', kind: 'trail', name: 'Cœurs', price: 450, rarity: 'rare', value: 'hearts', icon: 'poppy' },
  { id: 'trail_crit', kind: 'trail', name: 'Étincelles', price: 500, rarity: 'rare', value: 'crit', icon: 'iron_sword' },
  { id: 'trail_flame', kind: 'trail', name: 'Flammes', price: 650, rarity: 'épique', value: 'fire', icon: 'blaze_powder' },
  { id: 'trail_magic', kind: 'trail', name: 'Magie', price: 750, rarity: 'épique', value: 'magic', icon: 'amethyst_shard' },
  { id: 'trail_crystal', kind: 'trail', name: 'Cristaux', price: 900, rarity: 'épique', value: 'crystal', icon: 'prismarine_crystals' },
  { id: 'trail_lava', kind: 'trail', name: 'Lave', price: 1200, rarity: 'légendaire', value: 'lava', icon: 'lava_bucket' },
  // chapeaux
  { id: 'hat_pumpkin', kind: 'hat', name: 'Citrouille sculptée', price: 200, rarity: 'commun', value: 'carved_pumpkin', icon: 'carved_pumpkin' },
  { id: 'hat_melon', kind: 'hat', name: 'Pastèque', price: 250, rarity: 'commun', value: 'melon', icon: 'melon' },
  { id: 'hat_glass', kind: 'hat', name: 'Casque d’astronaute', price: 300, rarity: 'commun', value: 'glass', icon: 'glass' },
  { id: 'hat_ice', kind: 'hat', name: 'Tête gelée', price: 350, rarity: 'rare', value: 'ice', icon: 'ice' },
  { id: 'hat_tnt', kind: 'hat', name: 'TNT', price: 400, rarity: 'rare', value: 'tnt', icon: 'tnt' },
  { id: 'hat_jack', kind: 'hat', name: 'Citrouille-lanterne', price: 450, rarity: 'rare', value: 'jack_o_lantern', icon: 'jack_o_lantern' },
  { id: 'hat_slime', kind: 'hat', name: 'Bloc de slime', price: 500, rarity: 'rare', value: 'slime_block', icon: 'slime_block' },
  { id: 'hat_gold', kind: 'hat', name: 'Couronne d’or', price: 700, rarity: 'épique', value: 'gold_block', icon: 'gold_block' },
  { id: 'hat_diamond', kind: 'hat', name: 'Tête de diamant', price: 1000, rarity: 'épique', value: 'diamond_block', icon: 'diamond_block' },
  { id: 'hat_beacon', kind: 'hat', name: 'Balise', price: 1600, rarity: 'légendaire', value: 'beacon', icon: 'beacon' },
  // compagnons
  { id: 'pet_chicken', kind: 'pet', name: 'Poussin', price: 400, rarity: 'commun', value: 'chicken', icon: 'egg' },
  { id: 'pet_pig', kind: 'pet', name: 'Porcelet', price: 500, rarity: 'commun', value: 'pig', icon: 'porkchop' },
  { id: 'pet_rabbit', kind: 'pet', name: 'Lapin', price: 600, rarity: 'rare', value: 'rabbit', icon: 'carrot' },
  { id: 'pet_wolf', kind: 'pet', name: 'Louveteau', price: 800, rarity: 'rare', value: 'wolf', icon: 'bone' },
  { id: 'pet_cat', kind: 'pet', name: 'Chaton', price: 800, rarity: 'rare', value: 'cat', icon: 'cod' },
  { id: 'pet_fox', kind: 'pet', name: 'Renardeau', price: 1200, rarity: 'épique', value: 'fox', icon: 'sweet_berries' },
  { id: 'pet_bee', kind: 'pet', name: 'Abeille', price: 1100, rarity: 'épique', value: 'bee', icon: 'honeycomb' },
  { id: 'pet_parrot', kind: 'pet', name: 'Perroquet', price: 1200, rarity: 'épique', value: 'parrot', icon: 'feather' },
  { id: 'pet_axolotl', kind: 'pet', name: 'Axolotl', price: 1500, rarity: 'légendaire', value: 'axolotl', icon: 'axolotl_bucket' },
  { id: 'pet_panda', kind: 'pet', name: 'Bébé panda', price: 2000, rarity: 'légendaire', value: 'panda', icon: 'bamboo' },
  // couleurs de chat
  { id: 'color_yellow', kind: 'color', name: 'Chat jaune', price: 200, rarity: 'commun', value: '§e', icon: 'yellow_dye' },
  { id: 'color_aqua', kind: 'color', name: 'Chat turquoise', price: 200, rarity: 'commun', value: '§b', icon: 'light_blue_dye' },
  { id: 'color_green', kind: 'color', name: 'Chat vert', price: 250, rarity: 'commun', value: '§a', icon: 'lime_dye' },
  { id: 'color_pink', kind: 'color', name: 'Chat rose', price: 300, rarity: 'rare', value: '§d', icon: 'pink_dye' },
  { id: 'color_red', kind: 'color', name: 'Chat rouge', price: 300, rarity: 'rare', value: '§c', icon: 'red_dye' },
  { id: 'color_gold', kind: 'color', name: 'Chat doré', price: 600, rarity: 'épique', value: '§6', icon: 'gold_ingot' },
  // rangs
  { id: 'rank_vip', kind: 'rank', name: '[VIP]', price: 1000, rarity: 'rare', value: '§a[VIP] |§a', icon: 'emerald' },
  { id: 'rank_vipp', kind: 'rank', name: '[VIP+]', price: 2500, rarity: 'épique', value: '§a[VIP§6+§a] |§a', icon: 'emerald_block' },
  { id: 'rank_mvp', kind: 'rank', name: '[MVP]', price: 5000, rarity: 'épique', value: '§b[MVP] |§b', icon: 'diamond' },
  { id: 'rank_mvpp', kind: 'rank', name: '[MVP+]', price: 10000, rarity: 'légendaire', value: '§b[MVP§c+§b] |§b', icon: 'diamond_block' },
  // gadgets (objet dans la barre du hub)
  { id: 'gadget_firework', kind: 'gadget', name: 'Feu d’artifice', price: 300, rarity: 'commun', value: 'firework', icon: 'firework_rocket' },
  { id: 'gadget_confetti', kind: 'gadget', name: 'Canon à confettis', price: 450, rarity: 'rare', value: 'confetti', icon: 'paper' },
  { id: 'gadget_leap', kind: 'gadget', name: 'Perle de saut', price: 600, rarity: 'rare', value: 'leap', icon: 'ender_pearl' },
  { id: 'gadget_storm', kind: 'gadget', name: 'Bâton de tempête', price: 1000, rarity: 'épique', value: 'storm', icon: 'blaze_rod' },
];
export const COSMETIC_BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));
export const KIND_NAMES: Record<CosmeticKind, string> = { trail: 'Traînées', hat: 'Chapeaux', pet: 'Compagnons', color: 'Couleurs de chat', rank: 'Rangs', gadget: 'Gadgets' };
export const MYSTERY_PRICE = 250;

export interface CosmeticProfile {
  owned?: string[];
  equipped?: Partial<Record<CosmeticKind, string>>;
}

/** Tirage d'une boîte mystère : cosmétique non possédé, les raretés hautes étant plus rares. */
export function rollMystery(owned: Set<string>): Cosmetic | null {
  const pool = COSMETICS.filter((c) => !owned.has(c.id) && c.kind !== 'rank');
  if (!pool.length) return null;
  const weight = (c: Cosmetic) => [10, 5, 2, 0.7][R[c.rarity]];
  let t = Math.random() * pool.reduce((a, c) => a + weight(c), 0);
  for (const c of pool) if ((t -= weight(c)) <= 0) return c;
  return pool[pool.length - 1];
}

// ---------- rendu des chapeaux ----------
const hatCache = new Map<string, THREE.Material[]>();
/** Bloc porté sur la tête (au-dessus du crâne d'un modèle de joueur). */
export function makeHat(tm: TextureManager, blockKey: string): THREE.Mesh | null {
  if (!BlockRegistry.has(blockKey)) return null;
  let mats = hatCache.get(blockKey);
  if (!mats) {
    const b = BlockRegistry.byName(blockKey);
    mats = b.faceTiles.map((t) => {
      const tex = new THREE.CanvasTexture(tm.tile(t));
      tex.magFilter = tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.NoColorSpace;
      return new THREE.MeshBasicMaterial({ map: tex, transparent: b.render === 'translucent', alphaTest: 0.1 });
    });
    hatCache.set(blockKey, mats);
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), mats);
  mesh.position.set(0, 0.27, 0);
  mesh.name = 'hat';
  return mesh;
}

/** Pose / retire un chapeau sur la tête d'un modèle (repère : partie « head » du modèle joueur). */
export function setHat(head: THREE.Object3D | undefined, tm: TextureManager, blockKey: string | null) {
  if (!head) return;
  const old = head.getObjectByName('hat');
  if (old && old.userData.block === blockKey) return;
  if (old) head.remove(old);
  if (!blockKey) return;
  const hat = makeHat(tm, blockKey);
  if (hat) {
    hat.userData.block = blockKey;
    head.add(hat);
  }
}

// ---------- compagnons ----------
const noop = { update: () => undefined };
const IDLE = Object.fromEntries(Object.values(AIState).map((s) => [s, noop]));

/** Petite créature qui suit son maître (invulnérable, sans IA propre). */
export class Pet extends Mob {
  invulnerable = true;
  constructor(kind: string, x: number, y: number, z: number, spawner: EntitySpawner, readonly owner: () => { x: number; y: number; z: number } | null) {
    const e = MOB_BY_KEY.get(kind)!;
    super({ ...e.def, scale: (e.def.scale ?? 1) * 0.55, drops: [], xp: 0 }, e.index, x, y, z, spawner, IDLE);
    this.persistent = true;
  }
  protected customUpdate(_ctx: GameContext, _dt: number) {
    const o = this.owner();
    if (!o) {
      this.removed = true;
      return;
    }
    const d = Math.hypot(o.x - this.x, o.z - this.z);
    if (d > 18 || Math.abs(o.y - this.y) > 8) this.body.setPos(o.x + 1, o.y + 0.5, o.z + 1);
    else if (d > 2.6) this.ai.moveTowards(o.x, o.z, d > 6 ? 1.6 : 1.1, false);
    else this.ai.stop();
    if (this.body.onGround && d > 3 && Math.random() < 0.02) this.body.vy = 6;
  }
}
