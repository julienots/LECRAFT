import { describe, expect, it } from 'vitest';
import { World } from '../src/world/World';
import { Chunk } from '../src/world/Chunk';
import { createChunkData, idx, computeHeights } from '../src/world/ChunkData';
import { B, BlockRegistry } from '../src/blocks/BlockRegistry';
import { Player } from '../src/player/Player';
import { PlayerController } from '../src/player/PlayerController';
import { InputState } from '../src/input/InputState';
import type { Settings } from '../src/core/Settings';

/**
 * Mouvement du joueur comparé au jeu de référence (Java 1.21) : vitesses mesurées en régime
 * établi, à 60 et 20 images/s (le résultat ne doit pas dépendre de la fréquence d'affichage).
 */
function flatWorld(groundY = 10) {
  const w = new World(1);
  for (let cx = -2; cx <= 1; cx++)
    for (let cz = -12; cz <= 1; cz++) {
      const d = createChunkData(cx, cz);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y <= groundY; y++) d.blocks[idx(x, y, z)] = B.STONE;
      computeHeights(d);
      w.chunks.set(`${cx},${cz}`, new Chunk(d, `${cx},${cz}`));
    }
  return w;
}

function setup(mode: 'survival' | 'creative' = 'survival', w = flatWorld()) {
  const p = new Player(mode, 'normal');
  const i = new InputState();
  const c = new PlayerController(p, i, { autoJump: false } as Settings);
  p.body.setPos(0.5, 11, 0.5);
  for (let k = 0; k < 10; k++) c.update(w, 0.05);
  return { w, p, i, c };
}

/** Vitesse horizontale moyenne (blocs/s) entre 2 s et 2 + `secs` s. */
function speed(dt: number, conf: (i: InputState, p: Player) => void, secs = 4, mode: 'survival' | 'creative' = 'survival', warmup = 2) {
  const { w, p, i, c } = setup(mode);
  conf(i, p);
  const warm = Math.round(warmup / dt), n = Math.round(secs / dt);
  let z0 = p.z;
  for (let k = 0; k < warm + n; k++) {
    if (k === warm) z0 = p.z;
    c.update(w, dt);
  }
  return (z0 - p.z) / secs;
}

describe('Mouvement du joueur (Java 1.21)', () => {
  for (const dt of [1 / 60, 0.05]) {
    const fps = Math.round(1 / dt);
    it(`marche 4,317 · sprint 5,612 · accroupi 1,295 blocs/s (${fps} i/s)`, () => {
      expect(speed(dt, (i) => (i.moveY = 1))).toBeCloseTo(4.317, 2);
      expect(speed(dt, (i) => { i.moveY = 1; i.sprint = true; })).toBeCloseTo(5.612, 2);
      expect(speed(dt, (i) => { i.moveY = 1; i.sneak = true; })).toBeCloseTo(1.295, 2);
    });
    it(`saut : 1,2522 bloc de haut, retombe en 12 ticks (${fps} i/s)`, () => {
      const { w, p, i, c } = setup();
      i.jump = true;
      let top = 0, airTime = 0;
      for (let k = 0; k < Math.round(0.9 / dt); k++) {
        c.update(w, dt);
        top = Math.max(top, p.y - 11);
        if (!p.body.onGround) airTime += dt;
        if (k > 2 && p.body.onGround) i.jump = false;
      }
      expect(top).toBeCloseTo(1.2522, 2);
      expect(airTime).toBeGreaterThan(0.5);
      expect(airTime).toBeLessThan(0.65);
    });
    it(`saut en sprint ≈ 7,13 blocs/s (${fps} i/s)`, () => {
      const v = speed(dt, (i) => { i.moveY = 1; i.sprint = true; i.jump = true; }, 6);
      expect(v).toBeGreaterThan(7.0);
      expect(v).toBeLessThan(7.2);
    });
  }
  it('vol créatif : 10,9 blocs/s, 21,8 en sprint, 7,5 blocs/s vertical', () => {
    const fly = (sprint: boolean) => speed(1 / 60, (i, p) => { p.body.flying = true; p.body.setPos(0.5, 40, 0.5); i.moveY = 1; i.sprint = sprint; }, 3, 'creative', 4);
    expect(fly(false)).toBeCloseTo(10.89, 1);
    expect(fly(true)).toBeCloseTo(21.78, 1);
    const { w, p, i, c } = setup('creative');
    p.body.flying = true;
    i.jump = true;
    for (let k = 0; k < 40; k++) c.update(w, 0.05);
    const y0 = p.y;
    for (let k = 0; k < 20; k++) c.update(w, 0.05);
    expect(p.y - y0).toBeCloseTo(7.5, 1);
  });
  it('échelle : montée 2,35 blocs/s, descente 3 blocs/s, accroupi = accroché', () => {
    const w = flatWorld();
    for (let y = 11; y < 40; y++) w.setBlock(0, y, 0, BlockRegistry.byName('ladder').id);
    const { p, i, c } = setup('survival', w);
    i.jump = true;
    for (let k = 0; k < 20; k++) c.update(w, 0.05);
    let y0 = p.y;
    for (let k = 0; k < 40; k++) c.update(w, 0.05);
    expect((p.y - y0) / 2).toBeCloseTo(2.35, 1);
    i.jump = false;
    i.sneak = true;
    y0 = p.y;
    for (let k = 0; k < 20; k++) c.update(w, 0.05);
    expect(Math.abs(p.y - y0)).toBeLessThan(0.05);
    i.sneak = false;
    for (let k = 0; k < 20; k++) c.update(w, 0.05);
    y0 = p.y;
    for (let k = 0; k < 20; k++) c.update(w, 0.05);
    expect((y0 - p.y) / 1).toBeCloseTo(3, 1);
  });
  it('dégâts de chute : ⌈distance − 3⌉ (3 blocs : rien, 4 : 1, 10 : 7)', () => {
    for (const [h, dmg] of [[3, 0], [4, 1], [10, 7], [23, 20]]) {
      const { w, p, c } = setup();
      p.naturalRegen = false;
      p.body.setPos(0.5, 11 + h, 0.5);
      p.body.vy = 0;
      for (let k = 0; k < 200 && !p.dead; k++) {
        c.update(w, 0.05);
        p.tick(0.05);
      }
      expect(20 - p.health, `chute de ${h}`).toBeCloseTo(dmg, 5);
    }
  });
  it('atterrissage : botte de foin ⅕ des dégâts, slime rebondit sans dégâts', () => {
    for (const [key, dmg] of [['hay_block', 2], ['slime_block', 0]] as const) {
      if (!BlockRegistry.has(key)) continue;
      const w = flatWorld();
      w.setBlock(0, 10, 0, BlockRegistry.byName(key).id);
      const { p, c } = setup('survival', w);
      p.naturalRegen = false;
      p.body.setPos(0.5, 21, 0.5);
      let bounced = false;
      for (let k = 0; k < 60; k++) {
        c.update(w, 0.05);
        p.tick(0.05);
        if (k > 25 && p.body.vy > 3) bounced = true;
      }
      expect(20 - p.health, key).toBeCloseTo(dmg, 5);
      if (key === 'slime_block') expect(bounced).toBe(true);
    }
  });
  it('fatigue du sprint : 0,1 par mètre au sol', () => {
    const { w, p, i, c } = setup();
    p.exhaustion = 0;
    i.moveY = 1;
    i.sprint = true;
    const z0 = p.z;
    for (let k = 0; k < 20; k++) c.update(w, 0.05);
    expect(p.exhaustion).toBeCloseTo(0.1 * (z0 - p.z), 2);
  });
  it('hitbox et yeux : 1,8/1,62 debout, 1,5/1,27 accroupi', () => {
    const { w, p, i, c } = setup();
    expect(p.body.height).toBeCloseTo(1.8);
    expect(p.eyeHeight).toBeCloseTo(1.62);
    i.sneak = true;
    c.update(w, 0.05);
    expect(p.body.height).toBeCloseTo(1.5);
    expect(p.eyeHeight).toBeCloseTo(1.27);
    expect(p.body.halfWidth * 2).toBeCloseTo(0.6);
    expect(p.body.stepHeight).toBeCloseTo(0.6);
  });
});
