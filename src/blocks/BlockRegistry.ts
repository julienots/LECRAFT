import type { Block, BlockDef, ShapeKind } from './Block';
import { BLOCK_DEFS } from '../data/blocks';
import { TileRegistry } from '../render/TileRegistry';
import { BLOCK_MODELS } from '../data/blockModels';
import { buildJavaVisuals } from './JavaModels';

/** Nombre maximal de blocs (identifiants sur 16 bits, tables de lookup bornées). */
export const MAX_BLOCKS = 4096;
const RENDER_TYPES = ['none', 'cube', 'cutout', 'cross', 'liquid', 'translucent', 'model'] as const;
export const SHAPES: ShapeKind[] = ['slab', 'stairs', 'door', 'ladder', 'fence', 'pane', 'bed', 'torch', 'chest', 'farmland', 'snow_layer', 'cactus', 'plate', 'lantern', 'custom', 'trapdoor', 'fence_gate', 'lever', 'button', 'lily_pad', 'wall', 'carpet', 'end_frame', 'end_portal'];

/**
 * Registre des blocs : convertit les définitions data-driven en objets compacts
 * accessibles par ID numérique (tableaux plats pour les boucles chaudes du mesher/physique).
 */
class BlockRegistryImpl {
  readonly blocks: Block[] = [];
  private byKey = new Map<string, Block>();
  // Tables de lookup rapides (utilisées par le mesher et la physique)
  solid = new Uint8Array(MAX_BLOCKS);
  opaque = new Uint8Array(MAX_BLOCKS);
  lightEmit = new Uint8Array(MAX_BLOCKS);
  lightFilter = new Uint8Array(MAX_BLOCKS);
  renderType = new Uint8Array(MAX_BLOCKS); // 0 none,1 cube,2 cutout,3 cross,4 liquid,5 translucent,6 model
  liquid = new Uint8Array(MAX_BLOCKS); // 0 none, 1 water, 2 lava
  replaceable = new Uint8Array(MAX_BLOCKS);
  /** Forme : 0 = aucune, sinon index+1 dans SHAPES. */
  shape = new Uint8Array(MAX_BLOCKS);
  /** Teinte : 0 aucune, 1 herbe, 2 feuillage, 3 couleur fixe (tintColor). */
  tintType = new Uint8Array(MAX_BLOCKS);
  tintColor = new Uint32Array(MAX_BLOCKS);
  climbable = new Uint8Array(MAX_BLOCKS);

  constructor(defs: BlockDef[]) {
    defs.forEach((d) => this.register(d));
  }

  register(def: BlockDef): Block {
    if (this.byKey.has(def.key)) throw new Error(`Bloc dupliqué: ${def.key}`);
    const id = this.blocks.length;
    if (id >= MAX_BLOCKS) throw new Error(`Maximum ${MAX_BLOCKS} blocs`);
    // modèle 3D du jeu de référence (lanternes, chaudrons, enclumes…) : rendu par quads précalculés
    const model = def.bedrock ? undefined : BLOCK_MODELS[def.key];
    const shapeKind: ShapeKind | undefined = model ? 'custom' : def.shape;
    const render = model ? 'model' : def.render ?? (def.shape ? 'model' : 'cube');
    const solid = model ? model.collision?.length !== 0 && def.solid !== false : def.solid ?? !(render === 'none' || render === 'cross' || render === 'liquid');
    const opaque = render === 'cube';
    const t = def.textures ?? {};
    const tile = (n?: string) => (n ? TileRegistry.index(n) : 0);
    const side = t.side ?? t.all ?? t.byMeta?.[0];
    const top = t.top ?? t.all ?? t.byMeta?.[0];
    const bottom = t.bottom ?? t.all ?? t.byMeta?.[0];
    const faceTiles = [tile(t.east ?? side), tile(t.west ?? side), tile(top), tile(bottom), tile(t.front ?? side), tile(t.back ?? side)];
    const block: Block = {
      id,
      key: def.key,
      name: def.name,
      hardness: def.hardness,
      def,
      render,
      shape: shapeKind ?? null,
      visuals: model ? buildJavaVisuals(model) : undefined,
      solid,
      opaque,
      transparent: !opaque,
      liquid: def.liquid ?? null,
      light: def.light ?? 0,
      lightFilter: def.lightFilter ?? (opaque ? 15 : 0),
      replaceable: def.replaceable ?? false,
      gravity: def.gravity ?? false,
      flammable: def.flammable ?? false,
      tool: def.tool ?? null,
      minTier: def.minTier ?? 0,
      sound: def.sound ?? 'stone',
      faceTiles,
      metaTiles: t.byMeta ? t.byMeta.map((n) => TileRegistry.index(n)) : null,
      sway: def.sway ?? false,
      contactDamage: def.contactDamage ?? 0,
      friction: def.friction ?? 0,
      interact: def.interact ?? null,
      needsSupport: def.needsSupport ?? false,
      supportBlocks: def.supportBlocks ?? null,
      orientable: def.orientable ?? model?.facing ?? false,
      climbable: def.climbable ?? false,
      drops: def.drops ?? [{ item: def.key }],
      color: def.color ?? '#888888',
    };
    this.blocks.push(block);
    this.byKey.set(def.key, block);
    this.solid[id] = solid ? 1 : 0;
    this.opaque[id] = opaque ? 1 : 0;
    this.lightEmit[id] = block.light;
    this.lightFilter[id] = block.lightFilter;
    this.renderType[id] = RENDER_TYPES.indexOf(render);
    this.liquid[id] = block.liquid === 'water' ? 1 : block.liquid === 'lava' ? 2 : 0;
    this.replaceable[id] = block.replaceable ? 1 : 0;
    this.shape[id] = shapeKind ? SHAPES.indexOf(shapeKind) + 1 : 0;
    this.climbable[id] = block.climbable ? 1 : 0;
    if (def.tint === 'grass') this.tintType[id] = 1;
    else if (def.tint === 'foliage') this.tintType[id] = 2;
    else if (def.tint) {
      this.tintType[id] = 3;
      this.tintColor[id] = parseInt(def.tint.slice(1), 16);
    }
    return block;
  }

  get(id: number): Block {
    return this.blocks[id] ?? this.blocks[0];
  }
  byName(key: string): Block {
    const b = this.byKey.get(key);
    if (!b) throw new Error(`Bloc inconnu: ${key}`);
    return b;
  }
  has(key: string): boolean {
    return this.byKey.has(key);
  }
  id(key: string): number {
    return this.byName(key).id;
  }
  isShape(id: number, kind: ShapeKind) {
    return this.shape[id] === SHAPES.indexOf(kind) + 1;
  }
}

export const BlockRegistry = new BlockRegistryImpl(BLOCK_DEFS);

/** Identifiants des blocs par clé en majuscules (B.STONE, B.OAK_LOG...). */
export const B = Object.freeze(Object.fromEntries(BLOCK_DEFS.map((d, i) => [d.key.toUpperCase(), i])) as Record<string, number>);
