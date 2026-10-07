import type { Game } from '../core/Game';
import type { Screen } from './UIManager';
import { el } from './dom';
import { mcButton, mcLabel, mcRow, mcScreen } from './Mc';
import { setMcText } from './McText';
import { GAMES, SERVER_NAME, type ServerNetwork } from '../server/ServerNetwork';
import type { GameKey } from '../server/ServerMaps';

const ICON_FOR: Record<GameKey, string> = { skywars: 'grass_block', spleef: 'diamond_shovel', duels: 'iron_sword', tntrun: 'tnt', parkour: 'emerald_block' };

/** Liste des serveurs (écran « Multijoueur ») : le serveur de mini-jeux intégré. */
export function serversScreen(game: Game): Screen {
  let online = 1200 + Math.floor(Math.random() * 800);
  let selected = false;
  let lastTap = 0;
  const join = mcButton('Rejoindre le serveur', () => selected && game.joinServer(), { w: 150, disabled: true });
  const motd1 = el('div', { class: 'sub' });
  const motd2 = el('div', { class: 'sub' });
  const count = el('div', { class: 'sub srv-count' });
  const ping = el('div', { class: 'srv-ping' }, ...[1, 2, 3, 4, 5].map((i) => el('i', { style: `height:${i * 20}%` })));
  const refresh = () => {
    online += Math.floor(Math.random() * 40) - 18;
    setMcText(motd1, '§a§l       LeCraft Network §r§7[1.21]');
    setMcText(motd2, '§eSkyWars §7· §fSpleef §7· §cTNT Run §7· §bDuel §7· §aParkour');
    setMcText(count, `§7${online}§8/§720000`);
  };
  refresh();
  const entry = el(
    'div',
    { class: 'world-entry server-entry' },
    el('img', { src: game.textures.iconURL('grass_block'), alt: '' }),
    el('div', { style: 'min-width:0;flex:1' }, el('div', { class: 'name' }, SERVER_NAME), motd1, motd2),
    el('div', { class: 'srv-right' }, count, ping),
  );
  entry.addEventListener('click', () => {
    const now = performance.now();
    if (selected && now - lastTap < 400) game.joinServer();
    lastTap = now;
    selected = true;
    entry.classList.add('sel');
    join.disabled = false;
    game.audio.play('click', { volume: 0.3 });
  });
  return mcScreen({
    title: 'Jouer en multijoueur',
    body: [el('div', { class: 'col', style: 'align-items:center;gap:calc(var(--gs) * 2px)' }, entry, mcLabel('Serveur intégré : fonctionne hors ligne, les autres joueurs sont des bots.'))],
    list: true,
    footer: [mcRow(join, mcButton('Actualiser', refresh, { w: 72 }), mcButton('Retour', () => game.ui.back(), { w: 72 }))],
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
