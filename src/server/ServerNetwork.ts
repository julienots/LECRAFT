/**
 * Serveur de mini-jeux intégré « HypXL » (hors ligne) : grand hub (place, fontaine, logo
 * géant, quartiers), 8 mini-jeux (BedWars, SkyWars, Duel, Sumo, Block Party, TNT Run, Spleef,
 * Parkour), cosmétiques (traînées, chapeaux, compagnons, couleurs, rangs, gadgets, boîtes
 * mystères), menus du serveur, dizaines de bots joueurs, tableau de scores latéral, chat du
 * serveur, pièces, niveaux et victoires (profil local). Les autres joueurs sont des bots.
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
import { openCosmetics, openLobbySelector, openMysteryBox, openProfile } from '../ui/ServerUI';
import {
  BEDWARS, BEDWARS_TEAMS, BLOCKPARTY, BLOCKPARTY_COLORS, DUELS, FLOOR, HUB, HUB_NPCS, HUB_SERVICES, PARKOUR, SKYWARS, SPLEEF, SUMO, TNTRUN,
  bedwarsIsland, blockPartyPattern, buildBedWarsBeds, buildBlockPartyFloor, buildSpleefFloor, buildTntRunLayers, hubParkour,
  parkourCourse, skywarsCenterChests, skywarsIslands, type GameKey,
} from './ServerMaps';
import { COSMETICS, COSMETIC_BY_ID, MYSTERY_PRICE, Pet, RARITY_COLOR, rollMystery, setHat, type Cosmetic, type CosmeticKind, type CosmeticProfile } from './Cosmetics';
import type * as THREE from 'three';

export const SERVER_NAME = 'HypXL';
export const SERVER_IP = 'play.hypxl.net';
const PROFILE_KEY = 'lecraft.server.v1';

export interface ServerProfile extends CosmeticProfile {
  coins: number;
  wins: Partial<Record<GameKey, number>>;
  played: number;
  kills: number;
  bestParkour: number;
  xp?: number;
  /** Bonus de bienvenue HypXL déjà reçu. */
  welcome?: boolean;
  /** Numéro de lobby, joueurs cachés, meilleur temps du parcours du hub. */
  lobby?: number;
  hidePlayers?: boolean;
  bestHubParkour?: number;
}

function loadProfile(): ServerProfile {
  try {
    return { coins: 0, wins: {}, played: 0, kills: 0, bestParkour: 0, owned: [], equipped: {}, ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') };
  } catch {
    return { coins: 0, wins: {}, played: 0, kills: 0, bestParkour: 0 };
  }
}

export const GAMES: Record<GameKey, { name: string; color: string; desc: string; players: number }> = {
  bedwars: { name: 'BedWars', color: '§c', desc: '4 équipes de 2 : protégez votre lit, achetez de l’équipement avec le fer et détruisez les lits adverses. Sans lit, plus de réapparition !', players: 8 },
  skywars: { name: 'SkyWars', color: '§e', desc: 'Îles dans le ciel : pillez les coffres, construisez des ponts, soyez le dernier en vie.', players: 8 },
  sumo: { name: 'Sumo', color: '§6', desc: 'Poussez les autres hors de l’arène ronde. Le dernier debout gagne.', players: 6 },
  blockparty: { name: 'Block Party', color: '§d', desc: 'Une couleur est annoncée : courez dessus avant que les autres disparaissent !', players: 10 },
  spleef: { name: 'Spleef', color: '§f', desc: 'Cassez la neige sous les pieds des autres. Tomber = éliminé.', players: 6 },
  duels: { name: 'Duel', color: '§b', desc: 'Combat 1 contre 1 avec équipement en fer.', players: 2 },
  tntrun: { name: 'TNT Run', color: '§c', desc: 'Le sol disparaît sous vos pas : ne vous arrêtez jamais !', players: 8 },
  parkour: { name: 'Parkour', color: '§a', desc: '36 sauts, points de contrôle, chronomètre : battez votre record.', players: 1 },
};

// ---------- pseudos et messages des bots ----------
const P1 = ['Pixel', 'Dark', 'Mega', 'Ultra', 'Shadow', 'Creeper', 'Diamond', 'Ender', 'Blaze', 'Frost', 'Turbo', 'Nova', 'Lucky', 'Crafty', 'Epic', 'Ninja', 'Lava', 'Sky', 'Iron', 'Golden', 'Kevin', 'Mathis', 'Lucas', 'Emma', 'Lea', 'Hugo', 'Nathan', 'Chloe', 'Tom', 'Jade'];
const P2 = ['Master', 'King', 'Hunter', 'Miner', 'Gamer', 'Wolf', 'Fox', 'Builder', 'Slayer', 'Warrior', 'Dragon', 'Panda', 'Craft', 'PvP', 'Pro', 'Bow', 'Blade', 'Rush', 'Cube', 'Block'];
const HUB_CHAT = ['salut tout le monde', 'qui veut duel ?', 'quelqu’un en SkyWars ?', 'le spleef c’est trop bien', 'je suis nouveau ici', 'comment on va au parkour ?', 'mdr', 'go TNT Run', 'j’ai gagné 3 parties d’affilée !', 'bonjour !', 'le parkour est dur au 4e point de contrôle', 'gg à tous', 'qui a le meilleur temps au parkour ?', 'je farm les pièces', 'quelqu’un pour une partie ?',
  'go bedwars', 'qui veut faire une team bedwars ?', 'j’ai eu un chapeau légendaire dans une boîte mystère !!', 'le block party c’est trop dur au round 10', 'vous avez vu mon compagnon ?', 'hypxl c’est le meilleur serveur', 'quelqu’un a le rang MVP+ ?', 'trop beau le nouveau spawn', 'sumo 1v1 ?', 'la fontaine est trop belle', 'j’ai fini le parkour du hub en 20 s', 'les traînées de flammes c’est stylé', 'qui veut mes pièces mdr', 'lobby 3 > tous les autres', 'gg pour la partie de skywars'];
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

/** Points d'intérêt du hub où flânent les bots. */
const HUB_SPOTS: [number, number][] = [
  [0, 10], [8, 8], [-8, 8], [10, -6], [-10, -6], [0, -12], [0, 22], [22, 0], [-22, 0], [0, -24], [16, 16], [-16, 16], [16, -18], [-16, -18],
  ...HUB_NPCS.map((n): [number, number] => [n.x * 0.85, n.z * 0.85]),
  [HUB_SERVICES.cosmetics.x - 2, HUB_SERVICES.cosmetics.z], [HUB_SERVICES.mystery.x - 2, HUB_SERVICES.mystery.z], [HUB_SERVICES.leaderboard.x, HUB_SERVICES.leaderboard.z - 3],
  [HUB_SERVICES.parkourStart.x, HUB_SERVICES.parkourStart.z + 2], [0, 40], [6, 34], [-6, 34], [28, 28], [-28, -28], [30, -30], [-34, 30],
];

/** Gadgets du hub (objet en main → effet). */
const GADGET_ITEM: Record<string, string> = { firework: 'firework_rocket', confetti: 'paper', leap: 'ender_pearl', storm: 'blaze_rod' };

export class ServerNetwork {
  readonly profile = loadProfile();
  private rng = new Rng((Math.random() * 1e9) | 0);
  private hubBots: Bot[] = [];
  private npcs: Bot[] = [];
  private holograms: Bot[] = [];
  private game: MiniGame | null = null;
  private chatTimer = 6;
  private sidebarTimer = 0;
  private churnTimer = 15;
  private online = 38000 + Math.floor(Math.random() * 14000);
  private usedNames = new Set<string>();
  /** Cosmétiques des bots (traînée, chapeau) et compagnons actifs. */
  private botTrail = new Map<Bot, string>();
  private botHat = new Map<Bot, string>();
  private pets = new Map<Bot | 'player', Pet>();
  private trailTimer = 0;
  private gadgetCooldown = 0;
  private parkourRun: { t: number; next: number } | null = null;
  private playerHatShown: string | null = null;
  private hatAvatar: object | null = null;

  constructor(readonly s: Session) {
    this.profile.owned ??= [];
    this.profile.equipped ??= {};
    this.profile.lobby ??= 1 + Math.floor(Math.random() * 12);
  }

  // ---------- démarrage et hub ----------
  start() {
    const s = this.s;
    Object.assign(s.gamerules, { doMobSpawning: false, doDaylightCycle: false, doWeatherCycle: false, keepInventory: true, tntExplodes: false, mobGriefing: false });
    s.player.difficulty = 'normal';
    s.dayCycle.time = 0.27;
    this.chat(`§7Connexion à §e${SERVER_IP}§7…`);
    this.chat('§6§l▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬');
    this.chat('§e§l          Bienvenue sur §6§lHypXL §e§l!');
    this.chat(`§7  8 mini-jeux · ${COSMETICS.length} cosmétiques · des milliers de joueurs`);
    this.chat('§7  §eBoussole§7 : jeux · §eLivre§7 : profil · §eÉmeraude§7 : cosmétiques');
    this.chat('§7  §eÉtoile§7 : lobbys · §8/menu /cosmetiques /profil /lobby');
    this.chat('§6§l▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬');
    if (!this.profile.welcome) {
      this.profile.welcome = true;
      this.profile.coins += 1000;
      this.chat('§a§l+1000 pièces §r§a: cadeau de bienvenue ! Essayez une §dboîte mystère§a.');
      this.saveProfile();
    }
    for (const n of HUB_NPCS) {
      const g = GAMES[n.game];
      const npc = this.spawnBot(n.x + 0.5, FLOOR + 2, n.z + 0.5, 1);
      npc.npc = n.game;
      this.npcs.push(npc);
      npc.invulnerable = true;
      npc.setTag(`${g.color}§l${g.name.toUpperCase()}\n§7${n.game === 'parkour' ? 'Solo' : `${g.players} joueurs`} · §e${this.gameOnline(n.game).toLocaleString('fr-FR')} en jeu\n§a▶ Toucher pour jouer`);
    }
    const service = (key: string, x: number, z: number, tag: string) => {
      const b = this.spawnBot(x + 0.5, FLOOR + 1, z + 0.5, 1);
      b.npc = key;
      b.invulnerable = true;
      b.setTag(tag);
      this.npcs.push(b);
      return b;
    };
    service('cosmetics', HUB_SERVICES.cosmetics.x, HUB_SERVICES.cosmetics.z, '§d§lCOSMÉTIQUES\n§7Traînées · chapeaux · compagnons\n§a▶ Toucher pour ouvrir');
    service('mystery', HUB_SERVICES.mystery.x, HUB_SERVICES.mystery.z, `§5§lBOÎTES MYSTÈRES\n§7${MYSTERY_PRICE} pièces la boîte\n§a▶ Toucher pour ouvrir`);
    service('smp', HUB_SERVICES.smp.x, HUB_SERVICES.smp.z, '§2§lSURVIE MODDÉE\n§7LeCraft SMP\n§a▶ Toucher pour rejoindre');
    // hologrammes : accueil, classement, parcours du hub
    this.hologram(HUB.spawn.x, FLOOR + 2.2, HUB.spawn.z - 6, `§e§lBIENVENUE SUR §6§lHYPXL\n§7Le serveur de mini-jeux n°1\n§b8 jeux §7· §d${COSMETICS.length} cosmétiques §7· §a${SERVER_IP}`);
    this.hologram(HUB_SERVICES.leaderboard.x + 0.5, FLOOR + 3.4, HUB_SERVICES.leaderboard.z + 0.5, this.leaderboardText());
    this.hologram(HUB_SERVICES.parkourStart.x + 0.5, FLOOR + 1.6, HUB_SERVICES.parkourStart.z + 0.5, `§a§lPARCOURS DU HUB\n§7Montez sur le bloc d’or pour démarrer\n§fRecord : §e${this.profile.bestHubParkour ? this.profile.bestHubParkour.toFixed(2) + ' s' : '-'}`);
    this.toHub(true);
  }

  /** Joueurs « en jeu » affichés pour un mini-jeu (part de la population du réseau). */
  gameOnline(k: GameKey) {
    const share: Record<GameKey, number> = { bedwars: 0.31, skywars: 0.19, duels: 0.12, sumo: 0.05, blockparty: 0.06, tntrun: 0.05, spleef: 0.03, parkour: 0.02 };
    return Math.round(this.online * share[k] * (0.92 + ((this.online >> 3) % 17) / 100));
  }

  private hologram(x: number, y: number, z: number, text: string) {
    const b = this.spawnBot(x, y, z, 1);
    b.npc = 'hologram';
    b.invulnerable = true;
    b.setTag(text);
    b.object3d.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.visible = false;
    });
    b.body.gravity = 0;
    this.holograms.push(b);
    return b;
  }

  private leaderboardText() {
    const r = new Rng(this.profile.lobby! * 97);
    const rows: [string, number][] = Array.from({ length: 6 }, () => [`${r.pick(['§b[MVP§c+§b] ', '§b[MVP] ', '§a[VIP§6+§a] ', '§6[YOUTUBE] '])}${r.pick(P1)}${r.pick(P2)}`, r.int(800, 9000)]);
    const mine = Object.values(this.profile.wins).reduce((a, n) => a + (n ?? 0), 0);
    rows.push([`${this.rankPrefix()}${this.s.player.name}`, mine]);
    rows.sort((a, b) => b[1] - a[1]);
    return ['§e§lMEILLEURS JOUEURS §7(victoires)', ...rows.slice(0, 7).map(([n, w], i) => `§6${i + 1}. ${n} §7- §e${w.toLocaleString('fr-FR')}`)].join('\n');
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
    this.botTrail.delete(b);
    this.botHat.delete(b);
    const pet = this.pets.get(b);
    if (pet) {
      pet.removed = true;
      this.pets.delete(b);
    }
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

  /** Objets du hub : jeux, profil, gadget, cosmétiques, joueurs visibles, lobbys. */
  private hubHotbar() {
    const inv = this.s.player.inventory;
    const put = (slot: number, id: string, n = 1) => {
      if (ItemRegistry.has(id)) inv.slots[slot] = makeStack(id, n);
    };
    put(0, 'compass');
    put(1, 'book');
    const g = this.equipped('gadget');
    if (g) put(2, GADGET_ITEM[g.value] ?? 'firework_rocket');
    put(4, 'emerald', Math.max(1, Math.min(64, Math.floor(this.profile.coins / 100) || 1)));
    put(7, this.profile.hidePlayers ? 'gray_dye' : 'lime_dye');
    put(8, 'nether_star');
    inv.changed();
  }

  /** Retour au hub (fin de partie, /hub, objet « Retour »). */
  toHub(first = false) {
    this.game?.dispose();
    this.game = null;
    this.resetPlayer();
    this.hubHotbar();
    this.s.player.spawn = [HUB.spawn.x, HUB.spawn.y, HUB.spawn.z];
    this.teleport(HUB.spawn.x, HUB.spawn.y, HUB.spawn.z, HUB.spawn.yaw);
    this.s.held.setItem('compass');
    this.populateHub(true);
    this.applyPlayerPet();
    if (!first) this.chat(`§7Vous êtes de retour au §elobby #${this.profile.lobby}§7.`);
    this.s.hud.markHotbarDirty?.();
  }

  /** Nombre de joueurs (bots) du hub selon la qualité graphique. */
  private get hubCapacity() {
    const q = this.s.game.settings.quality;
    return q === 'HIGH' ? 40 : q === 'MEDIUM' ? 28 : 16;
  }

  private populateHub(silent: boolean) {
    while (this.hubBots.length < this.hubCapacity) {
      const [sx, sz] = this.rng.pick(HUB_SPOTS);
      const b = this.spawnBot(HUB.x + sx + (this.rng.next() - 0.5) * 6, FLOOR + 1, HUB.z + sz + (this.rng.next() - 0.5) * 6);
      b.brain = (bot, _ctx, dt) => this.hubWander(bot, dt);
      if (this.profile.hidePlayers) b.object3d.visible = false;
      this.dressBot(b);
      this.hubBots.push(b);
      if (!silent && (b.rank.tag.includes('MVP') || this.rng.next() < 0.3)) this.chat(`${b.chatName} §6a rejoint le lobby !`);
    }
  }

  /** Cosmétiques aléatoires des bots (traînées, chapeaux, quelques compagnons). */
  private dressBot(b: Bot) {
    const r = this.rng;
    if (r.next() < 0.35) this.botTrail.set(b, r.pick(COSMETICS.filter((c) => c.kind === 'trail')).value);
    if (r.next() < 0.3) {
      const hat = r.pick(COSMETICS.filter((c) => c.kind === 'hat')).value;
      this.botHat.set(b, hat);
      setHat(b.model.parts.get('head')?.[0], this.s.game.textures, hat);
    }
    if (r.next() < 0.12 && this.pets.size < 6) {
      const kind = r.pick(COSMETICS.filter((c) => c.kind === 'pet')).value;
      const pet = new Pet(kind, b.x + 1, b.y, b.z + 1, this.s.entities, () => (b.removed || b.dead ? null : b));
      this.pets.set(b, this.s.entities.addMob(pet));
    }
  }

  private wanderTarget = new Map<Bot, { x: number; z: number; t: number }>();
  private hubWander(b: Bot, dt: number) {
    let w = this.wanderTarget.get(b);
    if (!w || (w.t -= dt) <= 0) {
      const [sx, sz] = this.rng.pick(HUB_SPOTS);
      w = { x: HUB.x + sx + (Math.random() - 0.5) * 5, z: HUB.z + sz + (Math.random() - 0.5) * 5, t: 5 + Math.random() * 12 };
      this.wanderTarget.set(b, w);
    }
    const d = Math.hypot(w.x - b.x, w.z - b.z);
    // déplacement direct (pas de recherche de chemin : le hub est plat) — peu coûteux
    if (d > 1.4) b.ai.moveTowards(w.x, w.z, d > 10 ? 1.3 : 1, true);
    else b.ai.stop();
    if (b.body.onGround && Math.random() < dt * 0.25) b.body.vy = 9.2;
    if (b.body.onGround && b.body.collidedH) b.body.vy = 9.2;
  }

  /** Cosmétique équipé d'un type. */
  equipped(kind: CosmeticKind): Cosmetic | null {
    const id = this.profile.equipped?.[kind];
    return id ? COSMETIC_BY_ID.get(id) ?? null : null;
  }
  owns(id: string) {
    return this.profile.owned!.includes(id);
  }
  buy(c: Cosmetic): boolean {
    if (this.owns(c.id)) return true;
    if (this.profile.coins < c.price) return false;
    this.profile.coins -= c.price;
    this.profile.owned!.push(c.id);
    this.chat(`§aVous avez acheté ${RARITY_COLOR[c.rarity]}${c.name} §a(${KIND_LABEL[c.kind]}) !`);
    this.s.audio.play('levelup', { volume: 0.4 });
    this.equip(c);
    return true;
  }
  equip(c: Cosmetic | null, kind?: CosmeticKind) {
    const k = c?.kind ?? kind!;
    if (c && !this.owns(c.id)) return;
    if (c) this.profile.equipped![k] = c.id;
    else delete this.profile.equipped![k];
    this.saveProfile();
    if (k === 'pet') this.applyPlayerPet();
    if (k === 'gadget' && !this.game) this.hubHotbar();
    if (k === 'rank' || k === 'color') this.chat(`§7Votre nom dans le chat : ${this.rankPrefix()}${this.s.player.name}§f: ${this.chatColor()}Bonjour !`);
  }
  /** Boîte mystère : tirage animé d'un cosmétique non possédé. */
  openMystery(): Cosmetic | null {
    if (this.profile.coins < MYSTERY_PRICE) {
      this.chat(`§cIl vous faut ${MYSTERY_PRICE} pièces pour ouvrir une boîte mystère.`);
      return null;
    }
    const c = rollMystery(new Set(this.profile.owned));
    if (!c) {
      this.chat('§aVous possédez déjà tous les cosmétiques !');
      return null;
    }
    this.profile.coins -= MYSTERY_PRICE;
    this.profile.owned!.push(c.id);
    this.saveProfile();
    const names = COSMETICS.map((x) => `${RARITY_COLOR[x.rarity]}${x.name}`);
    let i = 0;
    const roll = () => {
      if (i++ < 14) {
        this.title('§5§lBOÎTE MYSTÈRE', this.rng.pick(names));
        this.s.audio.play('click', { volume: 0.4 });
        setTimeout(roll, 70 + i * 14);
        return;
      }
      this.title(`${RARITY_COLOR[c.rarity]}§l${c.name.toUpperCase()}`, `§7${KIND_LABEL[c.kind]} · ${c.rarity}`);
      this.s.audio.play(c.rarity === 'légendaire' || c.rarity === 'épique' ? 'achievement' : 'levelup');
      const p = this.s.player;
      this.s.particles.burst(c.rarity === 'légendaire' ? 'explosion' : 'magic', p.x, p.y + 1.2, p.z, 30);
      this.chat(`§5§l✦ §dVous avez obtenu ${RARITY_COLOR[c.rarity]}${c.name} §7(${KIND_LABEL[c.kind]}, ${c.rarity}) §d!`);
      if (c.rarity === 'légendaire') this.chat(`§6§l✦ ${this.rankPrefix()}${p.name} §6a obtenu un cosmétique §lLÉGENDAIRE §r§6!`);
    };
    roll();
    return c;
  }

  /** Préfixe de rang du joueur (acheté) et couleur de chat. */
  rankPrefix() {
    const r = this.equipped('rank');
    return r ? r.value.split('|')[0] : '§7';
  }
  chatColor() {
    return this.equipped('color')?.value ?? (this.equipped('rank') ? '§f' : '§7');
  }
  /** Ligne de chat du joueur (rang + couleur), comme sur les serveurs de mini-jeux. */
  formatPlayerChat(text: string) {
    const r = this.equipped('rank');
    const nameColor = r ? r.value.split('|')[1] : '§7';
    return `${r ? r.value.split('|')[0] : ''}${nameColor}${this.s.player.name}§f: ${this.chatColor()}${text}`;
  }

  private applyPlayerPet() {
    const old = this.pets.get('player');
    const want = this.equipped('pet')?.value ?? null;
    if (old && (!want || old.def.key !== want)) {
      old.removed = true;
      this.pets.delete('player');
    }
    if (want && !this.pets.has('player')) {
      const p = this.s.player;
      const pet = new Pet(want, p.x + 1, p.y + 0.5, p.z + 1, this.s.entities, () => (this.s.player.dead ? null : this.s.player));
      this.pets.set('player', this.s.entities.addMob(pet));
    }
  }

  /** Effets cosmétiques par image : traînées, chapeau visible en vue extérieure. */
  private cosmeticsTick(dt: number) {
    this.trailTimer -= dt;
    if (this.trailTimer <= 0) {
      this.trailTimer = 0.12;
      const fx = this.s.particles;
      const p = this.s.player;
      const mine = this.equipped('trail');
      if (mine && Math.hypot(p.body.vx, p.body.vz) > 0.8) fx.burst(mine.value as never, p.x, p.y + 0.15, p.z, 2);
      if (!this.profile.hidePlayers)
        for (const [b, kind] of this.botTrail) if (!b.removed && Math.hypot(b.body.vx, b.body.vz) > 0.8 && Math.hypot(b.x - p.x, b.z - p.z) < 40) fx.burst(kind as never, b.x, b.y + 0.15, b.z, 1);
    }
    const hat = this.equipped('hat')?.value ?? null;
    const avatar = this.s.playerAvatar;
    if (avatar && (hat !== this.playerHatShown || avatar !== this.hatAvatar)) {
      setHat(avatar.model.parts.get('head')?.[0], this.s.game.textures, hat);
      this.playerHatShown = hat;
      this.hatAvatar = avatar;
    }
    this.gadgetCooldown -= dt;
  }

  /** Parcours du hub : départ sur le bloc d'or, arrivée sur l'émeraude. */
  private hubParkourTick(dt: number) {
    const p = this.s.player;
    if (!p.body.onGround) {
      if (this.parkourRun) this.parkourRun.t += dt;
      return;
    }
    const course = hubParkour();
    const fx = Math.floor(p.x), fy = Math.floor(p.y - 0.2), fz = Math.floor(p.z);
    const i = course.findIndex((c) => c.x === fx && c.y === fy && c.z === fz);
    if (this.parkourRun) this.parkourRun.t += dt;
    if (i === 0 && (!this.parkourRun || this.parkourRun.next > 1)) {
      this.parkourRun = { t: 0, next: 1 };
      this.chat('§aParcours du hub démarré ! §7Atteignez le bloc d’émeraude en haut de la tour.');
    } else if (this.parkourRun && i >= this.parkourRun.next) {
      this.parkourRun.next = i + 1;
      if (i === course.length - 1) {
        const t = this.parkourRun.t;
        this.parkourRun = null;
        this.title('§a§lPARCOURS RÉUSSI !', `§f${t.toFixed(2)} s`);
        if (!this.profile.bestHubParkour || t < this.profile.bestHubParkour) {
          this.profile.bestHubParkour = t;
          this.chat(`§a§lNOUVEAU RECORD DU HUB : §f${t.toFixed(2)} s`);
          this.reward(20, 'record du parcours du hub');
        } else this.saveProfile();
      }
    }
    if (this.parkourRun) {
      this.s.hud.showTitle(`§e${this.parkourRun.t.toFixed(1)} s §7· bloc ${this.parkourRun.next}/${course.length}`, 'actionbar');
      if (p.y < FLOOR + 0.5 && this.parkourRun.next > 1) {
        this.parkourRun = null;
        this.s.hud.showTitle('§cParcours annulé', 'actionbar');
      }
    }
  }

  /** Arrivées et départs de joueurs dans le lobby (population vivante). */
  private churn() {
    if (!this.hubBots.length) return;
    const b = this.rng.pick(this.hubBots);
    if (this.rng.next() < 0.5) this.botSay(b, this.rng.pick(['go bedwars', 'je vais en skywars', 'bye', 'à plus', 'je vais jouer au sumo']));
    this.hubBots = this.hubBots.filter((x) => x !== b);
    this.removeBot(b);
    this.populateHub(false);
  }

  // ---------- événements du jeu ----------
  update(dt: number) {
    const s = this.s, p = s.player;
    if (this.game) this.game.update(dt);
    else {
      // hub : invulnérable, rassasié, retour si on tombe dans le vide
      p.invulnerable = Math.max(p.invulnerable, 1);
      p.hunger = 20;
      if (p.y < FLOOR - 30) this.teleport(HUB.spawn.x, HUB.spawn.y, HUB.spawn.z, HUB.spawn.yaw);
      this.chatTimer -= dt;
      if (this.chatTimer <= 0 && this.hubBots.length) {
        this.chatTimer = 5 + Math.random() * 11;
        const b = this.hubBots[this.rng.int(0, this.hubBots.length - 1)];
        this.botSay(b, this.rng.pick(HUB_CHAT));
      }
      this.churnTimer -= dt;
      if (this.churnTimer <= 0) {
        this.churnTimer = 18 + Math.random() * 25;
        this.churn();
      }
      this.hubParkourTick(dt);
    }
    this.cosmeticsTick(dt);
    this.sidebarTimer -= dt;
    if (this.sidebarTimer <= 0) {
      this.sidebarTimer = 0.5;
      if (Math.random() < 0.2) this.online += this.rng.int(-40, 45);
      s.hud.setSidebar('§e§lHYPXL', this.sidebarLines());
    }
  }

  private sidebarLines(): string[] {
    const d = new Date();
    const date = `§7${d.toLocaleDateString('fr-FR')} §8L${this.profile.lobby}`;
    if (this.game) return [date, '', ...this.game.sidebar(), '', `§e${SERVER_IP}`];
    const wins = Object.values(this.profile.wins).reduce((a, n) => a + (n ?? 0), 0);
    const rank = this.equipped('rank');
    return [
      date, '',
      `§fRang : ${rank ? rank.value.split('|')[0].trim() : '§7Joueur'}`,
      `§fNiveau : §b${this.level}`,
      `§fPièces : §6${this.profile.coins.toLocaleString('fr-FR')}`,
      `§fVictoires : §a${wins}`,
      `§fCosmétiques : §d${this.profile.owned!.length}/${COSMETICS.length}`, '',
      `§fLobby : §a#${this.profile.lobby}`,
      `§fJoueurs : §a${this.online.toLocaleString('fr-FR')}`, '',
      `§e${SERVER_IP}`,
    ];
  }

  /** Niveau du joueur (expérience gagnée en jouant : pièces cumulées). */
  get level() {
    return 1 + Math.floor(Math.sqrt((this.profile.xp ?? 0) / 40));
  }
  /** Progression vers le niveau suivant (0..1). */
  get levelProgress() {
    const xp = this.profile.xp ?? 0, l = this.level;
    const a = (l - 1) * (l - 1) * 40, b = l * l * 40;
    return Math.max(0, Math.min(1, (xp - a) / (b - a)));
  }

  saveProfile() {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(this.profile));
    } catch {
      /* stockage indisponible */
    }
  }

  /** Le joueur touche une créature : PNJ du hub → jeu, cosmétiques, boîtes mystères, survie. */
  mobInteract(m: Mob): boolean {
    const npc = (m as Bot).npc;
    if (!npc) return false;
    if (npc === 'hologram') return true;
    if (this.game) return this.game.interact(npc);
    if (npc === 'smp') {
      this.chat('§7Connexion à §2LeCraft SMP§7…');
      setTimeout(() => void this.s.game.joinSmp(), 0);
      return true;
    }
    if (npc === 'cosmetics') {
      openCosmetics(this.s.game, this);
      return true;
    }
    if (npc === 'mystery') {
      openMysteryBox(this.s.game, this);
      return true;
    }
    this.join(npc as GameKey);
    return true;
  }

  /** Objets du hub : menus, gadget, joueurs visibles, lobbys ; lit (quitter la partie). */
  useItem(id: string): boolean {
    if (!this.game) {
      if (id === 'compass') return (this.openSelector(), true);
      if (id === 'book') return (openProfile(this.s.game, this), true);
      if (id === 'emerald') return (openCosmetics(this.s.game, this), true);
      if (id === 'nether_star') return (openLobbySelector(this.s.game, this), true);
      if (id === 'lime_dye' || id === 'gray_dye') return (this.togglePlayers(), true);
      const g = this.equipped('gadget');
      if (g && id === (GADGET_ITEM[g.value] ?? '')) return (this.useGadget(g.value), true);
    }
    if (id === 'red_bed' && this.game) {
      this.chat('§7Vous quittez la partie.');
      this.toHub();
      return true;
    }
    return false;
  }

  private togglePlayers() {
    this.profile.hidePlayers = !this.profile.hidePlayers;
    for (const b of this.hubBots) b.object3d.visible = !this.profile.hidePlayers;
    for (const [owner, pet] of this.pets) if (owner !== 'player') pet.object3d.visible = !this.profile.hidePlayers;
    this.chat(this.profile.hidePlayers ? '§7Joueurs §ccachés§7.' : '§7Joueurs §avisibles§7.');
    this.saveProfile();
    this.hubHotbar();
  }

  private useGadget(kind: string) {
    if (this.gadgetCooldown > 0) {
      this.s.hud.showTitle(`§cRecharge : ${this.gadgetCooldown.toFixed(1)} s`, 'actionbar');
      return;
    }
    const p = this.s.player, fx = this.s.particles, a = this.s.audio;
    const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw);
    if (kind === 'firework') {
      const x = p.x + dx * 3, z = p.z + dz * 3;
      fx.burst('crit', x, p.y + 2, z, 12);
      setTimeout(() => {
        fx.burst('explosion', x, p.y + 9, z, 26);
        fx.burst('magic', x, p.y + 9, z, 40);
        fx.burst('crystal', x, p.y + 9, z, 30);
        a.play('explode', { x, y: p.y + 9, z, volume: 0.35 });
      }, 650);
      this.gadgetCooldown = 3;
    } else if (kind === 'confetti') {
      for (const k of ['magic', 'crystal', 'hearts', 'crit'] as const) fx.burst(k, p.x + dx * 1.5, p.y + 1.6, p.z + dz * 1.5, 18);
      a.play('pop', { volume: 0.6 });
      this.gadgetCooldown = 2;
    } else if (kind === 'leap') {
      p.body.vx = dx * 16;
      p.body.vz = dz * 16;
      p.body.vy = 13;
      fx.burst('magic', p.x, p.y, p.z, 20);
      a.play('whoosh', { volume: 0.5 });
      this.gadgetCooldown = 4;
    } else if (kind === 'storm') {
      for (let i = 0; i < 6; i++) setTimeout(() => fx.burst('rain', p.x + (Math.random() - 0.5) * 6, p.y + 4, p.z + (Math.random() - 0.5) * 6, 20), i * 120);
      fx.burst('smoke', p.x, p.y + 3, p.z, 30);
      a.play('thunder', { volume: 0.4 });
      this.gadgetCooldown = 5;
    }
  }

  /** Changement de lobby : nouveaux joueurs, retour au point d'apparition. */
  switchLobby(n: number) {
    if (this.game) return;
    for (const b of this.hubBots) this.removeBot(b);
    this.hubBots = [];
    this.profile.lobby = n;
    this.saveProfile();
    this.chat(`§7Envoi vers §aLobby #${n}§7…`);
    this.holograms[1]?.setTag(this.leaderboardText());
    this.toHub(true);
    this.title(`§a§lLOBBY #${n}`, `§7${this.hubCapacity} joueurs`);
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
    else if (/bedwars|skywars|spleef|tnt|parkour|sumo|block ?party/.test(t)) reply = this.rng.pick(['go !', 'j’arrive', 'je suis le meilleur à ça mdr', 'utilise la boussole pour rejoindre']);
    else if (/cosm|chapeau|pet|compagnon|boîte|boite|rang|mvp|vip/.test(t)) reply = this.rng.pick(['ouvre une boîte mystère au PNJ violet', 'mon chapeau préféré c’est la balise', 'le rang MVP+ coûte cher mais il est stylé', 'j’ai un renardeau comme compagnon']);
    else if (/\?$/.test(t)) reply = this.rng.pick(['je sais pas', 'oui', 'non', 'peut-être', 'demande au staff', 'bonne question']);
    else if (/(nul|noob|ez)/.test(t)) reply = this.rng.pick(['toi même', 'calme toi', ':(', 'on verra en duel']);
    else if (Math.random() < 0.35) reply = this.rng.pick(['mdr', 'ok', 'trop bien', 'ah oui ?', 'lol']);
    if (reply) setTimeout(() => !who.removed && this.botSay(who, reply!), 900 + Math.random() * 2200);
  }

  /** Commandes du serveur (chat). */
  command(line: string): boolean {
    const [cmd, arg] = line.trim().toLowerCase().split(/\s+/);
    if (cmd === '/hub' || cmd === '/lobby' || cmd === '/l') {
      if (arg && /^\d+$/.test(arg)) this.switchLobby(Math.max(1, Math.min(12, Number(arg))));
      else this.toHub();
      return true;
    }
    if (cmd === '/server') {
      if (arg === 'smp' || arg === 'survie') setTimeout(() => void this.s.game.joinSmp(), 0);
      else this.chat(`§7Serveurs : §e/server smp §7(survie moddée). Vous êtes sur §6HypXL §7lobby #${this.profile.lobby}.`);
      return true;
    }
    if (cmd === '/jeux' || cmd === '/games' || cmd === '/menu') {
      this.openSelector();
      return true;
    }
    if (cmd === '/cosmetiques' || cmd === '/cosmétiques' || cmd === '/cosmetics') {
      openCosmetics(this.s.game, this);
      return true;
    }
    if (cmd === '/profil' || cmd === '/profile' || cmd === '/stats') {
      openProfile(this.s.game, this);
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
    const Ctor = { skywars: SkyWars, spleef: Spleef, tntrun: TntRun, duels: Duel, parkour: Parkour, sumo: Sumo, blockparty: BlockParty, bedwars: BedWars }[key];
    const game = new Ctor(this, key);
    this.game = game;
    game.begin();
  }

  // ---------- services pour les mini-jeux ----------
  /** Bots d'une partie (hors du hub). */
  gameBot(x: number, y: number, z: number) {
    const b = this.spawnBot(x, y, z);
    if (this.rng.next() < 0.3) this.botTrail.set(b, this.rng.pick(COSMETICS.filter((c) => c.kind === 'trail')).value);
    return b;
  }
  release(b: Bot) {
    this.removeBot(b);
  }
  reward(coins: number, why: string) {
    const before = this.level;
    this.profile.coins += coins;
    this.profile.xp = (this.profile.xp ?? 0) + coins;
    if (this.level > before) {
      this.title(`§b§lNIVEAU ${this.level} !`, '§7Continuez à jouer pour monter');
      this.s.audio.play('levelup');
    }
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

const KIND_LABEL: Record<CosmeticKind, string> = { trail: 'traînée', hat: 'chapeau', pet: 'compagnon', color: 'couleur de chat', rank: 'rang', gadget: 'gadget' };

// =====================================================================================
// Mini-jeux
// =====================================================================================

abstract class MiniGame {
  parts: Part[] = [{ bot: null, name: 'Vous', alive: true, kills: 0 }];
  state: 'countdown' | 'playing' | 'ended' = 'countdown';
  timer = 10;
  elapsed = 0;
  /** Blocs modifiés pendant la partie (restaurés à la fin). */
  protected journal = new Map<string, number>();
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

  /** Annonces d'arrivée des autres joueurs pendant l'attente (k/N). */
  private joinQueue: Part[] = [];
  private joinTimer = 0.4;

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
    this.net.title(`${GAMES[this.key].color}§l${GAMES[this.key].name}`, this.parts.length > 1 ? '§7En attente de joueurs…' : '§7La partie commence bientôt');
    this.joinQueue = this.parts.filter((x) => x.bot);
    this.timer += Math.min(6, this.joinQueue.length * 0.6);
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
      this.joinTimer -= dt;
      if (this.joinQueue.length && this.joinTimer <= 0) {
        this.joinTimer = 0.3 + Math.random() * 0.8;
        const j = this.joinQueue.shift()!;
        const n = this.parts.length - this.joinQueue.length;
        this.net.chat(`${j.bot!.chatName} §ea rejoint la partie (§b${n}§e/§b${this.parts.length}§e) !`);
      }
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

  /** Coéquipiers (jeux en équipes). */
  protected ally(_a: Part, _b: Part) {
    return false;
  }
  /** PNJ propre au jeu (marchand…) touché par le joueur. */
  interact(_npc: string): boolean {
    return false;
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
      if (o === part || !o.alive || this.ally(part, o)) continue;
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
      else if (s.id === 'arrow') b.arrows += s.count;
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
    if (b.body.onGround && w.getBlock(Math.floor(b.x), FLOOR, Math.floor(b.z)) !== B.SNOW_BLOCK) b.body.vy = 9.2;
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
    if (b.body.onGround && !here(Math.floor(b.x + b.body.vx * 0.15), Math.floor(b.z + b.body.vz * 0.15)) && Math.random() < 0.5 + b.skill * 0.5) b.body.vy = 9.2;
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
    b.arrows = 16;
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

// ---------- Sumo ----------
class Sumo extends MiniGame {
  protected box = { x0: SUMO.x - 12, z0: SUMO.z - 12, x1: SUMO.x + 12, z1: SUMO.z + 12 };
  private starts: [number, number][] = [];
  /** Après un coup, le bot subit le recul sans pouvoir se diriger (sinon l'IA l'annule). */
  private stun = new Map<Bot, number>();
  setup() {
    const n = GAMES.sumo.players;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = SUMO.x + Math.cos(a) * (SUMO.r - 2) + 0.5, z = SUMO.z + Math.sin(a) * (SUMO.r - 2) + 0.5;
      this.starts.push([x, z]);
      if (i === 0) {
        this.net.teleportPlayer(x, FLOOR + 1, z, Math.atan2(SUMO.x - x, SUMO.z - z) + Math.PI);
        continue;
      }
      const b = this.net.gameBot(x, FLOOR + 1, z);
      this.parts.push({ bot: b, name: b.botName, alive: true, kills: 0 });
    }
    this.s.player.inventory.slots[8] = makeStack('red_bed', 1);
  }
  protected hold() {
    super.hold(0);
    const [x, z] = this.starts[0], p = this.s.player;
    if (Math.hypot(p.x - x, p.z - z) > 1.2) this.net.teleportPlayer(x, FLOOR + 1, z);
  }
  center() {
    return { x: SUMO.x, y: FLOOR, z: SUMO.z };
  }
  protected fallY() {
    return SUMO.outY;
  }
  /** Sumo : pas de dégâts, seulement du recul (plus fort que d'habitude). */
  protected strike(b: Bot, target: Part, _dmg: number, kx: number, kz: number) {
    if (!target.alive) return;
    if (target.bot) {
      target.bot.body.vx += kx * 1.3;
      target.bot.body.vz += kz * 1.3;
      target.bot.body.vy = Math.max(target.bot.body.vy, 5.5);
      target.bot.lastAttacker = b;
      target.bot.hurtTimer = 0.3;
      this.stun.set(target.bot, 0.55);
    } else {
      const p = this.s.player;
      p.damage(0.5, 'mob', kx * 1.8, kz * 1.8, b as never);
      p.body.vy = Math.max(p.body.vy, 5.5);
    }
  }
  protected tick() {
    const p = this.s.player;
    p.health = 20;
    for (const part of this.alive) {
      const b = part.bot;
      if (!b || b.dead) continue;
      // coup du joueur : recul supplémentaire, la vie reste pleine
      if (b.health < b.maxHealth) {
        if (b.lastAttacker === 'player') {
          const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz) || 1;
          b.body.vx += (dx / d) * 6;
          b.body.vz += (dz / d) * 6;
          b.body.vy = Math.max(b.body.vy, 5);
          this.stun.set(b, 0.55);
        }
        b.health = b.maxHealth;
      }
    }
  }
  think(b: Bot, part: Part, dt: number) {
    const st = (this.stun.get(b) ?? 0) - dt;
    this.stun.set(b, st);
    if (st > 0) return;
    const fromCenter = Math.hypot(b.x - SUMO.x - 0.5, b.z - SUMO.z - 0.5);
    // trop près du bord : on revient vers le centre avant de se battre
    if (fromCenter > SUMO.r - 1.6 && Math.random() < 0.6 + b.skill * 0.4) {
      b.ai.moveTowards(SUMO.x + 0.5, SUMO.z + 0.5, 1.2, false);
      return;
    }
    const foe = this.nearestFoe(b, part);
    if (foe) b.fight(this.s, foe.f, dt, (dmg, kx, kz) => this.strike(b, foe.part, dmg, kx, kz));
  }
}

// ---------- Block Party ----------
const COLOR_FR: Record<string, string> = { red: '§cROUGE', orange: '§6ORANGE', yellow: '§eJAUNE', lime: '§aVERT', light_blue: '§bBLEU CLAIR', blue: '§9BLEU', magenta: '§dMAGENTA', white: '§fBLANC' };
class BlockParty extends MiniGame {
  protected box = { x0: BLOCKPARTY.x - BLOCKPARTY.half - 1, z0: BLOCKPARTY.z - BLOCKPARTY.half - 1, x1: BLOCKPARTY.x + BLOCKPARTY.half + 1, z1: BLOCKPARTY.z + BLOCKPARTY.half + 1 };
  private round = 0;
  private phase: 'dance' | 'call' | 'drop' = 'dance';
  private phaseT = 4;
  private pattern: number[] = [];
  private color = 0;
  private goals = new Map<Bot, { x: number; z: number; react: number }>();
  private beat = 0;
  private get n() {
    return BLOCKPARTY.half * 2 + 1;
  }
  setup() {
    this.newFloor();
    const n = GAMES.blockparty.players;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = BLOCKPARTY.x + Math.cos(a) * 8 + 0.5, z = BLOCKPARTY.z + Math.sin(a) * 8 + 0.5;
      if (i === 0) {
        this.net.teleportPlayer(x, FLOOR + 1, z, Math.atan2(BLOCKPARTY.x - x, BLOCKPARTY.z - z) + Math.PI);
        continue;
      }
      const b = this.net.gameBot(x, FLOOR + 1, z);
      this.parts.push({ bot: b, name: b.botName, alive: true, kills: 0 });
    }
    this.s.player.inventory.slots[8] = makeStack('red_bed', 1);
  }
  center() {
    return { x: BLOCKPARTY.x, y: FLOOR, z: BLOCKPARTY.z };
  }
  protected fallY() {
    return BLOCKPARTY.outY;
  }
  private newFloor() {
    const w = this.s.world;
    this.pattern = blockPartyPattern(this.net.pick([1, 2, 3, 4, 5, 6, 7, 8, 9]) * 101 + this.round * 7);
    buildBlockPartyFloor((x, y, z, b) => void w.setBlock(x, y, z, b), this.pattern);
  }
  private colorAt(x: number, z: number) {
    const i = Math.floor(x) - (BLOCKPARTY.x - BLOCKPARTY.half), j = Math.floor(z) - (BLOCKPARTY.z - BLOCKPARTY.half);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return this.pattern[j * this.n + i];
  }
  /** Temps pour rejoindre la couleur : de 5 s à 1,5 s au fil des manches. */
  private get callTime() {
    return Math.max(1.5, 5 - this.round * 0.3);
  }
  protected tick(dt: number) {
    const p = this.s.player;
    p.health = 20;
    this.phaseT -= dt;
    // musique : notes sur le temps pendant la danse
    this.beat -= dt;
    if (this.phase === 'dance' && this.beat <= 0) {
      this.beat = 0.35;
      this.s.audio.play('click', { volume: 0.25 });
      if (Math.random() < 0.3) this.s.particles.burst('magic', BLOCKPARTY.x + (Math.random() - 0.5) * 20, FLOOR + 3, BLOCKPARTY.z + (Math.random() - 0.5) * 20, 6);
    }
    if (this.phaseT > 0) {
      if (this.phase === 'call') this.s.hud.showTitle(`${COLOR_FR[BLOCKPARTY_COLORS[this.color]]} §7— §f${this.phaseT.toFixed(1)} s`, 'actionbar');
      return;
    }
    const w = this.s.world;
    if (this.phase === 'dance') {
      // annonce d'une couleur présente sur la piste
      this.round++;
      const present = [...new Set(this.pattern.filter((c) => c >= 0))];
      this.color = this.net.pick(present);
      const key = BLOCKPARTY_COLORS[this.color];
      const item = ItemRegistry.has(`${key}_concrete`) ? `${key}_concrete` : `${key}_wool`;
      if (ItemRegistry.has(item)) {
        for (let i = 0; i < 8; i++) p.inventory.slots[i] = makeStack(item, 1);
        p.inventory.changed();
      }
      this.net.title(COLOR_FR[key], `§7Manche ${this.round}`);
      this.s.audio.play('levelup', { volume: 0.4 });
      this.phase = 'call';
      this.phaseT = this.callTime;
      this.goals.clear();
    } else if (this.phase === 'call') {
      // toutes les autres couleurs disparaissent
      this.pattern = this.pattern.map((c) => (c === this.color ? c : -1));
      buildBlockPartyFloor((x, y, z, b) => void w.setBlock(x, y, z, b), this.pattern);
      this.s.audio.play('explode', { volume: 0.2 });
      this.phase = 'drop';
      this.phaseT = 3;
    } else {
      for (let i = 0; i < 8; i++) p.inventory.slots[i] = null;
      p.inventory.changed();
      if (this.round % 3 === 0 && this.alive.length > 1 && this.you.alive) this.net.reward(3, `manche ${this.round}`);
      this.newFloor();
      this.phase = 'dance';
      this.phaseT = 3 + Math.random() * 3;
    }
  }
  think(b: Bot, _part: Part, dt: number) {
    if (this.phase === 'dance') {
      // danse : petits déplacements au hasard
      let g = this.goals.get(b);
      if (!g || Math.hypot(g.x - b.x, g.z - b.z) < 0.8) {
        g = { x: BLOCKPARTY.x + (Math.random() - 0.5) * 18, z: BLOCKPARTY.z + (Math.random() - 0.5) * 18, react: 0 };
        this.goals.set(b, g);
      }
      b.ai.moveTowards(g.x, g.z, 0.8, false);
      if (b.body.onGround && Math.random() < dt * 0.6) b.body.vy = 8;
      return;
    }
    if (this.phase === 'drop') return b.ai.stop();
    let g = this.goals.get(b);
    if (!g) {
      // case de la bonne couleur la plus proche (les moins bons visent parfois mal)
      let best: [number, number] | null = null, bd = Infinity;
      for (let j = 0; j < this.n; j++)
        for (let i = 0; i < this.n; i++) {
          if (this.pattern[j * this.n + i] !== this.color) continue;
          const x = BLOCKPARTY.x - BLOCKPARTY.half + i + 0.5, z = BLOCKPARTY.z - BLOCKPARTY.half + j + 0.5;
          const d = Math.hypot(x - b.x, z - b.z) + Math.random() * (1 - b.skill) * 6;
          if (d < bd) {
            bd = d;
            best = [x, z];
          }
        }
      const miss = Math.random() < 0.08 + this.round * 0.012 - b.skill * 0.08;
      g = best && !miss ? { x: best[0], z: best[1], react: 0.25 + (1 - b.skill) * 0.7 } : { x: b.x + (Math.random() - 0.5) * 6, z: b.z + (Math.random() - 0.5) * 6, react: 0.8 };
      this.goals.set(b, g);
    }
    if ((g.react -= dt) > 0) return b.ai.stop();
    if (Math.hypot(g.x - b.x, g.z - b.z) > 0.35 && this.colorAt(b.x, b.z) !== this.color) b.ai.moveTowards(g.x, g.z, 1.3, false);
    else b.ai.stop();
  }
  sidebar() {
    return [...super.sidebar().slice(0, 3), `§fManche : §d${this.round}`, `§fTemps de course : §e${this.callTime.toFixed(1)} s`];
  }
}

// ---------- BedWars ----------
const BW_SHOP: [string, number, number][] = [
  ['white_wool', 16, 4], ['oak_planks', 16, 12], ['end_stone', 12, 24], ['stone_sword', 1, 10], ['iron_sword', 1, 35],
  ['wooden_pickaxe', 1, 10], ['iron_pickaxe', 1, 30], ['shears', 1, 20], ['chainmail_chestplate', 1, 24], ['iron_chestplate', 1, 40],
  ['golden_apple', 1, 12], ['bow', 1, 24], ['arrow', 8, 6], ['ender_pearl', 1, 45],
];
class BedWars extends MiniGame {
  protected box = { x0: BEDWARS.x - 34, z0: BEDWARS.z - 34, x1: BEDWARS.x + 34, z1: BEDWARS.z + 34 };
  private team = new Map<Part, number>();
  private beds = BEDWARS_TEAMS.map(() => true);
  private bedId = BlockRegistry.has('red_bed') ? BlockRegistry.byName('red_bed').id : B.OAK_PLANKS;
  private genT = 0;
  private supplyT = 0;
  private plan = new Map<Bot, number>();
  /** Moment où l'attaquant quitte son île (après ses premiers achats). */
  private depart = new Map<Bot, number>();
  private shopNpc: Bot | null = null;
  setup() {
    const w = this.s.world;
    buildBedWarsBeds((x, y, z, b, m) => void w.setBlock(x, y, z, b, m ?? 0));
    const per = 2;
    BEDWARS_TEAMS.forEach((t, ti) => {
      const isl = bedwarsIsland(ti);
      const wool = BlockRegistry.has(`${t.wool}_wool`) ? BlockRegistry.byName(`${t.wool}_wool`).id : B.OAK_PLANKS;
      for (let k = 0; k < per; k++) {
        const ox = (k - 0.5) * 1.6 * (t.dz !== 0 ? 1 : 0), oz = (k - 0.5) * 1.6 * (t.dx !== 0 ? 1 : 0);
        if (ti === 0 && k === 0) {
          this.team.set(this.you, 0);
          this.net.teleportPlayer(isl.spawn[0] + ox, isl.spawn[1], isl.spawn[2] + oz, Math.atan2(-t.dx, -t.dz));
          this.s.player.spawn = [...isl.spawn];
          continue;
        }
        const b = this.net.gameBot(isl.spawn[0] + ox, isl.spawn[1], isl.spawn[2] + oz);
        b.blockId = wool;
        b.blocks = 24;
        b.weapon = 'wooden_sword';
        b.setTag(`${t.color}§l${t.name[0]} §r${t.color}${b.botName}`);
        const part = { bot: b, name: b.botName, alive: true, kills: 0 };
        this.parts.push(part);
        this.team.set(part, ti);
        // rôle : un défenseur et un attaquant par équipe (votre coéquipier défend votre lit)
        this.plan.set(b, ti === 0 || k === 0 ? 1 : 0);
        this.depart.set(b, 18 + Math.random() * 25);
      }
    });
    // marchand sur l'île du joueur
    const isl = bedwarsIsland(0), t = BEDWARS_TEAMS[0];
    const sx = isl.x + (t.dz !== 0 ? 3 : 0) + 0.5, sz = isl.z + (t.dx !== 0 ? 3 : 0) + 0.5;
    this.shopNpc = this.net.gameBot(sx, FLOOR + 1, sz);
    this.shopNpc.npc = 'bw_shop';
    this.shopNpc.invulnerable = true;
    this.shopNpc.setTag('§e§lMARCHAND\n§7Payez en lingots de fer\n§a▶ Toucher');
    const inv = this.s.player.inventory;
    inv.slots[0] = makeStack('wooden_sword', 1);
    if (BlockRegistry.has('red_wool')) inv.slots[1] = makeStack('red_wool', 16);
    inv.slots[8] = makeStack('red_bed', 1);
    inv.armor.chest = makeStack('leather_chestplate', 1);
    inv.armor.legs = makeStack('leather_leggings', 1);
    this.net.chat('§7Vous êtes dans l’équipe §c§lRouge§7. Le §egénérateur de fer§7 est sur votre île, le §emarchand§7 à côté.');
  }
  protected keyPoints(): [number, number][] {
    return BEDWARS_TEAMS.map((_, i): [number, number] => {
      const isl = bedwarsIsland(i);
      return [isl.bed[1][0], isl.bed[1][2]];
    });
  }
  protected hold() {
    super.hold(0);
  }
  center() {
    return { x: BEDWARS.x, y: FLOOR, z: BEDWARS.z };
  }
  protected fallY() {
    return BEDWARS.outY;
  }
  protected ally(a: Part, b: Part) {
    return this.team.get(a) === this.team.get(b);
  }
  interact(npc: string) {
    if (npc !== 'bw_shop') return false;
    const inv = this.s.player.inventory;
    this.s.game.openServerShop?.(BW_SHOP.filter(([id]) => ItemRegistry.has(id)).map(([id, n, price]) => [id === 'white_wool' && ItemRegistry.has('red_wool') ? 'red_wool' : id, n, price]), () => inv.count('iron_ingot'), (id, n, price) => {
      if (inv.count('iron_ingot') < price) return false;
      inv.remove('iron_ingot', price);
      const def = ItemRegistry.get(id);
      const slot = def?.armor?.slot;
      if (slot && !inv.armor[slot]) inv.armor[slot] = makeStack(id, 1);
      else {
        const left = inv.add(makeStack(id, n));
        if (left > 0) this.s.entities.spawnItem(id, left, this.s.player.x, this.s.player.y + 1, this.s.player.z);
      }
      inv.changed();
      return true;
    });
    return true;
  }
  canEdit(x: number, y: number, z: number, action: 'break' | 'place', b: number) {
    if (this.state !== 'playing' || !this.you.alive) return false;
    if (Math.abs(x - BEDWARS.x) > 33 || Math.abs(z - BEDWARS.z) > 33 || y > FLOOR + 18) return false;
    if (action === 'place') return true;
    if (b === this.bedId) {
      const own = bedwarsIsland(0).bed.some((c) => c[0] === x && c[1] === y && c[2] === z);
      if (own) this.s.hud.showTitle('§cVous ne pouvez pas casser votre propre lit !', 'actionbar');
      return !own;
    }
    // seuls les blocs posés pendant la partie se cassent
    return this.journal.get(`${x},${y},${z}`) === B.AIR;
  }
  private teamAlive(ti: number) {
    return [...this.team].some(([p, t]) => t === ti && p.alive);
  }
  private destroyBed(ti: number, by: Part | null) {
    if (!this.beds[ti]) return;
    this.beds[ti] = false;
    const w = this.s.world, t = BEDWARS_TEAMS[ti];
    for (const c of bedwarsIsland(ti).bed) {
      if (w.getBlock(c[0], c[1], c[2]) === this.bedId) w.setBlock(c[0], c[1], c[2], B.AIR);
      this.s.particles.burst('explosion', c[0] + 0.5, c[1] + 0.5, c[2] + 0.5, 8);
    }
    // pas de lit ramassé (l'objet lit sert à quitter la partie)
    for (const e of this.s.entities.entities) if (e.kind === 'item' && Math.hypot(e.x - bedwarsIsland(ti).bed[0][0], e.z - bedwarsIsland(ti).bed[0][2]) < 4) e.removed = true;
    const who = by ? (by.bot ? by.bot.chatName : '§aVous') : '§7quelqu’un';
    this.net.chat(`§f§lDESTRUCTION DE LIT > §r${t.color}Lit de l’équipe ${t.name} §7détruit par ${who}§7 !`);
    this.s.audio.play('thunder', { volume: 0.4 });
    if (ti === 0) this.net.title('§c§lLIT DÉTRUIT !', '§7Vous ne réapparaîtrez plus');
    if (by === this.you) this.net.reward(20, 'lit détruit');
  }
  protected tick(dt: number) {
    const w = this.s.world, p = this.s.player;
    // lits cassés (par le joueur ou un bot)
    this.beds.forEach((alive, ti) => {
      if (!alive) return;
      if (bedwarsIsland(ti).bed.some((c) => w.getBlock(c[0], c[1], c[2]) !== this.bedId)) {
        let by: Part | null = null, bd = 6;
        for (const part of this.alive) {
          if (this.team.get(part) === ti) continue;
          const e = part.bot ?? p;
          const d = Math.hypot(e.x - bedwarsIsland(ti).bed[0][0], e.z - bedwarsIsland(ti).bed[0][2]);
          if (d < bd) {
            bd = d;
            by = part;
          }
        }
        this.destroyBed(ti, by);
      }
    });
    // générateur de fer de l'île du joueur
    this.genT -= dt;
    if (this.genT <= 0) {
      this.genT = 1.6;
      const isl = bedwarsIsland(0), t = BEDWARS_TEAMS[0];
      this.s.entities.spawnItem('iron_ingot', 1, isl.x - t.dx * 4 + 0.5, FLOOR + 1.2, isl.z - t.dz * 4 + 0.5);
    }
    // les bots « achètent » blocs et armes avec leur fer
    this.supplyT -= dt;
    if (this.supplyT <= 0) {
      this.supplyT = 7;
      for (const part of this.alive) {
        const b = part.bot;
        if (!b) continue;
        b.blocks = Math.min(64, b.blocks + 12);
        if (this.elapsed > 50 && b.weapon === 'wooden_sword') b.weapon = 'stone_sword';
        if (this.elapsed > 140 && b.weapon === 'stone_sword' && Math.random() < b.skill) {
          b.weapon = 'iron_sword';
          b.armorFactor = armorFactor(8);
        }
        if (this.elapsed > 90 && b.gapples < 1 && Math.random() < 0.3) b.gapples = 1;
      }
    }
  }
  /** Mort avec le lit intact : réapparition sur son île (pas d'élimination). */
  eliminate(part: Part, by: Bot | 'player' | null, cause: 'void' | 'killed') {
    const ti = this.team.get(part) ?? 0;
    if (!part.alive || !this.beds[ti]) {
      const before = part.alive;
      super.eliminate(part, by, cause);
      if (before) this.net.chat('§b§lÉLIMINATION FINALE !');
      return;
    }
    const killer = by === 'player' ? this.you : by ? this.parts.find((x) => x.bot === by) ?? null : null;
    if (killer && killer !== part) killer.kills++;
    const name = part.bot ? part.bot.chatName : '§aVous';
    this.net.chat(killer && killer !== part ? `${name} §7a été tué par ${killer.bot ? killer.bot.chatName : '§aVous'}§7.` : `${name} §7${cause === 'void' ? 'est tombé dans le vide' : 'est mort'}.`);
    if (killer === this.you && part !== this.you) this.net.reward(4, 'élimination');
    const sp = bedwarsIsland(ti).spawn;
    if (part.bot) {
      const b = part.bot;
      b.dead = false;
      b.deathTimer = 0;
      b.health = b.maxHealth;
      b.body.setPos(sp[0], sp[1], sp[2]);
      b.body.vx = b.body.vy = b.body.vz = 0;
      b.body.fallDistance = 0;
      b.lastAttacker = null;
    } else {
      const p = this.s.player;
      if (p.dead) p.respawn();
      p.health = 20;
      this.net.teleportPlayer(sp[0], sp[1], sp[2]);
      this.net.title('§c§lVOUS ÊTES MORT', '§eRéapparition sur votre île');
    }
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
  checkEnd() {
    const teams = BEDWARS_TEAMS.map((_, i) => i).filter((i) => this.teamAlive(i));
    if (teams.length > 1) return;
    const win = teams[0];
    if (win === undefined) return this.finish(null);
    this.finish(win === 0 ? this.you : [...this.team].find(([p, t]) => t === win && p.alive)?.[0] ?? null);
  }
  think(b: Bot, part: Part, dt: number) {
    const ti = this.team.get(part) ?? 0;
    const home = bedwarsIsland(ti);
    const foe = this.nearestFoe(b, part);
    const near = foe && Math.abs(foe.f.y - b.y) < 3 && Math.hypot(foe.f.x - b.x, foe.f.z - b.z) < 7;
    if (near) {
      b.fight(this.s, foe!.f, dt, (dmg, kx, kz) => this.strike(b, foe!.part, dmg, kx, kz));
      return;
    }
    // défenseur : reste près de son lit tant qu'il existe
    if (this.plan.get(b) === 1 && this.beds[ti]) {
      const [bx, , bz] = home.bed[0];
      if (Math.hypot(bx + 0.5 - b.x, bz + 0.5 - b.z) > 3) b.goTo(bx + 0.5, FLOOR + 1, bz + 0.5);
      else b.ai.stop();
      return;
    }
    // début de partie : achats au générateur de son île
    if (this.elapsed < (this.depart.get(b) ?? 0)) {
      const t = BEDWARS_TEAMS[ti];
      const gx = home.x - t.dx * 3 + 0.5, gz = home.z - t.dz * 3 + 0.5;
      if (Math.hypot(gx - b.x, gz - b.z) > 1.5) b.goTo(gx, FLOOR + 1, gz);
      else b.ai.stop();
      return;
    }
    // attaquant : vise le lit adverse le plus proche, sinon le joueur adverse le plus proche
    let target: [number, number, number] | null = null, td = Infinity;
    this.beds.forEach((alive, i) => {
      if (!alive || i === ti) return;
      const c = bedwarsIsland(i).bed[0];
      const d = Math.hypot(c[0] - b.x, c[2] - b.z);
      if (d < td) {
        td = d;
        target = c;
      }
    });
    if (target) {
      const [tx, ty, tz] = target as [number, number, number];
      if (td < 2.6) {
        // casse les deux moitiés du lit
        for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]])
          if (this.s.world.getBlock(tx + dx, ty, tz + dz) === this.bedId && Math.random() < dt * 2.5) b.breakBlock(this.s, tx + dx, ty, tz + dz);
        b.ai.stop();
        return;
      }
      if (b.blocks > 0) b.bridgeTo(this.s, tx + 0.5, tz + 0.5, FLOOR + 1);
      else b.goTo(tx + 0.5, FLOOR + 1, tz + 0.5, true);
      return;
    }
    if (foe) {
      if (b.blocks > 0 && Math.abs(foe.f.y - b.y) < 4) b.bridgeTo(this.s, foe.f.x, foe.f.z, Math.floor(b.y));
      else b.goTo(foe.f.x, foe.f.y, foe.f.z, true);
    }
  }
  dispose() {
    if (this.shopNpc) this.net.release(this.shopNpc);
    super.dispose();
  }
  sidebar() {
    const lines = [`§fJeu : §cBedWars`, this.state === 'countdown' ? `§fDébut dans §a${Math.ceil(this.timer)} s` : `§fTemps : §a${fmt(this.elapsed)}`, ''];
    BEDWARS_TEAMS.forEach((t, i) => {
      const n = [...this.team].filter(([p, k]) => k === i && p.alive).length;
      lines.push(`${t.color}${t.name[0]} §f${t.name} ${this.beds[i] ? '§a✔' : n ? `§e${n}` : '§c✘'}${i === 0 ? ' §7(vous)' : ''}`);
    });
    lines.push('', `§fÉliminations : §a${this.you.kills}`, `§fFer : §7${this.s.player.inventory.count('iron_ingot')}`);
    return lines;
  }
}
