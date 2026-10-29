import type { Game } from '../core/Game';
import type { Screen } from './UIManager';
import { el } from './dom';
import { bhButton, bhIconEl } from './Bedrock';
import { drawLogo } from './MenuArt';
import { drawFigure } from './ContainerArt';
import { settingsScreen } from './SettingsUI';
import { tb } from './BedrockLang';
import { socialScreen, wardrobeScreen } from './BedrockMenus';

/** Personnage de face dessiné avec la skin du joueur (même rendu que l'inventaire), agrandi. */
function avatarCanvas(game: Game, skinName: string, k: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16 * k;
  c.height = 32 * k;
  c.className = 'bh-avatar';
  try {
    const skin = game.textures.skin(`player_${skinName}`).image as HTMLCanvasElement;
    drawFigure(c.getContext('2d')!, 0, 0, skin, k);
  } catch {
    /* skin indisponible : silhouette vide */
  }
  return c;
}

/** Enregistre une capture de l'image du jeu (PNG) depuis le menu de pause. */
function takeScreenshot(game: Game) {
  const r = game.renderer;
  try {
    r.gl.render(r.scene, r.camera);
    r.gl.domElement.toBlob((blob) => {
      if (!blob) return game.hud.toast('Capture impossible', 'warn');
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `lecraft-${new Date().toISOString().replace(/[:.]/g, '-')}.png` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      game.hud.toast('Capture enregistrée');
    }, 'image/png');
  } catch {
    game.hud.toast('Capture impossible', 'warn');
  }
}

/**
 * Menu de pause de l'édition mobile : panneau sombre à gauche (logo, Reprendre le jeu, Paramètres,
 * Parcourez les extensions !, Sauv. et quitter, trois pictogrammes), joueur à droite avec son nom,
 * « Vestiaire » et « Social ». Apparaît en fondu ; les commandes de jeu sont masquées pendant la pause.
 */
export function pauseScreen(game: Game): Screen {
  const s = game.session;
  const remote = !!(s?.meta.server || s?.meta.remote);
  const others = s?.netHost ? Math.max(0, s.netHost.playerCount - 1) : 0;
  const name = s?.player.name || game.settings.playerName || 'Joueur';
  document.documentElement.classList.add('bh-paused');
  const logo = el('img', { class: 'bh-logo', alt: 'LeCraft', src: drawLogo(game.textures) });
  const left = el(
    'div',
    { class: 'bh-pause-left' },
    logo,
    el(
      'div',
      { class: 'bh-pause-list' },
      bhButton('Reprendre le jeu', () => game.resume(), { cls: 'big' }),
      bhButton('Paramètres', () => game.ui.push(settingsScreen(game)), { cls: 'big' }),
      bhButton('Parcourez les extensions !', () => game.ui.push(settingsScreen(game, 'addons')), { cls: 'big' }),
      bhButton(remote ? 'Se déconnecter' : 'Sauv. et quitter', () => game.quitToMenu(), { cls: 'big' }),
    ),
    el(
      'div',
      { class: 'bh-pause-icons' },
      bhButton(bhIconEl('book'), () => game.showProgress(), { cls: 'sq' }),
      bhButton(bhIconEl('help'), () => game.showHelp(), { cls: 'sq' }),
      bhButton(bhIconEl('camera'), () => takeScreenshot(game), { cls: 'sq' }),
    ),
  );
  const social = bhButton(`${tb('Social')} (${others})`, () => game.ui.push(socialScreen(game)), { cls: 'bh-social', icon: 'social' });
  const skin = game.settings.playerSkin ?? 'steve';
  const right = el(
    'div',
    { class: 'bh-pause-right' },
    el('div', { class: 'bh-pause-tag' }, tb('Jeu en pause')),
    social,
    el('div', { class: 'bh-nick' }, name),
    avatarCanvas(game, skin, 14),
    bhButton('Vestiaire', () => game.ui.push(wardrobeScreen(game)), { cls: 'bh-wardrobe-btn' }),
  );
  const root = el('div', { class: 'screen bh-pause' }, left, right);
  return {
    el: root,
    onBack: () => (game.resume(), true),
    onClose: () => document.documentElement.classList.remove('bh-paused'),
  };
}
