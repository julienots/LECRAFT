import type { Game } from '../core/Game';
import type { Session } from '../core/Session';
import { ACHIEVEMENTS } from '../core/Progression';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { Screen } from './UIManager';
import { button, el, formatDuration, select } from './dom';
import { drawClouds, drawLandscape, drawLogo } from './MenuArt';
import type { Difficulty, GameMode } from '../core/Config';

let artCache: { logo: string; land: string; clouds: string } | null = null;

export function mainMenu(game: Game): Screen {
  if (!artCache) artCache = { logo: drawLogo(game.textures), land: drawLandscape(game.textures), clouds: drawClouds() };
  const click = () => game.audio.play('click', { volume: 0.5 });
  const box = el(
    'div',
    { class: 'menu-box' },
    el('img', { class: 'logo', src: artCache.logo, alt: 'LeCraft' }),
    button('▶ Jouer', () => game.continueLast(), 'primary', click),
    el('div', { class: 'grid2' }, button('Nouveau monde', () => game.showNewWorld(), '', click), button('Mondes', () => game.showWorlds(), '', click)),
    el('div', { class: 'grid2' }, button('Paramètres', () => game.showSettings(), '', click), button('Aide', () => game.showHelp(), '', click)),
    button('Crédits', () => game.showCredits(), 'small', click),
  );
  const root = el(
    'div',
    { class: 'screen main-menu' },
    el('div', { class: 'clouds', style: `background-image:url(${artCache.clouds})` }),
    el('div', { class: 'landscape', style: `background-image:url(${artCache.land})` }),
    box,
    el('div', { class: 'version' }, `LeCraft v${__APP_VERSION__} — hors ligne`),
  );
  return { el: root, onBack: () => false };
}

function panelScreen(title: string, game: Game, body: HTMLElement, extra?: HTMLElement, onClose?: () => void): Screen {
  const close = button('✕', () => game.ui.back(), 'small', () => game.audio.play('click', { volume: 0.5 }));
  const panel = el('div', { class: 'panel' }, el('div', { class: 'title-bar' }, el('h2', {}, title), extra ?? null, close), body);
  return { el: el('div', { class: 'screen dim' }, panel), onClose };
}

export function worldsScreen(game: Game): Screen {
  const list = el('div', { class: 'scroll' }, el('p', { class: 'muted' }, 'Chargement…'));
  const click = () => game.audio.play('click', { volume: 0.5 });
  const refresh = async () => {
    const worlds = await game.saves.listWorlds().catch(() => []);
    list.innerHTML = '';
    if (!worlds.length) list.append(el('p', { class: 'muted' }, 'Aucun monde sauvegardé. Créez-en un !'));
    for (const w of worlds) {
      const thumb = w.thumbnail ? el('img', { src: w.thumbnail, alt: '' }) : el('div', { class: 'thumb' });
      const card = el(
        'div',
        { class: 'world-card' },
        thumb,
        el(
          'div',
          {},
          el('div', { class: 'name' }, w.name),
          el('div', { class: 'muted' }, `${w.gameMode === 'creative' ? 'Créatif' : 'Survie'} · seed ${w.seed}`),
          el('div', { class: 'muted' }, `Créé le ${new Date(w.creationDate).toLocaleDateString('fr-FR')} · joué ${formatDuration(w.playTime)}`),
        ),
        el(
          'div',
          { class: 'actions' },
          button('Jouer', () => game.playWorld(w), 'primary small', click),
          button('Copie', async () => {
            await game.saves.backupSave(w.id);
            refresh();
          }, 'small', click),
          button('Supprimer', async () => {
            if (await game.ui.confirm('Supprimer le monde ?', `« ${w.name} » sera définitivement supprimé.`, 'Supprimer')) {
              await game.saves.deleteSave(w.id);
              refresh();
            }
          }, 'danger small', click),
        ),
      );
      list.append(card);
    }
  };
  void refresh();
  return panelScreen('Mondes', game, list, button('+ Nouveau', () => game.showNewWorld(), 'primary small', click));
}

export function newWorldScreen(game: Game): Screen {
  const name = el('input', { type: 'text', value: 'Nouveau monde', maxlength: '32' });
  const seed = el('input', { type: 'text', placeholder: 'Aléatoire (ex. 839274928)', maxlength: '40' });
  let mode: GameMode = 'survival';
  let diff: Difficulty = game.settings.difficulty;
  const body = el(
    'div',
    { class: 'scroll col' },
    el('label', { class: 'field' }, 'Nom du monde', name),
    el('label', { class: 'field' }, 'Seed (graine du monde)', seed),
    el('label', { class: 'field' }, 'Mode de jeu', select<GameMode>([['survival', 'Survie'], ['creative', 'Créatif (vol, blocs infinis)']], mode, (v) => (mode = v))),
    el('label', { class: 'field' }, 'Difficulté', select<Difficulty>([['peaceful', 'Paisible'], ['easy', 'Facile (inventaire conservé)'], ['normal', 'Normale'], ['hard', 'Difficile']], diff, (v) => (diff = v))),
    el('p', { class: 'muted' }, 'Le même seed génère toujours le même monde : terrain, biomes, grottes et structures.'),
    button('Créer le monde', () => game.createWorld(name.value, seed.value, mode, diff), 'primary', () => game.audio.play('click')),
  );
  return panelScreen('Nouveau monde', game, body);
}

export function pauseScreen(game: Game): Screen {
  const click = () => game.audio.play('click', { volume: 0.5 });
  const status = el('p', { class: 'muted', style: 'text-align:center;min-height:18px' });
  const panel = el(
    'div',
    { class: 'panel dialog col' },
    el('h2', { style: 'justify-content:center' }, 'Pause'),
    button('Reprendre', () => game.resume(), 'primary', click),
    button('Paramètres', () => game.showSettings(), '', click),
    button('Progression', () => game.showProgress(), '', click),
    button('Sauvegarder', async () => {
      status.textContent = 'Sauvegarde…';
      await game.saveNow();
      status.textContent = `Sauvegardé à ${new Date().toLocaleTimeString('fr-FR')}`;
    }, 'blue', click),
    button('Quitter vers le menu', () => game.quitToMenu(), 'danger', click),
    status,
  );
  return { el: el('div', { class: 'screen dim' }, panel), onBack: () => (game.resume(), true) };
}

export function deathScreen(game: Game, s: Session): Screen {
  const causes: Record<string, string> = { mob: 'tué par une créature', fall: 'chute mortelle', lava: 'brûlé dans la lave', drown: 'noyé', starve: 'mort de faim', contact: 'piqué à mort', void: 'tombé dans le vide', projectile: 'touché par un projectile', boss: 'vaincu par un boss', fire: 'brûlé' };
  const keep = s.player.difficulty === 'easy' || s.player.difficulty === 'peaceful';
  const panel = el(
    'div',
    { class: 'col', style: 'align-items:center;text-align:center' },
    el('h1', {}, 'Vous êtes mort !'),
    el('p', {}, `Cause : ${causes[s.player.deathCause ?? 'mob'] ?? '?'}`),
    el('p', { class: 'muted' }, keep ? 'Inventaire conservé (difficulté facile).' : 'Vos objets sont tombés sur place.'),
    el('div', { class: 'row' }, button('Réapparaître', () => game.respawn(), 'primary'), button('Menu principal', () => game.quitToMenu(), 'danger')),
  );
  return { el: el('div', { class: 'screen death' }, panel), onBack: () => true };
}

export function loadingScreen(name: string) {
  const fill = el('div');
  const label = el('p', { class: 'muted' }, 'Génération du terrain…');
  const screen: Screen = { el: el('div', { class: 'screen loading' }, el('h2', {}, `Chargement de « ${name} »`), label, el('div', { class: 'bar' }, fill)), onBack: () => true };
  return {
    screen,
    progress(f: number) {
      fill.style.width = `${Math.round(f * 100)}%`;
      label.textContent = f < 1 ? `Génération et maillage des chunks… ${Math.round(f * 100)} %` : 'Prêt !';
    },
  };
}

export function helpScreen(game: Game): Screen {
  const body = el(
    'div',
    { class: 'scroll help' },
    el('h3', {}, 'Contrôles tactiles'),
    el('ul', {}, ...['Joystick (moitié gauche) : se déplacer.', 'Glisser à droite : orienter la caméra.', 'Appui long à droite (ou bouton ⚔ maintenu) : miner / attaquer.', 'Toucher à droite (ou bouton ✋) : poser un bloc, ouvrir, manger, utiliser.', 'Boutons : ⤒ sauter / nager, ⇩ s’accroupir (empêche de tomber), » sprint, ▤ inventaire, ❚❚ pause.', 'Toucher un emplacement de la barre : sélectionner l’objet.', 'Bouton Retour Android : fermer un menu ou mettre en pause.'].map((t) => el('li', {}, t))),
    el('h3', {}, 'Clavier / souris'),
    el('p', {}, 'ZQSD/WASD : déplacement · Espace : saut · Maj : accroupi · Ctrl : sprint · Clic gauche : miner/attaquer · Clic droit : utiliser · Molette / 1-9 : barre · E : inventaire · G : jeter · F3 : infos · Échap : pause.'),
    el('h3', {}, 'Survie'),
    el('ul', {}, ...['Coupez des troncs, fabriquez des planches puis un établi.', 'Les outils plus solides permettent de miner les minerais rares : bois → pierre → cuivre → fer → aurite.', 'Faites fondre les minerais dans un four avec du charbon ou du bois.', 'La nuit, les rôdeurs et archers apparaissent : posez des torches et abritez-vous.', 'La faim baisse avec l’effort ; mangez pour régénérer votre santé.', 'Houe + graines sur terre cultivable près de l’eau = blé. Nourrissez deux animaux pour les faire se reproduire.'].map((t) => el('li', {}, t))),
    el('h3', {}, 'Aventure'),
    el('ul', {}, ...['Explorez villages, ruines, tours, temples, mines et donjons pour trouver du butin.', 'Les donjons cachent des cages à monstres et un Chef rôdeur.', 'Fabriquez la Boussole des profondeurs (fer + cristal) pour trouver le Golem des profondeurs, puis la Boussole du givre (cœur de golem) pour la Liche.', 'Le Golem est vulnérable aux pioches ; la Liche craint l’or.'].map((t) => el('li', {}, t))),
  );
  return panelScreen('Aide', game, body);
}

export function creditsScreen(game: Game): Screen {
  const body = el(
    'div',
    { class: 'scroll help' },
    el('p', {}, 'LeCraft — jeu sandbox voxel original, hors ligne, pour Android.'),
    el('p', {}, 'Moteur : Three.js (WebGL), TypeScript, Vite, Capacitor.'),
    el('p', {}, 'Textures, icônes, modèles, sons et musique : générés procéduralement par le code du jeu (aucun fichier externe, aucun contenu issu d’autres jeux).'),
    el('p', { class: 'muted' }, 'Bibliothèques open source : three.js (MIT), Capacitor (MIT).'),
  );
  return panelScreen('Crédits', game, body);
}

export function progressScreen(game: Game, s: Session): Screen {
  const prog = s.progression;
  prog.check(s.player.level);
  const st = prog.stats;
  const list = el('div', { class: 'ach-list' }, ...ACHIEVEMENTS.map((a) => el('div', { class: `ach${prog.unlocked.has(a.id) ? ' done' : ''}` }, el('b', {}, `${prog.unlocked.has(a.id) ? '🏆' : '🔒'} ${a.name}`), el('span', { class: 'muted' }, a.desc))));
  const rares = prog.rareTotal.map((k) => `${prog.rares.has(k) ? '✔' : '✗'} ${ItemRegistry.get(k)?.name}`).join(' · ');
  const body = el(
    'div',
    { class: 'scroll' },
    el('p', {}, `Niveau ${s.player.level} · Jour ${s.dayCycle.day + 1} · Biomes visités : ${prog.biomes.size}/14`),
    el('p', { class: 'muted' }, `Blocs minés ${st.blocksMined ?? 0} · posés ${st.blocksPlaced ?? 0} · monstres vaincus ${st.monstersKilled ?? 0} · morts ${st.deaths ?? 0} · animaux nés ${st.animalsBred ?? 0}`),
    el('p', { class: 'muted' }, `Collection d’objets rares (${prog.rares.size}/${prog.rareTotal.length}) : ${rares}`),
    list,
  );
  return panelScreen('Progression', game, body);
}
