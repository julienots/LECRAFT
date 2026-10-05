import type { Block, BlockDef } from './Block';
import { BLOCK_DEFS } from '../data/blocks';
import { TileRegistry } from '../render/TileRegistry';

/**
 * Registre des blocs : convertit les définitions data-driven en objets compacts
 * accessibles par ID numérique (tableaux plats pour les boucles chaudes du mesher/physique).
 */
class BlockRegistryImpl {
  readonly blocks: Block[] = [];
  private byKey = new Map<string, Block>();
  // Tables de lookup rapides (utilisées par le mesher et la physique)
  solid = new Uint8Array(256);
  opaque = new Uint8Array(256);
  lightEmit = new Uint8Array(256);
  lightFilter = new Uint8Array(256);
  renderType = new Uint8Array(256); // 0 none,1 cube,2 cutout,3 cross,4 liquid,5 translucent
  liquid = new Uint8Array(256); // 0 none, 1 water, 2 lava
  replaceable = new Uint8Array(256);

  constructor(defs: BlockDef[]) {
    defs.forEach((d) => this.register(d));
  }

  register(def: BlockDef): Block {
    if (this.byKey.has(def.key)) throw new Error(`Bloc dupliqué: ${def.key}`);
    const id = this.blocks.length;
    if (id > 255) throw new Error('Maximum 256 blocs (stockage Uint8)');
    const render = def.render ?? 'cube';
    const solid = def.solid ?? !(render === 'none' || render === 'cross' || render === 'liquid');
    const opaque = render === 'cube';
    const t = def.textures ?? {};
    const tile = (n?: string) => (n ? TileRegistry.index(n) : 0);
    const side = t.side ?? t.all ?? t.byMeta?.[0];
    const top = t.top ?? t.all ?? t.byMeta?.[0];
    const bottom = t.bottom ?? t.all ?? t.byMeta?.[0];
    const faceTiles = [tile(side), tile(side), tile(top), tile(bottom), tile(t.front ?? side), tile(side)];
    const block: Block = {
      id,
      key: def.key,
      name: def.name,
      hardness: def.hardness,
      def,
      render,
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
      orientable: def.orientable ?? !!t.front,
      drops: def.drops ?? [{ item: def.key }],
      color: def.color ?? '#888888',
    };
    this.blocks.push(block);
    this.byKey.set(def.key, block);
    this.solid[id] = solid ? 1 : 0;
    this.opaque[id] = opaque ? 1 : 0;
    this.lightEmit[id] = block.light;
    this.lightFilter[id] = block.lightFilter;
    this.renderType[id] = ['none', 'cube', 'cutout', 'cross', 'liquid', 'translucent'].indexOf(render);
    this.liquid[id] = block.liquid === 'water' ? 1 : block.liquid === 'lava' ? 2 : 0;
    this.replaceable[id] = block.replaceable ? 1 : 0;
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
}

export const BlockRegistry = new BlockRegistryImpl(BLOCK_DEFS);

/** Identifiants fréquemment utilisés (résolus une fois). */
export const B = Object.freeze(
  Object.fromEntries(BLOCK_DEFS.map((d, i) => [d.key.toUpperCase(), i])) as Record<string, number>,
);
