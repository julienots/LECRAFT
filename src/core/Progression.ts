import { ItemRegistry } from '../inventory/ItemRegistry';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** Condition évaluée sur les statistiques. */
  check: (s: Record<string, number>, p: { level: number; biomes: number; rares: number; rareTotal: number }) => boolean;
}

const A = (id: string, name: string, desc: string, check: AchievementDef['check']): AchievementDef => ({ id, name, desc, check });

export const ACHIEVEMENTS: AchievementDef[] = [
  A('wood', 'Premier bois', 'Récolter un tronc d’arbre.', (s) => (s['mine:log'] ?? 0) + (s['mine:birch_log'] ?? 0) + (s['mine:spruce_log'] ?? 0) + (s['mine:jungle_log'] ?? 0) + (s['mine:acacia_log'] ?? 0) > 0),
  A('table', 'Artisan', 'Fabriquer un établi.', (s) => (s['craft:crafting_table'] ?? 0) > 0),
  A('stone_age', 'Âge de pierre', 'Fabriquer une pioche en pierre.', (s) => (s['craft:stone_pickaxe'] ?? 0) > 0),
  A('copper', 'Reflets cuivrés', 'Fondre un lingot de cuivre.', (s) => (s['craft:copper_ingot'] ?? 0) > 0),
  A('iron_age', 'Âge du fer', 'Fabriquer une pioche en fer.', (s) => (s['craft:iron_pickaxe'] ?? 0) > 0),
  A('aurite', 'Lumière violette', 'Obtenir de l’aurite brute.', (s) => (s['collect:raw_aurite'] ?? 0) > 0),
  A('deep', 'Les profondeurs', 'Descendre sous la couche 12.', (s) => (s.deepest ?? 999) < 12),
  A('first_blood', 'Premier combat', 'Vaincre un monstre.', (s) => (s.monstersKilled ?? 0) > 0),
  A('hunter', 'Chasseur nocturne', 'Vaincre 25 monstres.', (s) => (s.monstersKilled ?? 0) >= 25),
  A('farmer', 'Main verte', 'Planter 20 graines.', (s) => (s.planted ?? 0) >= 20),
  A('breeder', 'Éleveur', 'Faire naître un animal.', (s) => (s.animalsBred ?? 0) > 0),
  A('builder', 'Bâtisseur', 'Poser 200 blocs.', (s) => (s.blocksPlaced ?? 0) >= 200),
  A('treasure', 'Chasseur de trésors', 'Ouvrir un coffre de donjon.', (s) => (s.dungeonChests ?? 0) > 0),
  A('explorer', 'Explorateur', 'Visiter 8 biomes différents.', (_s, p) => p.biomes >= 8),
  A('golem', 'Briseur de pierre', 'Vaincre le Golem des profondeurs.', (s) => (s['boss:golem'] ?? 0) > 0),
  A('lich', 'Fin de l’hiver', 'Vaincre la Liche de givre.', (s) => (s['boss:liche'] ?? 0) > 0),
  A('level10', 'Vétéran', 'Atteindre le niveau 10.', (_s, p) => p.level >= 10),
  A('collector', 'Collectionneur', 'Réunir tous les objets rares.', (_s, p) => p.rares >= p.rareTotal),
];

/** Statistiques, succès, biomes visités et collection d'objets rares. */
export class Progression {
  stats: Record<string, number> = {};
  unlocked = new Set<string>();
  biomes = new Set<string>();
  rares = new Set<string>();
  readonly rareTotal = ItemRegistry.all().filter((i) => i.rare).map((i) => i.key);
  onUnlock: (a: AchievementDef) => void = () => {};

  inc(stat: string, n = 1) {
    this.stats[stat] = (this.stats[stat] ?? 0) + n;
    if (stat.startsWith('collect:')) {
      const id = stat.slice(8);
      if (ItemRegistry.get(id)?.rare) this.rares.add(id);
    }
  }
  min(stat: string, v: number) {
    if (this.stats[stat] === undefined || v < this.stats[stat]) this.stats[stat] = v;
  }

  check(level: number) {
    for (const a of ACHIEVEMENTS) {
      if (this.unlocked.has(a.id)) continue;
      if (a.check(this.stats, { level, biomes: this.biomes.size, rares: this.rares.size, rareTotal: this.rareTotal.length })) {
        this.unlocked.add(a.id);
        this.onUnlock(a);
      }
    }
  }

  serialize() {
    return { stats: this.stats, unlocked: [...this.unlocked], biomes: [...this.biomes], rares: [...this.rares] };
  }
  load(d: { stats?: Record<string, number>; unlocked?: string[]; biomes?: string[]; rares?: string[] }) {
    this.stats = { ...(d.stats ?? {}) };
    this.unlocked = new Set(d.unlocked ?? []);
    this.biomes = new Set(d.biomes ?? []);
    this.rares = new Set(d.rares ?? []);
  }
}
