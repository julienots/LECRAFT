/** Petit bus d'événements typé. */
export class Emitter<T extends Record<string, unknown>> {
  private map = new Map<keyof T, Set<(p: never) => void>>();
  on<K extends keyof T>(k: K, fn: (p: T[K]) => void): () => void {
    let s = this.map.get(k);
    if (!s) this.map.set(k, (s = new Set()));
    s.add(fn as (p: never) => void);
    return () => s!.delete(fn as (p: never) => void);
  }
  emit<K extends keyof T>(k: K, p: T[K]) {
    this.map.get(k)?.forEach((f) => (f as (p: T[K]) => void)(p));
  }
  clear() {
    this.map.clear();
  }
}
