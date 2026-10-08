/**
 * Écrans du multijoueur en réseau : rejoindre une partie (adresse du serveur LeCraft, liste des
 * parties ouvertes) et ouvrir son monde aux autres joueurs (depuis le menu du jeu).
 */
import type { Game } from '../core/Game';
import type { Screen } from './UIManager';
import { el } from './dom';
import { mcButton, mcCycle, mcGrid, mcInput, mcLabel, mcRow, mcScreen, mcToggle } from './Mc';
import { setMcText } from './McText';
import { PLAYER_SKINS } from '../render/TextureManager';
import { DEFAULT_PORT, NetLink, relayUrl, sameOriginRelay, type RoomInfo } from '../net/Protocol';

/** Adresse proposée par défaut : la dernière utilisée, sinon le serveur qui sert la page. */
function defaultAddress(game: Game) {
  return game.settings.servers?.[0] ?? '';
}

function rememberAddress(game: Game, address: string) {
  const list = (game.settings.servers ?? []).filter((a) => a !== address);
  if (address) list.unshift(address);
  game.settings.servers = list.slice(0, 5);
  game.saveSettings();
}

function identity(game: Game) {
  const s = game.settings;
  const name = mcInput(s.playerName ?? '', { placeholder: 'Pseudo', maxlength: 16 });
  name.addEventListener('change', () => {
    s.playerName = name.value.trim().replace(/[^\p{L}\p{N}_\- ]/gu, '').slice(0, 16) || undefined;
    game.saveSettings();
  });
  const skin = mcCycle('Skin', PLAYER_SKINS.map((k) => [k, k[0].toUpperCase() + k.slice(1)] as [string, string]), s.playerSkin ?? 'steve', (v) => {
    s.playerSkin = v;
    game.saveSettings();
  });
  return { name, skin };
}

/** Liste des parties ouvertes sur un serveur LeCraft. */
export async function fetchRooms(address: string): Promise<RoomInfo[]> {
  const link = new NetLink(relayUrl(address));
  await link.connect(5000);
  try {
    link.send({ t: 'list' });
    const r = await link.waitFor('rooms', 5000);
    return r.rooms;
  } finally {
    link.close();
  }
}

/** Multijoueur › Parties en réseau : choisir le serveur, voir et rejoindre les parties. */
export function joinScreen(game: Game): Screen {
  const { name, skin } = identity(game);
  const addr = mcInput(defaultAddress(game), { placeholder: sameOriginRelay() ? 'Vide = ce serveur' : `Adresse du serveur (ex. 192.168.1.20:${DEFAULT_PORT})`, maxlength: 80, w: 300 });
  const status = mcLabel('');
  const list = el('div', { class: 'col', style: 'align-items:center;gap:calc(var(--gs) * 2px)' });
  let busy = false;
  const refresh = async () => {
    if (busy) return;
    busy = true;
    status.textContent = 'Recherche des parties…';
    list.replaceChildren();
    try {
      const rooms = await fetchRooms(addr.value);
      rememberAddress(game, addr.value.trim());
      status.textContent = rooms.length ? `${rooms.length} partie(s) ouverte(s) — touchez pour rejoindre.` : 'Serveur joignable, aucune partie ouverte pour l’instant (un joueur doit ouvrir son monde : Menu du jeu › Ouvrir au multijoueur).';
      for (const r of rooms) {
        const m1 = el('div', { class: 'sub' }), m2 = el('div', { class: 'sub' }), count = el('div', { class: 'sub srv-count' });
        setMcText(m1, `§7Hébergé par §f${r.host}§7 · ${r.mode === 'creative' ? 'Créatif' : 'Survie'}`);
        setMcText(m2, r.motd ? `§e${r.motd}` : '§8Partie en réseau');
        setMcText(count, `§7${r.players}§8/§7${r.max}`);
        const entry = el('div', { class: 'world-entry server-entry' }, el('img', { src: game.textures.iconURL('grass_block'), alt: '' }), el('div', { style: 'min-width:0;flex:1' }, el('div', { class: 'name' }, r.name), m1, m2), el('div', { class: 'srv-right' }, count));
        entry.dataset.room = r.id;
        entry.addEventListener('click', () => void join(r.id));
        list.append(entry);
      }
    } catch (e) {
      status.textContent = `${(e as Error).message}`;
    }
    busy = false;
  };
  const join = async (room: string) => {
    if (busy) return;
    busy = true;
    status.textContent = 'Connexion…';
    try {
      await game.joinRemote(addr.value.trim(), room);
    } catch (e) {
      status.textContent = `Impossible de rejoindre : ${(e as Error).message}`;
    }
    busy = false;
  };
  setTimeout(() => void refresh(), 50);
  return mcScreen({
    title: 'Parties en réseau',
    body: [
      mcRow(name, skin),
      addr,
      mcLabel(`Lancez « npm run server » sur un ordinateur (ou « npm run dev ») puis saisissez son adresse. Port par défaut : ${DEFAULT_PORT}.`),
      status,
      list,
    ],
    list: true,
    footer: [mcRow(mcButton('Actualiser', () => void refresh(), { w: 100 }), mcButton('Retour', () => game.ui.back(), { w: 100 }))],
  });
}

/** Menu du jeu › Ouvrir au multijoueur. */
export function hostScreen(game: Game): Screen {
  const s = game.session!;
  const { name, skin } = identity(game);
  const addr = mcInput(defaultAddress(game), { placeholder: sameOriginRelay() ? 'Vide = ce serveur' : `Adresse du serveur relais (ex. 192.168.1.20:${DEFAULT_PORT})`, maxlength: 80, w: 300 });
  const opts = { pvp: true, bots: !!s.smp, max: 8 };
  const status = mcLabel('');
  const info = mcLabel('', 'white');
  const show = () => {
    const h = s.netHost;
    info.textContent = h ? `Partie ouverte (${h.playerCount} joueur(s)). Les autres joueurs : Multijoueur › Parties en réseau, même adresse de serveur.` : 'Votre monde n’est pas encore ouvert.';
    open.disabled = !!h;
    close.disabled = !h;
  };
  const open = mcButton('Ouvrir la partie', async () => {
    status.textContent = 'Connexion au serveur…';
    open.disabled = true;
    try {
      await game.hostWorld(addr.value.trim(), opts);
      rememberAddress(game, addr.value.trim());
      status.textContent = 'Partie ouverte !';
    } catch (e) {
      status.textContent = `Échec : ${(e as Error).message}`;
    }
    show();
  }, { w: 150 });
  const close = mcButton('Fermer la partie', () => {
    s.stopMultiplayer();
    status.textContent = 'Partie fermée.';
    show();
  }, { w: 150 });
  show();
  return mcScreen({
    title: 'Ouvrir au multijoueur',
    bg: 'dim',
    body: [
      mcRow(name, skin),
      addr,
      mcGrid(
        mcToggle('Combat JcJ', opts.pvp, (v) => (opts.pvp = v)),
        mcToggle('Bots joueurs', opts.bots, (v) => (opts.bots = v)),
        mcCycle('Joueurs max', [[4, '4'], [8, '8'], [12, '12'], [16, '16']] as [number, string][], opts.max, (v) => (opts.max = v)),
      ),
      mcLabel('L’hôte garde le monde : les blocs, créatures, coffres, le temps et la météo sont partagés. Les bots joueurs travaillent, construisent et discutent avec tout le monde.'),
      info,
      status,
    ],
    footer: [mcRow(open, close), mcButton('Terminé', () => game.ui.back(), { w: 200 })],
  });
}
