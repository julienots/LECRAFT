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
  BEDWARS, BEDWARS_TEAMS, BLOCKPARTY, BLOCKPARTY_COLORS, BRIDGE, BRIDGE_TEAMS, DUELS, FLOOR, HUB, HUB_NPCS, HUB_PARKOUR_CHECKS, HUB_SERVICES, MURDER, PARKOUR, PILLARS, SKYWARS, SPLEEF, SUMO, TNTRUN, TNTTAG,
  bedwarsIsland, blockPartyPattern, bridgeBase, buildBedWarsBeds, buildBlockPartyFloor, buildSpleefFloor, buildTntRunLayers, hubParkour,
  murderSpots, parkourCourse, pillarPositions, skywarsCenterChests, skywarsIslands, type GameKey,
} from './ServerMaps';
import { ServerHud, type TabEntry } from '../ui/ServerHud';
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
  /** Récompense quotidienne : dernier retrait (ms) et série de jours. */
  lastDaily?: number;
  dailyStreak?: number;
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
  murder: { name: 'Murder Mystery', color: '§4', desc: 'Un meurtrier se cache parmi vous. Innocent : survivez et ramassez de l’or. Détective : démasquez-le à l’arc.', players: 8 },
  bridge: { name: 'The Bridge', color: '§9', desc: '2 contre 2 sur un pont : sautez dans le trou adverse pour marquer. 3 buts pour gagner.', players: 4 },
  tnttag: { name: 'TNT Tag', color: '§c', desc: 'Patate chaude explosive : frappez quelqu’un pour lui passer la TNT avant qu’elle explose !', players: 10 },
  pillars: { name: 'Piliers de la Chance', color: '§5', desc: 'Chacun sur un pilier au-dessus du vide reçoit des objets au hasard. Construisez, combattez, survivez !', players: 8 },
};
/** Jeux ajoutés récemment (étiquette « NOUVEAU » sur les PNJ et dans le menu). */
export const NEW_GAMES: GameKey[] = ['murder', 'bridge', 'tnttag', 'pillars'];

// ---------- pseudos et messages des bots ----------
const P1 = ['Pixel', 'Dark', 'Mega', 'Ultra', 'Shadow', 'Creeper', 'Diamond', 'Ender', 'Blaze', 'Frost', 'Turbo', 'Nova', 'Lucky', 'Crafty', 'Epic', 'Ninja', 'Lava', 'Sky', 'Iron', 'Golden', 'Kevin', 'Mathis', 'Lucas', 'Emma', 'Lea', 'Hugo', 'Nathan', 'Chloe', 'Tom', 'Jade'];
const P2 = ['Master', 'King', 'Hunter', 'Miner', 'Gamer', 'Wolf', 'Fox', 'Builder', 'Slayer', 'Warrior', 'Dragon', 'Panda', 'Craft', 'PvP', 'Pro', 'Bow', 'Blade', 'Rush', 'Cube', 'Block'];
const HUB_CHAT = ['salut tout le monde', 'qui veut duel ?', 'quelqu’un en SkyWars ?', 'le spleef c’est trop bien', 'je suis nouveau ici', 'comment on va au parkour ?', 'mdr', 'go TNT Run', 'j’ai gagné 3 parties d’affilée !', 'bonjour !', 'le parkour est dur au 4e point de contrôle', 'gg à tous', 'qui a le meilleur temps au parkour ?', 'je farm les pièces', 'quelqu’un pour une partie ?',
  'go bedwars', 'qui veut faire une team bedwars ?', 'le murder mystery est trop bien', 'qui a été meurtrier 3 fois de suite ?', 'go the bridge 2v2', 'j’ai marqué 3 buts au bridge', 'tnt tag c’est le chaos mdr', 'j’ai eu un arc en diamant aux piliers', 'la récompense quotidienne donne des pièces', 'le portail violet lance une partie rapide', 'vous avez vu le double saut ?', 'j’ai eu un chapeau légendaire dans une boîte mystère !!', 'le block party c’est trop dur au round 10', 'vous avez vu mon compagnon ?', 'hypxl c’est le meilleur serveur', 'quelqu’un a le rang MVP+ ?', 'trop beau le nouveau spawn', 'sumo 1v1 ?', 'la fontaine est trop belle', 'j’ai fini le parkour du hub en 20 s', 'les traînées de flammes c’est stylé', 'qui veut mes pièces mdr', 'lobby 3 > tous les autres', 'gg pour la partie de skywars'];
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
  [HUB_SERVICES.parkourStart.x, HUB_SERVICES.parkourStart.z + 2], [HUB_SERVICES.daily.x + 2, HUB_SERVICES.daily.z - 3], [0, HUB_SERVICES.portal.z + 4], [0, 40], [6, 34], [-6, 34], [28, 28], [-28, -28], [30, -30], [-34, 30],
];

/** Gadgets du hub (objet en main → effet). */
const GADGET_ITEM: Record<string, string> = { firework: 'firework_rocket', confetti: 'paper', leap: 'ender_pearl', storm: 'blaze_rod' };

export class ServerNetwork {

  /** Minuteries annulées en quittant le serveur (pas de messages ni d'effets après la sortie). */
  private timers = new Set<ReturnType<typeof setTimeout>>();
  later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }
  /** Sortie du serveur : partie en cours restaurée, minuteries annulées. */
  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.game?.dispose();
    this.game = null;
    this.hud?.dispose();
    this.hud = null;
  }
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
  /** Barre de boss et liste des joueurs (Tab). */
  private hud: ServerHud | null = null;
  private barTimer = 0;
  private barIndex = 0;
  private npcTagTimer = 6;
  private holoWins: Bot | null = null;
  private holoCoins: Bot | null = null;
  private holoParkour: Bot | null = null;
  /** Double saut du hub : prêt après avoir relâché la touche en l'air. */
  private djReady = false;
  private djUsed = false;
  private portalCooldown = 0;
  private portalFx = 0;
  /** Dernier point de contrôle atteint au parcours du hub (indice dans le parcours). */
  private parkourCheck = 0;
  /** Rôle imposé à la prochaine partie de Murder Mystery (tests). */
  nextRole: 'innocent' | 'detective' | 'murderer' | null = null;

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
    this.chat(`§7  ${Object.keys(GAMES).length} mini-jeux · ${COSMETICS.length} cosmétiques · des milliers de joueurs`);
    this.chat('§b  NOUVEAU : §4Murder Mystery§b, §9The Bridge§b, §cTNT Tag§b, §5Piliers de la Chance §b!');
    this.chat('§7  §eBoussole§7 : jeux · §eLivre§7 : profil · §eÉmeraude§7 : cosmétiques');
    this.chat('§7  §eHorloge§7 : récompense · §eÉtoile§7 : lobbys · §eTab§7 : joueurs');
    this.chat('§8  /menu /cosmetiques /profil /lobby /list /recompense');
    this.chat('§6§l▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬');
    if (!this.profile.welcome) {
      this.profile.welcome = true;
      this.profile.coins += 1000;
      this.chat('§a§l+1000 pièces §r§a: cadeau de bienvenue ! Essayez une §dboîte mystère§a.');
      this.saveProfile();
    }
    this.hud = new ServerHud();
    for (const n of HUB_NPCS) {
      const npc = this.spawnBot(n.x + 0.5, FLOOR + 2, n.z + 0.5, 1);
      npc.npc = n.game;
      npc.tagScale = 1.25;
      this.npcs.push(npc);
      npc.invulnerable = true;
    }
    this.refreshNpcTags();
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
    service('smp', HUB_SERVICES.smp.x, HUB_SERVICES.smp.z, '§2§lSURVIE MODDÉE\n§7LeCraft SMP\n§a▶ Clic pour rejoindre');
    service('daily', HUB_SERVICES.daily.x, HUB_SERVICES.daily.z, '§6§lRÉCOMPENSE QUOTIDIENNE\n§7Des pièces chaque jour\n§a▶ Clic pour réclamer');
    // hologrammes : accueil, classements (victoires, pièces), parcours du hub, portail
    this.hologram(HUB.spawn.x, FLOOR + 2.2, HUB.spawn.z - 6, `§e§lBIENVENUE SUR §6§lHYPXL\n§7Le serveur de mini-jeux n°1\n§b${Object.keys(GAMES).length} jeux §7· §d${COSMETICS.length} cosmétiques §7· §a${SERVER_IP}\n§fDouble saut : §eappuyez deux fois sur saut`);
    const lb = HUB_SERVICES.leaderboard;
    this.holoWins = this.hologram(lb.x - 4.5, FLOOR + 1, lb.z + 0.6, this.leaderboardText('wins'), 1.6);
    this.holoCoins = this.hologram(lb.x + 5.5, FLOOR + 1, lb.z + 0.6, this.leaderboardText('coins'), 1.6);
    this.holoParkour = this.hologram(HUB_SERVICES.parkourStart.x + 0.5, FLOOR + 1, HUB_SERVICES.parkourStart.z + 0.5, this.leaderboardText('parkour'), 1.3);
    const P = HUB_SERVICES.portal;
    this.hologram(HUB.x + 0.5, P.y1 + 2.6, HUB.z + P.z + 0.5, '§d§lPARTIE RAPIDE\n§7Entrez dans le portail : un jeu au hasard', 1.6);
    this.toHub(true);
    this.title('§6§lHYPXL', `§eBienvenue, ${this.rankPrefix()}${this.s.player.name}§e !`);
  }

  /** Hologrammes des PNJ de jeux : nom, joueurs, nombre en jeu (actualisé), « clic pour jouer ». */
  private refreshNpcTags() {
    for (const npc of this.npcs) {
      const k = npc.npc as GameKey;
      const g = GAMES[k];
      if (!g) continue;
      const fresh = NEW_GAMES.includes(k) ? '§b§lNOUVEAU ! ' : '';
      npc.setTag(`${fresh}${g.color}§l${g.name.toUpperCase()}\n§7${k === 'parkour' ? 'Solo' : `${g.players} joueurs`} · §e${this.gameOnline(k).toLocaleString('fr-FR')} en jeu\n§e§l▶ CLIC POUR JOUER`);
    }
  }

  /** Joueurs « en jeu » affichés pour un mini-jeu (part de la population du réseau). */
  gameOnline(k: GameKey) {
    const share: Record<GameKey, number> = { bedwars: 0.26, skywars: 0.15, duels: 0.1, sumo: 0.04, blockparty: 0.05, tntrun: 0.04, spleef: 0.02, parkour: 0.02, murder: 0.09, bridge: 0.06, tnttag: 0.04, pillars: 0.03 };
    return Math.round(this.online * share[k] * (0.92 + ((this.online >> 3) % 17) / 100));
  }

  private hologram(x: number, y: number, z: number, text: string, scale = 1) {
    const b = this.spawnBot(x, y, z, 1);
    b.npc = 'hologram';
    b.invulnerable = true;
    b.tagScale = scale;
    b.setTag(text);
    b.object3d.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.visible = false;
    });
    b.body.gravity = 0;
    this.holograms.push(b);
    return b;
  }

  /** Classements holographiques (joueurs du réseau fixes + le joueur) : victoires, pièces, parcours du hub. */
  leaderboardText(kind: 'wins' | 'coins' | 'parkour') {
    const r = new Rng(4242);
    const top = Array.from({ length: 9 }, () => ({ name: `${r.pick(['§b[MVP§c+§b] ', '§b[MVP] ', '§a[VIP§6+§a] ', '§a[VIP] ', '§6[YOUTUBE] '])}${r.pick(P1)}${r.pick(P2)}`, wins: r.int(800, 9000), coins: r.int(40000, 900000), parkour: 14 + r.next() * 22 }));
    const me = `${this.rankPrefix()}${this.s.player.name} §a(vous)`;
    const mine = { name: me, wins: Object.values(this.profile.wins).reduce((a, n) => a + (n ?? 0), 0), coins: this.profile.coins, parkour: this.profile.bestHubParkour ?? Infinity };
    const all = [...top, mine];
    const medal = (i: number) => ['§6§l1.', '§f§l2.', '§c§l3.'][i] ?? `§e${i + 1}.`;
    if (kind === 'parkour') {
      all.sort((a, b) => a.parkour - b.parkour);
      const rows = all.filter((x) => x.parkour < Infinity).slice(0, 5).map((x, i) => `${medal(i)} ${x.name} §7- §e${x.parkour.toFixed(2)} s`);
      return ['§a§lPARCOURS DU HUB', '§7Bloc d’or : départ · §bdiamant§7 : contrôle', ...rows, `§fVotre record : §e${this.profile.bestHubParkour ? this.profile.bestHubParkour.toFixed(2) + ' s' : '-'}`].join('\n');
    }
    const key = kind;
    all.sort((a, b) => b[key] - a[key]);
    const rows = all.slice(0, 8).map((x, i) => `${medal(i)} ${x.name} §7- §e${x[key].toLocaleString('fr-FR')}`);
    const rank = all.findIndex((x) => x === mine);
    if (rank >= 8) rows.push(`§7… §e${rank + 1}. ${me} §7- §e${mine[key].toLocaleString('fr-FR')}`);
    return [kind === 'wins' ? '§e§lMEILLEURS JOUEURS §7(victoires)' : '§6§lPLUS RICHES §7(pièces)', ...rows].join('\n');
  }

  private refreshLeaderboards() {
    this.holoWins?.setTag(this.leaderboardText('wins'));
    this.holoCoins?.setTag(this.leaderboardText('coins'));
    this.holoParkour?.setTag(this.leaderboardText('parkour'));
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
  /** Badge de niveau du chat (couleur selon le niveau). */
  static levelBadge(l: number) {
    const c = l >= 150 ? '§c' : l >= 100 ? '§6' : l >= 50 ? '§d' : l >= 25 ? '§b' : l >= 10 ? '§a' : '§7';
    return `${c}[${l}✫] `;
  }
  botSay(b: Bot, text: string) {
    this.chat(`${ServerNetwork.levelBadge(b.level)}${b.chatName}§f: ${b.rank.tag ? '§f' : '§7'}${text}`);
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
    put(6, 'clock');
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
    this.parkourRun = null;
    this.portalCooldown = 2;
    this.refreshLeaderboards();
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
        this.later(roll, 70 + i * 14);
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
    return `${ServerNetwork.levelBadge(this.level)}${r ? r.value.split('|')[0] : ''}${nameColor}${this.s.player.name}§f: ${this.chatColor()}${text}`;
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

  /** Parcours du hub : départ sur le bloc d'or, points de contrôle en diamant, arrivée sur l'émeraude. */
  private hubParkourTick(dt: number) {
    const p = this.s.player;
    const course = hubParkour();
    if (this.parkourRun) this.parkourRun.t += dt;
    if (p.body.onGround) {
      const fx = Math.floor(p.x), fy = Math.floor(p.y - 0.2), fz = Math.floor(p.z);
      const i = course.findIndex((c) => c.x === fx && c.y === fy && c.z === fz);
      if (i === 0 && (!this.parkourRun || this.parkourRun.next > 1)) {
        this.parkourRun = { t: 0, next: 1 };
        this.parkourCheck = 0;
        this.chat('§aParcours du hub démarré ! §7Atteignez le bloc d’émeraude en haut de la tour. §8(chute : retour au dernier point de contrôle)');
        this.s.audio.play('click', { volume: 0.5 });
      } else if (this.parkourRun && i >= this.parkourRun.next) {
        this.parkourRun.next = i + 1;
        if (HUB_PARKOUR_CHECKS.includes(i) && i > this.parkourCheck) {
          this.parkourCheck = i;
          this.chat(`§bPoint de contrôle ${HUB_PARKOUR_CHECKS.indexOf(i) + 1}/${HUB_PARKOUR_CHECKS.length} §7(${this.parkourRun.t.toFixed(2)} s)`);
          this.s.audio.play('levelup', { volume: 0.3 });
          this.s.particles.burst('happy', p.x, p.y + 0.5, p.z, 10);
        }
        if (i === course.length - 1) {
          const t = this.parkourRun.t;
          this.parkourRun = null;
          this.title('§a§lPARCOURS RÉUSSI !', `§f${t.toFixed(2)} s`);
          this.s.particles.burst('totem', p.x, p.y + 1, p.z, 30);
          if (!this.profile.bestHubParkour || t < this.profile.bestHubParkour) {
            this.profile.bestHubParkour = t;
            this.chat(`§a§lNOUVEAU RECORD DU HUB : §f${t.toFixed(2)} s`);
            this.reward(20, 'record du parcours du hub');
          } else this.saveProfile();
          this.refreshLeaderboards();
        }
      }
    }
    if (this.parkourRun) {
      this.s.hud.showTitle(`§e${this.parkourRun.t.toFixed(1)} s §7· bloc ${this.parkourRun.next}/${course.length}${this.parkourCheck ? ` §7· §bcontrôle ${HUB_PARKOUR_CHECKS.indexOf(this.parkourCheck) + 1}` : ''}`, 'actionbar');
      const fy = Math.floor(p.y - 0.2);
      const onCourse = course.some((c) => c.x === Math.floor(p.x) && c.y === fy && c.z === Math.floor(p.z));
      const fell = p.y < FLOOR - 2 || (p.body.onGround && !onCourse && p.y < course[Math.max(0, this.parkourRun.next - 1)].y + 0.5);
      if (fell && this.parkourRun.next > 1) {
        if (this.parkourCheck > 0) {
          // chute : retour au dernier point de contrôle (le chrono continue)
          const c = course[this.parkourCheck];
          this.teleport(c.x + 0.5, c.y + 1, c.z + 0.5);
          this.parkourRun.next = this.parkourCheck + 1;
          this.s.hud.showTitle('§bRetour au point de contrôle', 'actionbar');
        } else {
          this.parkourRun = null;
          this.s.hud.showTitle('§cParcours annulé', 'actionbar');
        }
      }
    }
  }

  /** Double saut du hub : une impulsion en l'air (comme sur les grands serveurs). */
  private doubleJumpTick() {
    const p = this.s.player, b = p.body, jump = this.s.game.input.jump;
    if (b.onGround || b.flying || b.inWater) {
      this.djReady = false;
      this.djUsed = false;
      return;
    }
    if (!jump) this.djReady = !this.djUsed;
    else if (this.djReady && !this.parkourRun && p.gameMode !== 'creative') {
      this.djReady = false;
      this.djUsed = true;
      const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw);
      b.vx = dx * 11;
      b.vz = dz * 11;
      b.vy = 12;
      b.fallDistance = 0;
      this.s.particles.burst('poof', p.x, p.y, p.z, 12);
      this.s.audio.play('paper_whoosh', { volume: 0.5 });
    }
  }

  /** Portail « Partie rapide » : particules, et un jeu au hasard quand on le traverse. */
  private portalTick(dt: number) {
    const P = HUB_SERVICES.portal, p = this.s.player;
    this.portalCooldown -= dt;
    this.portalFx -= dt;
    if (this.portalFx <= 0 && Math.hypot(p.x - HUB.x, p.z - (HUB.z + P.z)) < 40) {
      this.portalFx = 0.05;
      for (let i = 0; i < 4; i++) this.s.particles.burst(i ? 'portal' : 'magic', HUB.x + P.x0 + Math.random() * (P.x1 - P.x0 + 1), P.y0 + Math.random() * (P.y1 - P.y0 + 1), HUB.z + P.z + 0.5, 2);
    }
    if (this.portalCooldown > 0) return;
    if (p.x >= HUB.x + P.x0 && p.x < HUB.x + P.x1 + 1 && Math.abs(p.z - (HUB.z + P.z + 0.5)) < 0.8 && p.y < P.y1 + 1) {
      this.portalCooldown = 3;
      const pool = (Object.keys(GAMES) as GameKey[]).filter((k) => k !== 'parkour');
      const k = this.rng.pick(pool);
      this.chat(`§d§lPARTIE RAPIDE §r§7→ ${GAMES[k].color}${GAMES[k].name}`);
      this.s.audio.play('teleport', { volume: 0.4 });
      this.join(k);
    }
  }

  /** Récompense quotidienne : pièces selon la série de jours (une fois toutes les 20 h). */
  claimDaily(): boolean {
    const now = Date.now(), last = this.profile.lastDaily ?? 0;
    const wait = last + 20 * 3600e3 - now;
    if (wait > 0) {
      const h = Math.floor(wait / 3600e3), m = Math.ceil((wait % 3600e3) / 60e3);
      this.chat(`§cRécompense déjà réclamée. §7Revenez dans §e${h} h ${m} min§7.`);
      this.s.audio.play('deny', { volume: 0.5 });
      return false;
    }
    const streak = now - last < 48 * 3600e3 ? (this.profile.dailyStreak ?? 0) + 1 : 1;
    this.profile.dailyStreak = streak;
    this.profile.lastDaily = now;
    const coins = 100 + 25 * Math.min(streak - 1, 8);
    this.title('§6§lRÉCOMPENSE QUOTIDIENNE', `§e+${coins} pièces §7· série de ${streak} jour(s)`);
    this.reward(coins, `récompense quotidienne, jour ${streak}`);
    const p = this.s.player;
    this.s.particles.burst('totem', p.x, p.y + 1, p.z, 40);
    this.s.audio.play('achievement');
    this.refreshLeaderboards();
    return true;
  }

  /** Messages défilants de la barre de boss du hub. */
  private static BAR_MESSAGES = [
    '§e§lHYPXL §7| §fNOUVEAU : §4Murder Mystery§f, §9The Bridge§f, §cTNT Tag§f, §5Piliers§f !',
    '§fRécompense quotidienne : §6PNJ doré §fprès de l’entrée',
    '§fEntrez dans le §dportail violet §fau nord pour une §dpartie rapide',
    '§fBattez le record du §aparcours du hub §f(tour ouest) !',
    '§fDouble saut : §eappuyez deux fois sur saut §f· liste des joueurs : §eTab',
    '§fBoutique de §dcosmétiques §fà l’est · §5boîtes mystères',
  ];

  /** Barre de boss et liste des joueurs. */
  private hudTick(dt: number) {
    const hud = this.hud;
    if (!hud) return;
    if (this.game) {
      const [t, f] = this.game.bossbar();
      hud.setBar(t, f);
    } else {
      this.barTimer += dt;
      if (this.barTimer > 7) {
        this.barTimer = 0;
        this.barIndex = (this.barIndex + 1) % ServerNetwork.BAR_MESSAGES.length;
      }
      hud.setBar(ServerNetwork.BAR_MESSAGES[this.barIndex], 1 - this.barTimer / 7);
    }
    hud.update(dt, `§e§lHYPXL §r§7— §fVous jouez sur §6${SERVER_IP}`, `§7${this.game ? GAMES[this.game.key].name : `Lobby #${this.profile.lobby}`} §8· §a${this.online.toLocaleString('fr-FR')} joueurs en ligne §8· §dboutique.hypxl.net`, () => this.tabEntries());
  }

  /** Liste des joueurs (Tab) : rangs les plus hauts d'abord, puis niveau. */
  tabEntries(): TabEntry[] {
    const bots = this.game ? this.game.parts.filter((x) => x.bot).map((x) => x.bot!) : this.hubBots;
    const weight = (tag: string) => (tag.includes('MVP§c+') ? 4 : tag.includes('MVP') ? 3 : tag.includes('VIP§6+') ? 2 : tag.includes('VIP') ? 1 : 0);
    const r = this.equipped('rank');
    const me = { w: r ? 5 : 0, l: this.level, e: { name: `${ServerNetwork.levelBadge(this.level)}${this.rankPrefix()}${r ? r.value.split('|')[1] : '§7'}${this.s.player.name}`, ping: 1 } };
    const rows = bots.filter((b) => !b.removed).map((b) => ({ w: weight(b.rank.tag), l: b.level, e: { name: `${ServerNetwork.levelBadge(b.level)}${b.chatName}`, ping: b.ping } }));
    return [me, ...rows.sort((a, b) => b.w - a.w || b.l - a.l)].map((x) => x.e);
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
      // vide ou hors de l'île : retour au point d'apparition
      if (p.y < FLOOR - 12 || Math.hypot(p.x - HUB.x, p.z - HUB.z) > HUB.radius + 12) {
        this.teleport(HUB.spawn.x, HUB.spawn.y, HUB.spawn.z, HUB.spawn.yaw);
        this.s.hud.showTitle('§eRetour au point d’apparition', 'actionbar');
        this.parkourRun = null;
      }
      this.doubleJumpTick();
      this.portalTick(dt);
      this.npcTagTimer -= dt;
      if (this.npcTagTimer <= 0) {
        this.npcTagTimer = 6;
        this.refreshNpcTags();
      }
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
    this.hudTick(dt);
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
    if (npc === 'daily') {
      this.claimDaily();
      return true;
    }
    if (!(npc in GAMES)) return true;
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
      if (id === 'clock') return (this.claimDaily(), true);
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
      this.later(() => {
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
      a.play('paper_whoosh', { volume: 0.5 });
      this.gadgetCooldown = 4;
    } else if (kind === 'storm') {
      for (let i = 0; i < 6; i++) this.later(() => fx.burst('rain', p.x + (Math.random() - 0.5) * 6, p.y + 4, p.z + (Math.random() - 0.5) * 6, 20), i * 120);
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
    if (reply) this.later(() => !who.removed && this.botSay(who, reply!), 900 + Math.random() * 2200);
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
    if (cmd === '/list' || cmd === '/who' || cmd === '/joueurs') {
      this.hud?.showTab(8);
      this.chat(`§7Joueurs ici : §a${this.tabEntries().length} §7· réseau : §a${this.online.toLocaleString('fr-FR')}`);
      return true;
    }
    if (cmd === '/recompense' || cmd === '/récompense' || cmd === '/daily') {
      this.claimDaily();
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
    const Ctor = { skywars: SkyWars, spleef: Spleef, tntrun: TntRun, duels: Duel, parkour: Parkour, sumo: Sumo, blockparty: BlockParty, bedwars: BedWars, tnttag: TntTag, bridge: Bridge, murder: MurderMystery, pillars: Pillars }[key];
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
  /** Force la réapplication du chapeau cosmétique du joueur (après un chapeau de jeu). */
  refreshHat() {
    this.playerHatShown = '\u0000';
  }
  get textures() {
    return this.s.game.textures;
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
  /** Barre de boss pendant la partie : texte et remplissage. */
  bossbar(): [string, number] {
    const g = GAMES[this.key];
    if (this.state === 'countdown') return [`${g.color}§l${g.name.toUpperCase()} §7| §fdébut dans §e${Math.max(0, Math.ceil(this.timer))} s`, Math.max(0, Math.min(1, this.timer / 10))];
    return [`${g.color}§l${g.name.toUpperCase()} §7| §fsur §6${SERVER_IP}`, 1];
  }
  /** Texte d'une mort sans tueur (chute, explosion…). */
  protected deathText(cause: 'void' | 'killed'): string {
    return cause === 'void' ? 'est tombé dans le vide' : 'est mort';
  }
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
    this.net.chat(killer && killer !== part ? `${name} §7a été éliminé par ${kname}§7.` : `${name} §7${this.deathText(cause)}.`);
    if (killer === this.you && part !== this.you) {
      this.net.profile.kills++;
      this.net.reward(10, 'élimination');
      this.s.audio.play('levelup', { volume: 0.3 });
    }
    if (killer?.bot && Math.random() < 0.4) this.net.botSay(killer.bot, this.net.pick(KILL_CHAT));
    if (part.bot) {
      if (Math.random() < 0.3) this.net.botSay(part.bot, this.net.pick(DEATH_CHAT));
      const b = part.bot;
      this.net.later(() => this.net.release(b), b.dead ? 1200 : 0);
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

  /**
   * Fin d'une partie en équipes : `won` (le camp du joueur a gagné, perdu, ou égalité),
   * annonce `label` et lignes de détail, pièces et victoire comptée.
   */
  protected finishTeam(won: boolean | null, label: string, details: string[] = []) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.timer = 7;
    const g = GAMES[this.key];
    if (won) {
      this.net.title('§6§lVICTOIRE !', label);
      this.net.profile.wins[this.key] = (this.net.profile.wins[this.key] ?? 0) + 1;
      this.net.reward(50, 'victoire');
      this.s.audio.play('achievement');
      const p = this.s.player;
      this.s.particles.burst('totem', p.x, p.y + 1, p.z, 40);
    } else if (won === false) {
      this.net.title('§c§lDÉFAITE', label);
    } else this.net.title('§e§lÉGALITÉ', label);
    this.net.chat('§6§l▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬');
    this.net.chat(`${g.color}§l${g.name} §r§7— ${label}`);
    for (const d of details) this.net.chat(d);
    this.net.chat('§6§l▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬');
    this.net.reward(5, 'participation');
    const talk = this.parts.find((x) => x.bot && !x.bot.removed);
    if (talk) this.net.botSay(talk.bot!, this.net.pick(['gg', 'gg wp', 'gg à tous !', 'bien joué']));
  }

  /** Réapparition d'un participant (jeux où l'on ne meurt pas définitivement). */
  protected revive(part: Part, x: number, y: number, z: number, yaw?: number) {
    if (part.bot) {
      const b = part.bot;
      b.dead = false;
      b.deathTimer = 0;
      b.health = b.maxHealth;
      b.body.setPos(x, y, z);
      b.body.vx = b.body.vy = b.body.vz = 0;
      b.body.fallDistance = 0;
      b.lastAttacker = null;
      b.ai.clearPath();
    } else {
      const p = this.s.player;
      if (p.dead) p.respawn();
      p.health = 20;
      p.lastAttacker = null;
      this.net.teleportPlayer(x, y, z, yaw);
    }
  }

  /** Participant correspondant à un bot. */
  protected partOf(b: Bot) {
    return this.parts.find((x) => x.bot === b) ?? null;
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
  /** Le chrono part à la fin du compte à rebours (le joueur est déjà sur le départ). */
  protected started() {
    this.running = true;
    this.time = 0;
    this.check = 0;
  }
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

// =====================================================================================
// Nouveaux mini-jeux : TNT Tag, The Bridge, Murder Mystery, Piliers de la Chance
// =====================================================================================

/** Lieu de départ en cercle autour d'un centre (le joueur au premier). */
function ring(cx: number, cz: number, r: number, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + Math.PI / 2;
    const x = cx + Math.cos(a) * r + 0.5, z = cz + Math.sin(a) * r + 0.5;
    return { x, z, yaw: Math.atan2(x - cx - 0.5, z - cz - 0.5) };
  });
}

/** Ligne de vue entre deux points (blocs pleins seulement). */
function lineOfSight(s: Session, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const d = Math.hypot(bx - ax, by - ay, bz - az), n = Math.ceil(d * 2);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (s.world.isSolid(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t), Math.floor(az + (bz - az) * t))) return false;
  }
  return true;
}

// ---------- TNT Tag ----------
class TntTag extends MiniGame {
  protected box = { x0: TNTTAG.x - 17, z0: TNTTAG.z - 17, x1: TNTTAG.x + 17, z1: TNTTAG.z + 17 };
  /** Joueurs qui portent la TNT. */
  it = new Set<Part>();
  round = 0;
  roundT = 0;
  private roundLen = 30;
  private pause = 0;
  private immune = new Map<Part, number>();
  private flee = new Map<Bot, { x: number; z: number; t: number }>();
  private starts: { x: number; z: number; yaw: number }[] = [];
  private lastBeep = 0;

  setup() {
    this.starts = ring(TNTTAG.x, TNTTAG.z, 9, GAMES.tnttag.players);
    this.starts.forEach((st, i) => {
      if (i === 0) {
        this.net.teleportPlayer(st.x, FLOOR + 1, st.z, st.yaw);
        return;
      }
      const b = this.net.gameBot(st.x, FLOOR + 1, st.z);
      this.parts.push({ bot: b, name: b.botName, alive: true, kills: 0 });
    });
    this.s.player.inventory.slots[8] = makeStack('red_bed', 1);
  }
  protected hold() {
    super.hold(0);
    const st = this.starts[0], p = this.s.player;
    if (Math.hypot(p.x - st.x, p.z - st.z) > 1.2) this.net.teleportPlayer(st.x, FLOOR + 1, st.z);
  }
  center() {
    return { x: TNTTAG.x, y: FLOOR, z: TNTTAG.z };
  }
  protected fallY() {
    return TNTTAG.outY;
  }
  protected deathText() {
    return '§ca explosé §7!';
  }
  protected started() {
    this.newRound();
  }

  private newRound() {
    this.round++;
    const alive = this.alive;
    const k = Math.max(1, Math.floor(alive.length / 4));
    const pool = [...alive];
    for (let i = 0; i < k && pool.length; i++) this.setIt(pool.splice(Math.floor(Math.random() * pool.length), 1)[0], true);
    this.roundLen = Math.max(15, 32 - this.round * 3);
    this.roundT = this.roundLen;
    this.lastBeep = Math.ceil(this.roundT);
    this.net.chat(`§c§lMANCHE ${this.round} §r§7— ${k} joueur(s) ont la TNT ! Explosion dans §e${this.roundLen} s§7.`);
    if (this.it.has(this.you)) this.net.title('§c§lVOUS AVEZ LA TNT !', '§7Frappez quelqu’un pour la lui passer');
    else this.net.title(`§c§lMANCHE ${this.round}`, `§7${k} joueur(s) ont la TNT : fuyez !`);
    this.s.audio.play('fuse', { volume: 0.5 });
  }

  private setIt(part: Part, on: boolean) {
    if (on) this.it.add(part);
    else this.it.delete(part);
    const tm = this.net.textures;
    if (part.bot) {
      setHat(part.bot.model.parts.get('head')?.[0], tm, on ? 'tnt' : null);
      part.bot.setTag(on ? `§c§lTNT §r${part.bot.chatName}` : part.bot.chatName);
    } else {
      setHat(this.s.playerAvatar?.model.parts.get('head')?.[0], tm, on ? 'tnt' : null);
      this.net.refreshHat();
      const inv = this.s.player.inventory;
      for (let i = 0; i < 8; i++) inv.slots[i] = on && ItemRegistry.has('tnt') ? makeStack('tnt', 1) : null;
      inv.changed();
      this.s.player.effects.clear();
      this.s.player.effects.add('speed', 20 * 600, on ? 1 : 0, false);
    }
  }

  /** Passe la TNT de `from` à `to` (coup au corps à corps). */
  tag(from: Part, to: Part) {
    if (!this.it.has(from) || this.it.has(to) || !to.alive || !from.alive || this.pause > 0) return;
    if ((this.immune.get(from) ?? 0) > 0) return;
    this.setIt(from, false);
    this.setIt(to, true);
    this.immune.set(to, 0.6);
    const e = to.bot ?? this.s.player;
    this.s.particles.burst('smoke', e.x, e.y + 1.8, e.z, 6);
    this.s.audio.play('pop', { x: e.x, y: e.y, z: e.z, volume: 0.8 });
    if (to === this.you) this.net.title('§c§lVOUS AVEZ LA TNT !', '§7Frappez quelqu’un pour la lui passer');
    else if (from === this.you) this.net.title('', `§aTNT passée à ${to.bot!.chatName}`);
  }

  protected strike(b: Bot, target: Part) {
    const from = this.partOf(b);
    if (from) this.tag(from, target);
  }

  protected tick(dt: number) {
    const p = this.s.player;
    p.health = 20;
    for (const [k, v] of this.immune) this.immune.set(k, v - dt);
    // coups du joueur : pas de dégâts, seulement le passage de la TNT
    for (const part of this.alive) {
      const b = part.bot;
      if (!b || b.health >= b.maxHealth) continue;
      if (b.lastAttacker === 'player') this.tag(this.you, part);
      b.health = b.maxHealth;
      b.lastAttacker = null;
    }
    if (this.pause > 0) {
      this.pause -= dt;
      if (this.pause <= 0 && this.alive.length > 1) this.newRound();
      return;
    }
    this.roundT -= dt;
    const sec = Math.ceil(this.roundT);
    if (sec !== this.lastBeep) {
      this.lastBeep = sec;
      if (sec <= 5 && sec > 0) this.s.audio.play('click', { volume: 0.7, pitch: 1.6 - sec * 0.1 });
    }
    // fumée au-dessus des porteurs
    if (Math.random() < dt * 8) for (const part of this.it) {
      const e = part.bot ?? p;
      this.s.particles.burst('small_smoke', e.x, e.y + 2.3, e.z, 1);
    }
    if (this.roundT > 0) return;
    // explosion : tous les porteurs sont éliminés
    const boom = [...this.it];
    for (const part of boom) {
      const e = part.bot ?? p;
      this.s.particles.burst('explosion', e.x, e.y + 1, e.z, 14);
      this.s.audio.play('explode', { x: e.x, y: e.y, z: e.z, volume: 0.7 });
      this.setIt(part, false);
      this.eliminate(part, null, 'killed');
    }
    this.it.clear();
    if (this.you.alive && this.alive.length > 1) this.net.reward(3, `manche ${this.round} survécue`);
    this.pause = 3;
  }

  think(b: Bot, part: Part, dt: number) {
    if (this.pause > 0) {
      b.ai.stop();
      return;
    }
    const lim = TNTTAG.half - 1.5;
    if (this.it.has(part)) {
      // chasseur : le plus proche sans TNT
      let best: Part | null = null, bd = Infinity;
      for (const o of this.alive) {
        if (o === part || this.it.has(o)) continue;
        const e = o.bot ?? this.s.player;
        const d = Math.hypot(e.x - b.x, e.z - b.z);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (!best) return;
      const e = best.bot ?? this.s.player;
      // le porteur court plus vite (comme l'effet Vitesse II), avec un saut d'élan de temps en temps
      if (bd > 1.6) b.ai.navigateTo(e.x, FLOOR + 1, e.z, 1.5 + b.skill * 0.2);
      if (bd < 5 && b.body.onGround && Math.random() < dt * 1.5) b.body.vy = 8.5;
      if (bd < 2.3 && Math.random() < dt * (3 + b.skill * 5)) {
        b.attackAnim = 1;
        this.tag(part, best);
      }
      return;
    }
    // fuyard : s'éloigne du porteur le plus proche (en restant dans l'arène)
    let threat: { x: number; z: number } | null = null, td = Infinity;
    for (const o of this.it) {
      const e = o.bot ?? this.s.player;
      const d = Math.hypot(e.x - b.x, e.z - b.z);
      if (d < td) {
        td = d;
        threat = e;
      }
    }
    let g = this.flee.get(b);
    if (threat && td < 11) {
      if (!g || (g.t -= dt) <= 0 || Math.hypot(g.x - b.x, g.z - b.z) < 1.2) {
        const ax = b.x - threat.x, az = b.z - threat.z, a0 = Math.atan2(az, ax);
        let pick: { x: number; z: number; t: number } | null = null, ps = -Infinity;
        for (let i = 0; i < 9; i++) {
          const a = a0 + (Math.random() - 0.5) * Math.PI * 1.3;
          const x = Math.max(TNTTAG.x - lim, Math.min(TNTTAG.x + lim, b.x + Math.cos(a) * 7)), z = Math.max(TNTTAG.z - lim, Math.min(TNTTAG.z + lim, b.z + Math.sin(a) * 7));
          const score = Math.hypot(x - threat.x, z - threat.z) - (this.s.world.isSolid(Math.floor(x), FLOOR + 1, Math.floor(z)) ? 5 : 0);
          if (score > ps) {
            ps = score;
            pick = { x, z, t: 0.6 + Math.random() * 0.5 };
          }
        }
        g = pick!;
        this.flee.set(b, g);
      }
      b.ai.moveTowards(g.x, g.z, 1.15 + b.skill * 0.15, false);
    } else {
      if (!g || (g.t -= dt) <= 0 || Math.hypot(g.x - b.x, g.z - b.z) < 1) {
        g = { x: TNTTAG.x + (Math.random() - 0.5) * lim * 2, z: TNTTAG.z + (Math.random() - 0.5) * lim * 2, t: 2 + Math.random() * 3 };
        this.flee.set(b, g);
      }
      b.ai.moveTowards(g.x, g.z, 0.8, false);
    }
  }

  bossbar(): [string, number] {
    if (this.state !== 'playing') return super.bossbar();
    if (this.pause > 0) return ['§c§lTNT TAG §7| §fprochaine manche…', 1];
    return [`§c§lTNT TAG §7| §fexplosion dans §e${Math.max(0, Math.ceil(this.roundT))} s §7· manche ${this.round}`, Math.max(0, this.roundT / this.roundLen)];
  }
  sidebar() {
    return [
      '§fJeu : §cTNT Tag',
      this.state === 'countdown' ? `§fDébut dans §a${Math.ceil(this.timer)} s` : `§fManche : §c${this.round}`,
      `§fExplosion : §e${this.pause > 0 ? '-' : Math.max(0, Math.ceil(this.roundT)) + ' s'}`,
      '',
      `§fEn vie : §a${this.alive.length}/${this.parts.length}`,
      `§fPorteurs : §c${this.it.size}`,
      `§fVous : ${!this.you.alive ? '§7spectateur' : this.it.has(this.you) ? '§c§lTNT !' : '§aen fuite'}`,
    ];
  }
  dispose() {
    for (const part of [...this.it]) this.setIt(part, false);
    setHat(this.s.playerAvatar?.model.parts.get('head')?.[0], this.net.textures, null);
    this.net.refreshHat();
    super.dispose();
  }
}

// ---------- The Bridge ----------
class Bridge extends MiniGame {
  protected box = { x0: BRIDGE.x - 13, z0: BRIDGE.z - 34, x1: BRIDGE.x + 13, z1: BRIDGE.z + 34 };
  team = new Map<Part, number>();
  score = [0, 0];
  goalsBy = new Map<Part, number>();
  private role = new Map<Bot, 'atk' | 'def'>();
  /** Gel après un but (tout le monde revient à sa base). */
  private freeze = 0;
  private readonly limit = 300;
  private blockOf = (ti: number) => {
    const k = `${BRIDGE_TEAMS[ti].block}_terracotta`;
    return BlockRegistry.has(k) ? BlockRegistry.byName(k).id : B.OAK_PLANKS;
  };

  setup() {
    BRIDGE_TEAMS.forEach((t, ti) => {
      const base = bridgeBase(ti);
      for (let k = 0; k < 2; k++) {
        const ox = k === 0 ? -1 : 1;
        if (ti === 0 && k === 0) {
          this.team.set(this.you, 0);
          this.net.teleportPlayer(base.spawn[0] + ox, base.spawn[1], base.spawn[2], base.yaw);
          this.s.player.spawn = [...base.spawn];
          continue;
        }
        const b = this.net.gameBot(base.spawn[0] + ox, base.spawn[1], base.spawn[2]);
        b.weapon = 'iron_sword';
        b.blocks = 64;
        b.blockId = this.blockOf(ti);
        b.gapples = 2;
        b.arrows = 4;
        b.armorFactor = armorFactor(7);
        b.setTag(`${t.color}§l${t.name[0]} §r${t.color}${b.botName}`);
        const part = { bot: b, name: b.botName, alive: true, kills: 0 };
        this.parts.push(part);
        this.team.set(part, ti);
        this.role.set(b, ti === 0 || k === 1 ? 'atk' : 'def');
      }
    });
    const inv = this.s.player.inventory;
    inv.slots[0] = makeStack('iron_sword', 1);
    inv.slots[1] = makeStack('bow', 1);
    inv.slots[2] = makeStack(ItemRegistry.has('red_terracotta') ? 'red_terracotta' : 'oak_planks', 64);
    inv.slots[3] = makeStack(ItemRegistry.has('red_terracotta') ? 'red_terracotta' : 'oak_planks', 64);
    inv.slots[4] = makeStack('golden_apple', 4);
    inv.slots[5] = makeStack('arrow', 8);
    inv.slots[8] = makeStack('red_bed', 1);
    inv.armor.chest = makeStack('leather_chestplate', 1);
    inv.armor.legs = makeStack('leather_leggings', 1);
    inv.armor.feet = makeStack('leather_boots', 1);
    this.net.chat('§7Vous êtes dans l’équipe §c§lRouge§7 avec un coéquipier. Traversez le pont et sautez dans le §9trou bleu§7 pour marquer !');
  }
  protected keyPoints(): [number, number][] {
    return [0, 1].map((i): [number, number] => [bridgeBase(i).goal[0], bridgeBase(i).goal[2]]);
  }
  protected hold() {
    super.hold(0);
    this.keepAtSpawn();
  }
  private keepAtSpawn() {
    const sp = bridgeBase(0).spawn, p = this.s.player;
    if (Math.hypot(p.x - sp[0], p.z - sp[2]) > 2.2 || p.y < sp[1] - 0.5) this.net.teleportPlayer(sp[0] - 1, sp[1], sp[2]);
  }
  center() {
    return { x: BRIDGE.x, y: FLOOR, z: BRIDGE.z };
  }
  protected fallY() {
    return BRIDGE.outY;
  }
  protected ally(a: Part, b: Part) {
    return this.team.get(a) === this.team.get(b);
  }
  canEdit(x: number, y: number, z: number, action: 'break' | 'place') {
    if (this.state !== 'playing' || !this.you.alive || this.freeze > 0) return false;
    if (Math.abs(x - BRIDGE.x) > 12 || Math.abs(z - BRIDGE.z) > BRIDGE.spawnZ + 2 || y > FLOOR + 6 || y < FLOOR - 6) return false;
    // les trous restent ouverts
    for (let i = 0; i < 2; i++) {
      const g = bridgeBase(i).goal;
      if (Math.abs(x - g[0]) <= 2 && Math.abs(z - g[2]) <= 2) return false;
    }
    if (action === 'place') return true;
    return this.journal.get(`${x},${y},${z}`) === B.AIR;
  }
  /** Le participant est-il tombé dans le trou de l'équipe `ti` ? */
  private inGoal(e: { x: number; y: number; z: number }, ti: number) {
    const g = bridgeBase(ti).goal;
    return Math.abs(e.x - (g[0] + 0.5)) < 1.6 && Math.abs(e.z - (g[2] + 0.5)) < 1.6 && e.y < FLOOR + 0.2 && e.y > FLOOR - 5;
  }
  private respawnAll() {
    for (const part of this.parts) {
      if (!part.alive) continue;
      const ti = this.team.get(part) ?? 0, base = bridgeBase(ti);
      const mates = [...this.team].filter(([, t]) => t === ti).map(([o]) => o);
      const ox = mates.indexOf(part) === 0 ? -1 : 1;
      this.revive(part, base.spawn[0] + ox, base.spawn[1], base.spawn[2], base.yaw);
    }
  }
  private goal(part: Part, into: number) {
    const ti = this.team.get(part) ?? 0;
    if (ti === into) {
      // propre but : retour à la base, sans point
      const base = bridgeBase(ti);
      this.revive(part, base.spawn[0], base.spawn[1], base.spawn[2], base.yaw);
      if (part === this.you) this.net.title('', '§cC’est votre propre trou !');
      return;
    }
    this.score[ti]++;
    this.goalsBy.set(part, (this.goalsBy.get(part) ?? 0) + 1);
    const t = BRIDGE_TEAMS[ti];
    const who = part.bot ? part.bot.chatName : '§aVous';
    const sc = `§c${this.score[0]} §7- §9${this.score[1]}`;
    this.net.chat(`${t.color}§lBUT ! §r${who} §7a marqué pour l’équipe ${t.color}${t.name} §7(${sc}§7)`);
    this.net.title(`${t.color}§lBUT !`, `${part.bot ? `${t.color}${part.bot.botName} §7a marqué` : '§aVous avez marqué'} §8· ${sc}`);
    this.s.audio.play('levelup', { volume: 0.6 });
    const e = part.bot ?? this.s.player;
    this.s.particles.burst('totem', e.x, e.y + 1, e.z, 30);
    if (part === this.you) this.net.reward(15, 'but marqué');
    if (this.score[ti] >= BRIDGE.goals) return this.end();
    this.respawnAll();
    this.freeze = 3;
  }
  protected tick(dt: number) {
    if (this.freeze > 0) {
      this.freeze -= dt;
      this.keepAtSpawn();
      if (this.freeze <= 0) this.net.title('§a§lC’EST REPARTI !');
      else this.s.hud.showTitle(`§eReprise dans ${Math.ceil(this.freeze)} s`, 'actionbar');
      return;
    }
    for (const part of this.alive) {
      const e = part.bot ?? this.s.player;
      for (let i = 0; i < 2; i++)
        if (this.inGoal(e, i)) {
          this.goal(part, i);
          if (this.state !== 'playing') return;
          break;
        }
    }
  }
  /** Mort ou chute : réapparition à la base (le tueur marque une élimination). */
  eliminate(part: Part, by: Bot | 'player' | null, cause: 'void' | 'killed') {
    if (!part.alive) return;
    const killer = by === 'player' ? this.you : by ? this.partOf(by) : null;
    if (killer && killer !== part) killer.kills++;
    const name = part.bot ? part.bot.chatName : '§aVous';
    this.net.chat(killer && killer !== part ? `${name} §7a été tué par ${killer.bot ? killer.bot.chatName : '§aVous'}§7.` : `${name} §7${cause === 'void' ? 'est tombé dans le vide' : 'est mort'}.`);
    if (killer === this.you && part !== this.you) {
      this.net.profile.kills++;
      this.net.reward(3, 'élimination');
    }
    const ti = this.team.get(part) ?? 0, base = bridgeBase(ti);
    this.revive(part, base.spawn[0], base.spawn[1], base.spawn[2], base.yaw);
    if (part === this.you) {
      this.net.title('§c§lVOUS ÊTES MORT', '§eRéapparition à votre base');
      const inv = this.s.player.inventory;
      if (inv.count('arrow') < 1) inv.add(makeStack('arrow', 4));
      inv.changed();
    }
  }
  playerDied(cause: 'void' | 'killed') {
    const killer = this.s.player.lastAttacker;
    const kp = cause === 'killed' && killer instanceof Bot ? this.partOf(killer) : null;
    this.eliminate(this.you, kp?.bot ?? null, cause);
  }
  private end() {
    const [r, b] = this.score;
    const win = r === b ? null : r > b ? 0 : 1;
    const top = [...this.goalsBy].sort((a, c) => c[1] - a[1])[0];
    this.finishTeam(win === null ? null : win === 0, win === null ? `§eÉgalité §c${r} §7- §9${b}` : `${BRIDGE_TEAMS[win].color}L’équipe ${BRIDGE_TEAMS[win].name} gagne §7(§c${r} §7- §9${b}§7)`, top ? [`§eMeilleur buteur : ${top[0].bot ? top[0].bot.chatName : '§aVous'} §7(${top[1]} but(s))`] : []);
  }
  checkEnd() {
    if (this.state === 'playing' && this.elapsed >= this.limit) this.end();
  }
  think(b: Bot, part: Part, dt: number) {
    if (this.freeze > 0) return b.ai.stop();
    const ti = this.team.get(part) ?? 0, ei = 1 - ti;
    const own = bridgeBase(ti), enemy = bridgeBase(ei);
    const sdE = BRIDGE_TEAMS[ei].side;
    const foe = this.nearestFoe(b, part);
    const role = this.role.get(b) ?? 'atk';
    const ex = enemy.goal[0] + 0.5, ez = enemy.goal[2] + 0.5;
    // tout près du trou adverse : on fonce sans s'arrêter pour se battre
    const rush = role === 'atk' && Math.hypot(ex - b.x, ez - b.z) < 7 && b.y > FLOOR + 0.5;
    if (foe && !rush) {
      const d = Math.hypot(foe.f.x - b.x, foe.f.z - b.z);
      // un adversaire sur notre île : tout le monde défend ; sinon combat s'il est sur le chemin
      const onOurSide = Math.sign(foe.f.z - BRIDGE.z) === BRIDGE_TEAMS[ti].side && Math.abs(foe.f.z - BRIDGE.z) > BRIDGE.len - 2;
      if ((d < (role === 'def' || onOurSide ? 9 : 4.5) && Math.abs(foe.f.y - b.y) < 3) || (b.arrows > 0 && foe.part === this.you && d > 8 && d < 22 && Math.random() < 0.02)) {
        b.fight(this.s, foe.f, dt, (dmg, kx, kz) => this.strike(b, foe.part, dmg, kx, kz));
        return;
      }
    }
    if (role === 'def') {
      const gx = own.goal[0] + 0.5 + ((b.botName.length % 2) * 2 - 1) * 2.5, gz = own.goal[2] + 0.5 - BRIDGE_TEAMS[ti].side * 2;
      if (Math.hypot(gx - b.x, gz - b.z) > 1.5) b.goTo(gx, FLOOR + 1, gz);
      else b.ai.stop();
      return;
    }
    // attaquant : tout près du trou, course directe dedans (l'île est plate)
    if (rush) {
      b.ai.moveTowards(ex, ez, 1.3, false);
      return;
    }
    // sinon : traverse le pont, s'approche du bord du trou adverse, puis saute dedans
    const edgeZ = ez - sdE * 2.2;
    const dEdge = Math.hypot(ex - b.x, edgeZ - b.z);
    if (dEdge < 1.4 || Math.hypot(ex - b.x, ez - b.z) < 2.4) {
      b.ai.moveTowards(ex, ez, 1, false);
      return;
    }
    // tombé du pont mais encore au-dessus du vide proche : pont de secours
    if (b.y < FLOOR + 0.5 && b.blocks > 0) {
      b.bridgeTo(this.s, ex, ez, Math.floor(b.y));
      return;
    }
    b.goTo(ex, FLOOR + 1, edgeZ, true);
  }
  bossbar(): [string, number] {
    if (this.state !== 'playing') return super.bossbar();
    return [`§9§lTHE BRIDGE §7| §c${this.score[0]} §7- §9${this.score[1]} §7· premier à ${BRIDGE.goals} · §e${fmt(Math.max(0, this.limit - this.elapsed))}`, Math.max(0, 1 - this.elapsed / this.limit)];
  }
  sidebar() {
    const dots = (n: number, c: string) => `${c}${n} §7but(s) sur ${BRIDGE.goals}`;
    return [
      '§fJeu : §9The Bridge',
      this.state === 'countdown' ? `§fDébut dans §a${Math.ceil(this.timer)} s` : `§fTemps restant : §a${fmt(Math.max(0, this.limit - this.elapsed))}`,
      '',
      `§c[R] ${dots(this.score[0], '§c')}`,
      `§9[B] ${dots(this.score[1], '§9')}`,
      '',
      `§fÉliminations : §a${this.you.kills}`,
      `§fButs : §a${this.goalsBy.get(this.you) ?? 0}`,
    ];
  }
}

// ---------- Murder Mystery ----------
type MmRole = 'innocent' | 'detective' | 'murderer';
const ROLE_NAME: Record<MmRole, string> = { innocent: '§aInnocent', detective: '§bDétective', murderer: '§cMeurtrier' };
class MurderMystery extends MiniGame {
  protected box = { x0: MURDER.x - 28, z0: MURDER.z - 28, x1: MURDER.x + 28, z1: MURDER.z + 28 };
  role = new Map<Part, MmRole>();
  /** Le meurtrier a été vu (les innocents fuient, le détective tire). */
  revealed = false;
  readonly limit = 180;
  private killCd = new Map<Bot, number>();
  private swordT = new Map<Bot, number>();
  private goals = new Map<Bot, { x: number; z: number; t: number }>();
  private aim = new Map<Bot, number>();
  private shotCd = new Map<Bot, number>();
  /** Arc du détective tombé au sol. */
  bowDrop: { x: number; y: number; z: number } | null = null;
  /** Innocents qui ont ramassé l'arc. */
  private heroes = new Set<Part>();
  private goldT = 4;
  private arrowT = 0;
  private spots = murderSpots();
  winnerText = '';

  get murderer() {
    return [...this.role].find(([, r]) => r === 'murderer')?.[0] ?? null;
  }
  get detective() {
    return [...this.role].find(([, r]) => r === 'detective')?.[0] ?? null;
  }
  private roleOf(p: Part) {
    return this.role.get(p) ?? 'innocent';
  }

  setup() {
    const n = GAMES.murder.players;
    const pts = [...this.spots].sort(() => Math.random() - 0.5);
    for (let i = 0; i < n; i++) {
      const [x, z] = pts[i % pts.length];
      const ox = x + (Math.random() - 0.5) * 2, oz = z + (Math.random() - 0.5) * 2;
      if (i === 0) {
        this.net.teleportPlayer(ox, FLOOR + 1, oz, Math.random() * Math.PI * 2);
        continue;
      }
      const b = this.net.gameBot(ox, FLOOR + 1, oz);
      this.parts.push({ bot: b, name: b.botName, alive: true, kills: 0 });
    }
    // rôles : un meurtrier, un détective
    const forced = this.net.nextRole;
    this.net.nextRole = null;
    const idx = this.parts.map((_, i) => i);
    const any = (a: number[]) => a[Math.floor(Math.random() * a.length)];
    // sans rôle imposé : 1 chance sur 8 d'être meurtrier ou détective, comme les autres
    const mi = forced === 'murderer' ? 0 : any(forced ? idx.slice(1) : idx);
    const di = forced === 'detective' ? 0 : any(idx.filter((i) => i !== mi && (!forced || i !== 0)));
    this.parts.forEach((p, i) => this.role.set(p, i === mi ? 'murderer' : i === di ? 'detective' : 'innocent'));
    for (const p of this.parts) if (p.bot && this.roleOf(p) === 'detective') p.bot.weapon = 'bow';
    const inv = this.s.player.inventory;
    const r = this.roleOf(this.you);
    if (r === 'murderer') inv.slots[1] = makeStack('iron_sword', 1);
    if (r === 'detective') {
      inv.slots[1] = makeStack('bow', 1);
      inv.slots[2] = makeStack('arrow', 1);
    }
    inv.slots[8] = makeStack('red_bed', 1);
    inv.changed();
  }
  protected keyPoints(): [number, number][] {
    return [[MURDER.x - 20, MURDER.z - 20], [MURDER.x + 20, MURDER.z + 20], [MURDER.x - 20, MURDER.z + 20], [MURDER.x + 20, MURDER.z - 20]];
  }
  protected hold() {
    super.hold(0);
  }
  center() {
    return { x: MURDER.x, y: FLOOR, z: MURDER.z };
  }
  protected started() {
    const r = this.roleOf(this.you);
    if (r === 'murderer') this.net.title('§c§lMEURTRIER', '§7Éliminez tout le monde sans vous faire voir (épée : case 2)');
    else if (r === 'detective') this.net.title('§b§lDÉTECTIVE', '§7Trouvez le meurtrier et tirez-lui dessus');
    else this.net.title('§a§lINNOCENT', '§7Survivez ! 10 lingots d’or = un arc');
    this.net.chat(`§7Votre rôle : ${ROLE_NAME[r]}§7. ${r === 'murderer' ? 'Frappez avec l’épée pour éliminer. Ne vous faites pas repérer par le détective !' : r === 'detective' ? 'Une flèche se recharge toutes les 4 s. Tuer un innocent vous élimine aussi !' : 'Ramassez l’or, fuyez le meurtrier, ramassez l’arc du détective s’il tombe.'}`);
  }

  /** Élimination par le meurtrier (coup d'épée) : témoin proche → meurtrier repéré. */
  private murderKill(m: Part, victim: Part) {
    if (!victim.alive || !m.alive) return;
    const me = m.bot ?? this.s.player, ve = victim.bot ?? this.s.player;
    this.s.audio.play('crit', { x: ve.x, y: ve.y, z: ve.z });
    this.s.particles.burst('damage', ve.x, ve.y + 1.2, ve.z, 10);
    this.eliminate(victim, m.bot ?? 'player', 'killed');
    if (!this.revealed && this.alive.some((o) => o !== m && Math.hypot((o.bot ?? this.s.player).x - me.x, (o.bot ?? this.s.player).z - me.z) < 13 && lineOfSight(this.s, (o.bot ?? this.s.player).x, (o.bot ?? this.s.player).y + 1.6, (o.bot ?? this.s.player).z, me.x, me.y + 1.4, me.z))) {
      this.revealed = true;
      this.net.chat('§c§lUn témoin a vu le meurtrier !');
    }
  }

  /** Tir à l'arc (bot) : trait de particules, touche selon le niveau et la distance. */
  private shoot(b: Bot, shooter: Part, target: Part) {
    const t = target.bot ?? this.s.player;
    const d = Math.hypot(t.x - b.x, t.z - b.z);
    this.s.audio.play('bow', { x: b.x, y: b.y, z: b.z });
    b.attackAnim = 1;
    b.yaw = Math.atan2(t.x - b.x, t.z - b.z);
    const n = Math.ceil(d * 1.5);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      this.net.later(() => this.s.particles.burst('crit', b.x + (t.x - b.x) * k, b.y + 1.5 + (t.y - b.y) * k, b.z + (t.z - b.z) * k, 1), k * 250);
    }
    if (Math.random() < 0.5 + b.skill * 0.4 - d * 0.012) this.net.later(() => this.state === 'playing' && this.arrowHit(shooter, target), 250);
  }

  /** Flèche (du joueur ou d'un bot) qui touche quelqu'un. */
  private arrowHit(shooter: Part, target: Part) {
    if (!target.alive || !shooter.alive) return;
    const killedMurderer = this.roleOf(target) === 'murderer';
    this.eliminate(target, shooter.bot ?? 'player', 'killed');
    if (!killedMurderer && this.roleOf(shooter) !== 'murderer') {
      // tuer un innocent : le tireur meurt aussi
      this.net.chat(`${shooter.bot ? shooter.bot.chatName : '§aVous'} §7avez tué un innocent et êtes éliminé !`.replace('§7avez', shooter.bot ? '§7a' : '§7avez').replace('êtes', shooter.bot ? 'est' : 'êtes'));
      this.eliminate(shooter, null, 'killed');
    }
  }

  eliminate(part: Part, by: Bot | 'player' | null, cause: 'void' | 'killed') {
    if (!part.alive) return;
    const hadBow = this.roleOf(part) === 'detective' || this.heroes.has(part);
    super.eliminate(part, by, cause);
    if (hadBow && this.roleOf(part) !== 'murderer') {
      const e = part.bot ?? this.s.player;
      this.bowDrop = { x: e.x, y: FLOOR + 1, z: e.z };
      this.heroes.delete(part);
      this.net.chat('§6§lL’arc du détective est tombé ! §r§7Ramassez-le pour devenir le héros.');
    }
  }

  protected tick(dt: number) {
    const p = this.s.player, inv = p.inventory;
    p.health = 20;
    // or : apparaît régulièrement dans le village (10 lingots = un arc)
    this.goldT -= dt;
    if (this.goldT <= 0) {
      this.goldT = 3.5;
      const golds = this.s.entities.entities.filter((e) => e.kind === 'item' && (e as unknown as { itemId?: string }).itemId === 'gold_ingot').length;
      if (golds < 8) {
        const [x, z] = this.net.pick(this.spots);
        this.s.entities.spawnItem('gold_ingot', 1, x + (Math.random() - 0.5) * 4, FLOOR + 1.3, z + (Math.random() - 0.5) * 4);
      }
    }
    const myRole = this.roleOf(this.you);
    if (this.you.alive && myRole !== 'murderer' && inv.count('gold_ingot') >= 10) {
      inv.remove('gold_ingot', 10);
      if (inv.count('bow') < 1) inv.add(makeStack('bow', 1));
      inv.add(makeStack('arrow', 1));
      inv.changed();
      this.net.chat('§6Vous avez échangé 10 lingots d’or contre une flèche' + (this.heroes.has(this.you) || myRole === 'detective' ? '' : ' et un arc') + ' !');
      this.s.audio.play('levelup', { volume: 0.4 });
    }
    // flèche du détective : une toutes les 4 s
    if (this.you.alive && myRole === 'detective' && inv.count('arrow') < 1) {
      this.arrowT += dt;
      if (this.arrowT >= 4) {
        this.arrowT = 0;
        inv.add(makeStack('arrow', 1));
        inv.changed();
      }
    }
    // arc tombé : ramassé par le joueur (objet) ou par un innocent proche
    if (this.bowDrop) {
      const d = this.bowDrop;
      if (Math.random() < dt * 10) this.s.particles.burst('end_rod', d.x, d.y + 0.6, d.z, 2);
      if (this.you.alive && myRole !== 'murderer' && Math.hypot(p.x - d.x, p.z - d.z) < 1.6) {
        this.bowDrop = null;
        this.heroes.add(this.you);
        if (inv.count('bow') < 1) inv.add(makeStack('bow', 1));
        inv.add(makeStack('arrow', 2));
        inv.changed();
        this.net.title('§6§lVOUS AVEZ L’ARC !', '§7Éliminez le meurtrier');
      } else
        for (const part of this.alive) {
          const b = part.bot;
          if (!b || this.roleOf(part) !== 'innocent' || Math.hypot(b.x - d.x, b.z - d.z) > 1.5) continue;
          this.bowDrop = null;
          this.heroes.add(part);
          b.weapon = 'bow';
          this.net.chat('§6L’arc a été ramassé par un innocent !');
          break;
        }
    }
    // coups du joueur sur les bots : épée du meurtrier, flèches de l'arc
    for (const part of this.alive) {
      const b = part.bot;
      if (!b || b.health >= b.maxHealth) continue;
      const fromPlayer = b.lastAttacker === 'player' || b.lastAttacker === null;
      b.health = b.maxHealth;
      b.lastAttacker = null;
      if (!fromPlayer || !this.you.alive) continue;
      const melee = Math.hypot(b.x - p.x, b.z - p.z) < 3.8;
      if (myRole === 'murderer' && melee && inv.selectedStack?.id === 'iron_sword') this.murderKill(this.you, part);
      else if (myRole !== 'murderer' && !melee && inv.count('bow') > 0) this.arrowHit(this.you, part);
    }
    for (const [b, t] of this.swordT) {
      if (t - dt <= 0) {
        b.weapon = '';
        this.swordT.delete(b);
      } else this.swordT.set(b, t - dt);
    }
  }

  checkEnd() {
    if (this.state !== 'playing') return;
    const m = this.murderer;
    if (!m) return;
    const innocents = this.alive.filter((x) => x !== m);
    if (!m.alive) this.end(false);
    else if (!innocents.length) this.end(true);
    else if (this.elapsed >= this.limit) this.end(false);
  }
  private end(murdererWins: boolean) {
    const m = this.murderer!, d = this.detective;
    const mine = this.roleOf(this.you);
    const won = (mine === 'murderer') === murdererWins;
    this.winnerText = murdererWins ? 'murderer' : 'innocents';
    const nm = (p: Part | null) => (p ? (p.bot ? p.bot.chatName : '§aVous') : '§7-');
    if (!murdererWins && mine !== 'murderer' && this.you.alive) this.net.reward(10, 'survie');
    this.finishTeam(won, murdererWins ? '§c§lLE MEURTRIER GAGNE' : '§a§lLES INNOCENTS GAGNENT', [`§7Meurtrier : ${nm(m)} §7(${m.kills} élimination(s))`, `§7Détective : ${nm(d)}`, ...[...this.heroes].map((h) => `§6Héros : ${nm(h)}`)]);
  }

  private wander(b: Bot, dt: number, speed = 1) {
    let g = this.goals.get(b);
    if (!g || (g.t -= dt) <= 0 || Math.hypot(g.x - b.x, g.z - b.z) < 1.2) {
      const [x, z] = this.net.pick(this.spots);
      g = { x: x + (Math.random() - 0.5) * 3, z: z + (Math.random() - 0.5) * 3, t: 6 + Math.random() * 8 };
      this.goals.set(b, g);
    }
    b.goTo(g.x, FLOOR + 1, g.z, speed > 1);
  }

  think(b: Bot, part: Part, dt: number) {
    const role = this.roleOf(part);
    const m = this.murderer;
    if (role === 'murderer') {
      const cd = (this.killCd.get(b) ?? 4) - dt;
      this.killCd.set(b, cd);
      if (this.elapsed < 8) return this.wander(b, dt);
      // victime : la plus isolée (personne d'autre à moins de 7 blocs), sinon la plus proche
      let best: Part | null = null, bs = Infinity;
      for (const o of this.alive) {
        if (o === part) continue;
        const e = o.bot ?? this.s.player;
        if (Math.abs(e.y - b.y) > 3) continue; // hors d'atteinte (toit, vol)
        const d = Math.hypot(e.x - b.x, e.z - b.z);
        const crowd = this.alive.filter((x) => x !== o && x !== part && Math.hypot((x.bot ?? this.s.player).x - e.x, (x.bot ?? this.s.player).z - e.z) < 7).length;
        const sc = d + crowd * (this.elapsed > 70 ? 2 : 12) + (this.roleOf(o) === 'detective' && !this.revealed ? 8 : 0);
        if (sc < bs) {
          bs = sc;
          best = o;
        }
      }
      if (!best) return;
      const e = best.bot ?? this.s.player;
      const d = Math.hypot(e.x - b.x, e.z - b.z);
      if (bs > 30 && this.elapsed < 70) return this.wander(b, dt);
      if (d > 1.6) b.goTo(e.x, FLOOR + 1, e.z, d < 12);
      if (d < 2.2 && cd <= 0 && Math.abs(e.y - b.y) < 1.5) {
        b.weapon = 'iron_sword';
        b.attackAnim = 1;
        this.swordT.set(b, 2);
        this.killCd.set(b, 3 + Math.random() * 4 - b.skill * 1.5);
        this.murderKill(part, best);
      }
      return;
    }
    const armed = role === 'detective' || this.heroes.has(part);
    const me = m && m.alive ? m.bot ?? this.s.player : null;
    const dm = me ? Math.hypot(me.x - b.x, me.z - b.z) : Infinity;
    if (armed && this.revealed && me) {
      // détective : approche à portée, vise puis tire
      const cd = (this.shotCd.get(b) ?? 0) - dt;
      this.shotCd.set(b, cd);
      const see = dm < 24 && lineOfSight(this.s, b.x, b.y + 1.6, b.z, me.x, me.y + 1.4, me.z);
      if (see && dm > 3) {
        b.ai.stop();
        b.yaw = Math.atan2(me.x - b.x, me.z - b.z);
        const a = (this.aim.get(b) ?? 0) + dt;
        this.aim.set(b, a);
        if (a > 1.3 - b.skill * 0.6 && cd <= 0) {
          this.aim.set(b, 0);
          this.shotCd.set(b, 3.5);
          this.shoot(b, part, m!);
        }
        return;
      }
      this.aim.set(b, 0);
      if (dm <= 3) b.ai.moveTowards(b.x - (me.x - b.x), b.z - (me.z - b.z), 1.3, false);
      else b.goTo(me.x, FLOOR + 1, me.z, true);
      return;
    }
    // innocent : ramasse l'arc s'il est tombé et sûr, fuit le meurtrier repéré, sinon flâne
    if (this.bowDrop && dm > 8 && Math.hypot(this.bowDrop.x - b.x, this.bowDrop.z - b.z) < 22 && b.skill > 0.5) {
      b.goTo(this.bowDrop.x, FLOOR + 1, this.bowDrop.z, true);
      return;
    }
    if (me && (this.revealed || (dm < 5 && Math.random() < b.skill * 0.3)) && dm < 12) {
      const ax = b.x - me.x, az = b.z - me.z, d = Math.hypot(ax, az) || 1;
      const lim = MURDER.half - 2;
      const tx = Math.max(MURDER.x - lim, Math.min(MURDER.x + lim, b.x + (ax / d) * 6)), tz = Math.max(MURDER.z - lim, Math.min(MURDER.z + lim, b.z + (az / d) * 6));
      b.goTo(tx, FLOOR + 1, tz, true);
      return;
    }
    this.wander(b, dt, this.revealed ? 1.3 : 1);
  }

  bossbar(): [string, number] {
    if (this.state !== 'playing') return super.bossbar();
    return [`§4§lMURDER MYSTERY §7| §fRôle : ${ROLE_NAME[this.roleOf(this.you)]} §7· §e${fmt(Math.max(0, this.limit - this.elapsed))}`, Math.max(0, 1 - this.elapsed / this.limit)];
  }
  sidebar() {
    const m = this.murderer, d = this.detective;
    const innocents = this.alive.filter((x) => x !== m).length;
    return [
      '§fJeu : §4Murder Mystery',
      this.state === 'countdown' ? `§fDébut dans §a${Math.ceil(this.timer)} s` : `§fTemps restant : §a${fmt(Math.max(0, this.limit - this.elapsed))}`,
      '',
      `§fRôle : ${ROLE_NAME[this.roleOf(this.you)]}${this.heroes.has(this.you) ? ' §6(héros)' : ''}`,
      `§fInnocents en vie : §a${innocents}`,
      `§fDétective : ${d?.alive ? '§aen vie' : this.bowDrop ? '§6arc au sol' : '§cmort'}`,
      `§fOr : §6${this.s.player.inventory.count('gold_ingot')}/10`,
      `§fÉliminations : §a${this.you.kills}`,
    ];
  }
  dispose() {
    this.bowDrop = null;
    super.dispose();
  }
}

// ---------- Piliers de la Chance ----------
const PILLAR_LOOT: [string, number, number][] = [
  ['white_wool', 16, 6], ['oak_planks', 12, 3], ['stone_sword', 1, 2], ['iron_sword', 1, 2], ['diamond_sword', 1, 1], ['bow', 1, 1], ['arrow', 6, 2],
  ['golden_apple', 1, 2], ['iron_chestplate', 1, 1], ['iron_helmet', 1, 1], ['chainmail_leggings', 1, 1], ['diamond_boots', 1, 1], ['snowball', 8, 2], ['ender_pearl', 1, 1], ['cooked_beef', 3, 1],
];
class Pillars extends MiniGame {
  protected box = { x0: PILLARS.x - 24, z0: PILLARS.z - 24, x1: PILLARS.x + 24, z1: PILLARS.z + 24 };
  private itemT = 3;
  private armor = new Map<Bot, number>();
  private pillars = pillarPositions();
  private wool = 'red_wool';
  private towerT = new Map<Bot, number>();
  /** Mort subite : le vide monte d'un bloc par seconde après 2:30 (jusqu'au plafond de construction). */
  private readonly sudden = 150;
  private suddenSaid = false;
  setup() {
    const colors = ['red', 'blue', 'lime', 'yellow', 'orange', 'purple', 'cyan', 'pink'];
    this.pillars.forEach(([px, pz], i) => {
      const yaw = Math.atan2(px - PILLARS.x, pz - PILLARS.z);
      if (i === 0) {
        this.net.teleportPlayer(px + 0.5, FLOOR + 1, pz + 0.5, yaw);
        return;
      }
      const b = this.net.gameBot(px + 0.5, FLOOR + 1, pz + 0.5);
      const k = `${colors[i % colors.length]}_wool`;
      b.blockId = BlockRegistry.has(k) ? BlockRegistry.byName(k).id : B.OAK_PLANKS;
      this.parts.push({ bot: b, name: b.botName, alive: true, kills: 0 });
    });
    this.wool = ItemRegistry.has('red_wool') ? 'red_wool' : 'oak_planks';
    this.s.player.inventory.slots[8] = makeStack('red_bed', 1);
  }
  protected keyPoints(): [number, number][] {
    return this.pillars;
  }
  protected hold() {
    super.hold(0);
    const [px, pz] = this.pillars[0], p = this.s.player;
    if (Math.hypot(p.x - px - 0.5, p.z - pz - 0.5) > 0.8) this.net.teleportPlayer(px + 0.5, FLOOR + 1, pz + 0.5);
  }
  center() {
    return { x: PILLARS.x, y: FLOOR, z: PILLARS.z };
  }
  protected fallY() {
    return PILLARS.outY + Math.max(0, this.elapsed - this.sudden);
  }
  canEdit(x: number, y: number, z: number, action: 'break' | 'place') {
    if (this.state !== 'playing' || !this.you.alive) return false;
    if (Math.hypot(x - PILLARS.x, z - PILLARS.z) > 21 || y > FLOOR + 14 || y < FLOOR - 14) return false;
    if (action === 'place') return true;
    return this.journal.get(`${x},${y},${z}`) === B.AIR;
  }
  /** Délai entre deux objets : de 5 s à 2,5 s. */
  private get period() {
    return Math.max(2.5, 5 - this.elapsed / 40);
  }
  private roll(): [string, number] {
    const total = PILLAR_LOOT.reduce((a, l) => a + l[2], 0);
    let w = Math.random() * total;
    for (const [id, n, wt] of PILLAR_LOOT) if ((w -= wt) < 0) return [id, n];
    return ['white_wool', 16];
  }
  protected tick(dt: number) {
    if (this.elapsed > this.sudden) {
      if (!this.suddenSaid) {
        this.suddenSaid = true;
        this.net.chat('§c§lMORT SUBITE ! §r§cLe vide monte : grimpez !');
        this.net.title('§c§lMORT SUBITE', '§7Le vide monte');
        this.s.audio.play('thunder', { volume: 0.5 });
      }
      if (Math.random() < dt * 6) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 18;
        this.s.particles.burst('portal', PILLARS.x + Math.cos(a) * r, this.fallY(), PILLARS.z + Math.sin(a) * r, 4);
      }
    }
    this.itemT -= dt;
    if (this.itemT > 0) return;
    this.itemT = this.period;
    for (const part of this.alive) {
      let [id, n] = this.roll();
      if (part.bot) {
        this.give(part.bot, id, n);
        // les bons joueurs gardent toujours des blocs
        if (Math.random() < 0.5) part.bot.blocks += 6;
        continue;
      }
      if (id === 'white_wool') id = this.wool;
      if (!ItemRegistry.has(id)) continue;
      const inv = this.s.player.inventory;
      const def = ItemRegistry.get(id);
      const slot = def?.armor?.slot;
      if (slot && !inv.armor[slot]) inv.armor[slot] = makeStack(id, 1);
      else {
        const left = inv.add(makeStack(id, n));
        if (left > 0) this.s.entities.spawnItem(id, left, this.s.player.x, this.s.player.y + 1, this.s.player.z);
      }
      inv.changed();
      this.s.hud.showTitle(`§e+ ${n > 1 ? `${n} × ` : ''}${def?.name ?? id}`, 'actionbar');
      this.s.audio.play('pop', { volume: 0.4 });
    }
  }
  /** Objet reçu par un bot (arme, armure, blocs, pommes, flèches). */
  private give(b: Bot, id: string, n: number) {
    const rank = (x: string) => ['', 'wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword'].indexOf(x);
    const def = ItemRegistry.get(id);
    if (rank(id) > rank(b.weapon)) b.weapon = id;
    else if (def?.armor) {
      const pts = (this.armor.get(b) ?? 0) + def.armor.defense;
      this.armor.set(b, pts);
      b.armorFactor = armorFactor(pts);
    } else if (id.endsWith('_wool') || id === 'oak_planks') b.blocks += n;
    else if (id === 'golden_apple') b.gapples += n;
    else if (id === 'arrow') b.arrows += n;
  }
  /** Monte en posant un bloc sous ses pieds (comme un joueur qui fait un pilier). */
  private tower(b: Bot, dt: number) {
    const t = (this.towerT.get(b) ?? 0) - dt;
    this.towerT.set(b, t);
    const w = this.s.world, x = Math.floor(b.x), y = Math.floor(b.y + 0.05), z = Math.floor(b.z);
    if (t > 0 || !b.body.onGround || b.blocks <= 0 || y > FLOOR + 13 || w.isSolid(x, y + 2, z)) return false;
    b.body.setPos(b.x, y + 1.02, b.z);
    w.setBlock(x, y, z, b.blockId);
    b.blocks--;
    b.attackAnim = 1;
    this.towerT.set(b, 0.45 - b.skill * 0.15);
    this.s.audio.blockSound('place', 'wood', x + 0.5, y + 0.5, z + 0.5);
    return true;
  }
  think(b: Bot, part: Part, dt: number) {
    const foe = this.nearestFoe(b, part);
    if (!foe) return;
    const f = foe.f;
    const d = Math.hypot(f.x - b.x, f.z - b.z);
    // plus bas que l'adversaire (ou le vide monte) : on grimpe
    if ((f.y - b.y > 1.5 && d < 6) || b.y - this.fallY() < 5) {
      b.ai.stop();
      if (this.tower(b, dt)) return;
    }
    // au contact (même niveau) : combat ; tir à l'arc sur le joueur à distance
    if ((Math.abs(f.y - b.y) < 2.5 && d < 3.6) || (b.arrows > 0 && foe.part === this.you && d > 7 && d < 24)) {
      b.fight(this.s, f, dt, (dmg, kx, kz) => this.strike(b, foe.part, dmg, kx, kz));
      return;
    }
    // pont vers l'adversaire le plus proche (en attendant des blocs, on reste sur son pilier)
    if (b.blocks > 0 && this.elapsed > 6 + (1 - b.skill) * 10) b.bridgeTo(this.s, f.x, f.z, Math.floor(b.y + 0.05));
    else if (this.elapsed > 20) b.goTo(f.x, f.y, f.z, true); // par les ponts déjà construits
    else {
      b.ai.stop();
      b.yaw = Math.atan2(f.x - b.x, f.z - b.z);
    }
  }
  bossbar(): [string, number] {
    if (this.state !== 'playing') return super.bossbar();
    return [`§5§lPILIERS §7| §fprochain objet dans §e${Math.max(0, Math.ceil(this.itemT))} s §7· §a${this.alive.length} en vie`, Math.max(0, this.itemT / this.period)];
  }
  sidebar() {
    return [
      '§fJeu : §5Piliers de la Chance',
      this.state === 'countdown' ? `§fDébut dans §a${Math.ceil(this.timer)} s` : `§fTemps : §a${fmt(this.elapsed)}`,
      `§fProchain objet : §e${Math.max(0, Math.ceil(this.itemT))} s`,
      '',
      `§fEn vie : §a${this.alive.length}/${this.parts.length}`,
      `§fÉliminations : §a${this.you.kills}`,
    ];
  }
}
