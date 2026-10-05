/**
 * Effets de statut (vitesse, lenteur, régénération, poison, résistance…) communs au joueur et
 * aux créatures. Durées en ticks (20 par seconde), amplificateur 0 = niveau I.
 * Utilisés par /effect et par l'API de script des add-ons (entity.addEffect).
 */

export interface ActiveEffect {
  id: string;
  amplifier: number;
  /** Ticks restants (-1 = infini). */
  duration: number;
  showParticles: boolean;
}

/** Identifiants reconnus → nom affiché. */
export const EFFECTS: Record<string, string> = {
  speed: 'Rapidité',
  slowness: 'Lenteur',
  haste: 'Célérité',
  mining_fatigue: 'Fatigue',
  strength: 'Force',
  instant_health: 'Soin instantané',
  instant_damage: 'Dégâts instantanés',
  jump_boost: 'Saut amélioré',
  nausea: 'Nausée',
  regeneration: 'Régénération',
  resistance: 'Résistance',
  fire_resistance: 'Résistance au feu',
  water_breathing: 'Apnée',
  invisibility: 'Invisibilité',
  blindness: 'Cécité',
  night_vision: 'Vision nocturne',
  hunger: 'Faim',
  weakness: 'Faiblesse',
  poison: 'Poison',
  wither: 'Wither',
  health_boost: 'Bonus de vie',
  absorption: 'Absorption',
  saturation: 'Saturation',
  levitation: 'Lévitation',
  fatal_poison: 'Poison mortel',
  slow_falling: 'Chute lente',
  conduit_power: 'Force de conduit',
  bad_omen: 'Mauvais présage',
  village_hero: 'Héros du village',
  darkness: 'Obscurité',
  wind_charged: 'Chargé de vent',
  weaving: 'Tissage',
  oozing: 'Suintement',
  infested: 'Infestation',
};

const ALIASES: Record<string, string> = { regeneration_effect: 'regeneration', healing: 'instant_health', harming: 'instant_damage', jump: 'jump_boost', fireresistance: 'fire_resistance' };

/** Normalise un identifiant d'effet (« minecraft:speed », « Speed »…) ; null si inconnu. */
export function effectId(name: string): string | null {
  const k = String(name).toLowerCase().replace(/^minecraft:/, '').replace(/\s+/g, '_');
  const id = ALIASES[k] ?? k;
  return EFFECTS[id] ? id : null;
}

/** Cible des effets (joueur ou créature). */
export interface EffectTarget {
  heal(n: number): void;
  hurt(n: number, kind: 'magic' | 'wither'): void;
  /** Santé actuelle (le poison ne tue pas). */
  hp(): number;
  body: { vy: number };
  feed?(hunger: number, saturation: number): void;
  exhaust?(n: number): void;
}

export class EffectList {
  readonly map = new Map<string, ActiveEffect>();

  /** Ajoute un effet ; un effet plus fort ou plus long remplace l'existant. Retourne vrai si appliqué. */
  add(id: string, duration: number, amplifier = 0, showParticles = true, target?: EffectTarget): boolean {
    const e = effectId(id);
    if (!e) return false;
    const amp = Math.max(0, Math.min(255, Math.floor(amplifier)));
    if (e === 'instant_health' || e === 'instant_damage') {
      if (target) {
        if (e === 'instant_health') target.heal(4 << Math.min(amp, 8));
        else target.hurt(6 << Math.min(amp, 8), 'magic');
      }
      return true;
    }
    if (e === 'saturation') target?.feed?.(amp + 1, (amp + 1) * 2);
    const cur = this.map.get(e);
    if (cur && (cur.amplifier > amp || (cur.amplifier === amp && (cur.duration < 0 || cur.duration >= duration)))) return true;
    this.map.set(e, { id: e, amplifier: amp, duration: Math.floor(duration), showParticles });
    return true;
  }
  remove(id: string): boolean {
    const e = effectId(id);
    return !!e && this.map.delete(e);
  }
  clear() {
    this.map.clear();
  }
  get(id: string): ActiveEffect | undefined {
    const e = effectId(id);
    return e ? this.map.get(e) : undefined;
  }
  /** Niveau de l'effet (0 si absent, 1 pour niveau I…). */
  level(id: string): number {
    const e = this.map.get(id);
    return e ? e.amplifier + 1 : 0;
  }
  get list(): ActiveEffect[] {
    return [...this.map.values()];
  }

  /** Multiplicateur de vitesse de déplacement. */
  speedMul(): number {
    if (!this.map.size) return 1;
    return Math.max(0, (1 + 0.2 * this.level('speed')) * (1 - 0.15 * this.level('slowness')));
  }
  /** Réduction des dégâts (résistance). */
  damageMul(fire: boolean): number {
    if (!this.map.size) return 1;
    if (fire && this.level('fire_resistance')) return 0;
    return Math.max(0, 1 - 0.2 * this.level('resistance'));
  }
  /** Bonus de dégâts de mêlée (force/faiblesse). */
  attackBonus(): number {
    return 3 * this.level('strength') - 4 * this.level('weakness');
  }
  /** Multiplicateur de vitesse de minage. */
  miningMul(): number {
    if (!this.map.size) return 1;
    return (1 + 0.2 * this.level('haste')) * Math.pow(0.3, Math.min(4, this.level('mining_fatigue')));
  }

  /** Avance d'un tick : effets périodiques et expiration. */
  tick(t: EffectTarget, tickNo: number) {
    if (!this.map.size) return;
    for (const e of this.map.values()) {
      const lvl = e.amplifier;
      const every = (base: number) => Math.max(1, base >> Math.min(lvl, 5));
      switch (e.id) {
        case 'regeneration':
          if (tickNo % every(50) === 0) t.heal(1);
          break;
        case 'poison':
          if (tickNo % every(25) === 0 && t.hp() > 1) t.hurt(1, 'magic');
          break;
        case 'fatal_poison':
          if (tickNo % every(25) === 0) t.hurt(1, 'magic');
          break;
        case 'wither':
          if (tickNo % every(40) === 0) t.hurt(1, 'wither');
          break;
        case 'hunger':
          t.exhaust?.(0.005 * (lvl + 1));
          break;
        case 'saturation':
          if (tickNo % 20 === 0) t.feed?.(lvl + 1, (lvl + 1) * 2);
          break;
        case 'levitation':
          t.body.vy = 0.9 * (lvl + 1);
          break;
        case 'slow_falling':
          if (t.body.vy < -1.6) t.body.vy = -1.6;
          break;
      }
      if (e.duration > 0) e.duration--;
    }
    for (const [k, e] of this.map) if (e.duration === 0) this.map.delete(k);
  }

  serialize(): ActiveEffect[] {
    return this.list.map((e) => ({ ...e }));
  }
  load(list: ActiveEffect[] | undefined) {
    this.map.clear();
    for (const e of list ?? []) if (effectId(e.id)) this.map.set(e.id, { ...e });
  }
}
