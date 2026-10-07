/**
 * Serveur de mini-jeux intégré « LeCraft Network » (hors ligne) : hub avec PNJ, mini-jeux
 * (SkyWars, Spleef, TNT Run, Duel, Parkour), bots joueurs, tableau de scores latéral, chat
 * du serveur, pièces et victoires (profil local). Les autres joueurs sont des bots simulés.
 */
import type { Session } from '../core/Session';
import { B, BlockRegistry } from '../blocks/BlockRegistry';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { makeStack } from '../inventory/Inventory';
import type { ItemStack } from '../inventory/Item';
import type { Mob } from '../entities/Mob';
import { PLAYER_SKINS } from '../render/TextureManager';
import { Rng } from '../util/math';
import { Bot, RANKS, type Fighter } from './Bot';
import {
  DUELS, FLOOR, HUB, HUB_NPCS, PARKOUR, SKYWARS, SPLEEF, TNTRUN, buildSpleefFloor, buildTntRunLayers,
  parkourCourse, skywarsCenterChests, skywarsIslands, type GameKey,
} from './ServerMaps';

export const SERVER_NAME = 'LeCraft Network';
const PROFILE_KEY = 'lecraft.server.v1';

export interface ServerProfile {
  coins: number;
  wins: Partial<Record<GameKey, number>>;
  played: number;
  kills: number;
  bestParkour: number;
}

function loadProfile(): ServerProfile {
  try {
    return { coins: 0, wins: {}, played: 0, kills: 0, bestParkour: 0, ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') };
  } catch {
    return { coins: 0, wins: {}, played: 0, kills: 0, bestParkour: 0 };
  }
}

export const GAMES: Record<GameKey, { name: string; color: string; desc: string; players: number }> = {
  skywars: { name: 'SkyWars', color: '§e', desc: 'Îles dans le ciel : pillez les coffres, construisez des ponts, soyez le dernier en vie.', players: 8 },
  spleef: { name: 'Spleef', color: '§f', desc: 'Cassez la neige sous les pieds des autres. Tomber = éliminé.', players: 6 },
  duels: { name: 'Duel', color: '§b', desc: 'Combat 1 contre 1 avec équipement en fer.', players: 2 },
  tntrun: { name: 'TNT Run', color: '§c', desc: 'Le sol disparaît sous vos pas : ne vous arrêtez jamais !', players: 8 },
  parkour: { name: 'Parkour', color: '§a', desc: '36 sauts, points de contrôle, chronomètre : battez votre record.', players: 1 },
};

// ---------- pseudos et messages des bots ----------
const P1 = ['Pixel', 'Dark', 'Mega', 'Ultra', 'Shadow', 'Creeper', 'Diamond', 'Ender', 'Blaze', 'Frost', 'Turbo', 'Nova', 'Lucky', 'Crafty', 'Epic', 'Ninja', 'Lava', 'Sky', 'Iron', 'Golden', 'Kevin', 'Mathis', 'Lucas', 'Emma', 'Lea', 'Hugo', 'Nathan', 'Chloe', 'Tom', 'Jade'];
const P2 = ['Master', 'King', 'Hunter', 'Miner', 'Gamer', 'Wolf', 'Fox', 'Builder', 'Slayer', 'Warrior', 'Dragon', 'Panda', 'Craft', 'PvP', 'Pro', 'Bow', 'Blade', 'Rush', 'Cube', 'Block'];
const HUB_CHAT = ['salut tout le monde', 'qui veut duel ?', 'quelqu’un en SkyWars ?', 'le spleef c’est trop bien', 'je suis nouveau ici', 'comment on va au parkour ?', 'mdr', 'go TNT Run', 'j’ai gagné 3 parties d’affilée !', 'bonjour !', 'le parkour est dur au 4e point de contrôle', 'gg à tous', 'qui a le meilleur temps au parkour ?', 'je farm les pièces', 'quelqu’un pour une partie ?'];
const START_CHAT = ['bonne chance', 'gl', 'gl hf', 'je vais gagner', 'bonne chance à tous'];
const KILL_CHAT = ['ez', 'gg', 'trop facile', 'au suivant', 'bien essayé'];
const DEATH_CHAT = ['gg', 'lag !', 'pas juste', 'j’ai glissé', 'noooon', 'gg wp'];

/** Participant d'une partie : le joueur (bot = null) ou un bot. */
interface Part {
  bot: Bot | null;
  name: string;
  alive: boolean;
  kills: number;
}

export class ServerNetwork {
  readonly profile = loadProfile();
  private rng = new Rng((Math.random() * 1e9) | 0);
  private hubBots: Bot[] = [];
  private npcs: Bot[] = [];
  private game: MiniGame | null = null;
  private chatTimer = 6;
  private sidebarTimer = 0;
  private online = 1200 + Math.floor(Math.random() * 800);
  private usedNames = new Set<string>();

  constructor(readonly s: Session) {}

  // ---------- démarrage et hub ----------
  start() {
    const s = this.s;
    Object.assign(s.gamerules, { doMobSpawning: false, doDaylightCycle: false, doWeatherCycle: false, keepInventory: true, tntExplodes: false, mobGriefing: false });
    s.player.difficulty = 'normal';
    s.dayCycle.time = 0.3;
    this.chat(`§7Connexion à §e${SERVER_NAME}§7…`);
    this.chat('§a§l» §r§aBienvenue sur §e§lLeCraft Network §r§a!');
    this.chat('§7Touchez un §ePNJ§7 ou utilisez la §eboussole§7 pour choisir un jeu. §8(/hub, /jeux)');
    for (const n of HUB_NPCS) {
      const g = GAMES[n.game];
      const npc = this.spawnBot(n.x + 0.5, FLOOR + 2, n.z + 0.5, 1);
      npc.npc = n.game;
      this.npcs.push(npc);
      npc.invulnerable = true;
      npc.setTag(`${g.color}§l${g.name.toUpperCase()}\n§7${n.game === 'parkour' ? 'Solo' : `${g.players} joueurs`}\n§a▶ Toucher pour jouer`);
    }
    this.toHub(true);
  }

  private newName() {
    for (let t = 0; t < 30; t++) {
      const r = this.rng;
      const base = r.pick(P1) + (r.next() < 0.7 ? r.pick(P2) : '');
      const n = r.next() < 0.25 ? `xX${base}Xx` : r.next() < 0.5 ? `${base}${r.int(1, 999)}` : r.next() < 0.6 ? `${base}_` : base;
      if (n.length <= 16 && !this.usedNames.has(n)) {
        this.usedNames.add(n);
        return n;
      }
    }
    return `Joueur${this.rng.int(1000, 9999)}`;
  }

  private spawnBot(x: number, y: number, z: number, skill = 0.4 + Math.random() * 0.55): Bot {
    const s = this.s;
    const bot = new Bot(this.newName(), PLAYER_SKINS[this.rng.int(0, PLAYER_SKINS.length - 1)], skill, x, y, z, s.entities);
    let w = this.rng.next() * RANKS.reduce((a, r) => a + r.weight, 0);
    for (const r of RANKS) if ((w -= r.weight) < 0) {
      bot.rank = r;
      break;
    }
    if (!bot.npc) bot.setTag(`${bot.rank.tag}${bot.rank.color}${bot.botName}`);
    return s.entities.addMob(bot);
  }

  private removeBot(b: Bot) {
    b.removed = true;
    this.usedNames.delete(b.botName);
  }

  chat(text: string) {
    this.s.game.chat.add(text, 'chat');
  }
  botSay(b: Bot, text: string) {
    this.chat(`${b.chatName}§f: ${text}`);
  }
  title(t: string, sub = '') {
    // un texte vide efface titre et sous-titre : le sous-titre d'abord, puis le titre
    this.s.hud.showTitle(sub, 'subtitle');
    this.s.hud.showTitle(t, 'title');
  }

  private teleport(x: number, y: number, z: number, yaw?: number) {
    const p = this.s.player;
    p.body.setPos(x, y, z);
    p.body.vx = p.body.vy = p.body.vz = 0;
    p.body.fallDistance = 0;
    if (yaw !== undefined) p.yaw = yaw;
  }

  private resetPlayer() {
    const p = this.s.player;
    if (p.dead) p.respawn();
    p.gameMode = 'survival';
    p.body.flying = false;
    p.health = 20;
    p.hunger = 20;
    p.effects.clear();
    p.inventory.clear();
    for (const k of ['head', 'chest', 'legs', 'feet'] as const) p.inventory.armor[k] = null;
    p.inventory.selected = 0;
  }

  /** Retour au hub (fin de partie, /hub, objet « Retour »). */
  toHub(first = false) {
    this.game?.dispose();
    this.game = null;
    this.resetPlayer();
    const inv = this.s.player.inventory;
    inv.slots[0] = makeStack('compass', 1);
    inv.slots[8] = makeStack('emerald', Math.max(1, Math.min(64, this.profile.coins)));
    inv.changed();
    this.s.player.spawn = [HUB.spawn.x, HUB.spawn.y, HUB.spawn.z];
    this.teleport(HUB.spawn.x, HUB.spawn.y, HUB.spawn.z, HUB.spawn.yaw);
    this.s.held.setItem('compass');
    // population du hub
    while (this.hubBots.length < 9) {
      const a = this.rng.next() * Math.PI * 2, r = 6 + this.rng.next() * 16;
      const b = this.spawnBot(HUB.x + Math.cos(a) * r, FLOOR + 1, HUB.z + Math.sin(a) * r);
      b.brain = (bot, ctx, dt) => this.hubWander(bot, dt);
      this.hubBots.push(b);
    }
    if (!first) this.chat('§7Vous êtes de retour au §ehub§7.');
    this.s.hud.markHotbarDirty?.();
  }

  private wanderTarget = new Map<Bot, { x: number; z: number; t: number }>();
  private hubWander(b: Bot, dt: number) {
    let w = this.wanderTarget.get(b);
    if (!w || (w.t -= dt) <= 0) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * (HUB.radius - 5);
      w = { x: HUB.x + Math.cos(a) * r, z: HUB.z + Math.sin(a) * r, t: 4 + Math.random() * 8 };
      this.wanderTarget.set(b, w);
    }
    const d = Math.hypot(w.x - b.x, w.z - b.z);
    if (d > 1.2) b.goTo(w.x, FLOOR + 1, w.z, Math.random() < 0.3);
    else b.ai.stop();
    if (b.body.onGround && Math.random() < dt * 0.3) b.body.vy = 8.2;
  }

  // ---------- événements du jeu ----------
  update(dt: number) {
    const s = this.s, p = s.player;
    if (this.game) this.game.update(dt);
    else {
      // hub : invulnérable, rassasié, retour si on tombe dans le vide
      p.invulnerable = Math.max(p.invulnerable, 1);
      p.hunger = 20;
      if (p.y < FLOOR - 20) this.teleport(HUB.spawn.x, HUB.spawn.y, HUB.spawn.z, HUB.spawn.yaw);
      this.chatTimer -= dt;
      if (this.chatTimer <= 0 && this.hubBots.length) {
        this.chatTimer = 7 + Math.random() * 14;
        const b = this.hubBots[this.rng.int(0, this.hubBots.length - 1)];
        this.botSay(b, this.rng.pick(HUB_CHAT));
      }
    }
    this.sidebarTimer -= dt;
    if (this.sidebarTimer <= 0) {
      this.sidebarTimer = 0.5;
      if (Math.random() < 0.2) this.online += this.rng.int(-6, 7);
      s.hud.setSidebar(`§e§l${SERVER_NAME.toUpperCase()}`, this.sidebarLines());
    }
  }

  private sidebarLines(): string[] {
    const d = new Date();
    const date = `§7${d.toLocaleDateString('fr-FR')} §8lobby${1 + (this.online % 7)}`;
    if (this.game) return [date, '', ...this.game.sidebar(), '', '§elecraft.local'];
    const wins = Object.values(this.profile.wins).reduce((a, n) => a + (n ?? 0), 0);
    return [date, '', `§fPièces : §6${this.profile.coins}`, `§fVictoires : §a${wins}`, `§fÉliminations : §c${this.profile.kills}`, '', `§fEn ligne : §a${this.online}`, '', '§elecraft.local'];
  }

  saveProfile() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile));
    } catch {
      /* stockage indisponible */
    }
  }

  /** Le joueur touche une créature : PNJ du hub → rejoindre le jeu. */
  mobInteract(m: Mob): boolean {
    const npc = (m as Bot).npc;
    if (!npc) return false;
    this.join(npc as GameKey);
    return true;
  }

  /** Objets du hub : boussole (menu des jeux), lit (quitter la partie). */
  useItem(id: string): boolean {
    if (id === 'compass' && !this.game) {
      this.openSelector();
      return true;
    }
    if (id === 'red_bed' && this.game) {
      this.chat('§7Vous quittez la partie.');
      this.toHub();
      return true;
    }
    return false;
  }

  canEdit(x: number, y: number, z: number, action: 'break' | 'place', block: number): boolean {
    if (!this.game) return false;
    return this.game.canEdit(x, y, z, action, block);
  }

  /** Mort du joueur : gérée par le serveur (pas d'écran de mort). */
  onPlayerDeath(): boolean {
    if (this.game) this.game.playerDied(this.s.player.deathCause === 'void' ? 'void' : 'killed');
    else {
      this.s.player.respawn();
      this.toHub(true);
    }
    return true;
  }

  /** Message du joueur : un bot proche peut répondre (selon les mots du message). */
  playerChat(text: string) {
    const t = text.toLowerCase();
    const pool = this.game ? this.game.parts.filter((x) => x.bot && x.alive).map((x) => x.bot!) : this.hubBots;
    if (!pool.length) return;
    const who = pool[this.rng.int(0, pool.length - 1)];
    let reply: string | null = null;
    if (/\b(salut|slt|bonjour|coucou|hello|yo|wesh)\b/.test(t)) reply = this.rng.pick(['salut !', 'yo', 'bonjour :)', 'salut ça va ?', 'wesh']);
    else if (/\bgg\b/.test(t)) reply = this.rng.pick(['gg', 'gg wp', 'merci, gg']);
    else if (/duel|1v1|1 v 1/.test(t)) reply = this.rng.pick(['ok go duel, touche le PNJ Duel', 'je te prends en duel quand tu veux', 'pas maintenant je fais du skywars']);
    else if (/skywars|spleef|tnt|parkour/.test(t)) reply = this.rng.pick(['go !', 'j’arrive', 'je suis le meilleur à ça mdr', 'utilise la boussole pour rejoindre']);
    else if (/\?$/.test(t)) reply = this.rng.pick(['je sais pas', 'oui', 'non', 'peut-être', 'demande au staff', 'bonne question']);
    else if (/(nul|noob|ez)/.test(t)) reply = this.rng.pick(['toi même', 'calme toi', ':(', 'on verra en duel']);
    else if (Math.random() < 0.35) reply = this.rng.pick(['mdr', 'ok', 'trop bien', 'ah oui ?', 'lol']);
    if (reply) setTimeout(() => !who.removed && this.botSay(who, reply!), 900 + Math.random() * 2200);
  }

  /** Commandes du serveur (chat). */
  command(line: string): boolean {
    const [cmd, arg] = line.trim().toLowerCase().split(/\s+/);
    if (cmd === '/hub' || cmd === '/lobby' || cmd === '/l') {
      this.toHub();
      return true;
    }
    if (cmd === '/jeux' || cmd === '/games' || cmd === '/menu') {
      this.openSelector();
      return true;
    }
    if (cmd === '/play' || cmd === '/jouer') {
      const k = (Object.keys(GAMES) as GameKey[]).find((g) => g === arg || GAMES[g].name.toLowerCase().replace(/\s/g, '') === arg);
      if (k) this.join(k);
      else this.chat(`§cJeu inconnu. Jeux : ${Object.keys(GAMES).join(', ')}`);
      return true;
    }
    return false;
  }

  openSelector() {
    this.s.game.openServerSelector(this);
  }

  /** Rejoindre un mini-jeu (le joueur et des bots). */
  join(key: GameKey) {
    this.game?.dispose();
    this.resetPlayer();
    const g = GAMES[key];
    this.chat(`§7Envoi vers §e${g.name}-${this.rng.int(1, 40)}${'ABCDEFGH'[this.rng.int(0, 7)]}§7…`);
    this.profile.played++;
    const Ctor = { skywars: SkyWars, spleef: Spleef, tntrun: TntRun, duels: Duel, parkour: Parkour }[key];
    this.game = new Ctor(this, key);
    this.game.begin();
  }

  // ---------- services pour les mini-jeux ----------
  /** Bots d'une partie (hors du hub). */
  gameBot(x: number, y: number, z: number) {
    return this.spawnBot(x, y, z);
  }
  release(b: Bot) {
    this.removeBot(b);
  }
  reward(coins: number, why: string) {
    this.profile.coins += coins;
    this.chat(`§6+${coins} pièces §7(${why})`);
    this.saveProfile();
  }
  teleportPlayer(x: number, y: number, z: number, yaw?: number) {
    this.teleport(x, y, z, yaw);
  }
  get session() {
    return this.s;
  }
  pick<T>(a: T[]) {
    return this.rng.pick(a);
  }
  noteParkour(t: number) {
    if (!this.profile.bestParkour || t < this.profile.bestParkour) {
      this.profile.bestParkour = t;
      this.chat(`§a§lNOUVEAU RECORD ! §r§f${t.toFixed(2)} s`);
    }
    this.saveProfile();
  }
  /** Le joueur passe en spectateur (vol, invisible aux bots). */
  spectate(x: number, y: number, z: number) {
    const p = this.s.player;
    if (p.dead) p.respawn();
    p.gameMode = 'creative';
    p.body.flying = true;
    p.inventory.clear();
    p.inventory.slots[8] = makeStack('red_bed', 1);
    p.inventory.selected = 8;
    this.teleport(x, y, z);
  }
}

// =====================================================================================
// Mini-jeux
// =====================================================================================

abstract class MiniGame {
  parts: Part[] = [{ bot: null, name: 'Vous', alive: true, kills: 0 }];
  state: 'countdown' | 'playing' | 'ended' = 'countdown';
  timer = 10;
  elapsed = 0;
  /** Blocs modifiés pendant la partie (restaurés à la fin). */
  private journal = new Map<string, number>();
  private off: (() => void) | null = null;
  protected abstract readonly box: { x0: number; z0: number; x1: number; z1: number };

  constructor(readonly net: ServerNetwork, readonly key: GameKey) {}

  get s() {
    return this.net.session;
  }
  get you(): Part {
    return this.parts[0];
  }
  get alive() {
    return this.parts.filter((p) => p.alive);
  }

  /** Mise en place : carte, participants, équipement. */
  abstract setup(): void;
  /** Comportement d'un bot pendant la partie. */
  abstract think(b: Bot, part: Part, dt: number): void;
  sidebar(): string[] {
    const g = GAMES[this.key];
    const lines = [`§fJeu : ${g.color}${g.name}`];
    if (this.state === 'countdown') lines.push(`§fDébut dans §a${Math.ceil(this.timer)} s`);
    else lines.push(`§fTemps : §a${fmt(this.elapsed)}`);
    if (this.parts.length > 1) lines.push(`§fJoueurs en vie : §a${this.alive.length}/${this.parts.length}`, `§fÉliminations : §a${this.you.kills}`);
    return lines;
  }

  /** Carte en cours de chargement (le joueur attend au-dessus du centre). */
  loading = true;
  /** Points à charger avant la mise en place (coffres, cages, départs). */
  protected keyPoints(): [number, number][] {
    const c = this.center();
    return [[c.x, c.z]];
  }

  begin() {
    const c = this.center();
    this.net.teleportPlayer(c.x + 0.5, c.y + 12, c.z + 0.5);
    this.net.title('§7Chargement de la carte…');
  }

  /** Mise en place une fois la carte chargée. */
  private ready() {
    const w = this.s.world;
    const h = (e: { x: number; y: number; z: number; prev: number }) => {
      if (e.x < this.box.x0 || e.x > this.box.x1 || e.z < this.box.z0 || e.z > this.box.z1) return;
      const k = `${e.x},${e.y},${e.z}`;
      if (!this.journal.has(k)) this.journal.set(k, e.prev);
    };
    this.off = w.events.on('blockChanged', h);
    this.parts = [{ bot: null, name: 'Vous', alive: true, kills: 0 }];
    this.setup();
    for (const p of this.parts)
      if (p.bot) {
        const part = p;
        p.bot.brain = (b, _ctx, dt) => {
          if (this.state === 'playing' && part.alive) this.think(b, part, dt);
          else b.ai.stop();
        };
      }
    this.net.title(`${GAMES[this.key].color}§l${GAMES[this.key].name}`, '§7La partie commence bientôt');
    this.net.chat(`§e${GAMES[this.key].name} §7: ${GAMES[this.key].desc}`);
  }

  update(dt: number) {
    const p = this.s.player;
    p.hunger = 20;
    if (this.loading) {
      const c = this.center();
      this.net.teleportPlayer(c.x + 0.5, c.y + 12, c.z + 0.5);
      if (this.keyPoints().every(([x, z]) => this.s.world.isLoaded(Math.floor(x), Math.floor(z)))) {
        this.loading = false;
        this.ready();
      }
      return;
    }
    if (this.state === 'countdown') {
      const before = Math.ceil(this.timer);
      this.timer -= dt;
      this.hold(dt);
      const now = Math.ceil(this.timer);
      if (now !== before && now <= 5 && now > 0) {
        this.net.title(`§e${now}`);
        this.s.audio.play('click', { volume: 0.6 });
      }
      if (this.timer <= 0) {
        this.state = 'playing';
        this.net.title('§a§lC’EST PARTI !');
        this.s.audio.play('levelup', { volume: 0.5 });
        this.started();
        const talk = this.parts.filter((x) => x.bot);
        if (talk.length) this.net.botSay(talk[0].bot!, this.net.pick(START_CHAT));
      }
      return;
    }
    if (this.state === 'playing') {
      this.elapsed += dt;
      this.tick(dt);
      // morts et chutes des bots
      for (const part of this.parts) {
        const b = part.bot;
        if (!part.alive || !b) continue;
        if (b.dead || b.removed || b.y < this.fallY()) this.eliminate(part, b.dead ? (b.lastAttacker ?? null) : null, b.dead ? 'killed' : 'void');
      }
      if (this.you.alive && this.s.player.y < this.fallY()) this.playerDied('void');
      this.checkEnd();
    } else {
      this.timer -= dt;
      if (this.timer <= 0) this.net.toHub();
    }
  }

  /** Pendant le compte à rebours : chacun reste à sa place. */
  protected hold(_dt: number) {
    for (const part of this.parts) part.bot?.ai.stop();
  }
  protected started() {}
  protected tick(_dt: number) {}
  protected fallY() {
    return FLOOR - 20;
  }

  canEdit(_x: number, _y: number, _z: number, _a: 'break' | 'place', _b: number) {
    return false;
  }

  playerDied(cause: 'void' | 'killed') {
    if (!this.you.alive) {
      if (this.s.player.dead) this.s.player.respawn();
      return;
    }
    const killer = this.s.player.lastAttacker;
    const kp = cause === 'killed' && killer instanceof Bot ? this.parts.find((x) => x.bot === killer) ?? null : null;
    this.eliminate(this.you, kp?.bot ?? null, cause);
  }

  eliminate(part: Part, by: Bot | 'player' | null, cause: 'void' | 'killed') {
    if (!part.alive) return;
    part.alive = false;
    const killer = by === 'player' ? this.you : by ? this.parts.find((x) => x.bot === by) ?? null : null;
    if (killer && killer !== part) killer.kills++;
    const name = part.bot ? part.bot.chatName : '§aVous';
    const kname = killer ? (killer.bot ? killer.bot.chatName : '§aVous') : '';
    this.net.chat(killer && killer !== part ? `${name} §7a été éliminé par ${kname}§7.` : `${name} §7${cause === 'void' ? 'est tombé dans le vide' : 'est mort'}.`);
    if (killer === this.you && part !== this.you) {
      this.net.profile.kills++;
      this.net.reward(10, 'élimination');
      this.s.audio.play('levelup', { volume: 0.3 });
    }
    if (killer?.bot && Math.random() < 0.4) this.net.botSay(killer.bot, this.net.pick(KILL_CHAT));
    if (part.bot) {
      if (Math.random() < 0.3) this.net.botSay(part.bot, this.net.pick(DEATH_CHAT));
      const b = part.bot;
      setTimeout(() => this.net.release(b), b.dead ? 1200 : 0);
    } else {
      this.net.title('§c§lÉLIMINÉ', `§7${this.alive.length} joueur(s) encore en vie`);
      const c = this.center();
      this.net.spectate(c.x, c.y + 14, c.z);
    }
  }

  protected abstract center(): { x: number; y: number; z: number };

  checkEnd() {
    const alive = this.alive;
    if (this.parts.length > 1 && alive.length <= 1) this.finish(alive[0] ?? null);
  }

  finish(winner: Part | null) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.timer = 6;
    const g = GAMES[this.key];
    if (winner === this.you) {
      this.net.title('§6§lVICTOIRE !', `§7${g.name} · ${this.you.kills} élimination(s)`);
      this.net.profile.wins[this.key] = (this.net.profile.wins[this.key] ?? 0) + 1;
      this.net.reward(this.key === 'duels' ? 25 : 50, 'victoire');
      this.s.audio.play('achievement');
    } else if (winner?.bot) {
      this.net.title('§c§lPARTIE TERMINÉE', `§7Gagnant : ${winner.bot.chatName}`);
      this.net.botSay(winner.bot, this.net.pick(['gg', 'gg wp', 'gg à tous !', 'trop bien']));
    }
    this.net.chat(`§6§l▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`);
    this.net.chat(`§e§l${g.name} §r§7— gagnant : ${winner ? (winner.bot ? winner.bot.chatName : '§aVous') : '§7personne'}`);
    const top = [...this.parts].sort((a, b) => b.kills - a.kills).slice(0, 3);
    if (this.parts.length > 2) top.forEach((t, i) => this.net.chat(`§e${i + 1}. ${t.bot ? t.bot.chatName : '§aVous'} §7- ${t.kills} élimination(s)`));
    this.net.chat(`§6§l▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`);
    this.net.reward(5, 'participation');
  }

  dispose() {
    this.off?.();
    for (const p of this.parts) if (p.bot && !p.bot.removed) this.net.release(p.bot);
    // restauration de la carte (dans l'ordre inverse n'est pas nécessaire : on remet l'état d'origine)
    const w = this.s.world;
    for (const [k, prev] of this.journal) {
      const [x, y, z] = k.split(',').map(Number);
      w.setBlock(x, y, z, prev, 0, false);
    }
    this.journal.clear();
    for (const e of this.s.entities.entities) if (e.kind === 'item' || e.kind === 'projectile') e.removed = true;
  }

  /** Coup d'un bot sur sa cible (joueur ou bot). */
  protected strike(b: Bot, target: Part, dmg: number, kx: number, kz: number) {
    if (!target.alive) return;
    if (target.bot) this.s.combat.damageMob(target.bot, dmg, { kind: 'bot', knockX: kx, knockZ: kz, attacker: b as never });
    else this.s.player.damage(dmg, 'mob', kx * 1.2, kz * 1.2, b as never);
  }

  /** Cible la plus proche (encore en vie) d'un bot. */
  protected nearestFoe(b: Bot, part: Part): { part: Part; f: Fighter } | null {
    let best: { part: Part; f: Fighter } | null = null, bd = Infinity;
    for (const o of this.parts) {
      if (o === part || !o.alive) continue;
      const f: Fighter = o.bot ?? this.s.player;
      const d = Math.hypot(f.x - b.x, f.z - b.z) + Math.abs(f.y - b.y) * 2;
      if (d < bd) {
        bd = d;
        best = { part: o, f };
      }
    }
    return best;
  }
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Facteur de dégâts selon les points d'armure (même formule que le joueur). */
const armorFactor = (pts: number) => 1 - Math.min(0.8, pts * 0.04);

// ---------- SkyWars ----------
class SkyWars extends MiniGame {
  protected box = { x0: SKYWARS.x - 60, z0: SKYWARS.z - 60, x1: SKYWARS.x + 60, z1: SKYWARS.z + 60 };
  private islands = skywarsIslands();
  private armor = new Map<Bot, number>();
  private looted = new Set<Bot>();

  setup() {
    const w = this.s.world;
    const glass = B.GLASS;
    // cages de verre au-dessus de chaque île
    this.islands.forEach((isl, i) => {
      for (let y = FLOOR + 1; y <= FLOOR + 4; y++)
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) if (Math.abs(dx) === 1 || Math.abs(dz) === 1 || y === FLOOR + 4) w.setBlock(isl.x + dx, y + 2, isl.z + dz, glass);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) w.setBlock(isl.x + dx, FLOOR + 2, isl.z + dz, glass);
      if (i > 0) {
        const b = this.net.gameBot(isl.x + 0.5, FLOOR + 3, isl.z + 0.5);
        this.parts.push({ bot: b, name: b.botName, alive: true, kills: 0 });
        b.blockId = BlockRegistry.has(`${['red', 'blue', 'lime', 'yellow', 'orange', 'purple', 'cyan', 'pink'][i]}_wool`) ? BlockRegistry.byName(`${['red', 'blue', 'lime', 'yellow', 'orange', 'purple', 'cyan', 'pink'][i]}_wool`).id : B.OAK_PLANKS;
      }
    });
    // coffres
    const r = () => Math.random();
    const fill = (pos: [number, number, number], center: boolean) => {
      const inv = w.getChest(pos[0], pos[1], pos[2]);
      if (!inv) return;
      const items: ItemStack[] = [];
      const add = (id: string, n = 1) => ItemRegistry.has(id) && items.push(makeStack(id, n));
      add(center ? (r() < 0.5 ? 'diamond_sword' : 'iron_sword') : r() < 0.5 ? 'stone_sword' : 'iron_sword');
      add('oak_planks', center ? 16 : 32);
      add(center ? 'iron_chestplate' : r() < 0.5 ? 'leather_chestplate' : 'iron_helmet');
      add(center ? (r() < 0.5 ? 'diamond_helmet' : 'iron_leggings') : 'iron_boots');
      add('cooked_beef', 4);
      if (center || r() < 0.4) add('golden_apple', center ? 2 : 1);
      if (center && r() < 0.6) add('bow'), add('arrow', 12);
      if (r() < 0.5) add('snowball', 8);
      const slots: (ItemStack | null)[] = Array(27).fill(null);
      items.forEach((it) => {
        let k = Math.floor(r() * 27);
        while (slots[k]) k = (k + 1) % 27;
        slots[k] = it;
      });
      inv.load({ slots });
    };
    this.islands.forEach((i) => fill(i.chest, false));
    skywarsCenterChests().forEach((c) => fill(c, true));
    const isl = this.islands[0];
    this.net.teleportPlayer(isl.x + 0.5, FLOOR + 3, isl.z + 0.5, Math.atan2(SKYWARS.x - isl.x, SKYWARS.z - isl.z) + Math.PI);
    this.s.player.spawn = [isl.x + 0.5, FLOOR + 3, isl.z + 0.5];
  }

  protected keyPoints(): [number, number][] {
    return [...this.islands.map((i): [number, number] => [i.chest[0], i.chest[2]]), ...skywarsCenterChests().map((c): [number, number] => [c[0], c[2]])];
  }

  protected hold() {
    super.hold(0);
    const isl = this.islands[0], p = this.s.player;
    if (Math.hypot(p.x - isl.x - 0.5, p.z - isl.z - 0.5) > 1.2) this.net.teleportPlayer(isl.x + 0.5, FLOOR + 3, isl.z + 0.5);
  }

  protected started() {
    // les cages s'ouvrent
    const w = this.s.world;
    for (const isl of this.islands)
      for (let y = FLOOR + 2; y <= FLOOR + 6; y++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (w.getBlock(isl.x + dx, y, isl.z + dz) === B.GLASS) w.setBlock(isl.x + dx, y, isl.z + dz, B.AIR);
  }

  center() {
    return { x: SKYWARS.x, y: FLOOR, z: SKYWARS.z };
  }

  canEdit(x: number, y: number, z: number, action: 'break' | 'place', b: number) {
    if (this.state !== 'playing' || !this.you.alive) return false;
    if (action === 'break' && b === B.CHEST) return false;
    return Math.abs(x - SKYWARS.x) < 58 && Math.abs(z - SKYWARS.z) < 58 && y < FLOOR + 30;
  }

  /** Le bot prend le contenu d'un coffre (meilleure arme, armure, blocs, pommes). */
  private loot(b: Bot, pos: [number, number, number]) {
    const inv = this.s.world.getChest(pos[0], pos[1], pos[2], false);
    if (!inv) return;
    const rank = (id: string) => ['wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword'].indexOf(id);
    let pts = this.armor.get(b) ?? 0;
    inv.slots.forEach((s, i) => {
      if (!s) return;
      const def = ItemRegistry.get(s.id);
      if (rank(s.id) > rank(b.weapon)) b.weapon = s.id;
      else if (def?.armor) pts += def.armor.defense;
      else if (s.id === 'oak_planks') b.blocks += s.count;
      else if (s.id === 'golden_apple') b.gapples += s.count;
      else return;
      inv.slots[i] = null;
    });
    this.armor.set(b, pts);
    b.armorFactor = armorFactor(pts);
    b.attackAnim = 1;
  }

  think(b: Bot, part: Part, dt: number) {
    const isl = this.islands.find((i) => Math.hypot(i.x - b.x, i.z - b.z) < 4);
    // 1) piller le coffre de son île
    if (!this.looted.has(b) && isl) {
      const [cx, cy, cz] = isl.chest;
      if (Math.hypot(cx + 0.5 - b.x, cz + 0.5 - b.z) > 1.8) {
        b.goTo(cx + 0.5, cy, cz + 0.5);
        return;
      }
      this.loot(b, isl.chest);
      this.looted.add(b);
      return;
    }
    const foe = this.nearestFoe(b, part);
    if (!foe) return;
    const f = foe.f;
    const sameLand = Math.abs(f.y - b.y) < 3 && Math.hypot(f.x - b.x, f.z - b.z) < 6;
    // 2) combat si la cible est proche, sinon pont vers le centre puis vers la cible
    if (sameLand || Math.hypot(f.x - b.x, f.z - b.z) < 3.5) {
      b.fight(this.s, f, dt, (dmg, kx, kz) => this.strike(b, foe.part, dmg, kx, kz));
      return;
    }
    const toCenter = Math.hypot(SKYWARS.x - b.x, SKYWARS.z - b.z);
    // le centre d'abord (meilleur butin), avec ses coffres
    if (toCenter > 5 && b.blocks > 0) {
      b.bridgeTo(this.s, SKYWARS.x + 0.5, SKYWARS.z + 0.5, FLOOR + 1);
      return;
    }
    if (toCenter <= 7) {
      const chest = skywarsCenterChests().find((c) => this.s.world.getChest(c[0], c[1], c[2], false)?.slots.some((x) => x));
      if (chest && Math.random() < 0.9) {
        if (Math.hypot(chest[0] + 0.5 - b.x, chest[2] + 0.5 - b.z) > 1.8) b.goTo(chest[0] + 0.5, chest[1], chest[2] + 0.5);
        else this.loot(b, chest);
        return;
      }
    }
    // vers la cible : chemin s'il existe, sinon pont
    if (b.blocks > 0 && Math.abs(f.y - b.y) < 4) b.bridgeTo(this.s, f.x, f.z, Math.floor(b.y));
    else b.goTo(f.x, f.y, f.z, true);
  }
}

// ---------- Spleef ----------
class Spleef extends MiniGame {
  protected box = { x0: SPLEEF.x - 13, z0: SPLEEF.z - 13, x1: SPLEEF.x + 13, z1: SPLEEF.z + 13 };
  private breakTimers = new Map<Bot, number>();
  setup() {
    const w = this.s.world;
    buildSpleefFloor((x, y, z, b) => void w.setBlock(x, y, z, b));
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = SPLEEF.x + Math.cos(a) * 8 + 0.5, z = SPLEEF.z + Math.sin(a) * 8 + 0.5;
      if (i === 0) {
        this.net.teleportPlayer(x, FLOOR + 1, z, Math.atan2(SPLEEF.x - x, SPLEEF.z - z) + Math.PI);
        continue;
      }
      const b = this.net.gameBot(x, FLOOR + 1, z);
      b.weapon = 'diamond_shovel';
      this.parts.push({ bot: b, name: b.botName, alive: true, kills: 0 });
    }
    const inv = this.s.player.inventory;
    inv.slots[0] = makeStack('diamond_shovel', 1);
    inv.slots[8] = makeStack('red_bed', 1);
  }
  protected hold() {
    super.hold(0);
  }
  center() {
    return { x: SPLEEF.x, y: FLOOR, z: SPLEEF.z };
  }
  protected fallY() {
    return SPLEEF.outY;
  }
  canEdit(x: number, y: number, z: number, action: 'break' | 'place', b: number) {
    return this.state === 'playing' && this.you.alive && action === 'break' && b === B.SNOW_BLOCK && y === FLOOR && Math.abs(x - SPLEEF.x) <= SPLEEF.half && Math.abs(z - SPLEEF.z) <= SPLEEF.half;
  }
  think(b: Bot, part: Part, dt: number) {
    const w = this.s.world;
    const foe = this.nearestFoe(b, part);
    if (!foe) return;
    const f = foe.f;
    const d = Math.hypot(f.x - b.x, f.z - b.z);
    // garder ~3 blocs de distance (sur la neige), casser sous les pieds de l'adversaire
    if (d > 3.5) b.goTo(f.x, FLOOR + 1, f.z, true);
    else if (d < 2) b.ai.moveTowards(b.x - (f.x - b.x), b.z - (f.z - b.z), 1, true);
    else b.ai.stop();
    let t = (this.breakTimers.get(b) ?? 0) - dt;
    if (t <= 0) {
      t = 0.55 - b.skill * 0.3 + Math.random() * 0.2;
      // vise la case où l'adversaire va mettre le pied (vitesse anticipée)
      const vx = 'body' in f ? (f as Bot).body.vx : 0, vz = 'body' in f ? (f as Bot).body.vz : 0;
      const lead = Math.random() < b.skill ? 0.35 : 0;
      const tx = Math.floor(f.x + vx * lead), tz = Math.floor(f.z + vz * lead);
      if (Math.hypot(tx + 0.5 - b.x, tz + 0.5 - b.z) <= 4.5 && w.getBlock(tx, FLOOR, tz) === B.SNOW_BLOCK && !(Math.floor(b.x) === tx && Math.floor(b.z) === tz)) b.breakBlock(this.s, tx, FLOOR, tz);
    }
    this.breakTimers.set(b, t);
    // ne pas tomber : si la case sous soi a disparu, saut vers une case pleine voisine
    if (b.body.onGround && w.getBlock(Math.floor(b.x), FLOOR, Math.floor(b.z)) !== B.SNOW_BLOCK) b.body.vy = 8.2;
  }
}

// ---------- TNT Run ----------
class TntRun extends MiniGame {
  protected box = { x0: TNTRUN.x - 12, z0: TNTRUN.z - 12, x1: TNTRUN.x + 12, z1: TNTRUN.z + 12 };
  private pending: { x: number; y: number; z: number; t: number }[] = [];
  private seen = new Set<string>();
  private goals = new Map<Bot, { x: number; z: number; t: number }>();
  setup() {
    const w = this.s.world;
    buildTntRunLayers((x, y, z, b) => void w.setBlock(x, y, z, b));
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = TNTRUN.x + Math.cos(a) * 7 + 0.5, z = TNTRUN.z + Math.sin(a) * 7 + 0.5;
      if (i === 0) {
        this.net.teleportPlayer(x, FLOOR + 1, z, Math.atan2(TNTRUN.x - x, TNTRUN.z - z) + Math.PI);
        continue;
      }
      const b = this.net.gameBot(x, FLOOR + 1, z);
      this.parts.push({ bot: b, name: b.botName, alive: true, kills: 0 });
    }
    this.s.player.inventory.slots[8] = makeStack('red_bed', 1);
  }
  center() {
    return { x: TNTRUN.x, y: FLOOR, z: TNTRUN.z };
  }
  protected fallY() {
    return TNTRUN.outY;
  }
  /** Les blocs sous les pieds de chacun disparaissent peu après. */
  protected tick(dt: number) {
    const w = this.s.world;
    const sand = BlockRegistry.has('sand') ? BlockRegistry.byName('sand').id : B.SAND;
    const mark = (x: number, y: number, z: number) => {
      for (const [ox, oz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
        const bx = Math.floor(x + ox), by = Math.floor(y - 0.2), bz = Math.floor(z + oz);
        const k = `${bx},${by},${bz}`;
        if (!this.seen.has(k) && w.getBlock(bx, by, bz) === sand) {
          this.seen.add(k);
          this.pending.push({ x: bx, y: by, z: bz, t: 0.45 });
        }
      }
    };
    for (const part of this.alive) {
      const e = part.bot ?? this.s.player;
      if (e.body.onGround) mark(e.x, e.y, e.z);
    }
    for (const p of this.pending) p.t -= dt;
    const due = this.pending.filter((p) => p.t <= 0);
    this.pending = this.pending.filter((p) => p.t > 0);
    for (const p of due) {
      w.setBlock(p.x, p.y, p.z, B.AIR);
      w.setBlock(p.x, p.y - 1, p.z, B.AIR);
    }
  }
  think(b: Bot, _part: Part, dt: number) {
    const w = this.s.world;
    const sand = B.SAND;
    let g = this.goals.get(b);
    const layer = Math.floor(b.y - 0.2);
    const here = (x: number, z: number) => w.getBlock(x, layer, z) === sand && !this.seen.has(`${x},${layer},${z}`);
    if (!g || (g.t -= dt) <= 0 || Math.hypot(g.x - b.x, g.z - b.z) < 1 || !here(Math.floor(g.x), Math.floor(g.z))) {
      // case intacte la plus « entourée » parmi quelques essais (le joueur malin évite les trous)
      let best: { x: number; z: number; t: number } | null = null, bs = -1;
      for (let i = 0; i < 14; i++) {
        const x = Math.floor(b.x + (Math.random() - 0.5) * 12), z = Math.floor(b.z + (Math.random() - 0.5) * 12);
        if (!here(x, z)) continue;
        let score = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (here(x + dx, z + dz)) score++;
        score -= Math.hypot(x - b.x, z - b.z) * 0.15;
        if (score > bs) {
          bs = score;
          best = { x: x + 0.5, z: z + 0.5, t: 1.2 + Math.random() };
        }
      }
      g = best ?? { x: TNTRUN.x + (Math.random() - 0.5) * 16, z: TNTRUN.z + (Math.random() - 0.5) * 16, t: 0.8 };
      this.goals.set(b, g);
    }
    b.goTo(g.x, layer + 1, g.z, true);
    // trou devant : saut (comme un joueur qui court)
    if (b.body.onGround && !here(Math.floor(b.x + b.body.vx * 0.15), Math.floor(b.z + b.body.vz * 0.15)) && Math.random() < 0.5 + b.skill * 0.5) b.body.vy = 8.2;
  }
}

// ---------- Duel ----------
class Duel extends MiniGame {
  protected box = { x0: DUELS.x - 12, z0: DUELS.z - 18, x1: DUELS.x + 12, z1: DUELS.z + 18 };
  setup() {
    const kit = (inv: Session['player']['inventory']) => {
      inv.slots[0] = makeStack('iron_sword', 1);
      inv.slots[1] = makeStack('bow', 1);
      inv.slots[2] = makeStack('golden_apple', 3);
      inv.slots[3] = makeStack('cooked_beef', 8);
      inv.slots[4] = makeStack('arrow', 16);
      inv.slots[8] = makeStack('red_bed', 1);
      inv.armor.head = makeStack('iron_helmet', 1);
      inv.armor.chest = makeStack('iron_chestplate', 1);
      inv.armor.legs = makeStack('iron_leggings', 1);
      inv.armor.feet = makeStack('iron_boots', 1);
    };
    kit(this.s.player.inventory);
    this.net.teleportPlayer(DUELS.x + 0.5, FLOOR + 1, DUELS.z + 11.5, 0);
    const b = this.net.gameBot(DUELS.x + 0.5, FLOOR + 1, DUELS.z - 10.5);
    b.skill = 0.55 + Math.random() * 0.4;
    b.weapon = 'iron_sword';
    b.gapples = 3;
    b.armorFactor = armorFactor(15);
    this.parts.push({ bot: b, name: b.botName, alive: true, kills: 0 });
    this.timer = 5;
    this.net.chat(`§7Adversaire : ${b.chatName} §8(niveau ${Math.round(b.skill * 10)}/10)`);
  }
  protected keyPoints(): [number, number][] {
    return [[DUELS.x, DUELS.z - 12], [DUELS.x, DUELS.z + 12]];
  }
  protected hold() {
    super.hold(0);
    const p = this.s.player;
    if (Math.abs(p.z - (DUELS.z + 11.5)) > 1.5) this.net.teleportPlayer(DUELS.x + 0.5, FLOOR + 1, DUELS.z + 11.5);
  }
  center() {
    return { x: DUELS.x, y: FLOOR, z: DUELS.z };
  }
  think(b: Bot, part: Part, dt: number) {
    const foe = this.nearestFoe(b, part);
    if (foe) b.fight(this.s, foe.f, dt, (dmg, kx, kz) => this.strike(b, foe.part, dmg, kx, kz));
  }
  sidebar() {
    const b = this.parts[1]?.bot;
    return [...super.sidebar().slice(0, 2), `§fAdversaire : ${b ? b.rank.color + b.botName : ''}`, `§fSa vie : §c${b ? Math.ceil(b.health) : 0} ❤`];
  }
}

// ---------- Parkour ----------
class Parkour extends MiniGame {
  protected box = { x0: PARKOUR.x - 80, z0: PARKOUR.z - 80, x1: PARKOUR.x + 80, z1: PARKOUR.z + 80 };
  private course = parkourCourse();
  private check = 0;
  private running = false;
  private time = 0;
  setup() {
    const s0 = this.course[0];
    this.net.teleportPlayer(s0.x + 0.5, s0.y + 1, s0.z + 0.5);
    this.s.player.inventory.slots[8] = makeStack('red_bed', 1);
    this.timer = 3;
  }
  protected hold() {}
  center() {
    return { x: PARKOUR.x, y: FLOOR, z: PARKOUR.z };
  }
  protected fallY() {
    return -999;
  }
  think() {}
  protected tick(dt: number) {
    const p = this.s.player;
    if (this.running) this.time += dt;
    const fx = Math.floor(p.x), fy = Math.floor(p.y - 0.2), fz = Math.floor(p.z);
    const i = this.course.findIndex((c) => Math.abs(c.x - fx) <= (c.kind === 'start' ? 2 : 0) && Math.abs(c.z - fz) <= (c.kind === 'start' ? 2 : 0) && c.y === fy);
    if (i >= 0 && p.body.onGround) {
      const c = this.course[i];
      if (c.kind === 'start' && !this.running) {
        this.running = true;
        this.time = 0;
        this.check = 0;
      }
      if (c.kind === 'check' && i > this.check) {
        this.check = i;
        this.net.chat(`§aPoint de contrôle ${Math.round(i / 6)}/5 §7(${this.time.toFixed(1)} s)`);
        this.s.audio.play('levelup', { volume: 0.3 });
      }
      if (c.kind === 'end' && this.running) {
        this.running = false;
        this.net.title('§a§lPARCOURS TERMINÉ !', `§f${this.time.toFixed(2)} s`);
        this.net.noteParkour(this.time);
        this.net.profile.wins.parkour = (this.net.profile.wins.parkour ?? 0) + 1;
        this.net.reward(30, 'parcours terminé');
        this.state = 'ended';
        this.timer = 5;
      }
    }
    // chute : retour au dernier point de contrôle
    if (p.y < FLOOR - 6) {
      const c = this.course[this.check];
      this.net.teleportPlayer(c.x + 0.5, c.y + 1, c.z + 0.5);
    }
    this.s.hud.showTitle(`§e${this.time.toFixed(1)} s §7· point ${Math.round(this.check / 6)}/5`, 'actionbar');
  }
  checkEnd() {}
  playerDied() {
    const p = this.s.player;
    p.respawn();
    const c = this.course[this.check];
    this.net.teleportPlayer(c.x + 0.5, c.y + 1, c.z + 0.5);
  }
  sidebar() {
    const best = this.net.profile.bestParkour;
    return ['§fJeu : §aParkour', `§fTemps : §a${this.time.toFixed(1)} s`, `§fPoint : §a${Math.round(this.check / 6)}/5`, `§fRecord : §6${best ? best.toFixed(2) + ' s' : '-'}`];
  }
}
