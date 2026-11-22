import { describe, expect, it } from 'vitest';
import { World } from '../src/world/World';
import { Chunk } from '../src/world/Chunk';
import { createChunkData, idx, computeHeights } from '../src/world/ChunkData';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';
import { EXTRA_BLOCKS, EXTRA_ITEMS } from '../src/data/vanillaExtra';
import { ItemRegistry } from '../src/inventory/ItemRegistry';
import { RedstoneEngine, fillSignal } from '../src/world/Redstone';
import { wireConnections, wirePoints, inputPower } from '../src/world/RedstoneLogic';
import { pistonPowered } from '../src/world/Pistons';

registerAddonBlocks(EXTRA_BLOCKS);
for (const it of EXTRA_ITEMS) if (!ItemRegistry.has(it.key)) ItemRegistry.register(it);
const id = (k: string) => BlockRegistry.id(k);
const key = (w: World, x: number, y: number, z: number) => BlockRegistry.get(w.getBlock(x, y, z)).key;
// orientations : 0 sud (+Z), 1 ouest (-X), 2 nord (-Z), 3 est (+X)
const S = 0, W = 1, N = 2, E = 3;
const G = 11; // première couche d'air (sol de pierre jusqu'à y = 10)

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

/** Monde plat + moteur branché comme dans la session (mises à jour voisines, observateurs). */
function sim() {
  const w = flat();
  const rs = new RedstoneEngine(w);
  const primed: string[] = [];
  rs.host = { primeTnt: (x, y, z) => primed.push(`${x},${y},${z}`) };
  w.events.on('blockChanged', (e) => rs.blockChanged(e));
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      const q = w.updateQueue;
      w.updateQueue = [];
      for (let k = 0; k < q.length; k += 3) rs.notify(q[k], q[k + 1], q[k + 2]);
      rs.tick();
    }
  };
  const put = (x: number, y: number, z: number, k: string, meta = 0) => {
    w.setBlock(x, y, z, k === 'air' ? 0 : id(k), meta);
    step(1);
  };
  return { w, rs, step, put, primed };
}
const power = (w: World, x: number, y: number, z: number) => w.getMeta(x, y, z) & 15;

describe('Redstone : poudre', () => {
  it('perd 1 par bloc depuis un levier et allume une lampe au bout', () => {
    const { w, put, step } = sim();
    for (let x = 1; x <= 16; x++) put(x, G, 0, 'redstone_wire');
    put(0, G, 0, 'lever', 0);
    put(17, G, 0, 'redstone_lamp');
    expect(power(w, 1, G, 0)).toBe(0);
    w.setBlock(0, G, 0, id('lever'), 8, false);
    RedstoneEngine.for(w).notifyAround(0, G, 0);
    step(1);
    for (let x = 1; x <= 15; x++) expect(power(w, x, G, 0), `x=${x}`).toBe(16 - x);
    expect(power(w, 16, G, 0)).toBe(0);
    expect(key(w, 17, G, 0)).toBe('redstone_lamp');
    // lampe à 14 blocs : allumée
    put(15, G, 1, 'redstone_lamp');
    expect(key(w, 15, G, 1)).toBe('redstone_lamp');
    // la ligne ne pointe pas vers le côté : lampe à côté d'une ligne droite éteinte (comme le jeu)
    put(3, G, 0, 'redstone_wire');
    put(3, G, 1, 'redstone_lamp');
    expect(key(w, 3, G, 1)).toBe('redstone_lamp');
    put(16, G, 0, 'redstone_lamp');
    expect(key(w, 16, G, 0)).toBe('redstone_lamp_on');
  });

  it('se raccorde, monte et descend les blocs, croix si isolée', () => {
    const { w, put } = sim();
    put(0, G, 0, 'redstone_wire');
    expect(wirePoints(w, 0, G, 0)).toBe(15);
    put(1, G, 0, 'stone');
    put(1, G + 1, 0, 'redstone_wire');
    // vers l'est (orientation 3) : montée (2)
    expect((wireConnections(w, 0, G, 0) >> 6) & 3).toBe(2);
    // vers l'ouest depuis le haut : descente (3)
    expect((wireConnections(w, 1, G + 1, 0) >> 2) & 3).toBe(3);
    // un bloc conducteur au-dessus coupe la montée
    put(0, G + 1, 0, 'stone');
    expect(wireConnections(w, 0, G, 0)).toBe(0);
  });

  it('alimente le bloc sous elle et celui vers lequel elle pointe (faiblement)', () => {
    const { w, put, step } = sim();
    put(0, G, 0, 'redstone_block');
    put(1, G, 0, 'redstone_wire');
    put(2, G, 0, 'redstone_wire');
    put(3, G, 0, 'stone');
    // lampe derrière le bloc pointé : allumée (bloc faiblement alimenté → composants voisins)
    put(4, G, 0, 'redstone_lamp');
    step(1);
    expect(key(w, 4, G, 0)).toBe('redstone_lamp_on');
    // poudre derrière le bloc faiblement alimenté : rien
    put(4, G, 1, 'redstone_wire');
    put(3, G, 1, 'air');
    put(4, G, 0, 'redstone_wire');
    expect(power(w, 4, G, 0)).toBe(0);
  });

  it('un répéteur alimente fortement un bloc : la poudre derrière s’allume', () => {
    const { w, put, step } = sim();
    put(0, G, 0, 'redstone_block');
    put(1, G, 0, 'repeater', E);
    put(2, G, 0, 'stone');
    put(3, G, 0, 'redstone_wire');
    step(3);
    expect(key(w, 1, G, 0)).toBe('repeater_on');
    expect(power(w, 3, G, 0)).toBe(15);
  });
});

describe('Redstone : torches', () => {
  it('s’éteint 2 ticks après l’alimentation de son support', () => {
    const { w, put, step } = sim();
    put(1, G, 0, 'stone');
    // torche murale à l'est du bloc : support à l'ouest (orientation 1 → méta 2)
    put(2, G, 0, 'redstone_torch', W + 1);
    put(3, G, 0, 'redstone_lamp');
    step(1);
    expect(key(w, 3, G, 0)).toBe('redstone_lamp_on');
    // un bloc de redstone n'alimente pas le bloc voisin (pas de puissance forte) : torche allumée
    put(0, G, 0, 'redstone_block');
    step(4);
    expect(key(w, 2, G, 0)).toBe('redstone_torch');
    // levier fixé sur le bloc (au sud, support au nord : méta 3, activé : bit 8)
    put(1, G, 1, 'lever', (N + 1) | 8);
    expect(key(w, 2, G, 0)).toBe('redstone_torch');
    step(2);
    expect(key(w, 2, G, 0)).toBe('redstone_torch_off');
    step(4);
    expect(key(w, 3, G, 0)).toBe('redstone_lamp');
  });

  it('alimente fortement le bloc au-dessus', () => {
    const { w, put, step } = sim();
    put(0, G, 0, 'redstone_torch', 0);
    put(0, G + 1, 0, 'stone');
    put(1, G + 1, 0, 'redstone_wire');
    step(1);
    expect(power(w, 1, G + 1, 0)).toBe(15);
  });

  it('grille dans une horloge trop rapide puis reste éteinte', () => {
    const { w, put, step } = sim();
    put(1, G, 0, 'stone');
    put(0, G, 0, 'redstone_torch', E + 1);
    put(0, G, 1, 'redstone_wire');
    put(1, G, 1, 'redstone_wire');
    put(1, G + 1, 0, 'redstone_wire');
    let toggles = 0, last = key(w, 0, G, 0);
    for (let i = 0; i < 120; i++) {
      step(1);
      const k = key(w, 0, G, 0);
      if (k !== last) toggles++;
      last = k;
    }
    expect(toggles).toBeGreaterThan(6);
    expect(toggles).toBeLessThan(30);
    expect(key(w, 0, G, 0)).toBe('redstone_torch_off');
  });
});

describe('Redstone : répéteur', () => {
  it('délai de 1 à 4 ticks de redstone', () => {
    for (let delay = 1; delay <= 4; delay++) {
      const { w, put, step } = sim();
      put(1, G, 0, 'repeater', E | ((delay - 1) << 2));
      put(2, G, 0, 'redstone_lamp');
      put(0, G, 0, 'redstone_block');
      // le tick de pose compte déjà
      step(delay * 2 - 1);
      expect(key(w, 1, G, 0), `délai ${delay}`).toBe('repeater');
      step(1);
      expect(key(w, 1, G, 0), `délai ${delay}`).toBe('repeater_on');
      expect(key(w, 2, G, 0)).toBe('redstone_lamp_on');
    }
  });

  it('prolonge une impulsion courte jusqu’à son délai', () => {
    const { w, put, step } = sim();
    put(1, G, 0, 'repeater', E | (3 << 2));
    put(0, G, 0, 'redstone_block');
    put(0, G, 0, 'air');
    step(10);
    expect(key(w, 1, G, 0)).toBe('repeater_on');
    step(8);
    expect(key(w, 1, G, 0)).toBe('repeater');
  });

  it('verrouillé par un répéteur latéral allumé', () => {
    const { w, put, step } = sim();
    put(1, G, 0, 'repeater', E);
    // répéteur latéral au nord, sortie vers le sud (dans le côté du premier)
    put(1, G, -2, 'redstone_block');
    put(1, G, -1, 'repeater', S);
    step(4);
    expect(w.getMeta(1, G, 0) & 16).toBe(16);
    put(0, G, 0, 'redstone_block');
    step(6);
    expect(key(w, 1, G, 0)).toBe('repeater');
  });
});

describe('Redstone : comparateur', () => {
  it('compare et soustrait', () => {
    const { w, put, step, rs } = sim();
    put(0, G, 0, 'redstone_block');
    put(1, G, 0, 'comparator', E);
    put(2, G, 0, 'redstone_wire');
    // entrée latérale : poudre à 13 (levier à 2 blocs)
    put(1, G, 1, 'redstone_wire');
    put(1, G, 2, 'redstone_wire');
    put(1, G, 3, 'redstone_wire');
    put(2, G, 3, 'lever', 8);
    rs.notifyAround(2, G, 3);
    step(4);
    expect(power(w, 1, G, 1)).toBe(13);
    expect(key(w, 1, G, 0)).toBe('comparator_on');
    expect(power(w, 2, G, 0)).toBe(15);
    // soustraction : 15 - 13 = 2
    w.setBlock(1, G, 0, w.getBlock(1, G, 0), w.getMeta(1, G, 0) | 4, false);
    rs.notifyAround(1, G, 0);
    step(4);
    expect(power(w, 2, G, 0)).toBe(2);
  });

  it('lit le remplissage d’un coffre (formule du jeu)', () => {
    const { w, put, step } = sim();
    put(0, G, 0, 'chest');
    put(1, G, 0, 'comparator', E);
    put(2, G, 0, 'redstone_wire');
    step(4);
    expect(power(w, 2, G, 0)).toBe(0);
    const inv = w.getChest(0, G, 0, true)!;
    inv.slots[0] = { id: 'cobblestone', count: 64 };
    step(6);
    expect(power(w, 2, G, 0)).toBe(fillSignal(inv.slots, 27));
    expect(fillSignal([{ id: 'cobblestone', count: 64 }], 27)).toBe(1);
    expect(fillSignal(Array.from({ length: 27 }, () => ({ id: 'cobblestone', count: 64 })), 27)).toBe(15);
  });
});

describe('Redstone : observateur, consommateurs', () => {
  it('l’observateur émet une impulsion de 2 ticks quand son bloc change', () => {
    const { w, put, step } = sim();
    // face avant à l'ouest (orientation 1), sortie à l'est
    put(1, G, 0, 'observer', W);
    put(2, G, 0, 'redstone_wire');
    step(4);
    expect(key(w, 1, G, 0)).toBe('observer');
    w.setBlock(0, G, 0, id('stone'));
    let on = 0;
    for (let i = 0; i < 8; i++) {
      step(1);
      if (key(w, 1, G, 0) === 'observer_on') {
        on++;
        expect(power(w, 2, G, 0)).toBe(15);
      }
    }
    expect(on).toBe(2);
    expect(power(w, 2, G, 0)).toBe(0);
  });

  it('pistons, portes en fer, TNT et ampoules en cuivre', () => {
    const { w, put, step, primed } = sim();
    put(0, G, 0, 'piston', E);
    put(-2, G, 0, 'lever', 8);
    put(-1, G, 0, 'redstone_wire');
    step(1);
    expect(pistonPowered(w, 0, G, 0, E)).toBe(true);
    // porte en fer
    put(5, G, 0, 'iron_door', 0);
    w.setBlock(5, G + 1, 0, id('iron_door'), 8);
    put(5, G, 1, 'redstone_block');
    expect(w.getMeta(5, G, 0) & 4).toBe(4);
    put(5, G, 1, 'air');
    expect(w.getMeta(5, G, 0) & 4).toBe(0);
    // TNT
    put(8, G, 0, 'tnt');
    put(8, G, 1, 'redstone_block');
    expect(primed).toContain(`8,${G},0`);
    // ampoule : bascule à chaque front montant
    put(10, G, 0, 'copper_bulb');
    put(10, G, 1, 'redstone_block');
    expect(key(w, 10, G, 0)).toBe('copper_bulb_lit_powered');
    put(10, G, 1, 'air');
    expect(key(w, 10, G, 0)).toBe('copper_bulb_lit');
    put(10, G, 1, 'redstone_block');
    expect(key(w, 10, G, 0)).toBe('copper_bulb_powered');
  });

  it('les états allumés redonnent l’objet de base ; la poudre redonne de la redstone', () => {
    const drops = (k: string) => BlockRegistry.get(id(k)).def.drops?.[0]?.item;
    expect(drops('redstone_wire')).toBe('redstone');
    expect(drops('redstone_torch_off')).toBe('redstone_torch');
    expect(drops('repeater_on')).toBe('repeater');
    expect(drops('comparator_on')).toBe('comparator');
    expect(drops('redstone_lamp_on')).toBe('redstone_lamp');
    expect(ItemRegistry.get('redstone')!.place).toBe('redstone_wire');
    // signal de consommateur : rien sans source
    const { w } = sim();
    expect(inputPower(w, 0, G, 0)).toBe(0);
  });
});
