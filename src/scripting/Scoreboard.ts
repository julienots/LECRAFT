/**
 * Tableau des scores (objectifs, participants, affichage latéral), partagé par la commande
 * /scoreboard, les sélecteurs [scores=…] et l'API de script (world.scoreboard).
 * Participants : « player », « e:<id> » (entité) ou « f:<nom> » (joueur fictif).
 */

export interface ObjectiveData {
  id: string;
  displayName: string;
  criteria: string;
  scores: Map<string, number>;
}

export interface ScoreboardSnapshot {
  objectives: { id: string; displayName: string; criteria: string; scores: Record<string, number> }[];
  display: Record<string, { id: string; sort?: 'ascending' | 'descending' }>;
}

export class Scoreboard {
  readonly objectives = new Map<string, ObjectiveData>();
  /** Emplacements d'affichage (sidebar, list, belowname). */
  readonly display = new Map<string, { id: string; sort?: 'ascending' | 'descending' }>();
  /** Noms affichables des participants entités (pour la barre latérale). */
  names = new Map<string, string>();
  version = 0;

  add(id: string, displayName = id, criteria = 'dummy'): ObjectiveData {
    if (this.objectives.has(id)) throw new Error(`L'objectif « ${id} » existe déjà`);
    const o: ObjectiveData = { id, displayName, criteria, scores: new Map() };
    this.objectives.set(id, o);
    this.version++;
    return o;
  }
  remove(id: string): boolean {
    const ok = this.objectives.delete(id);
    for (const [k, v] of this.display) if (v.id === id) this.display.delete(k);
    this.version++;
    return ok;
  }
  get(id: string): ObjectiveData | undefined {
    return this.objectives.get(id);
  }
  set(id: string, who: string, v: number) {
    const o = this.objectives.get(id);
    if (!o) throw new Error(`Objectif inconnu : ${id}`);
    o.scores.set(who, Math.trunc(v) | 0);
    this.version++;
  }
  addTo(id: string, who: string, v: number): number {
    const o = this.objectives.get(id);
    if (!o) throw new Error(`Objectif inconnu : ${id}`);
    const n = ((o.scores.get(who) ?? 0) + Math.trunc(v)) | 0;
    o.scores.set(who, n);
    this.version++;
    return n;
  }
  score(id: string, who: string): number | undefined {
    return this.objectives.get(id)?.scores.get(who);
  }
  resetParticipant(who: string, id?: string) {
    for (const o of this.objectives.values()) if (!id || o.id === id) o.scores.delete(who);
    this.version++;
  }
  participants(): string[] {
    const s = new Set<string>();
    for (const o of this.objectives.values()) for (const k of o.scores.keys()) s.add(k);
    return [...s];
  }

  serialize(): ScoreboardSnapshot {
    return {
      objectives: [...this.objectives.values()].map((o) => ({ id: o.id, displayName: o.displayName, criteria: o.criteria, scores: Object.fromEntries(o.scores) })),
      display: Object.fromEntries(this.display),
    };
  }
  load(s: ScoreboardSnapshot | undefined) {
    this.objectives.clear();
    this.display.clear();
    for (const o of s?.objectives ?? []) this.objectives.set(o.id, { id: o.id, displayName: o.displayName, criteria: o.criteria, scores: new Map(Object.entries(o.scores)) });
    for (const [k, v] of Object.entries(s?.display ?? {})) this.display.set(k, v);
    this.version++;
  }
}
