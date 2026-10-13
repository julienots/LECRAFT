/**
 * Effets de statut qui agissent quand on est blessé ou qu'on meurt (potions de 1.21, comme le
 * jeu original) : Infestation (des poissons d'argent sortent, 10 % par coup), Chargé de vent
 * (rafale qui repousse tout autour), Tissage (toiles d'araignée), Suintement (2 slimes).
 */
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import type { GameContext } from '../core/GameContext';
import type { EffectList } from './Effects';
import type { EntitySpawner, Mob } from './Mob';

export function onHurtEffects(ctx: GameContext, fx: EffectList, x: number, y: number, z: number, spawner: EntitySpawner) {
  if (fx.level('infested') && Math.random() < 0.1) {
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) spawner.spawnMob('silverfish', x + (Math.random() - 0.5), y + 0.2, z + (Math.random() - 0.5));
    ctx.particles.burst('poof', x, y + 0.5, z, 6);
  }
}

export function onDeathEffects(ctx: GameContext, fx: EffectList, x: number, y: number, z: number, spawner: EntitySpawner, self: Mob | null) {
  if (!fx.map.size) return;
  const w = ctx.world;
  if (fx.level('wind_charged')) {
    // rafale : repousse créatures et joueur dans un rayon de 3 blocs
    ctx.particles.burst('poof', x, y + 0.6, z, 24);
    ctx.audio.play('explode', { x, y, z, volume: 0.4, pitch: 1.6 });
    const push = (bx: number, bz: number, body: { vx: number; vy: number; vz: number }) => {
      const dx = bx - x, dz = bz - z, d = Math.hypot(dx, dz) || 1;
      body.vx += (dx / d) * 9;
      body.vz += (dz / d) * 9;
      body.vy = Math.max(body.vy, 7);
    };
    const p = ctx.player;
    if (Math.hypot(p.x - x, p.y - y, p.z - z) < 3) push(p.x, p.z, p.body);
    for (const m of (spawner as unknown as { mobs?: Mob[] }).mobs ?? []) if (m !== self && !m.dead && Math.hypot(m.x - x, m.y - y, m.z - z) < 3) push(m.x, m.z, m.body);
  }
  if (fx.level('weaving') && BlockRegistry.has('cobweb')) {
    // 2 à 3 toiles d'araignée autour (seulement dans l'air)
    const web = BlockRegistry.byName('cobweb').id;
    let placed = 0;
    for (let t = 0; t < 12 && placed < 2 + Math.floor(Math.random() * 2); t++) {
      const bx = Math.floor(x + (Math.random() - 0.5) * 4), by = Math.floor(y + Math.random() * 2), bz = Math.floor(z + (Math.random() - 0.5) * 4);
      if (w.getBlock(bx, by, bz) === B.AIR && w.isSolid(bx, by - 1, bz)) {
        w.setBlock(bx, by, bz, web);
        placed++;
      }
    }
  }
  if (fx.level('oozing')) for (let i = 0; i < 2; i++) spawner.spawnMob('slime', x + (i ? 0.5 : -0.5), y + 0.3, z);
}
