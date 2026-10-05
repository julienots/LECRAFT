import type { Game } from '../core/Game';
import { applyQuality } from '../core/Settings';
import type { QualityLevel, Difficulty } from '../core/Config';
import type { Screen } from './UIManager';
import { button, el, select, setting, slider, toggle } from './dom';

type Tab = 'graphics' | 'controls' | 'audio' | 'gameplay';

export function settingsScreen(game: Game): Screen {
  const s = game.settings;
  let tab: Tab = 'graphics';
  const body = el('div', { class: 'scroll' });
  const tabs = el('div', { class: 'tabs' });
  const names: [Tab, string][] = [['graphics', 'Graphismes'], ['controls', 'Contrôles'], ['audio', 'Audio'], ['gameplay', 'Gameplay']];
  let needsRemesh = false;
  const apply = (remesh = false) => {
    needsRemesh ||= remesh;
    game.applySettings(false);
  };

  const render = () => {
    tabs.innerHTML = '';
    for (const [k, label] of names) {
      const t = el('div', { class: `tab${k === tab ? ' active' : ''}` }, label);
      t.addEventListener('click', () => {
        tab = k;
        game.audio.play('click', { volume: 0.4 });
        render();
      });
      tabs.append(t);
    }
    body.innerHTML = '';
    if (tab === 'graphics') {
      body.append(
        setting('Qualité', select<QualityLevel>([['LOW', 'Basse'], ['MEDIUM', 'Moyenne'], ['HIGH', 'Haute']], s.quality, (v) => {
          applyQuality(s, v);
          apply(true);
          render();
        }), `Détectée : ${game.device.level} (${game.device.reason})`),
        setting('Ajustement automatique', toggle(s.autoQuality, (v) => ((s.autoQuality = v), apply())), 'Réduit la résolution puis la distance si les FPS chutent'),
        setting('Distance de rendu', slider(2, 10, 1, s.renderDistance, (v) => ((s.renderDistance = v), apply()), (v) => `${v} chunks`)),
        setting('FPS max', select<number>([[30, '30 FPS'], [45, '45 FPS'], [60, '60 FPS']], s.fpsCap, (v) => ((s.fpsCap = v as 30 | 45 | 60), apply()))),
        setting('Résolution', slider(0.5, 1, 0.05, s.resolutionScale, (v) => ((s.resolutionScale = v), apply()), (v) => `${Math.round(v * 100)} %`)),
        setting('Ombres', select([['off', 'Désactivées'], ['blob', 'Ombres des entités'], ['blob+ao', 'Entités + occlusion']], s.shadows, (v) => ((s.shadows = v as typeof s.shadows), apply()))),
        setting('Particules', select([['off', 'Aucune'], ['low', 'Réduites'], ['high', 'Complètes']], s.particles, (v) => ((s.particles = v as typeof s.particles), apply()))),
        setting('Eau', select([['simple', 'Simple'], ['animated', 'Animée']], s.waterQuality, (v) => ((s.waterQuality = v as typeof s.waterQuality), apply()))),
        setting('Nuages', toggle(s.clouds, (v) => ((s.clouds = v), apply()))),
        setting('Afficher les FPS', toggle(s.showFps, (v) => ((s.showFps = v), apply()))),
      );
    } else if (tab === 'controls') {
      body.append(
        setting('Sensibilité caméra', slider(0.2, 3, 0.05, s.sensitivity, (v) => ((s.sensitivity = v), apply()), (v) => v.toFixed(2))),
        setting('Inverser l’axe vertical', toggle(s.invertY, (v) => ((s.invertY = v), apply()))),
        setting('Taille du joystick', slider(80, 200, 5, s.joystickSize, (v) => ((s.joystickSize = v), apply()), (v) => `${v}px`)),
        setting('Taille des boutons', slider(0.7, 1.5, 0.05, s.buttonScale, (v) => ((s.buttonScale = v), apply()), (v) => `${Math.round(v * 100)} %`)),
        setting('Mode gaucher', toggle(s.leftHanded, (v) => ((s.leftHanded = v), apply())), 'Joystick à droite, actions à gauche'),
        setting('Saut automatique', toggle(s.autoJump, (v) => ((s.autoJump = v), apply()))),
        setting('Balancement de la vue', toggle(s.viewBobbing, (v) => ((s.viewBobbing = v), apply()))),
        setting('Vibrations', toggle(s.haptics, (v) => ((s.haptics = v), apply()))),
        setting('Position des boutons', el('div', { class: 'row', style: 'justify-content:flex-end' }, button('Personnaliser', () => editLayout(game), 'small'), button('Réinitialiser', () => (game.touch.resetLayout(), apply()), 'small'))),
        setting('Orientation', select([['landscape', 'Paysage'], ['portrait', 'Portrait'], ['auto', 'Automatique']], s.orientation, (v) => {
          s.orientation = v as typeof s.orientation;
          apply();
          void game.platform.setOrientation(s.orientation);
        })),
      );
    } else if (tab === 'audio') {
      const pct = (v: number) => `${Math.round(v * 100)} %`;
      body.append(
        setting('Musique', slider(0, 1, 0.05, s.musicVolume, (v) => ((s.musicVolume = v), apply()), pct)),
        setting('Effets sonores', slider(0, 1, 0.05, s.sfxVolume, (v) => ((s.sfxVolume = v), apply(), game.audio.play('pop')), pct)),
        setting('Ambiance', slider(0, 1, 0.05, s.ambientVolume, (v) => ((s.ambientVolume = v), apply()), pct)),
      );
    } else {
      body.append(
        setting('Difficulté', select<Difficulty>([['peaceful', 'Paisible'], ['easy', 'Facile'], ['normal', 'Normale'], ['hard', 'Difficile']], s.difficulty, (v) => {
          s.difficulty = v;
          if (game.session) game.session.meta.difficulty = v;
          apply();
        })),
        setting('Champ de vision', slider(55, 100, 1, s.fov, (v) => ((s.fov = v), apply()), (v) => `${v}°`)),
        el('p', { class: 'muted' }, `Appareil : ${game.device.gpu} · ${game.device.cores} cœurs · ${game.device.memoryGB} Go · écran ${game.device.screen}`),
      );
    }
  };
  render();
  const close = button('✕', () => game.ui.back(), 'small');
  const panel = el('div', { class: 'panel' }, el('div', { class: 'title-bar' }, el('h2', {}, 'Paramètres'), close), tabs, body);
  return {
    el: el('div', { class: 'screen dim' }, panel),
    onClose: () => game.applySettings(needsRemesh),
  };
}

/** Mode édition : les boutons tactiles deviennent déplaçables. */
function editLayout(game: Game) {
  const touch = game.touch;
  const hiddenScreens = [...game.ui.root.children] as HTMLElement[];
  hiddenScreens.forEach((e) => e.classList.add('hidden'));
  touch.setVisible(true);
  touch.setEditMode(true);
  const banner = el(
    'div',
    { class: 'edit-banner' },
    el('span', { class: 'toast' }, 'Faites glisser les boutons'),
    button('Terminer', () => {
      touch.setEditMode(false);
      if (game.state !== 'playing') touch.setVisible(false);
      game.applySettings();
      game.ui.remove(screen);
      hiddenScreens.forEach((e) => e.classList.remove('hidden'));
    }, 'primary small'),
  );
  const screen = { el: el('div', { style: 'position:absolute;inset:0;pointer-events:none' }, banner), onBack: () => true };
  banner.style.pointerEvents = 'auto';
  game.ui.push(screen);
}
