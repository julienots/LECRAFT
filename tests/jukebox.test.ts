import { describe, expect, it } from 'vitest';
import { World } from '../src/world/World';
import { Chunk } from '../src/world/Chunk';
import { createChunkData, idx, computeHeights } from '../src/world/ChunkData';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';
import { EXTRA_BLOCKS, EXTRA_ITEMS } from '../src/data/vanillaExtra';
import { ItemRegistry } from '../src/inventory/ItemRegistry';
import { sourceActive } from '../src/world/Redstone';
import { ejectDisc, insertDisc, jukeboxSignal, loadJukeboxes, playingJukeboxes, serializeJukeboxes, tickJukeboxes, useJukebox, JUKEBOX_HAS_RECORD, JUKEBOX_PLAYING } from '../src/world/Jukebox';
import { CREEPER_DROP_DISCS, DISCS, LECRAFT_DISC_KEYS, creeperDiscDrop, discLabel, discSignal } from '../src/data/discs';
import { composeRecord, buildRecordSfx, recordSfxNames } from '../src/audio/Records';
import { SynthContext } from '../src/audio/Synth';
import { baseRarity } from '../src/ui/Rarity';
import { rollLoot } from '../src/blocks/BlockBehaviors';
import { LOOT } from '../src/world/StructureGenerator';

registerAddonBlocks(EXTRA_BLOCKS);
for (const it of EXTRA_ITEMS) if (!ItemRegistry.has(it.key)) ItemRegistry.register(it);
const JB = () => BlockRegistry.id('jukebox');

function flat() {
  const w = new World(1);
  for (let cx = -1; cx <= 1; cx++)
    for (let cz = -1; cz <= 1; cz++) {
      const d = createChunkData(cx, cz);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y <= 10; y++) d.blocks[idx(x, y, z)] = B.STONE;
      computeHeights(d);
      w.chunks.set(`${cx},${cz}`, new Chunk(d, `${cx},${cz}`));
    }
  w.setBlock(2, 11, 2, JB());
  return w;
}
const disc = (k: string) => ({ id: `music_disc_${k}`, count: 1 });

describe('Juke-box : insertion et éjection', () => {
  it('insère un disque, refuse un objet quelconque ou un second disque', () => {
    const w = flat();
    expect(insertDisc(w, 2, 11, 2, { id: 'stick', count: 1 })).toBe(false);
    expect(insertDisc(w, 2, 11, 2, disc('cat'))).toBe(true);
    expect(w.getMeta(2, 11, 2) & JUKEBOX_HAS_RECORD).toBeTruthy();
    expect(w.getMeta(2, 11, 2) & JUKEBOX_PLAYING).toBeTruthy();
    expect(insertDisc(w, 2, 11, 2, disc('13'))).toBe(false);
    expect(w.jukeboxes.get('2,11,2')!.disc.id).toBe('music_disc_cat');
  });
  it('éjecte le disque et vide le juke-box', () => {
    const w = flat();
    insertDisc(w, 2, 11, 2, disc('11'));
    expect(ejectDisc(w, 2, 11, 2)?.id).toBe('music_disc_11');
    expect(ejectDisc(w, 2, 11, 2)).toBeNull();
    expect(w.getMeta(2, 11, 2) & 3).toBe(0);
  });
  it('clic droit : insère puis éjecte ; accroupi ou bloc autre : rien', () => {
    const w = flat();
    expect(useJukebox(w, 2, 11, 2, disc('far'), true).action).toBe('none');
    expect(useJukebox(w, 2, 11, 2, null, false).action).toBe('none');
    expect(useJukebox(w, 2, 11, 2, disc('far'), false).action).toBe('insert');
    const r = useJukebox(w, 2, 11, 2, null, false);
    expect(r.action).toBe('eject');
    expect(r.disc?.id).toBe('music_disc_far');
    expect(useJukebox(w, 5, 5, 5, disc('far'), false).action).toBe('none');
  });
  it('casser le juke-box lâche le disque et efface son état', () => {
    const w = flat();
    insertDisc(w, 2, 11, 2, disc('wait'));
    expect(w.containerItems(2, 11, 2).map((s) => s.id)).toEqual(['music_disc_wait']);
    w.setBlock(2, 11, 2, B.AIR);
    expect(w.jukeboxes.size).toBe(0);
  });
  it('la piste se termine sans boucler, le disque reste', () => {
    const w = flat();
    insertDisc(w, 2, 11, 2, disc('mellohi'));
    let changes = 0;
    tickJukeboxes(w, 50, () => changes++);
    expect(playingJukeboxes(w).length).toBe(1);
    tickJukeboxes(w, DISCS.music_disc_mellohi.length, () => changes++);
    expect(playingJukeboxes(w).length).toBe(0);
    expect(changes).toBe(1);
    expect(w.jukeboxes.size).toBe(1);
    expect(w.getMeta(2, 11, 2) & JUKEBOX_PLAYING).toBe(0);
    expect(w.getMeta(2, 11, 2) & JUKEBOX_HAS_RECORD).toBeTruthy();
  });
  it('sauvegarde et chargement du contenu', () => {
    const w = flat();
    insertDisc(w, 2, 11, 2, disc('pigstep'));
    tickJukeboxes(w, 12.5);
    const json = JSON.parse(JSON.stringify(serializeJukeboxes(w)));
    const w2 = flat();
    loadJukeboxes(w2, json);
    expect(w2.jukeboxes.get('2,11,2')).toMatchObject({ disc: { id: 'music_disc_pigstep' }, elapsed: 12.5, playing: true });
  });
  it('en lecture, le juke-box est une source de redstone', () => {
    const w = flat();
    expect(sourceActive(w, 2, 11, 2)).toBe(false);
    insertDisc(w, 2, 11, 2, disc('cat'));
    expect(sourceActive(w, 2, 11, 2)).toBe(true);
  });
});

describe('Disques : signal de comparateur, titres, objets', () => {
  const JAVA: Record<string, number> = { '13': 1, cat: 2, blocks: 3, chirp: 4, far: 5, mall: 6, mellohi: 7, stal: 8, strad: 9, ward: 10, '11': 11, wait: 12, pigstep: 13, otherside: 14, '5': 15, relic: 14, precipice: 13, creator: 12, creator_music_box: 11, tears: 10, lava_chicken: 9 };
  it('signaux identiques au jeu original', () => {
    for (const [k, v] of Object.entries(JAVA)) expect(discSignal(`music_disc_${k}`), k).toBe(v);
    expect(discSignal(null)).toBe(0);
    const w = flat();
    expect(jukeboxSignal(w, 2, 11, 2)).toBe(0);
    insertDisc(w, 2, 11, 2, disc('5'));
    expect(jukeboxSignal(w, 2, 11, 2)).toBe(15);
  });
  it('titres', () => {
    expect(discLabel('music_disc_cat')).toBe('C418 - cat');
    expect(discLabel('music_disc_murmures')).toBe('LeCraft - murmures');
  });
  it('les 21 disques Java et les disques de LeCraft sont des objets', () => {
    for (const k of Object.keys(JAVA)) expect(ItemRegistry.has(`music_disc_${k}`), k).toBe(true);
    expect(LECRAFT_DISC_KEYS.length).toBeGreaterThanOrEqual(3);
    for (const k of LECRAFT_DISC_KEYS) {
      expect(ItemRegistry.has(k), k).toBe(true);
      expect(ItemRegistry.maxStack(k)).toBe(1);
      expect(['uncommon', 'rare']).toContain(baseRarity(k));
    }
  });
});

describe('Pistes composées', () => {
  const sr = 8000;
  const sfx = buildRecordSfx(new SynthContext(sr));
  it('chaque disque a une piste déterministe de la bonne durée', () => {
    for (const k of Object.keys(DISCS)) {
      const a = composeRecord(k)!, b = composeRecord(k)!;
      expect(a, k).not.toBeNull();
      expect(a.length).toBe(DISCS[k].length);
      expect(a.notes.length, k).toBeGreaterThan(20);
      expect(JSON.stringify(a.notes)).toBe(JSON.stringify(b.notes));
      const last = Math.max(...a.notes.map((n) => n.t + (n.voice === 'sfx' ? 0 : n.dur)));
      expect(last, k).toBeLessThanOrEqual(a.length + 0.01);
      expect(Math.min(...a.notes.map((n) => n.t))).toBeGreaterThanOrEqual(0);
      // la piste couvre au moins 70 % de sa durée
      expect(Math.max(...a.notes.map((n) => n.t)), k).toBeGreaterThan(a.length * 0.7);
      for (const name of recordSfxNames(a)) expect(sfx[name], `${k}: ${name}`).toBeDefined();
    }
  });
  it('les disques ont des pistes différentes', () => {
    const sigs = Object.keys(DISCS).map((k) => JSON.stringify(composeRecord(k)!.notes.slice(0, 40)));
    expect(new Set(sigs).size).toBe(sigs.length);
  });
  it('les bruitages sont finis et non muets', () => {
    for (const [name, buf] of Object.entries(sfx)) {
      expect(buf.length, name).toBeGreaterThan(0);
      let peak = 0;
      for (const v of buf) {
        expect(Number.isFinite(v), name).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak, name).toBeGreaterThan(0.005);
    }
  });
  it('le disque 11 contient pas, respiration et grésillement', () => {
    const names = new Set(recordSfxNames(composeRecord('music_disc_11')!));
    for (const n of ['crackle', 'breath_in', 'pant', 'heartbeat']) expect(names.has(n), n).toBe(true);
    expect([...names].some((n) => n.startsWith('step_gravel'))).toBe(true);
  });
});

describe('Disques du creeper', () => {
  it('seul un creeper tué par un squelette lâche un disque', () => {
    expect(creeperDiscDrop('creeper', 'skeleton', () => 0)).toBe('music_disc_13');
    expect(creeperDiscDrop('creeper', 'stray', () => 0.999)).toBe(CREEPER_DROP_DISCS[CREEPER_DROP_DISCS.length - 1]);
    expect(creeperDiscDrop('creeper', 'zombie')).toBeNull();
    expect(creeperDiscDrop('creeper', null)).toBeNull();
    expect(creeperDiscDrop('zombie', 'skeleton')).toBeNull();
  });
  it('le tirage couvre les disques Java prévus et ceux de LeCraft', () => {
    const seen = new Set<string>();
    for (let i = 0; i < CREEPER_DROP_DISCS.length; i++) seen.add(creeperDiscDrop('creeper', 'skeleton', () => (i + 0.5) / CREEPER_DROP_DISCS.length)!);
    expect(seen.size).toBe(CREEPER_DROP_DISCS.length);
    for (const d of ['13', 'cat', 'blocks', 'chirp', 'far', 'mall', 'mellohi', 'stal', 'strad', 'ward', '11', 'wait']) expect(seen.has(`music_disc_${d}`), d).toBe(true);
    for (const k of LECRAFT_DISC_KEYS) expect(seen.has(k), k).toBe(true);
    for (const d of seen) expect(ItemRegistry.has(d), d).toBe(true);
  });
  it('les coffres de puits de mine peuvent contenir un disque de LeCraft', () => {
    let found = 0;
    for (let s = 1; s < 4000; s++) if (rollLoot(LOOT.MINE, s).some((it) => LECRAFT_DISC_KEYS.includes(it.id))) found++;
    expect(found).toBeGreaterThan(0);
    expect(found).toBeLessThan(600);
  });
});
