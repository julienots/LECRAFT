/**
 * Serveur de survie moddé « LeCraft SMP » (hors ligne) : monde de survie sauvegardé où des bots
 * joueurs rejoignent et quittent la partie, récoltent du bois, minent en escalier, fabriquent de
 * meilleurs outils, choisissent un terrain et construisent leur maison bloc par bloc, combattent
 * les monstres la nuit, discutent entre eux et répondent au joueur (suivre, donner, dire ce
 * qu'ils font, où est leur maison).
 *
 * Mods : abattage d'arbre entier (TreeCapitator), filons de minerai (VeinMiner), tombes à la mort.
 * Plugins : /spawn /sethome /home /tpa /rtp /money /pay /shop /sell /msg /list, économie (pièces).
 */
import type { Session } from '../core/Session';
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { getDrops } from '../blocks/BlockBehaviors';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { makeStack } from '../inventory/Inventory';
import type { Mob } from '../entities/Mob';
import { Monster } from '../entities/Monster';
import { PLAYER_SKINS } from '../render/TextureManager';
import { Rng } from '../util/math';
import { planBuilding, buildingSize, type Building } from '../world/Village';
import { WORLD_HEIGHT } from '../core/Config';
import { Bot, RANKS } from './Bot';

export const SMP_NAME = 'LeCraft SMP';
export const SMP_WORLD_ID = 'smp-main';
export const SMP_SEED = 777123;

type Role = 'mineur' | 'bâtisseur' | 'aventurier' | 'fermier';
interface BotProfile {
  name: string;
  skin: string;
  skill: number;
  role: Role;
  rank: number;
  tier: number; // 0 mains nues, 1 bois, 2 pierre, 3 fer, 4 diamant
  inv: Record<string, number>;
  home: { x: number; y: number; z: number; facing: number; kind: Building } | null;
  built: number;
  houseDone: boolean;
}
interface PlayerData {
  coins: number;
  home: [number, number, number] | null;
}

type Task = 'wood' | 'mine' | 'build' | 'home' | 'idle' | 'follow' | 'fight' | 'site' | 'wander' | 'farm' | 'flee' | 'help';
const TIER_NAMES = ['mains nues', 'bois', 'pierre', 'fer', 'diamant'];
const TOOL_SPEED = [1, 2, 4, 6, 8];
const SELL: Record<string, number> = { coal: 2, raw_iron: 4, iron_ingot: 5, gold_ingot: 8, raw_gold: 6, diamond: 40, emerald: 25, lapis_lazuli: 2, redstone: 1, copper_ingot: 2, raw_copper: 1, oak_log: 1, wheat: 1, rotten_flesh: 1, bone: 1, string: 1, gunpowder: 3, ender_pearl: 10 };
const SHOP: [string, number, number][] = [
  ['bread', 4, 5], ['cooked_beef', 4, 8], ['torch', 16, 6], ['oak_log', 16, 10], ['iron_pickaxe', 1, 40], ['iron_sword', 1, 35],
  ['iron_chestplate', 1, 60], ['bow', 1, 20], ['arrow', 16, 10], ['golden_apple', 1, 50], ['diamond', 1, 80], ['red_bed', 1, 15],
];

/** Bot et sa « pensée » (tâche, minage en cours, plan de maison…). */
interface Mind {
  p: BotProfile;
  bot: Bot;
  task: Task;
  timer: number;
  target: [number, number, number] | null;
  mining: { x: number; y: number; z: number; t: number; then?: () => void } | null;
  stairs: { x: number; y: number; z: number; dx: number; dz: number; step: number; startY: number } | null;
  plan: [number, number, number, number, number][] | null;
  follow: number;
  placeTimer: number;
  talkTimer: number;
  onlineFor: number;
  stuck: number;
  lastPos: [number, number];
  /** Cibles inaccessibles (clé → secondes restantes). */
  avoid: Map<string, number>;
  wanderFor: number;
  buildWait: number;
  why?: string;
  /** Temps avant la prochaine bouchée / régénération. */
  eatTimer: number;
  /** Monstre qui attaque le joueur (le bot vient l'aider). */
  helpTarget: Monster | null;
  /** Ramassage des objets au sol. */
  pickTimer: number;
}

const P1 = ['Alex', 'Nico', 'Lucas', 'Emma', 'Hugo', 'Lea', 'Mathis', 'Jade', 'Theo', 'Chloe', 'Nathan', 'Ines', 'Tom', 'Lina', 'Enzo', 'Zoe', 'Noah', 'Sarah', 'Maxime', 'Clara'];
const P2 = ['Craft', 'Mine', 'Build', 'Block', 'Pixel', '_', 'Gaming', 'MC', 'TV', 'YT', 'Pro', 'Cube'];

export class SmpServer {
  private rng = new Rng((Math.random() * 1e9) | 0);
  private roster: BotProfile[] = [];
  online: Mind[] = [];
  data: PlayerData;
  private rosterTimer = 20;
  private sidebarTimer = 0;
  private globalTalk = 25;
  private wasNight = false;
  private tpa: { from: Mind; t: number } | null = null;
  /** Dernière téléportation acceptée (tests). */
  lastTpa = '';

  /** Mode « bots joueurs » d'un monde ordinaire : pas de mods, d'économie ni de spawn protégé. */
  readonly lite: boolean;
  constructor(readonly s: Session, opts: { lite?: boolean } = {}) {
    this.lite = !!opts.lite;
    this.data = this.load<PlayerData>('player', { coins: 0, home: null });
    this.roster = this.load<BotProfile[]>('bots', []);
    while (this.roster.length < 10) this.roster.push(this.newProfile());
  }

  private key(k: string) {
    return `lecraft.smp.${this.s.meta.id}.${k}`;
  }
  private load<T>(k: string, def: T): T {
    try {
      const v = localStorage.getItem(this.key(k));
      return v ? (JSON.parse(v) as T) : def;
    } catch {
      return def;
    }
  }
  /** Sauvegarde des profils des bots et du joueur (avec la sauvegarde du monde). */
  save() {
    try {
      localStorage.setItem(this.key('bots'), JSON.stringify(this.roster));
      localStorage.setItem(this.key('player'), JSON.stringify(this.data));
    } catch {
      /* stockage indisponible */
    }
  }

  private newProfile(): BotProfile {
    const r = this.rng;
    let name = '';
    for (let t = 0; t < 20 && (!name || this.roster.some((b) => b.name === name)); t++) {
      const a = r.pick(P1), b = r.pick(P2);
      name = r.next() < 0.5 ? `${a}${b === '_' ? '_' + r.int(10, 99) : b}` : `${a}${r.int(1, 2009)}`;
    }
    return {
      name, skin: PLAYER_SKINS[r.int(0, PLAYER_SKINS.length - 1)], skill: 0.45 + r.next() * 0.5,
      role: r.pick(['mineur', 'bâtisseur', 'aventurier', 'fermier'] as Role[]), rank: r.next() < 0.7 ? 0 : r.int(1, RANKS.length - 1),
      tier: 0, inv: {}, home: null, built: 0, houseDone: false,
    };
  }

  // ---------- démarrage ----------
  start() {
    const s = this.s;
    if (this.lite) {
      this.chat('§7Des §ebots joueurs§7 vont rejoindre la partie. Parlez-leur dans le chat (« suis-moi », « tu fais quoi ? », « donne-moi du bois »…).');
      const off = [...this.roster].sort(() => this.rng.next() - 0.5);
      for (let i = 0; i < 3; i++) setTimeout(() => this.join(off[i], i === 0), 2000 + i * 3000);
      return;
    }
    s.player.difficulty = 'normal';
    this.chat(`§7Connexion à §a${SMP_NAME}§7…`);
    this.chat('§a§l» §r§aBienvenue sur §2§lLeCraft SMP §r§a(survie moddée) !');
    this.chat('§7Mods : §fabattage d’arbre§7, §ffilons§7, §ftombes§7. Commandes : §e/spawn /sethome /home /tpa /shop /sell /money /pay /msg /list /rtp');
    const n = 3 + this.rng.int(0, 2);
    const off = this.roster.filter(() => true).sort(() => this.rng.next() - 0.5);
    for (let i = 0; i < n; i++) setTimeout(() => this.join(off[i], i === 0), 1500 + i * 2500);
  }

  private chat(text: string) {
    this.s.game.chat.add(text, 'chat');
  }
  private said = new Map<string, number>();
  private say(m: Mind, text: string) {
    if (!this.online.includes(m)) return;
    // pas deux fois la même phrase en deux minutes (comme un vrai joueur)
    const k = `${m.p.name}|${text}`, now = performance.now();
    if (now - (this.said.get(k) ?? -1e9) < 120000) return;
    this.said.set(k, now);
    const rank = RANKS[m.p.rank] ?? RANKS[0];
    this.chat(`${rank.tag}${rank.color}${m.p.name}§f: ${text}`);
  }
  private sayLater(m: Mind, text: string, delay = 1000 + Math.random() * 2000) {
    setTimeout(() => this.say(m, text), delay);
  }

  /** Un bot rejoint la partie (au point d'apparition ou chez lui). */
  private join(p: BotProfile, greet = false) {
    if (!p || this.online.some((m) => m.p === p)) return;
    const s = this.s;
    const [sx, , sz] = s.player.spawn;
    let at = p.home ?? { x: Math.floor(sx) + this.rng.int(-3, 3), y: 0, z: Math.floor(sz) + this.rng.int(-3, 3) };
    if (!s.world.isLoaded(at.x, at.z)) at = { x: Math.floor(sx) + this.rng.int(-3, 3), y: 0, z: Math.floor(sz) + this.rng.int(-3, 3) };
    if (!s.world.isLoaded(at.x, at.z)) return;
    const y = s.world.heightAt(at.x, at.z) + 1;
    const bot = new Bot(p.name, p.skin, p.skill, at.x + 0.5, y, at.z + 0.5, s.entities);
    bot.rank = RANKS[p.rank] ?? RANKS[0];
    bot.setTag(`${bot.rank.tag}${bot.rank.color}${p.name}`);
    bot.blocks = 0;
    s.entities.addMob(bot);
    const m: Mind = { p, bot, task: 'idle', timer: 0, target: null, mining: null, stairs: null, plan: null, follow: 0, placeTimer: 0, talkTimer: 20 + Math.random() * 40, onlineFor: 0, stuck: 0, lastPos: [bot.x, bot.z], avoid: new Map(), wanderFor: 0, buildWait: 0, eatTimer: 4, helpTarget: null, pickTimer: 1 };
    bot.brain = (_b, _ctx, dt) => this.think(m, dt);
    bot.weapon = this.toolFor(p, 'sword');
    this.online.push(m);
    this.chat(`§e${p.name} a rejoint la partie`);
    if (greet || Math.random() < 0.6) this.sayLater(m, this.rng.pick(p.home ? ['re', 're tout le monde', 'me revoilà', 'salut !'] : ['salut tout le monde !', 'bonjour', 'yo', 'hey, je suis nouveau ici']));
  }

  private leave(m: Mind) {
    if (Math.random() < 0.5) this.say(m, this.rng.pick(['bon je dois y aller', 'à plus', 'bye', 'je reviens plus tard', 'a+']));
    setTimeout(() => {
      m.bot.removed = true;
      this.online = this.online.filter((x) => x !== m);
      this.chat(`§e${m.p.name} a quitté la partie`);
    }, 1500);
  }

  // ---------- boucle ----------
  update(dt: number) {
    const s = this.s;
    // bot tué (par le joueur, la lave, une chute…) : il réapparaît au spawn
    for (const m of [...this.online])
      if (m.bot.dead || m.bot.removed) {
        this.online = this.online.filter((x) => x !== m);
        if (m.bot.dead) {
          const by = m.bot.lastAttacker === 'player' ? ' par Vous' : '';
          this.chat(`§7${m.p.name} est mort${by}.`);
          setTimeout(() => {
            this.join(m.p);
            const back = this.online.find((x) => x.p === m.p);
            if (back && by) this.sayLater(back, this.rng.pick(['pourquoi tu m’as tué ??', 'hé ! c’était pas cool', 'ok la guerre est déclarée mdr']));
          }, 4000);
        }
      }
    // arrivées et départs (3 à 6 joueurs en ligne)
    this.rosterTimer -= dt;
    if (this.rosterTimer <= 0) {
      this.rosterTimer = 45 + Math.random() * 90;
      const want = 3 + Math.floor(Math.random() * 4);
      if (this.online.length < want) this.join(this.roster.find((p) => !this.online.some((m) => m.p === p) && Math.random() < 0.5) ?? this.roster.find((p) => !this.online.some((m) => m.p === p))!);
      else if (this.online.length > 2) {
        const old = this.online.filter((m) => m.onlineFor > 240);
        if (old.length) this.leave(old[this.rng.int(0, old.length - 1)]);
      }
    }
    // conversations entre bots
    this.globalTalk -= dt;
    if (this.globalTalk <= 0 && this.online.length >= 2) {
      this.globalTalk = 30 + Math.random() * 60;
      this.smallTalk();
    }
    // tombée de la nuit
    const night = s.dayCycle.isNight;
    if (night && !this.wasNight && this.online.length) this.say(this.online[this.rng.int(0, this.online.length - 1)], this.rng.pick(['attention il fait nuit', 'la nuit tombe, rentrez chez vous', 'les monstres arrivent !', 'quelqu’un a un lit ?']));
    this.wasNight = night;
    // demande de téléportation
    if (this.tpa && (this.tpa.t -= dt) <= 0) {
      const m = this.tpa.from;
      this.tpa = null;
      if (this.online.includes(m)) {
        this.say(m, this.rng.pick(['ok accepté', 'vas-y viens', '/tpaccept']));
        const p = s.player;
        // exactement sur le bot (case libre garantie, même au fond d'une mine)
        p.body.setPos(m.bot.x, m.bot.y + 0.05, m.bot.z);
        p.body.vx = p.body.vy = p.body.vz = 0;
        p.body.fallDistance = 0;
        this.lastTpa = m.p.name;
        this.chat(`§aTéléporté vers ${m.p.name}.`);
      }
    }
    this.sidebarTimer -= dt;
    if (this.sidebarTimer <= 0 && !this.lite) {
      this.sidebarTimer = 0.5;
      const t = (s.dayCycle.time * 24 + 6) % 24;
      s.hud.setSidebar('§2§lLECRAFT SMP', [
        `§7Survie moddée`, '',
        `§fPièces : §6${this.data.coins}`,
        `§fJoueurs : §a${this.online.length + 1}`,
        `§fJour ${s.dayCycle.day + 1} · §e${String(Math.floor(t)).padStart(2, '0')}h`,
        `§fMaison : §7${this.data.home ? 'oui' : '/sethome'}`, '',
        '§asmp.lecraft.local',
      ]);
    }
  }

  private smallTalk() {
    const a = this.online[this.rng.int(0, this.online.length - 1)];
    const b = this.online.find((x) => x !== a)!;
    const topics: [string, string][] = [
      [`${b.p.name} t’as du fer ?`, a.p.inv.iron_ingot ? 'oui un peu' : 'non désolé'],
      ['quelqu’un veut faire une base ensemble ?', 'pourquoi pas'],
      ['j’ai trouvé une grotte énorme', 'trop bien, où ça ?'],
      [`${b.p.name} tu fais quoi ?`, this.describe(b)],
      ['le serveur lag pas un peu ?', 'non ça va chez moi'],
      ['vous avez vu le village au nord ?', 'oui j’y suis allé'],
      ['qui a des diamants ?', b.p.inv.diamond ? `moi j’en ai ${b.p.inv.diamond}` : 'pas encore'],
    ];
    const [q, r] = topics[this.rng.int(0, topics.length - 1)];
    this.say(a, q);
    this.sayLater(b, r, 2000 + Math.random() * 3000);
  }

  private describe(m: Mind): string {
    switch (m.task) {
      case 'wood': return 'je coupe du bois';
      case 'mine': return `je mine${m.bot.y < 40 ? ' en profondeur' : ''}, j’ai ${m.p.inv.cobblestone ?? 0} pierres`;
      case 'build': return `je construis ma maison (${m.p.home ? Math.round((m.p.built / Math.max(1, m.plan?.length ?? 1)) * 100) : 0} %)`;
      case 'home': return 'je rentre chez moi';
      case 'follow': return 'je te suis';
      case 'fight': return 'je tape des monstres';
      case 'site': return 'je cherche un terrain pour ma maison';
      case 'farm': return 'je m’occupe de mon champ de blé';
      case 'help': return 'je t’aide contre les monstres';
      case 'flee': return 'je fuis !';
      default: return this.rng.pick(['rien de spécial', 'je me balade', 'je range mes coffres']);
    }
  }

  // ---------- inventaire virtuel des bots ----------
  private add(p: BotProfile, k: string, n = 1) {
    p.inv[k] = (p.inv[k] ?? 0) + n;
  }
  private take(p: BotProfile, k: string, n: number) {
    if ((p.inv[k] ?? 0) < n) return false;
    p.inv[k] -= n;
    return true;
  }
  private toolFor(p: BotProfile, kind: 'pickaxe' | 'axe' | 'sword') {
    const mat = ['', 'wooden', 'stone', 'iron', 'diamond'][p.tier];
    return mat ? `${mat}_${kind}` : '';
  }

  /** Fabrication automatique : planches, meilleurs outils, lingots (four). */
  private craft(m: Mind) {
    const p = m.p;
    const logs = p.inv.log ?? 0;
    if (logs > 0 && (p.inv.planks ?? 0) < 24) {
      this.take(p, 'log', logs);
      this.add(p, 'planks', logs * 4);
    }
    const up = (tier: number, k: string, n: number) => {
      if (p.tier < tier && this.take(p, k, n)) {
        p.tier = tier;
        m.bot.weapon = this.toolFor(p, 'pickaxe');
        if (Math.random() < 0.7) this.say(m, this.rng.pick([`enfin des outils en ${TIER_NAMES[tier]} !`, `pioche en ${TIER_NAMES[tier]} fabriquée`, `je passe au ${TIER_NAMES[tier]}`]));
      }
    };
    up(1, 'planks', 5);
    up(2, 'cobblestone', 5);
    if ((p.inv.raw_iron ?? 0) >= 3 && ((p.inv.coal ?? 0) > 0 || (p.inv.planks ?? 0) > 4)) {
      const n = p.inv.raw_iron;
      this.take(p, 'raw_iron', n);
      if (!this.take(p, 'coal', 1)) this.take(p, 'planks', 4);
      this.add(p, 'iron_ingot', n);
    }
    up(3, 'iron_ingot', 3);
    up(4, 'diamond', 3);
  }

  // ---------- comportement ----------
  private think(m: Mind, dt: number) {
    const s = this.s, b = m.bot, p = m.p;
    m.onlineFor += dt;
    m.placeTimer -= dt;
    for (const [k, t] of m.avoid) if (t - dt <= 0) m.avoid.delete(k);
    else m.avoid.set(k, t - dt);
    // bloqué ? (n'avance plus vers sa cible)
    m.timer -= dt;
    if (m.timer <= 0) {
      m.timer = 3;
      const moved = Math.hypot(b.x - m.lastPos[0], b.z - m.lastPos[1]);
      m.stuck = moved < 0.5 && m.task !== 'idle' && m.task !== 'build' && m.task !== 'farm' && m.task !== 'help' && !m.mining ? m.stuck + 1 : 0;
      m.lastPos = [b.x, b.z];
      if (m.stuck >= 3) {
        // bloqué : cible mise de côté une minute, petite balade avant de réessayer
        m.stuck = 0;
        if (m.target) m.avoid.set(m.target.join(','), 60);
        m.target = null;
        m.stairs = null;
        m.task = 'wander';
        m.why = 'stuck';
        m.wanderFor = 6 + Math.random() * 6;
        m.bot.ai.clearPath();
      }
    }
    // minage en cours (durée selon la dureté et l'outil)
    if (m.mining) {
      const k = m.mining;
      k.t -= dt;
      b.attackAnim = 1;
      b.ai.stop();
      b.yaw = Math.atan2(k.x + 0.5 - b.x, k.z + 0.5 - b.z);
      if (Math.random() < dt * 6) s.particles.blockBreak?.(k.x, k.y, k.z, Math.max(1, s.world.getBlock(k.x, k.y, k.z)));
      if (k.t <= 0) {
        m.mining = null;
        this.breakNow(m, k.x, k.y, k.z);
        k.then?.();
      }
      return;
    }
    // survie : se nourrir et récupérer hors combat ; ramasser les objets au sol
    this.survive(m, dt);
    // creeper proche : on s'écarte (un vrai joueur ne le frappe pas au corps à corps quand il siffle)
    const creeper = this.nearestMonster(b, 7, 'creeper') as (Monster & { fuse: number }) | null;
    if (creeper && (creeper.fuse > 0 || Math.hypot(creeper.x - b.x, creeper.z - b.z) < 4)) {
      const dx = b.x - creeper.x, dz = b.z - creeper.z, d = Math.hypot(dx, dz) || 1;
      b.ai.moveTowards(b.x + (dx / d) * 6, b.z + (dz / d) * 6, 1.3, true);
      if (m.task !== 'flee') this.say(m, this.rng.pick(['CREEPER !', 'attention creeper', 'aaah un creeper']));
      m.task = 'flee';
      return;
    }
    // vie basse : fuite (vers la maison si elle existe), on ne se bat plus
    if (b.health <= 6 && this.nearestMonster(b, 10)) {
      const foe0 = this.nearestMonster(b, 10)!;
      const dx = b.x - foe0.x, dz = b.z - foe0.z, d = Math.hypot(dx, dz) || 1;
      if (m.p.home) b.goTo(m.p.home.x + 0.5, m.p.home.y, m.p.home.z + 2.5, true);
      else b.ai.moveTowards(b.x + (dx / d) * 8, b.z + (dz / d) * 8, 1.3, true);
      if (m.task !== 'flee') this.say(m, this.rng.pick(['à l’aide, j’ai plus de vie', 'je fuis', 'je vais mourir aidez-moi']));
      m.task = 'flee';
      return;
    }
    if (m.task === 'flee') m.task = 'idle';
    // le joueur se fait attaquer près du bot : il vient l'aider
    if (!m.helpTarget || m.helpTarget.dead) {
      m.helpTarget = null;
      const pl = s.player;
      if (!pl.dead && Math.hypot(pl.x - b.x, pl.z - b.z) < 20 && p.tier >= 1) {
        const threat = this.nearestMonsterTo(pl.x, pl.y, pl.z, 6);
        if (threat && threat.def.key !== 'creeper') {
          m.helpTarget = threat;
          this.say(m, this.rng.pick(['je viens t’aider !', 'tiens bon j’arrive', 'je m’en occupe']));
        }
      }
    }
    if (m.helpTarget) {
      const h = m.helpTarget;
      m.task = 'help';
      b.weapon = this.toolFor(p, 'sword') || this.toolFor(p, 'axe');
      b.fight(s, h, dt, (dmg, kx, kz) => s.combat.damageMob(h, dmg, { kind: 'bot', knockX: kx, knockZ: kz, attacker: b as never }));
      if (h.dead) {
        m.helpTarget = null;
        m.task = 'idle';
        if (Math.random() < 0.5) this.sayLater(m, this.rng.pick(['c’est bon il est mort', 'de rien ;)', 'ça va ?']));
      }
      return;
    }
    // menace : monstre proche → combat (avec une arme), sinon fuite vers la maison
    // en train de suivre le joueur : on ne se bat que si le monstre est collé à nous
    const foe = this.nearestMonster(b, m.follow > 0 ? 3.5 : 9);
    if (foe && foe.def.key !== 'creeper') {
      if (p.tier >= 1 || b.health > 12) {
        if (m.task !== 'fight' && Math.random() < 0.3) this.say(m, this.rng.pick(['un zombie !', 'au secours', 'viens là toi', 'encore un creeper…']));
        m.task = 'fight';
        b.weapon = this.toolFor(p, 'sword') || this.toolFor(p, 'axe');
        b.fight(s, foe, dt, (dmg, kx, kz) => {
          s.combat.damageMob(foe, dmg, { kind: 'bot', knockX: kx, knockZ: kz, attacker: b as never });
          if (foe.dead) this.add(p, 'rotten_flesh');
        });
        return;
      }
    } else if (m.task === 'fight') m.task = 'idle';
    // suivre le joueur
    if (m.follow > 0) {
      m.follow -= dt;
      m.task = 'follow';
      const pl = s.player;
      const d = Math.hypot(pl.x - b.x, pl.z - b.z);
      // trop loin : comme un vrai joueur du serveur, il demande une téléportation (/tpa)
      if (d > 24 && m.follow < 118) {
        this.say(m, this.rng.pick(['je me tp', '/tpa, j’arrive', 'attends je te rejoins']));
        b.body.setPos(pl.x, pl.y + 0.05, pl.z);
        b.body.vx = b.body.vy = b.body.vz = 0;
        b.ai.clearPath();
        return;
      }
      if (d > 3) b.goTo(pl.x, pl.y, pl.z, d > 8);
      else {
        b.ai.stop();
        b.yaw = Math.atan2(pl.x - b.x, pl.z - b.z);
      }
      if (m.follow <= 0) m.task = 'idle';
      return;
    }
    // bavardage
    m.talkTimer -= dt;
    if (m.talkTimer <= 0) {
      m.talkTimer = 60 + Math.random() * 120;
      if (Math.random() < 0.5) this.say(m, this.describe(m));
    }
    if (m.task === 'wander') {
      m.wanderFor -= dt;
      if (m.wanderFor <= 0) m.task = 'idle';
    }
    if (m.task === 'idle') this.chooseTask(m);
    switch (m.task) {
      case 'wood': return this.doWood(m);
      case 'mine': return this.doMine(m);
      case 'site': return this.doSite(m);
      case 'build': return this.doBuild(m, dt);
      case 'home': return this.doHome(m);
      case 'wander': return this.doWander(m, dt);
      case 'farm': return this.doFarm(m);
      default:
    }
  }

  /** Manger, se soigner, ramasser les objets proches (comme un joueur). */
  private survive(m: Mind, dt: number) {
    const b = m.bot, p = m.p, s = this.s;
    m.eatTimer -= dt;
    if (m.eatTimer <= 0) {
      m.eatTimer = 4;
      if (b.health < 20 && m.task !== 'fight' && m.task !== 'help') {
        const food = ['cooked_beef', 'bread', 'cooked_porkchop', 'apple', 'carrot', 'baked_potato'].find((k) => (p.inv[k] ?? 0) > 0);
        if (food && b.health < 14) {
          this.take(p, food, 1);
          b.health = Math.min(20, b.health + 6);
          s.audio.play('eat', { x: b.x, y: b.y, z: b.z, volume: 0.5 });
        } else b.health = Math.min(20, b.health + 1);
      }
    }
    m.pickTimer -= dt;
    if (m.pickTimer <= 0) {
      m.pickTimer = 0.8;
      for (const e of s.entities.entities) {
        if (e.kind !== 'item' || e.removed) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y, e.z - b.z) > 1.8) continue;
        const it = e as unknown as { itemId: string; count: number; pickupDelay: number };
        if (it.pickupDelay > 0) continue;
        const k = /_log$|_stem$/.test(it.itemId) ? 'log' : /_planks$/.test(it.itemId) ? 'planks' : it.itemId;
        this.add(p, k, it.count);
        e.removed = true;
        s.audio.play('pop', { x: b.x, y: b.y, z: b.z, volume: 0.3 });
      }
    }
  }

  /** Fermier : petit champ de blé à côté de sa maison (labour, semis, récolte, resemis). */
  private doFarm(m: Mind) {
    const b = m.bot, p = m.p, w = this.s.world;
    const h = p.home;
    if (!h) {
      m.task = 'idle';
      return;
    }
    const fx = h.x + 5, fz = h.z + 1;
    // 3×3 cases : on traite la première qui a besoin de quelque chose
    for (let dz = 0; dz < 3; dz++)
      for (let dx = 0; dx < 3; dx++) {
        const x = fx + dx, z = fz + dz;
        if (!w.isLoaded(x, z)) continue;
        const y = this.groundAt(x, z);
        const g = w.getBlock(x, y, z), above = w.getBlock(x, y + 1, z);
        const ripe = above === B.WHEAT && w.getMeta(x, y + 1, z) >= 7;
        const todo = ripe || ((g === B.GRASS_BLOCK || g === B.DIRT) && (above === B.AIR || BlockRegistry.replaceable[above])) || (g === B.FARMLAND && above === B.AIR);
        if (!todo) continue;
        if (Math.hypot(x + 0.5 - b.x, z + 0.5 - b.z) > 2.5) {
          b.goTo(x + 0.5, y + 1, z + 0.5);
          return;
        }
        if (m.placeTimer > 0) return;
        m.placeTimer = 0.6;
        b.attackAnim = 1;
        b.yaw = Math.atan2(x + 0.5 - b.x, z + 0.5 - b.z);
        if (ripe) {
          w.setBlock(x, y + 1, z, B.AIR);
          this.add(p, 'wheat', 1);
          this.add(p, 'wheat_seeds', 1 + this.rng.int(0, 2));
          if ((p.inv.wheat ?? 0) >= 3 && this.take(p, 'wheat', 3)) this.add(p, 'bread', 1);
        } else if (g !== B.FARMLAND) {
          if (above > 0) w.setBlock(x, y + 1, z, B.AIR);
          w.setBlock(x, y, z, B.FARMLAND, 0);
        } else {
          // graines : celles de la récolte, sinon trouvées en coupant l'herbe
          this.take(p, 'wheat_seeds', 1);
          w.setBlock(x, y + 1, z, B.WHEAT, 0);
        }
        this.s.audio.blockSound('place', 'grass', x + 0.5, y + 1, z + 0.5);
        return;
      }
    // rien à faire au champ : on passe à autre chose
    m.task = 'wander';
    m.wanderFor = 10;
  }

  private chooseTask(m: Mind) {
    const p = m.p, s = this.s;
    this.craft(m);
    const planks = (p.inv.planks ?? 0) + (p.inv.log ?? 0) * 4;
    const night = s.dayCycle.isNight;
    let next: Task;
    if (night && p.houseDone) next = 'home';
    else if (p.tier < 1 || planks < 8) next = 'wood';
    else if (p.tier < 2 || (p.inv.cobblestone ?? 0) < 6) next = 'mine';
    else if (!p.home) next = 'site';
    else if (!p.houseDone && planks < 40) next = 'wood';
    else if (!p.houseDone && (p.inv.cobblestone ?? 0) < 20) next = 'mine';
    else if (!p.houseDone) next = 'build';
    else if (p.role === 'fermier' && !night) next = 'farm';
    else if (p.tier < 3 || (p.role === 'mineur' && Math.random() < 0.6)) next = 'mine';
    else next = Math.random() < 0.5 ? 'wander' : 'wood';
    if (next !== m.task) {
      m.target = null;
      m.stairs = null;
      if (Math.random() < 0.35) {
        const lines: Partial<Record<Task, string[]>> = {
          wood: ['je vais chercher du bois', 'il me faut du bois'],
          mine: ['je descends miner', 'go miner', 'je vais chercher du fer'],
          site: ['je cherche un endroit pour construire'],
          build: ['je construis ma maison', 'au boulot, la maison va pas se faire toute seule'],
          home: ['je rentre'],
        };
        const l = lines[next];
        if (l) this.say(m, this.rng.pick(l));
      }
    }
    m.task = next;
    m.why = 'choose';
    if (next === 'wander') m.wanderFor = 8 + Math.random() * 10;
  }

  /** Commence à casser un bloc (durée selon dureté et outil). */
  private mine(m: Mind, x: number, y: number, z: number, then?: () => void) {
    const id = this.s.world.getBlock(x, y, z);
    if (id <= 0 || BlockRegistry.liquid[id]) return then?.();
    const def = BlockRegistry.get(id);
    if (def.hardness < 0) return;
    const speed = TOOL_SPEED[m.p.tier];
    m.bot.weapon = def.tool === 'axe' ? this.toolFor(m.p, 'axe') : def.tool === 'pickaxe' ? this.toolFor(m.p, 'pickaxe') : m.bot.weapon;
    m.mining = { x, y, z, t: Math.min(3, Math.max(0.15, (def.hardness * 1.5) / (def.tool === 'pickaxe' || def.tool === 'axe' ? speed : 1))), then };
  }

  /** Bloc cassé par un bot : butin dans son inventaire virtuel. */
  private breakNow(m: Mind, x: number, y: number, z: number) {
    const s = this.s, w = s.world;
    const id = w.getBlock(x, y, z);
    if (id <= 0) return;
    const key = BlockRegistry.get(id).key;
    w.setBlock(x, y, z, B.AIR);
    s.particles.blockBreak(x, y, z, id);
    s.audio.blockSound('break', BlockRegistry.get(id).sound, x + 0.5, y + 0.5, z + 0.5);
    if (/_log$|_stem$/.test(key)) this.add(m.p, 'log');
    else if (/stone$|deepslate$|^granite$|^andesite$|^diorite$|^tuff$/.test(key)) this.add(m.p, 'cobblestone');
    else if (/_ore$/.test(key)) {
      for (const d of getDrops(id, 0, this.toolFor(m.p, 'pickaxe') || undefined)) this.add(m.p, d.id, d.count);
      if (key.includes('diamond')) this.say(m, this.rng.pick(['DIAMANTS !!!', 'j’ai trouvé des diamants', 'trop chanceux, diamants']));
      else if (key.includes('iron') && Math.random() < 0.3) this.say(m, 'du fer !');
    } else if (key === 'dirt' || key === 'grass_block') this.add(m.p, 'dirt');
  }

  private nearestMonster(b: Bot, r: number, key?: string): Monster | null {
    return this.nearestMonsterTo(b.x, b.y, b.z, r, key);
  }

  private nearestMonsterTo(x: number, y: number, z: number, r: number, key?: string): Monster | null {
    let best: Monster | null = null, bd = r;
    for (const e of this.s.entities.mobs) {
      if (!(e instanceof Monster) || e.dead || (key && e.def.key !== key)) continue;
      const d = Math.hypot(e.x - x, e.y - y, e.z - z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** Bois : cherche le tronc le plus proche, y va et abat l'arbre entier (le bot a le mod). */
  private doWood(m: Mind) {
    const b = m.bot, w = this.s.world;
    if (!m.target || !this.isLog(w.getBlock(...m.target))) {
      m.target = this.findBlock(b, 28, (id) => this.isLog(id), true, m.avoid);
      if (!m.target) {
        m.task = 'wander';
        m.wanderFor = 8;
        return;
      }
      // on vise le bas du tronc (accessible depuis le sol), pas le haut caché dans les feuilles
      while (m.target[1] > 1 && this.isLog(w.getBlock(m.target[0], m.target[1] - 1, m.target[2]))) m.target[1]--;
    }
    const [x, y, z] = m.target;
    const d = Math.hypot(x + 0.5 - b.x, z + 0.5 - b.z);
    if (d > 2.6 || Math.abs(y - b.y) > 4) {
      b.goTo(x + 0.5, y, z + 0.5, d > 10);
      return;
    }
    this.mine(m, x, y, z, () => {
      // abattage de tout l'arbre (mod TreeCapitator)
      const n = this.fell(x, y, z, (bx, by, bz) => this.breakNow(m, bx, by, bz));
      if (n > 3 && Math.random() < 0.2) this.say(m, 'timber !');
      m.target = null;
      if ((m.p.inv.log ?? 0) * 4 + (m.p.inv.planks ?? 0) >= (m.p.home && !m.p.houseDone ? 48 : 16)) m.task = 'idle';
    });
  }

  private isLog(id: number) {
    if (id <= 0) return false;
    const k = BlockRegistry.get(id).key;
    return /_log$|_stem$/.test(k);
  }

  /** Bloc le plus proche répondant au critère (recherche par colonnes autour du bot). */
  private findBlock(b: Bot, r: number, ok: (id: number) => boolean, surface: boolean, avoid?: Map<string, number>): [number, number, number] | null {
    const w = this.s.world;
    const bx = Math.floor(b.x), bz = Math.floor(b.z), by = Math.floor(b.y);
    let best: [number, number, number] | null = null, bd = Infinity;
    for (let dz = -r; dz <= r; dz += 1)
      for (let dx = -r; dx <= r; dx += 1) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r || d2 >= bd) continue;
        const x = bx + dx, z = bz + dz;
        if (!w.isLoaded(x, z)) continue;
        const top = surface ? w.heightAt(x, z) : by + 3;
        for (let y = top; y >= Math.max(1, (surface ? top : by) - (surface ? 14 : 6)); y--) {
          if (ok(w.getBlock(x, y, z))) {
            // tronc déjà jugé inaccessible : ignoré (on compare la colonne, pas la hauteur)
            if (avoid && [...avoid.keys()].some((k) => k.startsWith(`${x},`) && k.endsWith(`,${z}`))) break;
            bd = d2;
            best = [x, y, z];
            break;
          }
        }
      }
    return best;
  }

  /** Abat les troncs reliés (jusqu'à 96). Retourne le nombre de blocs. */
  fell(x: number, y: number, z: number, breakAt: (x: number, y: number, z: number) => void): number {
    const w = this.s.world;
    const seen = new Set<string>();
    const todo: [number, number, number][] = [[x, y, z]];
    let n = 0;
    while (todo.length && n < 96) {
      const [cx, cy, cz] = todo.pop()!;
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy, nz = cz + dz;
            const k = `${nx},${ny},${nz}`;
            if (seen.has(k)) continue;
            seen.add(k);
            if (this.isLog(w.getBlock(nx, ny, nz)) && ny >= y) {
              breakAt(nx, ny, nz);
              n++;
              todo.push([nx, ny, nz]);
            }
          }
    }
    return n;
  }

  /** Minage en escalier : descend en creusant 3 blocs de haut, ramasse les minerais visibles. */
  private doMine(m: Mind) {
    const b = m.bot, w = this.s.world;
    if (!m.stairs) {
      // pas de mine au spawn (zone protégée) : on s'éloigne d'abord
      const [px, , pz] = this.s.player.spawn;
      if (Math.hypot(b.x - px, b.z - pz) < 14) {
        const a = Math.atan2(b.z - pz, b.x - px) + (Math.random() - 0.5);
        const tx = px + Math.cos(a) * 18, tz = pz + Math.sin(a) * 18;
        b.goTo(tx, w.heightAt(Math.floor(tx), Math.floor(tz)) + 1, tz, true);
        return;
      }
      const [dx, dz] = this.rng.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
      const sx = Math.floor(b.x), sz = Math.floor(b.z);
      m.stairs = { x: sx, y: Math.floor(b.y + 0.05), z: sz, dx, dz, step: 0, startY: Math.floor(b.y + 0.05) };
    }
    const st = m.stairs;
    // profondeur visée selon l'outil, et au moins 12 marches depuis le départ
    const goalY = Math.max(6, Math.min(m.p.tier >= 3 ? 14 : m.p.tier >= 2 ? 28 : 46, st.startY - 12));
    // minerais à portée : on les prend d'abord (mod VeinMiner)
    const ore = this.findOre(b);
    if (ore) return this.mine(m, ore[0], ore[1], ore[2]);
    if (st.y <= goalY || st.step > 60) {
      this.say(m, this.rng.pick(['bon je remonte', 'assez miné pour aujourd’hui', `j’ai ${m.p.inv.cobblestone ?? 0} pierres et ${m.p.inv.raw_iron ?? 0} fer`]));
      m.stairs = null;
      m.task = 'home';
      return;
    }
    const nx = st.x + st.dx, nz = st.z + st.dz, ny = st.y - 1;
    // danger : lave ou eau autour de la prochaine marche → on bouche ou on tourne
    for (const [ox, oy, oz] of [[0, 0, 0], [0, 1, 0], [0, 2, 0], [st.dx, 0, st.dz], [st.dx, 1, st.dz], [0, -1, 0]]) {
      const id = w.getBlock(nx + ox, ny + oy, nz + oz);
      if (id > 0 && BlockRegistry.liquid[id]) {
        if (BlockRegistry.liquid[id] === 2 && Math.random() < 0.5) this.say(m, 'oula de la lave');
        if (this.take(m.p, 'cobblestone', 1)) w.setBlock(nx + ox, ny + oy, nz + oz, B.COBBLESTONE);
        else {
          m.stairs = { ...st, dx: -st.dz, dz: st.dx };
          return;
        }
      }
    }
    for (const yy of [ny + 2, ny + 1, ny]) {
      const id = w.getBlock(nx, yy, nz);
      if (id > 0 && BlockRegistry.solid[id]) {
        if (Math.hypot(nx + 0.5 - b.x, nz + 0.5 - b.z) > 3.2) {
          b.goTo(st.x + 0.5, st.y, st.z + 0.5);
          return;
        }
        return this.mine(m, nx, yy, nz);
      }
    }
    // marche praticable : sol dessous (sinon on le pose)
    if (!w.isSolid(nx, ny - 1, nz) && this.take(m.p, 'cobblestone', 1)) w.setBlock(nx, ny - 1, nz, B.COBBLESTONE);
    if (Math.hypot(nx + 0.5 - b.x, nz + 0.5 - b.z) > 0.6) {
      b.ai.moveTowards(nx + 0.5, nz + 0.5, 0.8, false);
      return;
    }
    // torche de temps en temps
    if (st.step % 8 === 4 && w.getBlock(st.x, st.y + 1, st.z) === B.AIR) w.setBlock(st.x, st.y + 1, st.z, B.TORCH, 0);
    m.stairs = { ...st, x: nx, y: ny, z: nz, step: st.step + 1 };
  }

  private findOre(b: Bot): [number, number, number] | null {
    const w = this.s.world;
    const bx = Math.floor(b.x), by = Math.floor(b.y), bz = Math.floor(b.z);
    for (let dy = -1; dy <= 3; dy++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const id = w.getBlock(bx + dx, by + dy, bz + dz);
          if (id > 0 && BlockRegistry.get(id).key.endsWith('_ore')) {
            // accessible : au moins une face à l'air
            for (const [ox, oy, oz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])
              if (w.getBlock(bx + dx + ox, by + dy + oy, bz + dz + oz) === B.AIR) return [bx + dx, by + dy, bz + dz];
          }
        }
    return null;
  }

  /** Choix d'un terrain plat pour la maison (près du point d'apparition, loin des autres). */
  private doSite(m: Mind) {
    const w = this.s.world, b = m.bot;
    const [sx, , sz] = this.s.player.spawn;
    let best: { x: number; z: number; y: number; score: number; kind: Building } | null = null;
    for (let t = 0; t < 70; t++) {
      const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 48;
      const x = Math.floor(sx + Math.cos(a) * r), z = Math.floor(sz + Math.sin(a) * r);
      if (!w.isLoaded(x - 6, z - 6) || !w.isLoaded(x + 6, z + 6)) continue;
      if (this.roster.some((p) => p.home && Math.hypot(p.home.x - x, p.home.z - z) < 16)) continue;
      const kind: Building = m.p.role === 'bâtisseur' ? 'medium' : 'small';
      const [hw, depth] = buildingSize(kind);
      let lo = Infinity, hi = -Infinity, wet = false;
      for (let dz = -1; dz <= depth; dz++)
        for (let dx = -hw - 1; dx <= hw + 1; dx++) {
          const h = this.groundAt(x + dx, z + dz);
          const top = w.getBlock(x + dx, w.heightAt(x + dx, z + dz), z + dz);
          if (top > 0 && BlockRegistry.liquid[top]) wet = true;
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      // terrain assez plat (les fondations comblent jusqu'à 4 blocs), au sec, plutôt proche
      if (wet || hi - lo > 4) continue;
      const score = (hi - lo) * 3 + r / 20;
      if (!best || score < best.score) best = { x, z, y: Math.round((hi + lo) / 2) + 1, score, kind };
    }
    if (best) {
      const { x, z, kind } = best;
      m.p.home = { x, y: best.y, z, facing: this.rng.int(0, 3), kind };
      m.p.built = 0;
      m.plan = null;
      this.say(m, this.rng.pick([`j’ai trouvé un terrain en ${x}, ${z}`, 'je vais construire ici', 'parfait cet endroit']));
      m.task = 'build';
      return;
    }
    // rien trouvé : on se déplace un peu et on réessaie
    m.task = 'wander';
    m.wanderFor = 8;
    void b;
  }

  /** Hauteur du vrai sol (sans feuilles, troncs ni plantes). */
  groundAt(x: number, z: number) {
    const w = this.s.world;
    let y = w.heightAt(x, z);
    while (y > 1) {
      const id = w.getBlock(x, y, z);
      const k = id > 0 ? BlockRegistry.get(id).key : '';
      if (id > 0 && BlockRegistry.solid[id] && !/leaves|_log$|_stem$|mushroom_block/.test(k)) break;
      y--;
    }
    return y;
  }

  private planFor(m: Mind) {
    const h = m.p.home!;
    const w = this.s.world;
    m.plan ??= planBuilding(h.kind, h.x, h.y, h.z, h.facing, w.biomeAt(h.x, h.z).key, { heightAt: (x, z) => this.groundAt(x, z), biomeAt: () => 0 }, h.x * 31 + h.z);
    return m.plan;
  }

  /** Construction de la maison, bloc par bloc (consomme planches et pierres). */
  private doBuild(m: Mind, dt: number) {
    const b = m.bot, w = this.s.world, p = m.p;
    if (!p.home) {
      m.task = 'site';
      return;
    }
    const plan = this.planFor(m);
    // saute ce qui est déjà en place
    while (p.built < plan.length) {
      const [x, y, z, id, meta] = plan[p.built];
      if (w.getBlock(x, y, z) === id && (id === B.AIR || w.getMeta(x, y, z) === meta)) p.built++;
      else break;
    }
    if (p.built >= plan.length) {
      p.houseDone = true;
      this.say(m, this.rng.pick(['ma maison est finie, venez voir !', `maison terminée en ${p.home.x}, ${p.home.z}`, 'enfin fini de construire']));
      m.task = 'idle';
      return;
    }
    const [x, y, z, id, meta] = plan[p.built];
    const d = Math.hypot(x + 0.5 - b.x, z + 0.5 - b.z);
    // portée depuis les yeux (dégager : jusqu'à 8 blocs au-dessus, comme un joueur qui coupe les feuilles)
    const reach = id === B.AIR ? d <= 5 && y - b.y <= 8 && y - b.y >= -3 : Math.hypot(d, y + 0.5 - (b.y + 1.6)) <= 6;
    // feuilles trop hautes au-dessus du chantier : laissées telles quelles
    if (!reach && id === B.AIR && d <= 5 && y - b.y > 8) {
      p.built++;
      return;
    }
    if (!reach) {
      // vers le bloc à poser (le chemin s'arrête au point accessible le plus proche)
      b.goTo(x + 0.5, Math.min(y, this.groundAt(x, z) + 1), z + 0.5, d > 10);
      m.buildWait += dt;
      // bloqué longtemps sur son propre chantier : il s'y place (comme un joueur qui grimpe)
      if (m.buildWait > 6) {
        m.buildWait = 0;
        const f = p.home.facing;
        const gx = x + (f === 1 ? 2 : f === 3 ? -2 : 0), gz = z + (f === 0 ? -2 : f === 2 ? 2 : 0);
        b.body.setPos(gx + 0.5, this.groundAt(gx, gz) + 1, gz + 0.5);
        b.ai.clearPath();
      }
      return;
    }
    m.buildWait = 0;
    if (m.placeTimer > 0) return;
    m.placeTimer = 0.32 - p.skill * 0.12;
    // matériaux : planches pour le bois, pierres pour la pierre ; le reste est « fabriqué »
    const key = BlockRegistry.get(id).key;
    const need = id === B.AIR ? null : /planks|stairs|slab|log|fence|door/.test(key) ? 'planks' : /cobble|stone|bricks/.test(key) ? 'cobblestone' : null;
    if (need && !this.take(p, need, 1)) {
      m.task = need === 'planks' ? 'wood' : 'mine';
      if (Math.random() < 0.4) this.say(m, need === 'planks' ? 'plus de bois, je retourne en chercher' : 'il me faut plus de pierre');
      return;
    }
    // le bot ne s'emmure pas : s'il est dans la case, il s'écarte
    if (id !== B.AIR && Math.floor(b.x) === x && Math.floor(b.z) === z && Math.abs(Math.floor(b.y) - y) <= 1) {
      b.body.setPos(b.x + 1.2, b.y + 0.1, b.z);
      return;
    }
    if (id === B.AIR) {
      const cur = w.getBlock(x, y, z);
      if (cur > 0) this.breakNow(m, x, y, z);
    } else w.setBlock(x, y, z, id, meta);
    b.attackAnim = 1;
    b.yaw = Math.atan2(x + 0.5 - b.x, z + 0.5 - b.z);
    if (id !== B.AIR) this.s.audio.blockSound('place', BlockRegistry.get(id).sound, x + 0.5, y + 0.5, z + 0.5);
    p.built++;
  }

  private doHome(m: Mind) {
    const b = m.bot, h = m.p.home;
    if (!h) {
      m.task = 'idle';
      return;
    }
    const tx = h.x + 0.5, tz = h.z + 2.5;
    if (Math.hypot(tx - b.x, tz - b.z) > 2) b.goTo(tx, h.y, tz, true);
    else {
      b.ai.stop();
      if (!this.s.dayCycle.isNight) m.task = 'idle';
    }
  }

  private wanderGoal = new Map<Mind, [number, number, number]>();
  private doWander(m: Mind, dt: number) {
    const b = m.bot;
    let g = this.wanderGoal.get(m);
    if (!g || Math.hypot(g[0] - b.x, g[1] - b.z) < 1.5 || (g[2] -= dt) <= 0) {
      g = [b.x + (Math.random() - 0.5) * 30, b.z + (Math.random() - 0.5) * 30, 10];
      this.wanderGoal.set(m, g);
    }
    b.goTo(g[0], this.s.world.heightAt(Math.floor(g[0]), Math.floor(g[1])) + 1, g[1]);
  }

  // ---------- joueur : chat, commandes, mods ----------
  playerChat(text: string) {
    if (!this.online.length) return;
    const t = text.toLowerCase();
    const named = this.online.find((m) => t.includes(m.p.name.toLowerCase()));
    const pl = this.s.player;
    const m = named ?? [...this.online].sort((a, b) => Math.hypot(a.bot.x - pl.x, a.bot.z - pl.z) - Math.hypot(b.bot.x - pl.x, b.bot.z - pl.z))[0];
    const reply = (r: string) => this.sayLater(m, r);
    if (/suis[- ]moi|viens|follow|rejoins[- ]moi/.test(t)) {
      m.follow = 120;
      reply(this.rng.pick(['j’arrive !', 'ok je te suis', 'en route']));
    } else if (/\b(stop|arr[eê]te|reste)\b/.test(t)) {
      m.follow = 0;
      reply('ok');
    } else if (/(donne|file|passe|t'?as|tu as|aurais)/.test(t)) {
      const wants: [RegExp, string, string][] = [[/bois|planche/, 'planks', 'oak_planks'], [/fer/, 'iron_ingot', 'iron_ingot'], [/diam/, 'diamond', 'diamond'], [/pierre|cobble/, 'cobblestone', 'cobblestone'], [/charbon/, 'coal', 'coal'], [/b[uû]che|tronc/, 'log', 'oak_log']];
      const w = wants.find(([re]) => re.test(t));
      if (!w) return reply(this.rng.pick(['te donner quoi ?', 'j’ai du bois et de la pierre si tu veux']));
      const have = m.p.inv[w[1]] ?? 0;
      if (!have) return reply(this.rng.pick(['j’en ai pas désolé', 'non j’en ai plus', 'va miner toi aussi mdr']));
      const n = Math.min(have, w[1] === 'diamond' ? 1 : 16);
      if (w[1] === 'diamond' && Math.random() < 0.5) return reply('mes diamants ? non merci mdr');
      m.p.inv[w[1]] -= n;
      setTimeout(() => {
        this.s.entities.spawnItem(w[2], n, pl.x, pl.y + 1, pl.z);
        this.say(m, `tiens, ${n} ${ItemRegistry.get(w[2])?.name ?? w[2]}`);
      }, 1500);
    } else if (/(tu fais quoi|que fais|qu'est-ce que tu fais|tu fais)/.test(t)) reply(this.describe(m));
    else if (/(maison|base|o[uù] tu)/.test(t)) reply(m.p.home ? `ma maison est en ${m.p.home.x}, ${m.p.home.z}${m.p.houseDone ? '' : ' (pas finie)'}` : 'j’ai pas encore de maison');
    else if (/(salut|bonjour|slt|coucou|yo|hey)/.test(t)) reply(this.rng.pick(['salut !', 'yo', 'bonjour :)', 'salut, bienvenue']));
    else if (/merci|thx/.test(t)) reply(this.rng.pick(['de rien', 'avec plaisir', 'np']));
    else if (/(niveau|outil|pioche)/.test(t)) reply(`j’ai des outils en ${TIER_NAMES[m.p.tier]}`);
    else if (/\?$/.test(t)) reply(this.rng.pick(['je sais pas trop', 'oui', 'non', 'bonne question', 'peut-être']));
    else if (Math.random() < 0.4) reply(this.rng.pick(['mdr', 'ok', 'cool', 'ah ouais', 'grave']));
  }

  command(line: string): boolean {
    const [cmd, ...args] = line.trim().split(/\s+/);
    const c = cmd.toLowerCase();
    const s = this.s, p = s.player;
    if (this.lite && !['/list', '/msg', '/tell', '/w', '/tpa'].includes(c)) return false;
    const tp = (x: number, y: number, z: number) => {
      p.body.setPos(x, y, z);
      p.body.vx = p.body.vy = p.body.vz = 0;
      p.body.fallDistance = 0;
    };
    switch (c) {
      case '/server':
      case '/lobby':
      case '/hub':
        if (c === '/server' && (args[0] ?? '').toLowerCase() !== 'lobby') this.chat('§7Serveurs : §e/server lobby §7(mini-jeux). Vous êtes sur §2SMP§7.');
        else {
          void this.s.save().catch(() => {});
          setTimeout(() => void this.s.game.joinServer(), 0);
        }
        return true;
      case '/spawn':
        tp(...p.spawn);
        this.chat('§aTéléporté au point d’apparition.');
        return true;
      case '/sethome':
        this.data.home = [p.x, p.y, p.z];
        this.save();
        this.chat('§aMaison définie ici. §7(/home pour revenir)');
        return true;
      case '/home':
        if (!this.data.home) this.chat('§cAucune maison : utilisez /sethome.');
        else {
          tp(...this.data.home);
          this.chat('§aBienvenue chez vous.');
        }
        return true;
      case '/rtp': {
        const a = Math.random() * Math.PI * 2, r = 300 + Math.random() * 700;
        const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
        tp(x + 0.5, WORLD_HEIGHT - 10, z + 0.5);
        p.invulnerable = 10;
        this.chat(`§aTéléportation aléatoire en ${x}, ${z}…`);
        return true;
      }
      case '/money':
      case '/bal':
        this.chat(`§aSolde : §6${this.data.coins} pièces`);
        return true;
      case '/list':
        this.chat(`§aJoueurs en ligne (${this.online.length + 1}) : §fVous, ${this.online.map((m) => m.p.name).join(', ')}`);
        return true;
      case '/tpa': {
        const m = this.findBot(args[0]);
        if (!m) this.chat('§cJoueur introuvable. §7(/list)');
        else {
          this.chat(`§7Demande de téléportation envoyée à ${m.p.name}.`);
          if (m.task === 'fight' || Math.random() < 0.15) this.sayLater(m, 'pas maintenant désolé');
          else this.tpa = { from: m, t: 2 + Math.random() * 3 };
        }
        return true;
      }
      case '/pay': {
        const m = this.findBot(args[0]);
        const n = Math.floor(Number(args[1]));
        if (!m || !(n > 0) || n > this.data.coins) this.chat('§cUsage : /pay <joueur> <montant> (solde suffisant)');
        else {
          this.data.coins -= n;
          this.chat(`§aVous avez envoyé §6${n} pièces §aà ${m.p.name}.`);
          this.sayLater(m, this.rng.pick(['merci !!', 'oh merci', 'trop gentil']));
          this.save();
        }
        return true;
      }
      case '/msg':
      case '/tell':
      case '/w': {
        const m = this.findBot(args[0]);
        if (!m) this.chat('§cJoueur introuvable.');
        else {
          this.chat(`§7[Vous → ${m.p.name}] ${args.slice(1).join(' ')}`);
          this.playerChatTo(m, args.slice(1).join(' '));
        }
        return true;
      }
      case '/sell': {
        const st = p.inventory.selectedStack;
        const price = st ? SELL[st.id] ?? (st.id.endsWith('_log') ? 1 : 0) : 0;
        if (!st || !price) this.chat('§cCet objet ne se vend pas. §7(minerais, bois, butin de monstres)');
        else {
          const gain = price * st.count;
          p.inventory.takeFromSlot(p.inventory.selected, st.count);
          this.data.coins += gain;
          this.chat(`§aVendu pour §6${gain} pièces§a.`);
          this.save();
        }
        return true;
      }
      case '/shop':
        this.openShop();
        return true;
      default:
        return false;
    }
  }

  private playerChatTo(m: Mind, text: string) {
    const keep = this.online;
    this.online = [m, ...keep.filter((x) => x !== m)];
    this.playerChat(`${m.p.name} ${text}`);
    this.online = keep;
  }

  private findBot(name?: string) {
    if (!name) return null;
    const n = name.toLowerCase();
    return this.online.find((m) => m.p.name.toLowerCase() === n) ?? this.online.find((m) => m.p.name.toLowerCase().startsWith(n)) ?? null;
  }

  private openShop() {
    const game = this.s.game;
    game.openServerShop?.(SHOP.filter(([id]) => ItemRegistry.has(id)), () => this.data.coins, (id, n, price) => {
      if (this.data.coins < price) return false;
      this.data.coins -= price;
      const left = this.s.player.inventory.add(makeStack(id, n));
      if (left > 0) this.s.entities.spawnItem(id, left, this.s.player.x, this.s.player.y + 1, this.s.player.z);
      this.save();
      return true;
    });
  }

  /** Mods : arbre abattu entier, filon de minerai ; pièces pour les minerais. */
  afterBreak(x: number, y: number, z: number, block: number, itemId: string | undefined) {
    const s = this.s, p = s.player;
    if (p.creative || p.sneaking || this.lite) return;
    const key = BlockRegistry.get(block).key;
    const drop = (bx: number, by: number, bz: number) => {
      const id = s.world.getBlock(bx, by, bz);
      if (id <= 0) return;
      s.world.setBlock(bx, by, bz, B.AIR);
      s.particles.blockBreak(bx, by, bz, id);
      for (const d of getDrops(id, 0, itemId)) s.entities.spawnItem(d.id, d.count, bx + 0.5, by + 0.3, bz + 0.5);
      if (itemId && ItemRegistry.get(itemId)?.tool) p.inventory.damageSelected(1);
    };
    if (this.isLog(block) && itemId && ItemRegistry.get(itemId)?.tool?.type === 'axe') {
      const n = this.fell(x, y, z, drop);
      if (n) s.audio.play('break', { volume: 0.6 });
    } else if (key.endsWith('_ore')) {
      this.data.coins += key.includes('diamond') ? 10 : key.includes('gold') || key.includes('emerald') ? 5 : 1;
      if (itemId && ItemRegistry.get(itemId)?.tool?.type === 'pickaxe') {
        // filon : blocs identiques reliés (jusqu'à 32)
        const todo: [number, number, number][] = [[x, y, z]];
        const seen = new Set([`${x},${y},${z}`]);
        let n = 0;
        while (todo.length && n < 32) {
          const [cx, cy, cz] = todo.pop()!;
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const nx = cx + dx, ny = cy + dy, nz = cz + dz, k = `${nx},${ny},${nz}`;
            if (seen.has(k)) continue;
            seen.add(k);
            if (s.world.getBlock(nx, ny, nz) === block) {
              drop(nx, ny, nz);
              this.data.coins += key.includes('diamond') ? 10 : 1;
              n++;
              todo.push([nx, ny, nz]);
            }
          }
        }
      }
    }
  }

  /** Mort du joueur : ses objets vont dans une tombe (coffre) à l'endroit de la mort. */
  makeGrave(): boolean {
    if (this.lite) return false;
    const s = this.s, p = s.player, w = s.world;
    const items = [...p.inventory.slots, ...Object.values(p.inventory.armor)].filter((x): x is NonNullable<typeof x> => !!x);
    if (!items.length) return false;
    let x = Math.floor(p.x), y = Math.max(2, Math.floor(p.y)), z = Math.floor(p.z);
    while (y < WORLD_HEIGHT - 2 && w.getBlock(x, y, z) > 0 && !BlockRegistry.replaceable[w.getBlock(x, y, z)]) y++;
    if (y < 1) y = 1;
    w.setBlock(x, y, z, B.CHEST, 0);
    const inv = w.getChest(x, y, z);
    if (!inv) return false;
    const slots = Array(27).fill(null);
    const extra: typeof items = [];
    items.forEach((it, i) => (i < 27 ? (slots[i] = it) : extra.push(it)));
    inv.load({ slots });
    for (const it of extra) s.entities.spawnItem(it.id, it.count, x + 0.5, y + 1, z + 0.5, it.durability);
    p.inventory.clear();
    for (const k of ['head', 'chest', 'legs', 'feet'] as const) p.inventory.armor[k] = null;
    this.chat(`§7Votre tombe est en §e${x}, ${y}, ${z}§7 (vos objets y sont rangés).`);
    if (this.online.length && Math.random() < 0.6) this.sayLater(this.online[0], this.rng.pick(['rip', 'f', 'oh non', 'tu veux de l’aide pour récupérer tes affaires ?']));
    return true;
  }

  /** Spawn protégé (rayon 8) : pas de casse ni de pose près du point d'apparition. */
  canEdit(x: number, _y: number, z: number): boolean {
    if (this.lite) return true;
    const [sx, , sz] = this.s.player.spawn;
    if (Math.hypot(x - sx, z - sz) <= 8 && !this.s.player.creative) {
      this.s.hud.showTitle('§cZone protégée (spawn)', 'actionbar');
      return false;
    }
    return true;
  }

  mobKilled(m: Mob) {
    if (m instanceof Monster && !this.lite) {
      this.data.coins += 3;
      this.s.hud.showTitle('§6+3 pièces', 'actionbar');
    }
  }

  /** Bots en ligne (tests). */
  get bots() {
    return this.online.map((m) => ({ name: m.p.name, task: m.task, tier: m.p.tier, inv: { ...m.p.inv }, home: m.p.home, built: m.p.built, done: m.p.houseDone, bot: m.bot }));
  }
}
