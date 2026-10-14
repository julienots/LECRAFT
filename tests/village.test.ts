import { describe, expect, it } from 'vitest';
import { BlockRegistry, B } from '../src/blocks/BlockRegistry';
import { registerAddonBlocks } from '../src/addons/AddonRegistry';
import { EXTRA_BLOCKS } from '../src/data/vanillaExtra';
import { BiomeManager } from '../src/world/BiomeManager';
import { BEDS, BUILDING_KINDS, buildingSize, buildVillage, Frame, HAS_DOOR, JOB_SITE, planBuilding } from '../src/world/Village';
import type { StructWriter, TerrainQuery } from '../src/world/StructureGenerator';
import { FACING_DIR } from '../src/blocks/Shapes';
import { Rng } from '../src/util/math';
import type { ChunkData } from '../src/world/ChunkData';

registerAddonBlocks(EXTRA_BLOCKS);
const R = BlockRegistry;
const key = (b: number) => (b > 0 ? R.get(b).key : 'air');
const BIOMES = ['plains', 'desert', 'savanna', 'taiga', 'snowy_taiga'];
const flat = (h: number, biome = 'plains'): TerrainQuery => ({ heightAt: () => h, biomeAt: () => BiomeManager.byName(biome).id });
const hilly = (biome = 'plains'): TerrainQuery => ({
  heightAt: (x, z) => 70 + Math.round(2.5 * Math.sin(x / 9) + 2 * Math.cos(z / 7) + Math.sin((x + z) / 15)),
  biomeAt: () => BiomeManager.byName(biome).id,
});
const nowhere: StructWriter = { set() {}, setIfAir() {} };

/** Monde simulé : blocs écrits par-dessus un terrain (plein jusqu'à heightAt, air au-dessus). */
function record(t: TerrainQuery) {
  const m = new Map<string, [number, number]>();
  const w: StructWriter = {
    set: (x, y, z, b, meta = 0) => void m.set(`${x},${y},${z}`, [b, meta]),
    setIfAir: (x, y, z, b, meta = 0) => void (!m.has(`${x},${y},${z}`) && m.set(`${x},${y},${z}`, [b, meta])),
  };
  const get = (x: number, y: number, z: number) => m.get(`${x},${y},${z}`)?.[0] ?? (y <= t.heightAt(x, z) ? B.STONE : B.AIR);
  const meta = (x: number, y: number, z: number) => m.get(`${x},${y},${z}`)?.[1] ?? 0;
  return { m, w, get, meta };
}
const isDoor = (b: number) => b > 0 && R.get(b).shape === 'door';
/** Bloc sur lequel on peut marcher / qui bloque le passage (portes et neige mises à part). */
const solid = (b: number) => b > 0 && R.solid[b] === 1 && !isDoor(b) && key(b) !== 'snow';
const pass = (b: number) => !solid(b) && b !== B.WATER && b !== B.LAVA;

describe('Bâtiments de village', () => {
  for (const kind of BUILDING_KINDS.filter((k) => HAS_DOOR[k]))
    it(`${kind} : vraie porte (2 moitiés vers la rue), marche, allée, entrée libre`, () => {
      for (const biome of BIOMES)
        for (let facing = 0; facing < 4; facing++) {
          const plan = planBuilding(kind, 0, 70, 0, facing, biome, flat(69), 7);
          const at = new Map(plan.map((e) => [`${e[0]},${e[1]},${e[2]}`, e]));
          const f = new Frame(nowhere, 0, 70, 0, facing);
          const cell = (u: number, dy: number, v: number) => at.get(`${f.wx(u, v)},${70 + dy},${f.wz(u, v)}`);
          const lo = cell(0, 1, 0), hi = cell(0, 2, 0);
          const tag = `${kind}/${biome}/${facing}`;
          expect(lo && isDoor(lo[3]), tag).toBe(true);
          expect(hi?.[3], tag).toBe(lo![3]);
          expect(lo![4] & 3, tag).toBe(facing); // on entre en regardant vers l'intérieur
          expect(lo![4] & 8, tag).toBe(0);
          expect(hi![4] & 8, tag).toBe(8);
          expect(hi![4] & 3, tag).toBe(facing);
          expect(solid(cell(0, 0, 0)![3]), `${tag} sol sous la porte`).toBe(true);
          // la porte extérieure ouvre sur l'extérieur : rue en -v
          const [dx, dz] = FACING_DIR[lo![4] & 3];
          expect([dx, dz]).toEqual([f.fx, f.fz]);
          // entrée libre de part et d'autre, marche puis allée de chemin
          for (const v of [-1, 1]) for (const dy of [1, 2]) expect(pass(cell(0, dy, v)?.[3] ?? B.AIR), `${tag} ${v},${dy}`).toBe(true);
          expect(R.get(cell(0, 0, -1)![3]).shape, `${tag} marche`).toBe('stairs');
          expect(key(cell(0, -1, -2)![3]), `${tag} allée`).toMatch(/dirt_path|sandstone/);
          for (const dy of [0, 1, 2]) expect(cell(0, dy, -2)?.[3], `${tag} allée dégagée`).toBe(B.AIR);
        }
    });

  it('un lit par villageois et un bloc de métier par atelier', () => {
    for (const kind of BUILDING_KINDS) {
      const plan = planBuilding(kind, 0, 70, 0, 0, 'plains', flat(69), 3);
      const feet = plan.filter((e) => e[3] === B.RED_BED && !(e[4] & 4)).length;
      const heads = plan.filter((e) => e[3] === B.RED_BED && e[4] & 4).length;
      expect(feet, kind).toBe(BEDS[kind] ?? 0);
      expect(heads, kind).toBe(feet);
      const jobs = (JOB_SITE[kind] ?? []).filter((k) => R.has(k));
      if (jobs.length) expect(plan.some((e) => jobs.includes(key(e[3]))), `${kind} : ${jobs}`).toBe(true);
    }
  });

  it('tous les blocs restent dans l’emprise du bâtiment et sont valides', () => {
    for (const kind of BUILDING_KINDS)
      for (let facing = 0; facing < 4; facing++) {
        const [hw, depth] = buildingSize(kind);
        const f = new Frame(nowhere, 0, 70, 0, facing);
        const xs = [f.wx(-hw - 1, -2), f.wx(hw + 1, depth)], zs = [f.wz(-hw - 1, -2), f.wz(hw + 1, depth)];
        for (const [x, , z, b] of planBuilding(kind, 0, 70, 0, facing, 'taiga', hilly(), 5)) {
          expect(Number.isInteger(b) && b >= 0, `${kind} bloc ${b}`).toBe(true);
          expect(x >= Math.min(...xs) && x <= Math.max(...xs) && z >= Math.min(...zs) && z <= Math.max(...zs), `${kind} ${x},${z}`).toBe(true);
        }
      }
  });
});

describe('Village complet', () => {
  const ox = 8, oz = 8;
  const run = (t: TerrainQuery, seed: number) => {
    const r = record(t);
    buildVillage(r.w, ox, oz, new Rng(seed), t, 1);
    return r;
  };

  it('déterministe, dans le rayon de la structure, et identique écrit chunk par chunk', () => {
    const t = hilly();
    const a = run(t, 42), b = run(t, 42);
    expect([...a.m.entries()]).toEqual([...b.m.entries()]);
    for (const k of a.m.keys()) {
      const [x, , z] = k.split(',').map(Number);
      expect(Math.abs(x - ox) <= 48 && Math.abs(z - oz) <= 48, k).toBe(true);
    }
    // écriture « clippée » à quelques chunks : mêmes blocs que la version complète
    for (const [cx, cz] of [[0, 0], [1, -1], [-2, 1], [2, 2]]) {
      const got = new Map<string, number>();
      const w: StructWriter = {
        set: (x, y, z, bl) => {
          if (x >> 4 === cx && z >> 4 === cz) got.set(`${x},${y},${z}`, bl);
        },
        setIfAir() {},
      };
      buildVillage(w, ox, oz, new Rng(42), t, 1);
      for (const [k, bl] of got) expect(a.m.get(k)?.[0], k).toBe(bl);
    }
  });

  for (const biome of BIOMES)
    it(`${biome} : chaque porte est complète, praticable et reliée à la place à pied ; chaque lit dans une pièce close`, () => {
      for (const seed of [1, 2, 3]) {
        const t = seed === 1 ? flat(70, biome) : hilly(biome);
        const { m, get, meta } = run(t, seed * 977 + biome.length);
        const doors: [number, number, number][] = [];
        const beds: [number, number, number][] = [];
        for (const [k, [b, mt]] of m) {
          const [x, y, z] = k.split(',').map(Number);
          if (isDoor(b) && !(mt & 8)) doors.push([x, y, z]);
          if (b === B.RED_BED && !(mt & 4)) beds.push([x, y, z]);
        }
        expect(doors.length, `${biome}/${seed}`).toBeGreaterThanOrEqual(4);
        expect(beds.length, `${biome}/${seed}`).toBeGreaterThanOrEqual(2);
        // déplacement à pied (marche de 1 bloc au plus) depuis la place centrale
        const cy = Math.max(t.heightAt(ox, oz), 62) + 1;
        const stand = (x: number, y: number, z: number) => solid(get(x, y - 1, z)) && pass(get(x, y, z)) && pass(get(x, y + 1, z));
        const seen = new Set<string>();
        const q: [number, number, number][] = [[ox + 2, cy, oz - 2]];
        expect(stand(ox + 2, cy, oz - 2)).toBe(true);
        while (q.length) {
          const [x, y, z] = q.pop()!;
          const k = `${x},${y},${z}`;
          if (seen.has(k)) continue;
          seen.add(k);
          for (const [dx, dz] of FACING_DIR)
            for (const dy of [0, 1, -1]) {
              const nx = x + dx, ny = y + dy, nz = z + dz;
              if (Math.abs(nx - ox) > 50 || Math.abs(nz - oz) > 50) continue;
              if (dy === 1 && !pass(get(x, y + 2, z))) continue;
              if (stand(nx, ny, nz) && !seen.has(`${nx},${ny},${nz}`)) q.push([nx, ny, nz]);
            }
        }
        for (const [x, y, z] of doors) {
          const m0 = meta(x, y, z);
          expect(get(x, y + 1, z), `porte ${x},${y},${z}`).toBe(get(x, y, z));
          expect(meta(x, y + 1, z), `porte ${x},${y},${z}`).toBe(m0 | 8);
          expect(seen.has(`${x},${y},${z}`), `${biome}/${seed} porte ${x},${y},${z} inaccessible depuis la place`).toBe(true);
        }
        // chaque lit : la pièce (à hauteur du lit) est close et touche une porte
        for (const [bx, by, bz] of beds) {
          const vis = new Set<string>(), q2: [number, number][] = FACING_DIR.map(([dx, dz]) => [bx + dx, bz + dz]);
          let door = 0, escaped = false;
          while (q2.length && !escaped) {
            const [x, z] = q2.pop()!;
            const k = `${x},${z}`;
            if (vis.has(k)) continue;
            vis.add(k);
            const b = get(x, by, z);
            if (isDoor(b)) { door++; continue; }
            if (solid(b) || b === B.RED_BED) continue;
            if (Math.abs(x - bx) > 12 || Math.abs(z - bz) > 12) escaped = true;
            for (const [dx, dz] of FACING_DIR) q2.push([x + dx, z + dz]);
          }
          expect(!escaped && door > 0, `${biome}/${seed} lit ${bx},${by},${bz}`).toBe(true);
        }
      }
    });

  it('variété : cloche, métiers et décor (plaines)', () => {
    const found = new Set<string>();
    for (const seed of [11, 12, 13]) for (const [b] of run(flat(70), seed).m.values()) found.add(key(b));
    const want = ['bell', 'lectern', 'composter', 'smoker', 'cartography_table', 'brewing_stand', 'barrel', 'fletching_table', 'cauldron', 'stonecutter', 'loom', 'blast_furnace', 'smithing_table', 'grindstone'].filter((k) => R.has(k));
    const got = want.filter((k) => found.has(k));
    expect(got.length, `présents : ${got}`).toBeGreaterThanOrEqual(Math.min(want.length, 8));
    for (const k of ['dirt_path', 'hay_block', 'glass_pane', 'lantern', 'wheat', 'farmland', 'oak_door', 'red_bed']) expect(found.has(k), k).toBe(true);
  });
});


describe('Village : coût', () => {
  it('reconstruction rapide (le village est recalculé pour chaque chunk touché)', () => {
    const t = hilly();
    const w: StructWriter = { set() {}, setIfAir() {} };
    buildVillage(w, 8, 8, new Rng(5), t, 1);
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) buildVillage(w, 8, 8, new Rng(5 + i), t, 1);
    const ms = (performance.now() - t0) / 10;
    expect(ms).toBeLessThan(60);
  });
});

describe('Village dans le vrai générateur', () => {
  it('portes complètes et dégagées après génération chunk par chunk', async () => {
    const { WorldGenerator } = await import('../src/world/WorldGenerator');
    const { idx } = await import('../src/world/ChunkData');
    const gen = new WorldGenerator(12345);
    const v = gen.structures.locate('village', 0, 0, 16)!;
    expect(v).toBeTruthy();
    const chunks = new Map<string, ChunkData>();
    const c0x = (v.x - 48) >> 4, c1x = (v.x + 48) >> 4, c0z = (v.z - 48) >> 4, c1z = (v.z + 48) >> 4;
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) chunks.set(`${cx},${cz}`, gen.generateChunk(cx, cz).data);
    const get = (x: number, y: number, z: number) => {
      const c = chunks.get(`${x >> 4},${z >> 4}`);
      return c ? c.blocks[idx(x & 15, y, z & 15)] : 0;
    };
    const meta = (x: number, y: number, z: number) => chunks.get(`${x >> 4},${z >> 4}`)!.meta[idx(x & 15, y, z & 15)];
    let doors = 0;
    for (let x = v.x - 47; x <= v.x + 47; x++)
      for (let z = v.z - 47; z <= v.z + 47; z++)
        for (let y = 50; y < 120; y++) {
          const b = get(x, y, z);
          if (!isDoor(b) || meta(x, y, z) & 8) continue;
          doors++;
          const [dx, dz] = FACING_DIR[meta(x, y, z) & 3];
          expect(get(x, y + 1, z), `${x},${y},${z}`).toBe(b);
          expect(meta(x, y + 1, z), `${x},${y},${z}`).toBe(meta(x, y, z) | 8);
          for (const s of [-1, 1]) for (const dy of [0, 1]) expect(pass(get(x + dx * s, y + dy, z + dz * s)), `${x},${y},${z} ${s},${dy}`).toBe(true);
          expect(solid(get(x - dx, y - 1, z - dz)), `${x},${y},${z} marche`).toBe(true);
        }
    expect(doors).toBeGreaterThanOrEqual(5);
  }, 120000);
});
