import { describe, expect, it } from 'vitest';
import { World } from '../src/world/World';
import { Chunk } from '../src/world/Chunk';
import { createChunkData, idx, computeHeights } from '../src/world/ChunkData';
import { B } from '../src/blocks/BlockRegistry';
import { Player } from '../src/player/Player';
import { PlayerController } from '../src/player/PlayerController';
import { InputState } from '../src/input/InputState';
import type { Settings } from '../src/core/Settings';
import { makeStack } from '../src/inventory/Inventory';
import { canGlideWith, glideTick, wallDamage } from '../src/player/Elytra';

function flatWorld(groundY = 10) {
  const w = new World(1);
  for (let cx = -2; cx <= 1; cx++)
    for (let cz = -8; cz <= 1; cz++) {
      const d = createChunkData(cx, cz);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y <= groundY; y++) d.blocks[idx(x, y, z)] = B.STONE;
      computeHeights(d);
      w.chunks.set(`${cx},${cz}`, new Chunk(d, `${cx},${cz}`));
    }
  return w;
}

function setup() {
  const p = new Player('survival', 'normal');
  const input = new InputState();
  const c = new PlayerController(p, input, { autoJump: false } as Settings);
  p.inventory.armor.chest = { id: 'elytra', count: 1, durability: 432 };
  return { p, input, c };
}

describe('Élytres', () => {
  it('formule Java : plané stable à l’horizontale (~ -0,02 bloc/tick de gravité nette)', () => {
    const v = { x: 0, y: -0.5, z: -1 };
    for (let i = 0; i < 200; i++) glideTick(v, 0, 0);
    // vol horizontal : la vitesse se stabilise vers l'avant (-Z), descente lente
    expect(v.z).toBeLessThan(-0.3);
    expect(Math.abs(v.x)).toBeLessThan(1e-9);
    expect(v.y).toBeGreaterThan(-0.6);
    expect(v.y).toBeLessThan(0);
  });
  it('piqué : accélère ; cabré : échange vitesse contre altitude', () => {
    const dive = { x: 0, y: 0, z: -0.5 };
    for (let i = 0; i < 40; i++) glideTick(dive, 0, -Math.PI / 3);
    expect(Math.hypot(dive.x, dive.y, dive.z)).toBeGreaterThan(1.5);
    const climb = { x: 0, y: 0, z: -2 };
    glideTick(climb, 0, Math.PI / 4);
    expect(climb.y).toBeGreaterThan(0);
    expect(Math.abs(climb.z)).toBeLessThan(2);
  });
  it('dégâts d’impact et élytres cassées', () => {
    expect(wallDamage(1, 0)).toBeCloseTo(7);
    expect(wallDamage(0.3, 0)).toBe(0);
    expect(canGlideWith({ id: 'elytra', count: 1, durability: 1 })).toBe(false);
    expect(canGlideWith({ id: 'elytra', count: 1, durability: 2 })).toBe(true);
    expect(canGlideWith(null)).toBe(false);
  });
  it('saut en l’air pendant la chute → vol plané, puis arrêt au sol', () => {
    const w = flatWorld(10);
    const { p, input, c } = setup();
    p.body.setPos(0.5, 60, 0.5);
    p.body.vy = -5;
    c.update(w, 1 / 60);
    expect(c.gliding).toBe(false);
    input.jump = true;
    c.update(w, 1 / 60);
    expect(c.gliding).toBe(true);
    expect(p.body.height).toBeCloseTo(0.6);
    p.pitch = -0.2;
    const dur0 = p.inventory.armor.chest!.durability!;
    for (let i = 0; i < 60 * 20 && c.gliding; i++) c.update(w, 1 / 60);
    expect(c.gliding).toBe(false);
    expect(p.body.onGround).toBe(true);
    // on a avancé vers -Z et usé les élytres (~1 point/s)
    expect(p.body.z).toBeLessThan(-20);
    expect(p.inventory.armor.chest!.durability!).toBeLessThan(dur0);
  });
  it('pas de vol plané sans élytres ni avec un saut maintenu depuis le sol', () => {
    const w = flatWorld(10);
    const { p, input, c } = setup();
    p.inventory.armor.chest = null;
    p.body.setPos(0.5, 60, 0.5);
    p.body.vy = -5;
    input.jump = true;
    c.update(w, 1 / 60);
    expect(c.gliding).toBe(false);
    p.inventory.armor.chest = { id: 'elytra', count: 1, durability: 432 };
    c.update(w, 1 / 60); // saut toujours maintenu : pas un nouvel appui
    expect(c.gliding).toBe(false);
  });
  it('fusée : poussée seulement en vol plané', () => {
    const w = flatWorld(10);
    const { p, input, c } = setup();
    expect(c.useFirework('firework_rocket')).toBe(false);
    p.body.setPos(0.5, 60, 0.5);
    p.body.vy = -5;
    input.jump = true;
    c.update(w, 1 / 60);
    p.inventory.slots[0] = makeStack('firework_rocket', 3);
    expect(c.useFirework('firework_rocket')).toBe(true);
    expect(p.inventory.slots[0]!.count).toBe(2);
    for (let i = 0; i < 30; i++) c.update(w, 1 / 60);
    // regard horizontal vers -Z : ~1,5 bloc/tick = 30 blocs/s
    expect(-p.body.vz).toBeGreaterThan(20);
  });
});
