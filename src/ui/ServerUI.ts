import type { Game } from '../core/Game';
import type { Screen } from './UIManager';
import { el } from './dom';
import { mcButton, mcLabel, mcRow, mcScreen } from './Mc';
import { setMcText } from './McText';
import { GAMES, SERVER_NAME, type ServerNetwork } from '../server/ServerNetwork';
import { SMP_NAME } from '../server/SmpServer';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { GameKey } from '../server/ServerMaps';

const ICON_FOR: Record<GameKey, string> = { skywars: 'grass_block', spleef: 'diamond_shovel', duels: 'iron_sword', tntrun: 'tnt', parkour: 'emerald_block' };

/** Liste des serveurs (écran « Multijoueur ») : serveurs intégrés (mini-jeux, survie moddée). */
export function serversScreen(game: Game): Screen {
  type Srv = { name: string; icon: string; motd: [string, string]; online: number; max: number; join: () => void };
  const servers: Srv[] = [
    { name: SERVER_NAME, icon: 'grass_block', motd: ['§a§l       LeCraft Network §r§7[1.21]', '§eSkyWars §7· §fSpleef §7· §cTNT Run §7· §bDuel §7· §aParkour'], online: 1200 + Math.floor(Math.random() * 800), max: 20000, join: () => game.joinServer() },
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
    body: [el('div', { class: 'col', style: 'align-items:center;gap:calc(var(--gs) * 2px)' }, ...rows.map((r) => r.entry), mcLabel('Serveurs intégrés : fonctionnent hors ligne, les autres joueurs sont des bots.'))],
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
      setMcText(label.lastChild as HTMLElement, `${g.color}§l${g.name} §r§7— ${k === 'parkour' ? `record ${net.profile.bestParkour ? net.profile.bestParkour.toFixed(1) + ' s' : '-'}` : `${wins[k] ?? 0} victoire(s)`}`);
      const b = mcButton(label, () => {
        close();
        net.join(k);
      }, { w: 300 });
      b.title = g.desc;
      b.dataset.game = k;
      return b;
    });
    const head = el('div', { class: 'sub' });
    setMcText(head, `§7Pièces : §6${net.profile.coins} §7· Parties jouées : §f${net.profile.played}`);
    const screen = mcScreen({
      title: 'Menu des jeux',
      body: [head, el('div', { class: 'trade-list' }, ...rows)],
      footer: [mcButton('Fermer', close, { w: 200 })],
      bg: 'dim',
      onBack: () => (close(), true),
    });
    screen.el.classList.add('trade-screen');
    return screen;
  });
}
