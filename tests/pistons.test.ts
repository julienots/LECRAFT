import { describe, expect, it, vi } from 'vitest';
import { World } from '../src/world/World';
import { Chunk } from '../src/world/Chunk';
import { createChunkData, idx, computeHeights } from '../src/world/ChunkData';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';
import { EXTRA_BLOCKS } from '../src/data/vanillaExtra';
import { computePushList, extendPiston, retractPiston, pistonPowered, pushReaction, PistonSystem, PISTON_EXTENDED, HEAD_STICKY } from '../src/world/Pistons';
import type { GameContext } from '../src/core/GameContext';
import type { EntitySpawner } from '../src/entities/Mob';

registerAddonBlocks(EXTRA_BLOCKS);
const id = (k: string) => BlockRegistry.id(k);
// orientations : 0 sud (+Z), 1 ouest (-X), 2 nord (-Z), 3 est (+X), 4 haut, 5 bas
const EAST = 3, UP = 4;

function flat() {
  const w = new World(1);
  for (let cx = -2; cx <= 2; cx++)
    for (let cz = -2; cz <= 2; cz++) {
      const d = createChunkData(cx, cz);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y <= 10; y++) d.blocks[idx(x, y, z)] = B.STONE;
      computeHeights(d);
      w.chunks.set(`${cx},${cz}`, new Chunk(d, `${cx},${cz}`));
    }
  return w;
}
// deux cases d’air sous les pistons (le slime collerait au sol de pierre)
const Y = 13;
function setup(sticky = false, facing = EAST) {
  const w = flat();
  w.setBlock(0, Y, 0, id(sticky ? 'sticky_piston' : 'piston'), facing);
  return w;
}

describe('Pistons : liste des blocs poussés', () => {
  it('pousse un bloc et pose la tête', () => {
    const w = setup();
    w.setBlock(1, Y, 0, B.SAND);
    expect(extendPiston(w, 0, Y, 0)).not.toBeNull();
    expect(w.getBlock(1, Y, 0)).toBe(id('piston_head'));
    expect(w.getMeta(1, Y, 0)).toBe(EAST);
    expect(w.getBlock(2, Y, 0)).toBe(B.SAND);
    expect(w.getMeta(0, Y, 0)).toBe(EAST | PISTON_EXTENDED);
    // un piston sorti ne bouge plus, ni sa tête
    expect(pushReaction(w.getBlock(0, Y, 0), w.getMeta(0, Y, 0))).toBe('block');
    expect(pushReaction(id('piston_head'), 0)).toBe('block');
  });
  it('12 blocs au plus', () => {
    const w = setup();
    for (let x = 1; x <= 12; x++) w.setBlock(x, Y, 0, B.COBBLESTONE);
    const plan = computePushList(w, 0, Y, 0, EAST, true);
    expect(plan.ok).toBe(true);
    expect(plan.push.length).toBe(12);
    w.setBlock(13, Y, 0, B.COBBLESTONE);
    expect(computePushList(w, 0, Y, 0, EAST, true).ok).toBe(false);
    expect(extendPiston(w, 0, Y, 0)).toBeNull();
    expect(w.getMeta(0, Y, 0) & PISTON_EXTENDED).toBe(0);
  });
  it('blocs immobiles : obsidienne, bedrock, coffre, piston sorti', () => {
    for (const k of ['obsidian', 'bedrock', 'chest', 'crying_obsidian', 'respawn_anchor', 'enchanting_table', 'furnace', 'hopper', 'dispenser', 'barrel', 'shulker_box']) {
      if (!BlockRegistry.has(k)) continue;
      const w = setup();
      w.setBlock(1, Y, 0, B.STONE);
      w.setBlock(2, Y, 0, id(k));
      expect(computePushList(w, 0, Y, 0, EAST, true).ok, k).toBe(false);
    }
    const w = setup();
    w.setBlock(1, Y, 0, B.STONE);
    w.setBlock(2, Y, 0, id('piston'), 0);
    expect(computePushList(w, 0, Y, 0, EAST, true).ok).toBe(true); // piston rentré : déplaçable
    w.setBlock(2, Y, 0, id('piston'), PISTON_EXTENDED);
    expect(computePushList(w, 0, Y, 0, EAST, true).ok).toBe(false);
  });
  it('herbe, torche et eau sont cassées (avec leurs objets)', () => {
    const w = setup();
    w.setBlock(1, Y, 0, B.STONE);
    w.setBlock(2, Y, 0, B.SHORT_GRASS);
    const plan = computePushList(w, 0, Y, 0, EAST, true);
    expect(plan.ok).toBe(true);
    expect(plan.destroy).toEqual([[2, Y, 0]]);
    expect(pushReaction(B.TORCH, 0)).toBe('destroy');
    expect(pushReaction(B.WATER, 0)).toBe('destroy');
    const spawnItem = vi.fn();
    w.setBlock(2, Y, 0, B.TORCH);
    extendPiston(w, 0, Y, 0, { spawnItem } as unknown as EntitySpawner);
    expect(w.getBlock(2, Y, 0)).toBe(B.STONE);
    expect(spawnItem).toHaveBeenCalledWith('torch', 1, expect.any(Number), expect.any(Number), expect.any(Number));
  });
  it('vers le haut ; pas au-delà du haut du monde', () => {
    const w = setup(false, UP);
    w.setBlock(0, Y + 1, 0, B.SAND);
    expect(extendPiston(w, 0, Y, 0)).not.toBeNull();
    expect(w.getBlock(0, Y + 2, 0)).toBe(B.SAND);
    expect(w.getBlock(0, Y + 1, 0)).toBe(id('piston_head'));
  });
  it('piston collant : tire le bloc ; piston simple : le laisse', () => {
    for (const sticky of [true, false]) {
      const w = setup(sticky);
      w.setBlock(1, Y, 0, B.COBBLESTONE);
      extendPiston(w, 0, Y, 0);
      expect(w.getMeta(1, Y, 0) & HEAD_STICKY).toBe(sticky ? HEAD_STICKY : 0);
      retractPiston(w, 0, Y, 0);
      expect(w.getMeta(0, Y, 0)).toBe(EAST);
      expect(w.getBlock(1, Y, 0)).toBe(sticky ? B.COBBLESTONE : B.AIR);
      expect(w.getBlock(2, Y, 0)).toBe(sticky ? B.AIR : B.COBBLESTONE);
    }
    // obsidienne : pas tirée, le piston rentre quand même
    const w = setup(true);
    extendPiston(w, 0, Y, 0);
    w.setBlock(2, Y, 0, B.OBSIDIAN);
    retractPiston(w, 0, Y, 0);
    expect(w.getBlock(1, Y, 0)).toBe(B.AIR);
    expect(w.getBlock(2, Y, 0)).toBe(B.OBSIDIAN);
  });
  it('bloc de slime : entraîne ses voisins ; miel et slime ne collent pas', () => {
    const w = setup();
    w.setBlock(1, Y, 0, id('slime_block'));
    w.setBlock(1, Y + 1, 0, B.COBBLESTONE); // collé au-dessus
    w.setBlock(1, Y, 1, B.COBBLESTONE); // collé sur le côté
    const plan = computePushList(w, 0, Y, 0, EAST, true);
    expect(plan.ok).toBe(true);
    expect(plan.push.length).toBe(3);
    extendPiston(w, 0, Y, 0);
    expect(w.getBlock(2, Y, 0)).toBe(id('slime_block'));
    expect(w.getBlock(2, Y + 1, 0)).toBe(B.COBBLESTONE);
    expect(w.getBlock(2, Y, 1)).toBe(B.COBBLESTONE);
    expect(w.getBlock(1, Y + 1, 0)).toBe(B.AIR);

    const w2 = setup();
    w2.setBlock(1, Y, 0, id('slime_block'));
    w2.setBlock(1, Y + 1, 0, id('honey_block'));
    expect(computePushList(w2, 0, Y, 0, EAST, true).push.length).toBe(1);
    // obsidienne collée sur le côté : simplement laissée
    w2.setBlock(1, Y, 1, B.OBSIDIAN);
    expect(computePushList(w2, 0, Y, 0, EAST, true).ok).toBe(true);
  });
  it('slime : la limite de 12 compte les blocs entraînés', () => {
    const w = setup();
    w.setBlock(1, Y, 0, id('slime_block'));
    for (let y = Y + 1; y <= Y + 11; y++) w.setBlock(1, y, 0, B.COBBLESTONE); // colonne : seul le bloc touchant le slime est collé
    expect(computePushList(w, 0, Y, 0, EAST, true).push.length).toBe(2);
    const w2 = setup();
    for (let x = 1; x <= 6; x++) {
      w2.setBlock(x, Y, 0, id('slime_block'));
      w2.setBlock(x, Y + 1, 0, B.COBBLESTONE);
    }
    expect(computePushList(w2, 0, Y, 0, EAST, true).push.length).toBe(12);
    w2.setBlock(1, Y - 1, 0, B.COBBLESTONE); // 13e bloc collé (sol de pierre déjà présent : bloque aussi)
    expect(computePushList(w2, 0, Y, 0, EAST, true).ok).toBe(false);
  });
  it('slime collant qui tire une structure', () => {
    const w = setup(true);
    w.setBlock(2, Y, 0, id('slime_block'));
    w.setBlock(2, Y + 1, 0, B.COBBLESTONE);
    w.setBlock(1, Y, 0, B.AIR);
    w.setBlock(0, Y, 0, id('sticky_piston'), EAST);
    // sortie manuelle : tête en (1), slime en (2)
    w.setBlock(0, Y, 0, id('sticky_piston'), EAST | PISTON_EXTENDED);
    w.setBlock(1, Y, 0, id('piston_head'), EAST | HEAD_STICKY);
    retractPiston(w, 0, Y, 0);
    expect(w.getBlock(1, Y, 0)).toBe(id('slime_block'));
    expect(w.getBlock(1, Y + 1, 0)).toBe(B.COBBLESTONE);
    expect(w.getBlock(2, Y + 1, 0)).toBe(B.AIR);
  });
});

describe('Pistons : alimentation et système', () => {
  it('alimenté par un levier voisin, par le dessus (quasi-connectivité), pas par la face avant', () => {
    const w = setup();
    expect(pistonPowered(w, 0, Y, 0, EAST)).toBe(false);
    w.setBlock(0, Y, 1, id('lever'), 8);
    expect(pistonPowered(w, 0, Y, 0, EAST)).toBe(true);
    w.setBlock(0, Y, 1, B.AIR);
    w.setBlock(0, Y + 2, 0, id('lever'), 8);
    expect(pistonPowered(w, 0, Y, 0, EAST)).toBe(true);
    w.setBlock(0, Y + 2, 0, B.AIR);
    w.setBlock(1, Y, 0, id('redstone_block'));
    expect(pistonPowered(w, 0, Y, 0, EAST)).toBe(false);
    w.setBlock(-1, Y, 0, id('redstone_block'));
    expect(pistonPowered(w, 0, Y, 0, EAST)).toBe(true);
  });
  it('sort après 2 ticks, pousse le joueur, joue un son ; tête cassée → base cassée', () => {
    const w = setup();
    const play = vi.fn();
    const body = { x: 1.5, y: Y, z: 0.5, vy: 0, halfWidth: 0.3, height: 1.8 };
    const player = { body, dead: false, creative: false, x: 1.5, y: Y, z: 0.5, pitch: 0, yaw: 0 };
    const ctx = { world: w, player, audio: { play }, particles: { blockBreak() {} } } as unknown as GameContext;
    const spawner = { spawnItem: vi.fn(), entities: [] } as unknown as EntitySpawner;
    const sys = new PistonSystem();
    w.setBlock(-1, Y, 0, id('redstone_block'));
    sys.neighborUpdate(ctx, spawner, 0, Y, 0, w.getBlock(0, Y, 0));
    sys.tick(ctx, spawner);
    expect(w.getMeta(0, Y, 0) & PISTON_EXTENDED).toBe(0);
    sys.tick(ctx, spawner);
    expect(w.getMeta(0, Y, 0) & PISTON_EXTENDED).toBe(PISTON_EXTENDED);
    expect(body.x).toBeCloseTo(2.5);
    expect(play).toHaveBeenCalledWith('piston_out', expect.anything());
    // tête cassée : la base casse et donne un piston
    w.setBlock(1, Y, 0, B.AIR);
    sys.neighborUpdate(ctx, spawner, 0, Y, 0, w.getBlock(0, Y, 0));
    expect(w.getBlock(0, Y, 0)).toBe(B.AIR);
    expect(spawner.spawnItem).toHaveBeenCalledWith('piston', 1, expect.any(Number), expect.any(Number), expect.any(Number));
  });
  it('rentre quand le courant est coupé ; tête sans base retirée', () => {
    const w = setup();
    const ctx = { world: w, player: { body: { x: 9, y: Y, z: 9, vy: 0, halfWidth: 0.3, height: 1.8 }, dead: false }, audio: { play: vi.fn() }, particles: { blockBreak() {} } } as unknown as GameContext;
    const spawner = { spawnItem: vi.fn(), entities: [] } as unknown as EntitySpawner;
    const sys = new PistonSystem();
    extendPiston(w, 0, Y, 0);
    sys.neighborUpdate(ctx, spawner, 0, Y, 0, w.getBlock(0, Y, 0));
    sys.tick(ctx, spawner);
    sys.tick(ctx, spawner);
    expect(w.getMeta(0, Y, 0)).toBe(EAST);
    expect(w.getBlock(1, Y, 0)).toBe(B.AIR);
    w.setBlock(5, Y, 5, id('piston_head'), EAST);
    sys.neighborUpdate(ctx, spawner, 5, Y, 5, id('piston_head'));
    expect(w.getBlock(5, Y, 5)).toBe(B.AIR);
  });
  it('modèles : 6 orientations × 2 états ; base sortie de 12 px', () => {
    const p = BlockRegistry.get(id('piston'));
    expect(p.visuals?.length).toBe(16);
    expect(p.orientable).toBe(true);
    expect(p.visuals![UP | PISTON_EXTENDED].selection[0]).toEqual([0, 0, 0, 16, 12, 16]);
    expect(p.visuals![EAST | PISTON_EXTENDED].selection[0]).toEqual([0, 0, 0, 12, 16, 16]);
    expect(p.visuals![5 | PISTON_EXTENDED].selection[0]).toEqual([0, 4, 0, 16, 16, 16]);
    const h = BlockRegistry.get(id('piston_head'));
    expect(h.visuals?.length).toBe(16);
    expect(h.def.drops).toEqual([]);
  });
});
