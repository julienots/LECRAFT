/**
 * Écrans du multijoueur en réseau : rejoindre une partie (adresse du serveur LeCraft, liste des
 * parties ouvertes) et ouvrir son monde aux autres joueurs (depuis le menu du jeu).
 */
import type { Game } from '../core/Game';
import type { Screen } from './UIManager';
import { el } from './dom';
import { bmBtn, bmInput, bmRow, bmScreen, bmSegment, bmToggle, setBtnLabel } from './BedrockUI';
import { t } from './i18n';
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
  const name = bmInput(s.playerName ?? '', { placeholder: 'Pseudo', maxlength: 16 });
  name.addEventListener('change', () => {
    s.playerName = name.value.trim().replace(/[^\p{L}\p{N}_\- ]/gu, '').slice(0, 16) || undefined;
    game.saveSettings();
  });
  const label = (k: string) => `Skin : ${k[0].toUpperCase() + k.slice(1)}`;
  const skin = bmBtn(label(s.playerSkin ?? 'steve'), () => {
    const i = PLAYER_SKINS.indexOf(s.playerSkin ?? 'steve');
    s.playerSkin = PLAYER_SKINS[(i + 1) % PLAYER_SKINS.length];
    setBtnLabel(skin, label(s.playerSkin));
    game.saveSettings();
  }, { w: 110, h: 33 });
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

/** Parties en réseau (onglet Realms) : choisir le serveur, voir et rejoindre les parties ouvertes. */
export function joinPanel(game: Game): HTMLElement {
  const { name, skin } = identity(game);
  const addr = bmInput(defaultAddress(game), { placeholder: sameOriginRelay() ? 'Vide = ce serveur' : `Adresse du serveur (ex. 192.168.1.20:${DEFAULT_PORT})`, maxlength: 80 });
  const status = el('div', { class: 'bm-status' });
  const list = el('div', { class: 'bm-rooms' });
  let busy = false;
  const refresh = async () => {
    if (busy) return;
    busy = true;
    status.textContent = t('Recherche des parties…');
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
        const entry = el('div', { class: 'bm-srv server-entry world-entry', role: 'button', tabindex: '0' }, el('img', { src: game.textures.iconURL('grass_block'), alt: '' }), el('div', { class: 'tx' }, el('div', { class: 'name' }, r.name), m1, m2), el('div', { class: 'rt' }, count));
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
    status.textContent = t('Connexion…');
    try {
      await game.joinRemote(addr.value.trim(), room);
    } catch (e) {
      status.textContent = `Impossible de rejoindre : ${(e as Error).message}`;
    }
    busy = false;
  };
  setTimeout(() => void refresh(), 50);
  return el(
    'div',
    { class: 'bm-tabpanel bm-panel' },
    el('div', { class: 'bm-rw' }, el('div', { class: 'bm-inrow', style: 'margin-top:0' }, name, skin)),
    el('div', { class: 'bm-rw' }, el('div', { class: 't' }, t('Adresse du serveur')), el('div', { class: 'bm-inrow' }, addr, bmBtn('Actualiser', () => void refresh(), { w: 100, h: 33 })), el('div', { class: 'd', style: 'margin-top:calc(var(--u) * 6 * 1px)' }, t(`Lancez « npm run server » sur un ordinateur (ou « npm run dev ») puis saisissez son adresse. Port par défaut : ${DEFAULT_PORT}.`)), status),
    list,
  );
}

/** Multijoueur › Parties en réseau (écran complet). */
export function joinScreen(game: Game): Screen {
  const s = bmScreen(game, { cls: 'bm-play', title: 'Parties en réseau', dim: true, body: [el('div', { class: 'bm-wrap' }, joinPanel(game))] });
  return { el: s.el, onBack: s.onBack };
}

/** Menu du jeu › Ouvrir au multijoueur. */
export function hostScreen(game: Game): Screen {
  const s = game.session!;
  const { name, skin } = identity(game);
  const addr = bmInput(defaultAddress(game), { placeholder: sameOriginRelay() ? 'Vide = ce serveur' : `Adresse du serveur relais (ex. 192.168.1.20:${DEFAULT_PORT})`, maxlength: 80 });
  const opts = { pvp: true, bots: !!s.smp, max: 8 };
  const status = el('div', { class: 'bm-status' });
  const info = el('div', { class: 'bm-note' });
  const show = () => {
    const h = s.netHost;
    info.textContent = h ? `Partie ouverte (${h.playerCount} joueur(s)). Les autres joueurs : Jouer › Realms, même adresse de serveur.` : 'Votre monde n’est pas encore ouvert.';
    open.disabled = !!h;
    close.disabled = !h;
  };
  const open = bmBtn('Ouvrir la partie', async () => {
    status.textContent = t('Connexion au serveur…');
    open.disabled = true;
    try {
      await game.hostWorld(addr.value.trim(), opts);
      rememberAddress(game, addr.value.trim());
      status.textContent = t('Partie ouverte !');
    } catch (e) {
      status.textContent = `Échec : ${(e as Error).message}`;
    }
    show();
  }, { tone: 'green', w: 150 });
  const close = bmBtn('Fermer la partie', () => {
    s.stopMultiplayer();
    status.textContent = t('Partie fermée.');
    show();
  }, { w: 150 });
  show();
  const max = bmSegment<number>('Joueurs max', [[4, '4'], [8, '8'], [12, '12'], [16, '16']], opts.max, (v) => (opts.max = v));
  const body = el(
    'div',
    { class: 'bm-tabpanel bm-panel' },
    el('div', { class: 'bm-rw' }, el('div', { class: 'bm-inrow', style: 'margin-top:0' }, name, skin)),
    el('div', { class: 'bm-rw' }, el('div', { class: 't' }, t('Adresse du serveur relais')), addr),
    bmToggle('Combat JcJ', null, opts.pvp, (v) => (opts.pvp = v)).el,
    bmToggle('Bots joueurs', null, opts.bots, (v) => (opts.bots = v)).el,
    max.el,
    el('div', { class: 'bm-rw' }, el('div', { class: 'd' }, t('L’hôte garde le monde : les blocs, créatures, coffres, le temps et la météo sont partagés. Les bots joueurs travaillent, construisent et discutent avec tout le monde.')), info, status, el('div', { class: 'bm-inrow', style: 'flex-wrap:wrap' }, open, close)),
  );
  void bmRow;
  const sc = bmScreen(game, { cls: 'bm-play', title: 'Ouvrir au multijoueur', social: false, dim: true, body: [el('div', { class: 'bm-wrap' }, body)] });
  return { el: sc.el, onBack: sc.onBack };
}
