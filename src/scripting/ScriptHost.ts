/**
 * Hôte des scripts JavaScript des add-ons (API de script Bedrock).
 *
 * - Chargement : chaque fichier .js du pack devient un module ES (URL blob) ; les imports
 *   relatifs (avec ou sans « .js ») sont résolus dans le pack, les modules « @minecraft/… »
 *   pointent vers les implémentations du jeu (une instance par pack et par version).
 * - Exécution : planification à 20 ticks/s (system.run/runTimeout/runInterval/runJob),
 *   relais des événements du moteur (crochets) vers les abonnements des scripts,
 *   composants personnalisés de blocs et d'objets, ticks de blocs, marche sur les blocs.
 * - Sécurité : une erreur d'un script est interceptée et journalisée sans arrêter le jeu.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Session } from '../core/Session';
import type { ScriptPack } from '../addons/AddonManager';
import type { ItemStack as EngineStack } from '../inventory/Item';
import { BlockRegistry, B } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { decodeStates } from '../addons/BedrockBlocks';
import { execute, type Target, type Origin } from '../commands/Commands';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/Config';
import { createServerApi, type HostServices, type ServerApiInstance } from './ServerApi';
import { createUiApi, type FormHost } from './UiApi';
import { hooks, type Actor, type DamageEvent, type ScriptHooks } from './Hooks';
import type { Screen } from '../ui/UIManager';

type Any = any;

interface Job {
  id: number;
  at: number;
  interval: number;
  fn: () => void;
}

/** Modules annexes simplifiés (sans équivalent dans le jeu). */
function auxModule(name: string): Record<string, unknown> {
  if (name === '@minecraft/common') return { ArgumentOutOfBoundsError: class extends Error {}, EngineError: class extends Error {}, InvalidArgumentError: class extends Error {}, PropertyOutOfBoundsError: class extends Error {}, UnsupportedFunctionalityError: class extends Error {} };
  if (name === '@minecraft/server-net') return { http: { request: () => Promise.reject(new Error('Réseau indisponible')), get: () => Promise.reject(new Error('Réseau indisponible')), cancelAll() {} }, HttpRequest: class {}, HttpHeader: class {}, HttpRequestMethod: { Get: 'Get', Post: 'Post', Put: 'Put', Delete: 'Delete', Head: 'Head' } };
  if (name === '@minecraft/server-admin') return { variables: { get: () => undefined, names: [] }, secrets: { get: () => undefined, names: [] }, SecretString: class {} };
  if (name === '@minecraft/debug-utilities') return { clearAllShapes() {}, addShape() {}, removeShape() {}, DebugBox: class {}, DebugLine: class {}, DebugSphere: class {}, DebugText: class {}, DebugCircle: class {}, DebugArrow: class {} };
  if (name === '@minecraft/server-gametest') return { register: () => ({ structureName: () => ({}), maxTicks: () => ({}), tag: () => ({}) }), registerAsync: () => ({}), SimulatedPlayer: class {}, Test: class {} };
  return {};
}

/** Noms importés depuis chaque module « @minecraft/… » (pour générer les exports). */
function importedNames(files: Map<string, string>): Map<string, { names: Set<string>; star: boolean; def: boolean }> {
  const out = new Map<string, { names: Set<string>; star: boolean; def: boolean }>();
  const re = /\b(?:import|export)\s*(type\s+)?([\s\S]*?)\s*from\s*(['"])(@minecraft\/[\w-]+)\3/g;
  for (const src of files.values()) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      if (m[2].length > 2000) continue;
      const mod = m[4];
      let e = out.get(mod);
      if (!e) out.set(mod, (e = { names: new Set(), star: false, def: false }));
      const clause = m[2].trim();
      if (/^\*/.test(clause) || /\*\s*as/.test(clause)) e.star = true;
      const braces = /\{([\s\S]*)\}/.exec(clause);
      if (braces)
        for (const part of braces[1].split(',')) {
          const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
          if (/^[A-Za-z_$][\w$]*$/.test(n)) e.names.add(n);
        }
      const head = clause.replace(/\{[\s\S]*\}/, '').replace(/\*\s*as\s+\w+/, '').replace(/,/g, ' ').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(head) && !/^(import|export)$/.test(head)) e.def = true;
    }
  }
  return out;
}

const RESERVED = new Set(['default', 'class', 'function', 'const', 'let', 'var', 'new', 'delete', 'typeof', 'void', 'if', 'else', 'return', 'import', 'export']);

export class ScriptHost implements HostServices {
  tick = 0;
  readonly instances: ServerApiInstance[] = [];
  readonly cooldowns = new Map<string, number>();
  offhand: EngineStack | null = null;
  readonly forms: FormHost;
  /** Erreurs et avertissements (affichés dans le rapport des add-ons). */
  readonly log: string[] = [];
  private jobs = new Map<number, Job>();
  private nextJob = 1;
  private urls: string[] = [];
  private disposed = false;
  private started = false;
  private joined = false;
  private chatErrors = 0;
  private key = `h${Math.random().toString(36).slice(2)}`;
  /** Blocs à tick (minecraft:tick + composant avec onTick) : clé → prochain tick. */
  private tickBlocks = new Map<string, number>();
  private tickIds = new Set<number>();
  private stepKey = '';
  private lastSlots: (EngineStack | null)[] = [];
  private lastSelected = -1;
  private lastMode = '';
  private lastWeather = '';
  private wasDead = false;
  private fallStart = 0;
  private offBlock: (() => void) | null = null;

  constructor(
    readonly s: Session,
    private readonly packs: ScriptPack[],
    private readonly ui: { open(build: (close: () => void) => Screen): boolean; closeAll(): void; icon(path: string): string | null },
  ) {
    this.forms = ui;
  }

  // ---------- services ----------
  schedule(fn: () => void, delay: number, interval = 0): number {
    const id = this.nextJob++;
    this.jobs.set(id, { id, at: this.tick + Math.max(0, delay), interval, fn });
    return id;
  }
  clearRun(id: number) {
    this.jobs.delete(id);
  }
  runCommand(line: string, executor: Target | null, origin?: Origin): number {
    if (this.disposed) return 0;
    let ok = false;
    try {
      ok = execute(this.s, line, (m, err) => err && this.warn(`Commande « ${line.slice(0, 60)} » : ${m}`), 1, origin, true, executor);
    } catch (e) {
      this.reportError(e, `commande ${line}`);
    }
    return ok ? 1 : 0;
  }
  reportError(e: unknown, where: string) {
    const msg = e instanceof Error ? `${e.name === 'Error' ? '' : `${e.name} : `}${e.message}` : String(e);
    const line = `[Script] ${where} : ${msg}`;
    console.warn(line, e instanceof Error ? e.stack : '');
    if (this.log.length < 200 && !this.log.includes(line)) this.log.push(line);
    // quelques erreurs visibles dans le chat (le reste dans la console et le rapport)
    if (this.chatErrors < 3 && this.started) {
      this.chatErrors++;
      this.s.game.chat.add(`§c${line.slice(0, 200)}`, 'error');
    }
  }
  private warn(m: string) {
    if (this.log.length < 200 && !this.log.includes(m)) this.log.push(m);
  }
  ensureItem(typeId: string): string {
    const t = String(typeId);
    const k = t.replace(/^minecraft:/, '');
    if (ItemRegistry.has(t)) return t;
    if (ItemRegistry.has(k)) return k;
    const alias: Record<string, string> = { golden_apple: 'golden_apple', planks: 'oak_planks', log: 'oak_log', wool: 'white_wool', grass: 'grass_block' };
    if (alias[k] && ItemRegistry.has(alias[k])) return alias[k];
    if (BlockRegistry.has(k) && !ItemRegistry.has(k)) {
      ItemRegistry.register({ key: k, name: BlockRegistry.byName(k).def.name, icon: { block: k }, place: k, tab: 'building' });
      return k;
    }
    // objet du jeu de référence absent : objet de remplacement (évite l'échec du script)
    const key = t.includes(':') && !t.startsWith('minecraft:') ? t : k;
    ItemRegistry.register({ key, name: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), icon: { sprite: 'lump', colors: ['#909090', '#d0d0d0'] }, tab: 'ingredients' });
    this.warn(`Objet « ${t} » inconnu du jeu : remplacé par un objet générique.`);
    return key;
  }
  sendScriptEvent(id: string, message: string, source: Actor | null) {
    this.schedule(() => this.instances.forEach((i) => i.fire.scriptEvent(id, message, source)), 0);
  }

  // ---------- chargement ----------
  /** Charge et exécute les scripts ; retourne le nombre de packs démarrés. */
  async start(): Promise<number> {
    const g = globalThis as Any;
    g.__lecraftScript ??= {};
    const reg: Record<string, Record<string, unknown>> = (g.__lecraftScript[this.key] = {});
    let ok = 0;
    for (let pi = 0; pi < this.packs.length; pi++) {
      const pack = this.packs[pi];
      const version = pack.modules['@minecraft/server'] ?? '1.0.0';
      const inst = createServerApi(this, pack.name, version);
      this.instances.push(inst);
      const ui = createUiApi(this.ui);
      reg[`${pi}:@minecraft/server`] = inst.exports;
      reg[`${pi}:@minecraft/server-ui`] = ui;
      try {
        const entryUrl = this.buildModules(pi, pack, reg);
        await import(/* @vite-ignore */ entryUrl);
        ok++;
      } catch (e) {
        this.reportError(e, `chargement de « ${pack.name} »`);
      }
    }
    // démarrage : enregistrement des composants, puis chargement du monde
    for (const inst of this.instances) this.safe(() => inst.fire.startup(), 'startup');
    for (const inst of this.instances) this.safe(() => inst.fire.worldLoad(), 'worldLoad');
    this.installHooks();
    this.scanLoadedChunks();
    this.started = true;
    return ok;
  }

  /** Crée les modules (URL blob) d'un pack ; retourne l'URL du point d'entrée. */
  private buildModules(pi: number, pack: ScriptPack, reg: Record<string, Record<string, unknown>>): string {
    const files = pack.files;
    const lower = new Map([...files.keys()].map((k) => [k.toLowerCase(), k]));
    const imported = importedNames(files);
    const shimUrls = new Map<string, string>();
    const shim = (mod: string): string => {
      let u = shimUrls.get(mod);
      if (u) return u;
      const k = `${pi}:${mod}`;
      if (!reg[k]) reg[k] = auxModule(mod);
      const api = reg[k] as Record<string, unknown>;
      const names = new Set<string>([...Object.keys(api)].filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && !RESERVED.has(n) && n !== '__stub'));
      const used = imported.get(mod);
      used?.names.forEach((n) => names.add(n));
      let src = `const m = globalThis.__lecraftScript[${JSON.stringify(this.key)}][${JSON.stringify(k)}];\n`;
      for (const n of names) {
        if (RESERVED.has(n)) continue;
        src += n in api ? `export const ${n} = m[${JSON.stringify(n)}];\n` : `export const ${n} = m.__stub ? m.__stub(${JSON.stringify(n)}) : undefined;\n`;
      }
      src += 'export default m;\n';
      u = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.urls.push(u);
      shimUrls.set(mod, u);
      return u;
    };
    const urls = new Map<string, string>();
    const visiting = new Set<string>();
    const resolve = (from: string, spec: string): string | null => {
      const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
      const bases = spec.startsWith('./') || spec.startsWith('../') ? [dir] : spec.startsWith('/') ? [''] : [dir, 'scripts/', ''];
      for (const base of bases) {
        const parts: string[] = [];
        for (const seg of (base + spec.replace(/^\//, '')).split('/')) {
          if (seg === '..') parts.pop();
          else if (seg && seg !== '.') parts.push(seg);
        }
        const p = parts.join('/');
        for (const cand of [p, `${p}.js`, `${p}/index.js`, `${p}.mjs`]) {
          const real = lower.get(cand.toLowerCase());
          if (real) return real;
        }
      }
      return null;
    };
    const build = (path: string): string => {
      const done = urls.get(path);
      if (done) return done;
      if (visiting.has(path)) throw new Error(`Import circulaire non pris en charge (${path})`);
      visiting.add(path);
      const src = files.get(path) ?? '';
      const rewrite = (spec: string): string => {
        if (spec.startsWith('@minecraft/')) return shim(spec);
        const r = resolve(path, spec);
        if (!r) throw new Error(`Module introuvable « ${spec} » (importé par ${path})`);
        return build(r);
      };
      const out = src
        .replace(/(\b(?:import|export)\s*(?:type\s+)?[\w$*{}\s,]*?\s*from\s*)(['"])([^'"\n]+)\2/g, (_m, a: string, q: string, spec: string) => `${a}${q}${rewrite(spec)}${q}`)
        .replace(/(\bimport\s*)(['"])([^'"\n]+)\2/g, (_m, a: string, q: string, spec: string) => `${a}${q}${rewrite(spec)}${q}`)
        .replace(/(\bimport\s*\(\s*)(['"])([^'"\n]+)\2(\s*\))/g, (_m, a: string, q: string, spec: string, b: string) => `${a}${q}${rewrite(spec)}${q}${b}`);
      const u = URL.createObjectURL(new Blob([`${out}\n//# sourceURL=addon://${encodeURIComponent(pack.name)}/${path}`], { type: 'text/javascript' }));
      this.urls.push(u);
      urls.set(path, u);
      visiting.delete(path);
      return u;
    };
    const entry = lower.get(pack.entry.toLowerCase()) ?? resolve('', pack.entry);
    if (!entry) throw new Error(`Point d'entrée introuvable : ${pack.entry}`);
    return build(entry);
  }

  private safe(fn: () => void, where: string) {
    try {
      fn();
    } catch (e) {
      this.reportError(e, where);
    }
  }

  // ---------- composants personnalisés ----------
  private blockHandlers(id: number): { h: Record<string, (...a: Any[]) => unknown>; params: unknown; inst: ServerApiInstance }[] {
    const info = BlockRegistry.get(id)?.def.bedrock;
    if (!info?.custom.length) return [];
    const out: { h: Record<string, (...a: Any[]) => unknown>; params: unknown; inst: ServerApiInstance }[] = [];
    for (const name of info.custom)
      for (const inst of this.instances) {
        const h = inst.blockComponents.get(name);
        if (h) {
          out.push({ h, params: info.customParams?.[name] ?? {}, inst });
          break;
        }
      }
    return out;
  }
  private itemHandlers(itemId: string | undefined): { h: Record<string, (...a: Any[]) => unknown>; params: unknown; inst: ServerApiInstance }[] {
    const comps = itemId ? ItemRegistry.get(itemId)?.scriptComponents : undefined;
    if (!comps) return [];
    const out: { h: Record<string, (...a: Any[]) => unknown>; params: unknown; inst: ServerApiInstance }[] = [];
    for (const [name, params] of Object.entries(comps))
      for (const inst of this.instances) {
        const h = inst.itemComponents.get(name);
        if (h) {
          out.push({ h, params: params ?? {}, inst });
          break;
        }
      }
    return out;
  }
  /** Appelle un gestionnaire de composant ; retourne l'objet événement (pour lire cancel…). */
  private callBlock(id: number, hook: string, make: (inst: ServerApiInstance) => Any): Any[] {
    const evs: Any[] = [];
    for (const { h, params, inst } of this.blockHandlers(id)) {
      const fn = h[hook] ?? (hook === 'onPlayerBreak' ? h.onPlayerDestroy : undefined);
      if (typeof fn !== 'function') continue;
      const ev = make(inst);
      evs.push(ev);
      try {
        fn.call(h, ev, { params });
      } catch (e) {
        this.reportError(e, `${BlockRegistry.get(id).key} ${hook}`);
      }
    }
    return evs;
  }
  private callItem(itemId: string | undefined, hook: string, make: (inst: ServerApiInstance) => Any): Any[] {
    const evs: Any[] = [];
    for (const { h, params, inst } of this.itemHandlers(itemId)) {
      const fn = h[hook];
      if (typeof fn !== 'function') continue;
      const ev = make(inst);
      evs.push(ev);
      try {
        fn.call(h, ev, { params });
      } catch (e) {
        this.reportError(e, `${itemId} ${hook}`);
      }
    }
    return evs;
  }
  private hasBlockHook(id: number, hook: string) {
    return this.blockHandlers(id).some(({ h }) => typeof h[hook] === 'function' || (hook === 'onPlayerBreak' && typeof h.onPlayerDestroy === 'function'));
  }

  // ---------- crochets du moteur ----------
  private installHooks() {
    const each = (fn: (i: ServerApiInstance) => void, where: string) => {
      for (const i of this.instances) this.safe(() => fn(i), where);
    };
    const h: ScriptHooks = {
      beforeHurt: (target, amount, ev: DamageEvent) => {
        let a = amount;
        for (const i of this.instances) {
          try {
            a = i.fire.beforeHurt(target, a, ev);
          } catch (e) {
            this.reportError(e, 'entityHurt (avant)');
          }
          if (!(a > 0)) return 0;
        }
        return a;
      },
      afterHurt: (target, amount, ev) => each((i) => i.fire.afterHurt(target, amount, ev), 'entityHurt'),
      died: (target, ev) => each((i) => i.fire.died(target, ev), 'entityDie'),
      spawned: (e, cause) => {
        if (this.disposed) return;
        this.schedule(() => each((i) => i.fire.entitySpawn(e, cause), 'entitySpawn'), 0);
      },
      removed: (e) => each((i) => i.fire.entityRemove(e), 'entityRemove'),
      hitEntity: (target, stack) => {
        each((i) => i.fire.hitEntity(target), 'entityHitEntity');
        if (stack) {
          this.callItem(stack.id, 'onHitEntity', (i) => ({ attackingEntity: i.wrapEntity(this.s.player), hitEntity: i.wrapEntity(target), hadEffect: true, itemStack: i.wrapItem(stack) }));
          this.callItem(stack.id, 'onBeforeDurabilityDamage', (i) => ({ attackingEntity: i.wrapEntity(this.s.player), hitEntity: i.wrapEntity(target), itemStack: i.wrapItem(stack), durabilityDamage: 1 }));
        }
      },
      hitBlock: (x, y, z, face) => each((i) => i.fire.hitBlock(x, y, z, face), 'entityHitBlock'),
      interactEntity: (target, stack) => {
        for (const i of this.instances) if (this.safeBool(() => i.fire.beforeInteractEntity(target, stack))) return true;
        each((i) => i.fire.afterInteractEntity(target, stack), 'playerInteractWithEntity');
        return false;
      },
      interactBlock: (x, y, z, face, hit, stack) => {
        const id = this.s.world.getBlock(x, y, z);
        for (const i of this.instances) if (this.safeBool(() => i.fire.beforeInteractBlock(x, y, z, face, hit, stack, true))) return true;
        if (stack) for (const i of this.instances) if (this.safeBool(() => i.fire.beforeItemUseOn(stack, x, y, z, face, hit))) return true;
        let consumed = false;
        // composant de bloc onPlayerInteract (accroupi avec un objet : on pose plutôt)
        if (id > 0 && !(this.s.player.sneaking && stack) && this.hasBlockHook(id, 'onPlayerInteract')) {
          this.callBlock(id, 'onPlayerInteract', (i) => ({ block: i.wrapBlock(x, y, z), dimension: i.exports.world && (i.exports.world as Any).getDimension('overworld'), player: i.wrapEntity(this.s.player), face: faceName(face), faceLocation: { x: hit[0] - x, y: hit[1] - y, z: hit[2] - z } }));
          consumed = true;
        }
        if (stack && !consumed) {
          const evs = this.callItem(stack.id, 'onUseOn', (i) => ({ source: i.wrapEntity(this.s.player), block: i.wrapBlock(x, y, z), blockFace: faceName(face), faceLocation: { x: hit[0] - x, y: hit[1] - y, z: hit[2] - z }, itemStack: i.wrapItem(stack), usedOnBlockPermutation: i.permutation(id, this.s.world.getMeta(x, y, z)) }));
          if (evs.length && !ItemRegistry.get(stack.id)?.place) consumed = true;
          each((i) => i.fire.afterItemUseOn(stack, x, y, z, face, hit), 'itemUseOn');
        }
        if (consumed || stack) each((i) => i.fire.afterInteractBlock(x, y, z, face, hit, this.s.player.inventory.selectedStack, stack), 'playerInteractWithBlock');
        return consumed;
      },
      useItem: (stack) => {
        for (const i of this.instances) if (this.safeBool(() => i.fire.beforeItemUse(stack))) return true;
        if (this.cooldownActive(stack.id)) return true;
        const evs = this.callItem(stack.id, 'onUse', (i) => ({ source: i.wrapEntity(this.s.player), itemStack: i.wrapItem(stack) }));
        const cd = ItemRegistry.get(stack.id)?.cooldown;
        if (evs.length && cd) this.cooldowns.set(cd.category, this.tick + Math.round(cd.duration * 20));
        each((i) => i.fire.afterItemUse(stack), 'itemUse');
        return evs.length > 0 && !ItemRegistry.get(stack.id)?.food;
      },
      beforeBreak: (x, y, z, id, meta, stack) => {
        for (const i of this.instances) if (this.safeBool(() => i.fire.beforeBreak(x, y, z, stack))) return true;
        void meta;
        void id;
        return false;
      },
      afterBreak: (x, y, z, id, meta, stack) => {
        this.callBlock(id, 'onPlayerBreak', (i) => {
          const perm = i.permutation(id, meta);
          return { block: i.wrapBlock(x, y, z), brokenBlockPermutation: perm, destroyedBlockPermutation: perm, dimension: (i.exports.world as Any).getDimension('overworld'), player: i.wrapEntity(this.s.player) };
        });
        this.callBlock(id, 'onBreak', (i) => ({ block: i.wrapBlock(x, y, z), brokenBlockPermutation: i.permutation(id, meta), dimension: (i.exports.world as Any).getDimension('overworld'), blockDestroySource: undefined }));
        if (stack) this.callItem(stack.id, 'onMineBlock', (i) => ({ source: i.wrapEntity(this.s.player), block: i.wrapBlock(x, y, z), minedBlockPermutation: i.permutation(id, meta), itemStack: i.wrapItem(stack) }));
        each((i) => i.fire.afterBreak(x, y, z, id, meta, stack), 'playerBreakBlock');
        this.tickBlocks.delete(`${x},${y},${z}`);
      },
      beforePlace: (x, y, z, id, meta, face) => {
        let m: number | null = meta;
        for (const i of this.instances) {
          const r: number | null = this.safeVal<number | null>(() => i.fire.beforePlace(x, y, z, id, m as number, face), m);
          if (r === null) return null;
          m = r;
        }
        // composant beforeOnPlayerPlace : peut annuler ou changer la permutation
        for (const ev of this.callBlock(id, 'beforeOnPlayerPlace', (i) => ({ block: i.wrapBlock(x, y, z), dimension: (i.exports.world as Any).getDimension('overworld'), face: faceName(face), permutationToPlace: i.permutation(id, m as number), player: i.wrapEntity(this.s.player), cancel: false }))) {
          if (ev.cancel) return null;
          const p = ev.permutationToPlace;
          if (p && p._id === id) m = p._meta;
        }
        return m;
      },
      afterPlace: (x, y, z, id, prev) => {
        each((i) => i.fire.afterPlace(x, y, z), 'playerPlaceBlock');
        this.callBlock(id, 'onPlace', (i) => ({ block: i.wrapBlock(x, y, z), dimension: (i.exports.world as Any).getDimension('overworld'), previousBlock: i.permutation(prev, 0) }));
      },
      startUse: (stack) => each((i) => i.fire.startUse(stack), 'itemStartUse'),
      releaseUse: (stack, ticks) => each((i) => i.fire.releaseUse(stack, ticks), 'itemReleaseUse'),
      consumed: (stack) => {
        this.callItem(stack.id, 'onConsume', (i) => ({ source: i.wrapEntity(this.s.player), itemStack: i.wrapItem(stack) }));
        this.callItem(stack.id, 'onCompleteUse', (i) => ({ source: i.wrapEntity(this.s.player), itemStack: i.wrapItem(stack) }));
        each((i) => i.fire.consumed(stack), 'itemCompleteUse');
      },
      chat: (message) => {
        for (const i of this.instances) if (this.safeBool(() => i.fire.beforeChat(message))) return true;
        this.schedule(() => each((i) => i.fire.afterChat(message), 'chatSend'), 0);
        return false;
      },
      scriptEvent: (id, message, source) => this.sendScriptEvent(id, message, source),
      randomTick: (x, y, z, id) => this.callBlock(id, 'onRandomTick', (i) => ({ block: i.wrapBlock(x, y, z), dimension: (i.exports.world as Any).getDimension('overworld') })),
      customCommand: (name, args) => {
        const n = name.replace(/^\//, '');
        for (const i of this.instances) if (this.safeBool(() => i.fire.customCommand(n, args))) return true;
        return false;
      },
    };
    Object.assign(hooks, h);
    // blocs à tick : suivi des modifications du monde
    this.tickIds.clear();
    for (const b of BlockRegistry.blocks) if (b.def.bedrock?.tick && this.hasBlockHook(b.id, 'onTick')) this.tickIds.add(b.id);
    this.offBlock = this.s.world.events.on('blockChanged', this.onBlockChanged);
  }
  private onBlockChanged = (e: { x: number; y: number; z: number; prev: number; id: number }) => {
    if (this.disposed) return;
    const k = `${e.x},${e.y},${e.z}`;
    if (this.tickIds.has(e.id)) {
      if (!this.tickBlocks.has(k)) this.tickBlocks.set(k, this.tick + this.tickDelay(e.id));
    } else this.tickBlocks.delete(k);
  };
  private tickDelay(id: number) {
    const r = BlockRegistry.get(id).def.bedrock?.tick ?? [1, 1];
    return Math.max(1, Math.round(r[0] + Math.random() * Math.max(0, r[1] - r[0])));
  }
  /** Recherche des blocs à tick dans les chunks déjà chargés (et ceux qui arrivent). */
  private scanned = new Set<string>();
  private scanLoadedChunks() {
    if (!this.tickIds.size) return;
    const w = this.s.world as Any;
    const chunks: Map<string, Any> | undefined = w.chunks;
    if (!chunks) return;
    for (const [k, c] of chunks) {
      if (this.scanned.has(k) || !c?.blocks) continue;
      this.scanned.add(k);
      const blocks: Uint16Array = c.blocks;
      for (let i = 0; i < blocks.length; i++) {
        if (!this.tickIds.has(blocks[i])) continue;
        // index = x + z*16 + y*256 (voir ChunkData.idx)
        const lx = i & 15, lz = (i >> 4) & 15, y = i >> 8;
        const x = c.cx * CHUNK_SIZE + lx, z = c.cz * CHUNK_SIZE + lz;
        const key = `${x},${y},${z}`;
        if (!this.tickBlocks.has(key)) this.tickBlocks.set(key, this.tick + this.tickDelay(blocks[i]));
      }
    }
  }
  private cooldownActive(itemId: string) {
    const cd = ItemRegistry.get(itemId)?.cooldown;
    return !!cd && (this.cooldowns.get(cd.category) ?? 0) > this.tick;
  }
  private safeBool(fn: () => unknown): boolean {
    try {
      return !!fn();
    } catch (e) {
      this.reportError(e, 'événement');
      return false;
    }
  }
  private safeVal<T>(fn: () => T, def: T): T {
    try {
      return fn();
    } catch (e) {
      this.reportError(e, 'événement');
      return def;
    }
  }

  // ---------- boucle ----------
  /** Un tick de jeu (20 Hz). */
  update() {
    if (this.disposed || !this.started) return;
    this.tick++;
    const s = this.s;
    const p = s.player;
    if (!this.joined) {
      this.joined = true;
      for (const i of this.instances) this.safe(() => i.fire.playerJoin(), 'playerJoin');
      for (const i of this.instances) this.safe(() => i.fire.playerSpawn(true), 'playerSpawn');
      this.lastSlots = p.inventory.slots.map((x) => x);
      this.lastSelected = p.inventory.selected;
      this.lastMode = p.gameMode;
      this.lastWeather = s.weather.state;
    }
    // tâches planifiées
    if (this.jobs.size) {
      const due = [...this.jobs.values()].filter((j) => j.at <= this.tick);
      for (const j of due) {
        if (!this.jobs.has(j.id)) continue;
        if (j.interval > 0) j.at = this.tick + j.interval;
        else this.jobs.delete(j.id);
        try {
          j.fn();
        } catch (e) {
          this.reportError(e, 'tâche planifiée');
        }
      }
    }
    // réapparition
    if (this.wasDead && !p.dead) for (const i of this.instances) this.safe(() => i.fire.playerSpawn(false), 'playerSpawn');
    this.wasDead = p.dead;
    // blocs à tick
    if (this.tickBlocks.size) {
      if (this.tick % 20 === 0) this.scanLoadedChunks();
      for (const [k, at] of this.tickBlocks) {
        if (at > this.tick) continue;
        const [x, y, z] = k.split(',').map(Number);
        const id = s.world.getBlock(x, y, z);
        if (id < 0) continue; // chunk déchargé : on attend
        if (!this.tickIds.has(id)) {
          this.tickBlocks.delete(k);
          continue;
        }
        this.tickBlocks.set(k, this.tick + this.tickDelay(id));
        this.callBlock(id, 'onTick', (i) => ({ block: i.wrapBlock(x, y, z), dimension: (i.exports.world as Any).getDimension('overworld') }));
      }
    } else if (this.tickIds.size && this.tick % 20 === 0) this.scanLoadedChunks();
    // marcher sur un bloc / tomber dessus
    const bx = Math.floor(p.x), by = Math.floor(p.y - 0.05), bz = Math.floor(p.z);
    const below = p.body.onGround ? s.world.getBlock(bx, by, bz) : 0;
    const key = below > 0 && BlockRegistry.get(below).def.bedrock?.custom.length ? `${bx},${by},${bz}` : '';
    if (!p.body.onGround && p.body.vy < 0 && !this.fallStart) this.fallStart = p.y;
    if (key !== this.stepKey) {
      if (this.stepKey) {
        const [ox, oy, oz] = this.stepKey.split(',').map(Number);
        const oid = s.world.getBlock(ox, oy, oz);
        if (oid > 0) this.callBlock(oid, 'onStepOff', (i) => ({ block: i.wrapBlock(ox, oy, oz), dimension: (i.exports.world as Any).getDimension('overworld'), entity: i.wrapEntity(p) }));
      }
      if (key) {
        this.callBlock(below, 'onStepOn', (i) => ({ block: i.wrapBlock(bx, by, bz), dimension: (i.exports.world as Any).getDimension('overworld'), entity: i.wrapEntity(p) }));
        const fall = this.fallStart ? this.fallStart - p.y : 0;
        if (fall > 0.5) this.callBlock(below, 'onEntityFallOn', (i) => ({ block: i.wrapBlock(bx, by, bz), dimension: (i.exports.world as Any).getDimension('overworld'), entity: i.wrapEntity(p), fallDistance: fall }));
      }
      this.stepKey = key;
    }
    if (p.body.onGround) this.fallStart = 0;
    // inventaire, emplacement choisi, mode de jeu, météo
    const inv = p.inventory;
    for (let i = 0; i < inv.slots.length; i++) {
      const cur = inv.slots[i], prev = this.lastSlots[i] ?? null;
      if (cur !== prev && !(cur && prev && cur.id === prev.id && cur.count === prev.count && cur.durability === prev.durability && JSON.stringify(cur.meta ?? null) === JSON.stringify(prev.meta ?? null))) {
        const c = cur ? { ...cur } : null, b = prev ? { ...prev } : null;
        for (const inst of this.instances) this.safe(() => inst.fire.inventoryChange(i, c, b), 'playerInventoryItemChange');
      }
      this.lastSlots[i] = cur ? { ...cur } : null;
    }
    if (inv.selected !== this.lastSelected) {
      const prev = this.lastSelected;
      this.lastSelected = inv.selected;
      for (const inst of this.instances) this.safe(() => inst.fire.hotbarChange(prev, inv.selected), 'playerHotbarSelectedSlotChange');
    }
    if (p.gameMode !== this.lastMode) {
      const prev = this.lastMode;
      this.lastMode = p.gameMode;
      for (const inst of this.instances) this.safe(() => inst.fire.gameModeChange(prev, p.gameMode), 'playerGameModeChange');
    }
    if (s.weather.state !== this.lastWeather) {
      const prev = this.lastWeather;
      this.lastWeather = s.weather.state;
      for (const inst of this.instances) this.safe(() => inst.fire.weatherChange(prev, s.weather.state), 'weatherChange');
    }
    // feu (setOnFire) : dégâts périodiques
    if (this.tick % 20 === 0) {
      const burn = (dp: Map<string, unknown>, hurt: () => void) => {
        const until = dp.get('__fire') as number | undefined;
        if (until === undefined) return;
        if (until <= this.tick) dp.delete('__fire');
        else hurt();
      };
      burn(p.dynProps, () => p.damage(1, 'fire'));
      for (const e of s.entities.mobs) if (!e.dead) burn(e.dynProps, () => s.combat.damageMob(e, 1, { kind: 'environment', fire: true, cause: 'fireTick' }));
    }
    void WORLD_HEIGHT;
    void B;
    void decodeStates;
  }

  /** Arrête les scripts (fin de partie). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const k of Object.keys(hooks) as (keyof ScriptHooks)[]) delete hooks[k];
    this.offBlock?.();
    this.jobs.clear();
    this.ui.closeAll();
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
    const g = globalThis as Any;
    if (g.__lecraftScript) delete g.__lecraftScript[this.key];
  }
}

function faceName(face: number): string {
  return ['East', 'West', 'Up', 'Down', 'South', 'North'][face] ?? 'Up';
}
