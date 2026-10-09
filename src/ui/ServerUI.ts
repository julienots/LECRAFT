import type { Game } from '../core/Game';
import type { Screen } from './UIManager';
import { el } from './dom';
import { mcButton, mcLabel, mcRow, mcScreen } from './Mc';
import { setMcText } from './McText';
import { GAMES, SERVER_IP, SERVER_NAME, type ServerNetwork } from '../server/ServerNetwork';
import { COSMETICS, KIND_NAMES, MYSTERY_PRICE, RARITY_COLOR, type CosmeticKind } from '../server/Cosmetics';
import { SMP_NAME } from '../server/SmpServer';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { GameKey } from '../server/ServerMaps';

const ICON_FOR: Record<GameKey, string> = { bedwars: 'red_bed', skywars: 'grass_block', duels: 'iron_sword', sumo: 'slime_ball', blockparty: 'magenta_wool', tntrun: 'tnt', spleef: 'diamond_shovel', parkour: 'emerald_block' };

/** Liste des serveurs (écran « Multijoueur ») : serveurs intégrés (mini-jeux, survie moddée). */
export function serversScreen(game: Game): Screen {
  type Srv = { name: string; icon: string; motd: [string, string]; online: number; max: number; join: () => void };
  const servers: Srv[] = [
    { name: SERVER_NAME, icon: 'red_bed', motd: [`§6§l      HypXL Network §r§7[1.21] §8${SERVER_IP}`, '§cBedWars §7· §eSkyWars §7· §6Sumo §7· §dBlock Party §7· §d§lCOSMÉTIQUES'], online: 38000 + Math.floor(Math.random() * 14000), max: 100000, join: () => game.joinServer() },
    { name: SMP_NAME, icon: 'oak_sapling', motd: ['§2§l       LeCraft SMP §r§7— survie moddée', '§fArbres entiers §7· §fFilons §7· §fTombes §7· §e/home /tpa /shop'], online: 4, max: 20, join: () => game.joinSmp() },
  ];
  let selected: Srv | null = null;
  let lastTap = 0;
  const join = mcButton('Rejoindre le serveur', () => selected?.join(), { w: 150, disabled: true });
  const rows: { s: Srv; entry: HTMLElement; count: HTMLElement; m1: HTMLElement; m2: HTMLElement }[] = [];
  const refresh = () => {
    for (const r of rows) {
      r.s.online = Math.max(1, r.s.online + Math.floor(Math.random() * (r.s.max > 100 ? 40 : 3)) - (r.s.max > 100 ? 18 : 1));
      setMcText(r.m1, r.s.motd[0]);
      setMcText(r.m2, r.s.motd[1]);
      setMcText(r.count, `§7${Math.min(r.s.online, r.s.max)}§8/§7${r.s.max}`);
    }
  };
  for (const srv of servers) {
    const m1 = el('div', { class: 'sub' }), m2 = el('div', { class: 'sub' }), count = el('div', { class: 'sub srv-count' });
    const ping = el('div', { class: 'srv-ping' }, ...[1, 2, 3, 4, 5].map((i) => el('i', { style: `height:${i * 20}%` })));
    const entry = el(
      'div',
      { class: 'world-entry server-entry' },
      el('img', { src: game.textures.iconURL(srv.icon), alt: '' }),
      el('div', { style: 'min-width:0;flex:1' }, el('div', { class: 'name' }, srv.name), m1, m2),
      el('div', { class: 'srv-right' }, count, ping),
    );
    entry.dataset.server = srv.name;
    entry.addEventListener('click', () => {
      const now = performance.now();
      if (selected === srv && now - lastTap < 400) srv.join();
      lastTap = now;
      selected = srv;
      for (const r of rows) r.entry.classList.toggle('sel', r.s === srv);
      join.disabled = false;
      game.audio.play('click', { volume: 0.3 });
    });
    rows.push({ s: srv, entry, count, m1, m2 });
  }
  refresh();
  return mcScreen({
    title: 'Jouer en multijoueur',
    body: [
      el(
        'div',
        { class: 'col', style: 'align-items:center;gap:calc(var(--gs) * 2px)' },
        mcButton('Parties en réseau (vrais joueurs)...', () => game.showJoinRemote(), { w: 300 }),
        mcLabel('Jouez avec vos amis : un joueur ouvre son monde (Menu du jeu › Ouvrir au multijoueur), les autres le rejoignent ici.'),
        ...rows.map((r) => r.entry),
        mcLabel('Serveurs intégrés : fonctionnent hors ligne, les autres joueurs sont des bots.'),
      ),
    ],
    list: true,
    footer: [mcRow(join, mcButton('Actualiser', refresh, { w: 72 }), mcButton('Retour', () => game.ui.back(), { w: 72 }))],
  });
}

/** Boutique du serveur de survie : acheter avec les pièces. */
export function openShop(game: Game, items: [string, number, number][], coins: () => number, buy: (id: string, n: number, price: number) => boolean) {
  game.openScriptForm((close) => {
    const head = el('div', { class: 'sub' });
    const upd = () => setMcText(head, `§7Solde : §6${coins()} pièces §7· /sell pour vendre l’objet en main`);
    const rows = items.map(([id, n, price]) => {
      const label = el('span', { class: 'trade-row' }, el('img', { class: 'trade-icon', src: game.textures.iconURL(id), alt: '' }), el('span', {}));
      const b = mcButton(label, () => {
        if (buy(id, n, price)) game.audio.play('pop', { volume: 0.5 });
        refresh();
      }, { w: 300 });
      b.dataset.buy = id;
      const refresh = () => {
        for (const r of all) r.b.disabled = coins() < r.price;
        upd();
      };
      setMcText(label.lastChild as HTMLElement, `§f${n} × ${ItemRegistry.get(id)?.name ?? id} §7— §6${price} pièces`);
      return { b, price, refresh };
    });
    const all = rows;
    rows[0]?.refresh();
    upd();
    const screen = mcScreen({
      title: 'Boutique',
      body: [head, el('div', { class: 'trade-list' }, ...rows.map((r) => r.b))],
      footer: [mcButton('Fermer', close, { w: 200 })],
      bg: 'dim',
      onBack: () => (close(), true),
    });
    screen.el.classList.add('trade-screen');
    return screen;
  });
}

/** Menu des jeux (boussole du hub, /jeux). */
export function openGameSelector(game: Game, net: ServerNetwork) {
  game.openScriptForm((close) => {
    const wins = net.profile.wins;
    const rows = (Object.keys(GAMES) as GameKey[]).map((k) => {
      const g = GAMES[k];
      const label = el('span', { class: 'trade-row' }, el('img', { class: 'trade-icon', src: game.textures.iconURL(ICON_FOR[k]), alt: '' }), el('span', {}));
      setMcText(label.lastChild as HTMLElement, `${g.color}§l${g.name} §r§8· §e${net.gameOnline(k).toLocaleString('fr-FR')} en jeu §8· §7${k === 'parkour' ? `record ${net.profile.bestParkour ? net.profile.bestParkour.toFixed(1) + ' s' : '-'}` : `${wins[k] ?? 0} victoire(s)`}`);
      const b = mcButton(label, () => {
        close();
        net.join(k);
      }, { w: 300 });
      b.title = g.desc;
      b.dataset.game = k;
      return b;
    });
    const head = el('div', { class: 'sub' });
    setMcText(head, `§7Pièces : §6${net.profile.coins} §7· Parties jouées : §f${net.profile.played} §7· Niveau §b${net.level}`);
    const screen = mcScreen({
      title: `${SERVER_NAME} — Menu des jeux`,
      body: [head, el('div', { class: 'trade-list' }, ...rows)],
      footer: [mcButton('Fermer', close, { w: 200 })],
      bg: 'dim',
      onBack: () => (close(), true),
    });
    screen.el.classList.add('trade-screen');
    return screen;
  });
}

/** Écran de menu du serveur (liste de boutons à icône) ; `rebuild` réaffiche l'écran. */
function menuForm(game: Game, title: string, build: (close: () => void, rebuild: () => void) => { head: string; rows: HTMLElement[]; tabs?: HTMLElement }) {
  game.openScriptForm((close) => {
    const head = el('div', { class: 'sub' });
    const list = el('div', { class: 'trade-list' });
    const tabsBox = el('div', { class: 'row', style: 'flex-wrap:wrap;justify-content:center;gap:calc(var(--gs) * 2px)' });
    const rebuild = () => {
      const r = build(close, rebuild);
      setMcText(head, r.head);
      list.replaceChildren(...r.rows);
      tabsBox.replaceChildren(...(r.tabs ? [r.tabs] : []));
    };
    rebuild();
    const screen = mcScreen({ title, body: [head, tabsBox, list], footer: [mcButton('Fermer', close, { w: 200 })], bg: 'dim', onBack: () => (close(), true) });
    screen.el.classList.add('trade-screen');
    return screen;
  });
}

function iconRow(game: Game, icon: string, text: string, onClick: () => void, opts: { disabled?: boolean; data?: string } = {}) {
  const label = el('span', { class: 'trade-row' }, el('img', { class: 'trade-icon', src: game.textures.iconURL(ItemRegistry.has(icon) ? icon : 'barrier'), alt: '' }), el('span', {}));
  setMcText(label.lastChild as HTMLElement, text);
  const b = mcButton(label, onClick, { w: 300, disabled: opts.disabled });
  if (opts.data) b.dataset.cosmetic = opts.data;
  return b;
}

/** Boutique et garde-robe des cosmétiques (onglets par type). */
export function openCosmetics(game: Game, net: ServerNetwork, start: CosmeticKind = 'trail') {
  let tab: CosmeticKind = start;
  menuForm(game, `${SERVER_NAME} — Cosmétiques`, (_close, rebuild) => {
    const kinds = Object.keys(KIND_NAMES) as CosmeticKind[];
    const tabs = el('div', { class: 'row', style: 'flex-wrap:wrap;justify-content:center;gap:4px' }, ...kinds.map((k) => {
      const b = mcButton(KIND_NAMES[k], () => ((tab = k), rebuild()), { w: 96, disabled: k === tab });
      b.dataset.tab = k;
      return b;
    }));
    const cur = net.equipped(tab);
    const rows = COSMETICS.filter((c) => c.kind === tab).map((c) => {
      const own = net.owns(c.id), on = cur?.id === c.id;
      const state = on ? '§a§l✔ ÉQUIPÉ' : own ? '§eToucher pour équiper' : `§6${c.price} pièces`;
      return iconRow(game, c.icon, `${RARITY_COLOR[c.rarity]}${c.name} §8(${c.rarity}) §7— ${state}`, () => {
        if (on) net.equip(null, tab);
        else if (own) net.equip(c);
        else if (!net.buy(c)) {
          game.audio.play('deny', { volume: 0.5 });
          return;
        }
        game.audio.play('click', { volume: 0.4 });
        rebuild();
      }, { disabled: !own && net.profile.coins < c.price, data: c.id });
    });
    if (cur) rows.unshift(iconRow(game, 'barrier', `§cRetirer ${KIND_NAMES[tab].toLowerCase()} : §f${cur.name}`, () => (net.equip(null, tab), rebuild())));
    const owned = COSMETICS.filter((c) => c.kind === tab && net.owns(c.id)).length;
    return { head: `§7Pièces : §6${net.profile.coins.toLocaleString('fr-FR')} §7· ${KIND_NAMES[tab]} : §d${owned}/${COSMETICS.filter((c) => c.kind === tab).length} §7· Boîte mystère : §5${MYSTERY_PRICE} pièces`, rows, tabs };
  });
}

/** Boîtes mystères : ouvrir une boîte (cosmétique aléatoire non possédé). */
export function openMysteryBox(game: Game, net: ServerNetwork) {
  menuForm(game, 'Boîtes mystères', (close, rebuild) => {
    const left = COSMETICS.filter((c) => c.kind !== 'rank' && !net.owns(c.id)).length;
    const rows = [
      iconRow(game, 'ender_chest', `§5§lOUVRIR UNE BOÎTE §r§7— §6${MYSTERY_PRICE} pièces`, () => {
        if (net.openMystery()) close();
        else rebuild();
      }, { disabled: net.profile.coins < MYSTERY_PRICE || left === 0, data: 'mystery' }),
      iconRow(game, 'emerald', '§dVoir mes cosmétiques', () => (close(), openCosmetics(game, net))),
    ];
    return { head: `§7Pièces : §6${net.profile.coins.toLocaleString('fr-FR')} §7· Cosmétiques à gagner : §d${left} §7· chances : §acommun 55% §9rare 30% §5épique 12% §6légendaire 3%`, rows };
  });
}

/** Profil : niveau, pièces, statistiques par jeu. */
export function openProfile(game: Game, net: ServerNetwork) {
  menuForm(game, `Profil de ${game.session?.player.name ?? 'Joueur'}`, (close) => {
    const p = net.profile;
    const wins = Object.values(p.wins).reduce((a, n) => a + (n ?? 0), 0);
    const bar = Math.round(net.levelProgress * 20);
    const rows = [
      iconRow(game, 'experience_bottle', `§fNiveau §b§l${net.level} §r§a${'|'.repeat(bar)}§7${'|'.repeat(20 - bar)} §7${Math.round(net.levelProgress * 100)}%`, () => {}),
      iconRow(game, 'gold_ingot', `§fPièces : §6${p.coins.toLocaleString('fr-FR')} §7· Rang : ${net.equipped('rank')?.value.split('|')[0].trim() || '§7Joueur'}`, () => {}),
      iconRow(game, 'iron_sword', `§fParties : §a${p.played} §7· Victoires : §a${wins} §7· Éliminations : §a${p.kills}`, () => {}),
      ...(Object.keys(GAMES) as GameKey[]).map((k) =>
        iconRow(game, ICON_FOR[k], `${GAMES[k].color}${GAMES[k].name} §7— ${k === 'parkour' ? `record ${p.bestParkour ? p.bestParkour.toFixed(2) + ' s' : '-'}` : `${p.wins[k] ?? 0} victoire(s)`}`, () => (close(), net.join(k))),
      ),
      iconRow(game, 'feather', `§fParcours du hub : §e${p.bestHubParkour ? p.bestHubParkour.toFixed(2) + ' s' : '-'}`, () => {}),
      iconRow(game, 'emerald', `§fCosmétiques : §d${p.owned?.length ?? 0}/${COSMETICS.length}`, () => (close(), openCosmetics(game, net))),
    ];
    return { head: `§7Serveur §6${SERVER_NAME} §7· Lobby §a#${p.lobby}`, rows };
  });
}

/** Choix du lobby (1 à 12). */
export function openLobbySelector(game: Game, net: ServerNetwork) {
  menuForm(game, 'Choisir un lobby', (close) => {
    const rows = Array.from({ length: 12 }, (_, i) => {
      const n = i + 1, here = n === net.profile.lobby;
      const pl = 40 + ((n * 37 + 11) % 60);
      return iconRow(game, here ? 'lime_concrete' : pl > 90 ? 'red_concrete' : 'quartz_block', `§fLobby §a#${n} §7— ${here ? '§a§lvous êtes ici' : `§7${pl}/100 joueurs`}`, () => {
        close();
        if (!here) net.switchLobby(n);
      }, { data: `lobby${n}` });
    });
    return { head: '§7Changer de lobby : nouveaux joueurs, même progression.', rows };
  });
}
