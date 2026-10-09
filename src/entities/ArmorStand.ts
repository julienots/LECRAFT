/**
 * Support d'armure : se pose avec l'objet « Support d'armure », porte casque, plastron,
 * jambières et bottes (toucher avec une pièce d'armure pour l'équiper, main vide pour la
 * reprendre), se casse d'un coup en rendant le support et son armure, et est sauvegardé avec
 * le monde (EntityManager.serialize / load).
 */
import { AIState } from '../ai/StateMachine';
import type { GameContext } from '../core/GameContext';
import type { MobDef } from '../data/mobs';
import type { ArmorSlot } from '../inventory/Item';
import { Mob, type EntitySpawner } from './Mob';

export const ARMOR_STAND_DEF: MobDef = {
  key: 'armor_stand', name: "Support d'armure", category: 'passive', health: 1, damage: 0, speed: 0, detectionRange: 0, attackRange: 0,
  attackCooldown: 1, width: 0.5, height: 1.975, drops: [{ item: 'armor_stand', min: 1, max: 1 }], xp: 0, sounds: { idle: '', hurt: 'hit', death: 'hit' },
} as MobDef;

const noop = { update: () => undefined };
const IDLE = Object.fromEntries(Object.values(AIState).map((s) => [s, noop]));
export const ARMOR_SLOTS: ArmorSlot[] = ['head', 'chest', 'legs', 'feet'];

export class ArmorStand extends Mob {
  /** Pièces portées (id d'objet et usure). */
  armor: Partial<Record<ArmorSlot, { id: string; durability?: number }>> = {};
  constructor(x: number, y: number, z: number, spawner: EntitySpawner) {
    super(ARMOR_STAND_DEF, -1, x, y, z, spawner, IDLE);
    this.persistent = true;
  }
  protected customUpdate(ctx: GameContext, _dt: number) {
    const a = this.armor;
    this.model.setArmor({ head: a.head?.id, chest: a.chest?.id, legs: a.legs?.id, feet: a.feet?.id }, ctx.skins);
    this.body.vx = this.body.vz = 0;
  }
  /** Objets lâchés en plus du support quand il est cassé. */
  dropExtra() {
    for (const s of ARMOR_SLOTS) {
      const it = this.armor[s];
      if (it) this.spawner.spawnItem(it.id, 1, this.x, this.y + 0.8, this.z, it.durability);
    }
    this.armor = {};
  }
}
