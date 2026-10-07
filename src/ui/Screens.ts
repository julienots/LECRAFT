import type { Game } from '../core/Game';
import type { Session } from '../core/Session';
import { ACHIEVEMENTS } from '../core/Progression';
import { ItemRegistry } from '../inventory/ItemRegistry';
import { SAVE_VERSION, type Difficulty, type GameMode } from '../core/Config';
import type { WorldMeta } from '../save/SaveManager';
import type { Screen } from './UIManager';
import { el, formatDuration } from './dom';
import { drawLandscape, drawLogo } from './MenuArt';
import { mcButton, mcCycle, mcInput, mcLabel, mcRow, mcScreen, mcToggle } from './Mc';

let artCache: { logo: string; land: string } | null = null;
export function resetMenuArt() {
  artCache = null;
}

/** Phrases d'accueil (originales) affichées en jaune sur l'écran titre. */
const SPLASHES = [
  '100 % hors ligne !', 'Fait de blocs !', 'Maintenant avec des lits !', 'Attention aux araignées !', 'Creusez droit vers le bas... ou pas !',
  'Des cubes partout !', 'Le blé pousse mieux près de l’eau !', 'Allez, encore une nuit !', 'Fabriqué sur téléphone !', 'Pierre, fer, diamant !',
  'Ne creusez pas sous vos pieds !', 'Les moutons sont multicolores !', 'TNT : à manier avec soin !', 'Pixel par pixel !', 'Bonjour le monde !',
  'Rien à télécharger !', 'Le sable tombe !', 'Plus de 120 blocs !', 'Des poules et des œufs !', 'Bon minage !',
];

export function mainMenu(game: Game): Screen {
  if (!artCache) artCache = { logo: drawLogo(game.textures), land: drawLandscape(game.textures) };
  const splash = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
  const root = el(
    'div',
    { class: 'screen mc-screen title-screen' },
    el('div', { class: 'panorama', style: `background-image:url(${artCache.land})` }),
    el('div', { class: 'logo-wrap' }, el('img', { class: 'logo', src: artCache.logo, alt: 'LeCraft' }), el('div', { class: 'splash' }, splash)),
    mcButton('Solo', () => game.showWorlds()),
    mcButton('Multijoueur', () => game.showServers()),
    mcRow(mcButton('Aide', () => game.showHelp(), { w: 98 }), mcButton('Crédits', () => game.showCredits(), { w: 98 })),
    el('div', { style: 'height:calc(var(--gs) * 8px)' }),
    mcRow(mcButton('Options...', () => game.showSettings(), { w: 98 }), mcButton('Quitter le jeu', () => game.back(), { w: 98 })),
    el('div', { class: 'corner l' }, `LeCraft ${__APP_VERSION__}`),
    el('div', { class: 'corner r' }, 'Jeu original, hors ligne'),
  );
  return { el: root, onBack: () => false };
}

function worldSub(w: WorldMeta) {
  const d = new Date(w.lastPlayed);
  return `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

export function worldsScreen(game: Game): Screen {
  const list = el('div', { class: 'col', style: 'align-items:center;gap:calc(var(--gs) * 2px)' }, mcLabel('Chargement…'));
  let selected: WorldMeta | null = null;
  let lastTap = 0;
  const play = mcButton('Jouer au monde sélectionné', () => selected && game.playWorld(selected), { w: 150, disabled: true });
  const edit = mcButton('Modifier', () => selected && game.ui.push(editWorldScreen(game, selected, refresh)), { w: 72, disabled: true });
  const del = mcButton('Supprimer', async () => {
    if (!selected) return;
    const w = selected;
    if (await game.ui.confirm('Voulez-vous vraiment supprimer ce monde ?', `« ${w.name} » sera perdu à jamais ! (Très longtemps !)`, 'Supprimer')) {
      await game.saves.deleteSave(w.id);
      selected = null;
      refresh();
    }
  }, { w: 72, disabled: true });
  const recreate = mcButton('Recréer', () => selected && game.recreateWorld(selected), { w: 72, disabled: true });
  const select = (w: WorldMeta | null) => {
    selected = w;
    for (const b of [play, edit, del, recreate]) b.disabled = !w;
  };
  const refresh = async () => {
    const worlds = await game.saves.listWorlds().catch(() => []);
    list.replaceChildren();
    select(null);
    if (!worlds.length) list.append(mcLabel('Aucun monde. Créez-en un !'));
    for (const w of worlds) {
      const old = (w.version ?? 1) < SAVE_VERSION;
      const entry = el(
        'div',
        { class: 'world-entry' },
        w.thumbnail ? el('img', { src: w.thumbnail, alt: '' }) : el('div', { class: 'thumb' }),
        el(
          'div',
          { style: 'min-width:0' },
          el('div', { class: 'name' }, w.name),
          el('div', { class: 'sub' }, `${worldSub(w)} · ${formatDuration(w.playTime)}`),
          el('div', { class: `sub${old ? ' old' : ''}` }, old ? 'Ancienne version (incompatible)' : `Mode ${w.gameMode === 'creative' ? 'Créatif' : 'Survie'}, graine ${w.seed}`),
        ),
      );
      entry.addEventListener('click', () => {
        const now = performance.now();
        if (selected === w && now - lastTap < 400) game.playWorld(w);
        lastTap = now;
        list.querySelectorAll('.world-entry').forEach((e) => e.classList.remove('sel'));
        entry.classList.add('sel');
        select(w);
        game.audio.play('click', { volume: 0.3 });
      });
      list.append(entry);
    }
  };
  void refresh();
  return mcScreen({
    title: 'Sélectionner un monde',
    body: [list],
    list: true,
    footer: [
      mcRow(play, mcButton('Créer un nouveau monde', () => game.showNewWorld(), { w: 150 })),
      mcRow(edit, del, recreate, mcButton('Annuler', () => game.ui.back(), { w: 72 })),
    ],
  });
}

function editWorldScreen(game: Game, w: WorldMeta, done: () => void): Screen {
  const name = mcInput(w.name, { maxlength: 32 });
  const status = mcLabel('');
  return mcScreen({
    title: 'Modifier le monde',
    body: [
      mcLabel('Nom du monde', 'left'),
      name,
      el('div', { style: 'height:calc(var(--gs) * 6px)' }),
      mcButton('Faire une sauvegarde', async () => {
        await game.saves.backupSave(w.id);
        status.textContent = 'Copie de sauvegarde créée';
        done();
      }),
      mcToggle('Activer les triches', w.cheats ?? true, (v) => (w.cheats = v), 200),
      status,
    ],
    footer: [
      mcRow(
        mcButton('Enregistrer', async () => {
          w.name = name.value.trim() || w.name;
          await game.saves.updateMeta(w);
          done();
          game.ui.back();
        }, { w: 98 }),
        mcButton('Annuler', () => game.ui.back(), { w: 98 }),
      ),
    ],
  });
}

const MODE_DESC: Record<GameMode, string> = {
  survival: 'Cherchez des ressources, fabriquez, gagnez des niveaux, de la santé et de la faim',
  creative: 'Ressources illimitées, vol libre et destruction instantanée des blocs',
};

export function newWorldScreen(game: Game): Screen {
  const name = mcInput('Nouveau monde', { maxlength: 32 });
  const seed = mcInput('', { placeholder: 'Laisser vide pour une graine aléatoire', maxlength: 40 });
  let mode: GameMode = 'survival';
  let diff: Difficulty = game.settings.difficulty === 'peaceful' ? 'normal' : game.settings.difficulty;
  let bonus = false;
  let cheats = true;
  const desc = mcLabel(MODE_DESC[mode]);
  return mcScreen({
    title: 'Créer un nouveau monde',
    body: [
      mcLabel('Nom du monde', 'left'),
      name,
      mcRow(
        mcCycle<GameMode>('Mode de jeu', [['survival', 'Survie'], ['creative', 'Créatif']], mode, (v) => {
          mode = v;
          desc.textContent = MODE_DESC[v];
        }, 150),
        mcCycle<Difficulty>('Difficulté', [['peaceful', 'Paisible'], ['easy', 'Facile'], ['normal', 'Normale'], ['hard', 'Difficile']], diff, (v) => (diff = v), 150),
      ),
      desc,
      mcLabel('Graine pour le générateur de monde', 'left'),
      seed,
      mcRow(mcToggle('Coffre bonus', bonus, (v) => (bonus = v), 150), mcToggle('Activer les triches', cheats, (v) => (cheats = v), 150)),
      mcLabel('Les triches autorisent les commandes comme /give, /tp, /time ou /gamemode.'),
    ],
    footer: [mcRow(mcButton('Créer un nouveau monde', () => game.createWorld(name.value, seed.value, mode, diff, bonus, cheats), { w: 150 }), mcButton('Annuler', () => game.ui.back(), { w: 150 }))],
  });
}

export function pauseScreen(game: Game): Screen {
  const status = mcLabel('');
  const sc = mcScreen({
    title: 'Menu du jeu',
    bg: 'dim',
    body: [
      el('div', { style: 'flex:1' }),
      mcButton('Retour au jeu', () => game.resume(), { w: 204 }),
      // vue de la caméra (le jeu original la règle dans les options, pas de bouton à l'écran)
      (() => {
        const names = ['1re personne', '3e personne (dos)', '3e personne (face)'];
        const b = mcButton(`Vue : ${names[game.session?.perspective ?? 0]}`, () => {
          game.session?.cyclePerspective();
          b.textContent = `Vue : ${names[game.session?.perspective ?? 0]}`;
        }, { w: 204 });
        return b;
      })(),
      mcRow(mcButton('Progrès', () => game.showProgress(), { w: 100 }), mcButton('Statistiques', () => game.showStats(), { w: 100 })),
      mcRow(
        mcButton('Options...', () => game.showSettings(), { w: 100 }),
        mcButton('Sauvegarder', async () => {
          status.textContent = 'Sauvegarde du monde…';
          await game.saveNow();
          status.textContent = `Sauvegardé à ${new Date().toLocaleTimeString('fr-FR')}`;
        }, { w: 100 }),
      ),
      mcButton(game.session?.meta.server ? 'Se déconnecter' : 'Sauvegarder et quitter', () => game.quitToMenu(), { w: 204 }),
      status,
      el('div', { style: 'flex:1' }),
    ],
    onBack: () => (game.resume(), true),
  });
  return sc;
}

const CAUSES: Record<string, string> = {
  mob: 'a été tué par une créature',
  fall: 'a heurté le sol trop violemment',
  lava: 'a essayé de nager dans la lave',
  drown: 's’est noyé',
  starve: 'est mort de faim',
  contact: 's’est piqué à mort',
  void: 'est tombé hors du monde',
  projectile: 'a été abattu par une flèche',
  boss: 'a été vaincu par un boss',
  fire: 'est parti en fumée',
  explosion: 'a explosé',
};

export function deathScreen(game: Game, s: Session): Screen {
  const respawn = mcButton('Réapparaître', () => game.respawn(), { disabled: true });
  const title = mcButton("Écran titre", () => game.quitToMenu(), { disabled: true });
  // comme dans le jeu de référence, les boutons s'activent après un court délai
  setTimeout(() => {
    respawn.disabled = false;
    title.disabled = false;
  }, 1000);
  const score = s.player.level * 7 + s.player.xp;
  return mcScreen({
    title: '',
    bg: 'death',
    body: [
      el('div', { class: 'mc-big' }, 'Vous êtes mort !'),
      mcLabel(`Joueur ${CAUSES[s.player.deathCause ?? 'mob'] ?? 'est mort'}`, 'white'),
      el('div', { class: 'mc-label white' }, 'Score : ', el('span', { style: 'color:#ffff55' }, String(Math.floor(score)))),
      ...(s.lastDeath ? [mcLabel(`Position : ${s.lastDeath.x}, ${s.lastDeath.y}, ${s.lastDeath.z}`)] : []),
      el('div', { style: 'height:calc(var(--gs) * 24px)' }),
      respawn,
      title,
    ],
    onBack: () => true,
  });
}

export function loadingScreen(name: string) {
  const fill = el('div');
  const label = mcLabel('Génération du terrain…', 'white');
  const screen = mcScreen({ title: '', body: [el('div', { style: 'flex:1' }), mcLabel(`Chargement de « ${name} »`, 'white'), label, el('div', { class: 'mc-progress' }, fill), el('div', { style: 'flex:1' })], onBack: () => true });
  return {
    screen,
    progress(f: number) {
      fill.style.width = `${Math.round(f * 100)}%`;
      label.textContent = f < 1 ? `Préparation de la zone d'apparition : ${Math.round(f * 100)} %` : 'Prêt !';
    },
  };
}

function textScreen(game: Game, title: string, blocks: [string, string[]][]): Screen {
  const body: HTMLElement[] = [];
  for (const [h, lines] of blocks) {
    if (h) body.push(mcLabel(h, 'yellow'));
    for (const l of lines) body.push(el('div', { class: 'mc-label white', style: 'max-width:calc(var(--gs) * 300px);text-align:left' }, l));
    body.push(el('div', { style: 'height:calc(var(--gs) * 4px)' }));
  }
  return mcScreen({ title, body, list: true, footer: [mcButton('Terminé', () => game.ui.back())] });
}

export function helpScreen(game: Game): Screen {
  return textScreen(game, 'Aide', [
    ['Commandes tactiles', ['Joystick (moitié gauche) : se déplacer.', 'Glisser à droite : orienter la caméra.', 'Maintenir à droite : miner / attaquer. Toucher : poser, ouvrir, utiliser.', 'Boutons : sauter / nager, s’accroupir, sprint, inventaire, pause.', 'Inventaire : toucher = prendre/poser, appui long = moitié/un seul, double toucher = transfert rapide, toucher hors de la fenêtre = jeter.']],
    ['Clavier / souris', ['ZQSD/WASD, Espace, Maj (accroupi), Ctrl (sprint), clic gauche/droit, molette ou 1-9, E (inventaire), Q/G (jeter), F3, Échap.']],
    ['Survie', ['Coupez du bois, fabriquez des planches puis une table de fabrication (grille 3x3).', 'Les recettes suivent les motifs classiques ; le livre de recettes (bouton vert) remplit la grille pour vous.', 'Faites cuire minerais et nourriture dans un fourneau avec du charbon ou du bois.', 'Dormez dans un lit la nuit pour passer au matin et définir votre point de réapparition.']],
    ['Packs de ressources', ['Options... > Packs de ressources : importez le .zip d’un pack ou le .jar de version de votre propre copie du jeu. Les textures des blocs, objets, créatures et interfaces sont alors utilisées, stockées uniquement sur votre appareil.']],
  ]);
}

export function creditsScreen(game: Game): Screen {
  return textScreen(game, 'Crédits', [
    ['LeCraft', ['Jeu de construction voxel original, hors ligne, pour Android.', 'Moteur : Three.js (WebGL), TypeScript, Vite, Capacitor (licences MIT).', 'Textures, icônes, modèles, police, sons et musique : générés par le code du jeu.', 'Aucun contenu d’un autre jeu n’est distribué. Les packs de ressources importés restent sur l’appareil de l’utilisateur.']],
  ]);
}

export function progressScreen(game: Game, s: Session): Screen {
  const prog = s.progression;
  prog.check(s.player.level);
  const rows = ACHIEVEMENTS.map((a) => {
    const done = prog.unlocked.has(a.id);
    return el('div', { class: `ach-row${done ? '' : ' locked'}` }, el('div', { class: 'mc-label', style: `color:${done ? '#55ff55' : '#a0a0a0'};text-align:left` }, `${done ? '✔' : '•'} ${a.name}`), el('div', { class: 'mc-label', style: 'text-align:right;flex:1' }, a.desc));
  });
  const rares = prog.rareTotal.map((k) => `${prog.rares.has(k) ? '✔' : '•'} ${ItemRegistry.get(k)?.name}`).join('  ');
  return mcScreen({
    title: 'Progrès',
    list: true,
    body: [mcLabel(`Niveau ${s.player.level} · Jour ${s.dayCycle.day + 1} · Biomes visités : ${prog.biomes.size}/14`, 'white'), mcLabel(`Objets rares (${prog.rares.size}/${prog.rareTotal.length}) : ${rares}`), ...rows],
    footer: [mcButton('Terminé', () => game.ui.back())],
  });
}

export function statsScreen(game: Game, s: Session): Screen {
  const st = s.progression.stats as Record<string, number>;
  const general: [string, string][] = [
    ['Temps de jeu', formatDuration(s.meta.playTime)],
    ['Jours écoulés', String(s.dayCycle.day + 1)],
    ['Blocs minés', String(st.blocksMined ?? 0)],
    ['Blocs posés', String(st.blocksPlaced ?? 0)],
    ['Monstres tués', String(st.monstersKilled ?? 0)],
    ['Animaux élevés', String(st.animalsBred ?? 0)],
    ['Morts', String(st.deaths ?? 0)],
    ['Nuits dormies', String(st.nightsSlept ?? 0)],
    ['Objets mangés', String(st.eaten ?? 0)],
    ['Explosions', String(st.explosions ?? 0)],
    ['Profondeur maximale', String(st.deepest ?? '-')],
  ];
  const crafted = Object.entries(st)
    .filter(([k]) => k.startsWith('craft:'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, v]) => [`Fabriqué : ${ItemRegistry.get(k.slice(6))?.name ?? k.slice(6)}`, String(v)] as [string, string]);
  const mined = Object.entries(st)
    .filter(([k]) => k.startsWith('mine:'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, v]) => [`Miné : ${ItemRegistry.get(k.slice(5))?.name ?? k.slice(5)}`, String(v)] as [string, string]);
  const row = ([a, b]: [string, string]) => el('div', { class: 'stat-row' }, el('span', {}, a), el('span', {}, b));
  return mcScreen({
    title: 'Statistiques',
    list: true,
    body: [mcLabel('Général', 'yellow'), ...general.map(row), mcLabel('Objets', 'yellow'), ...crafted.map(row), mcLabel('Blocs', 'yellow'), ...mined.map(row)],
    footer: [mcButton('Terminé', () => game.ui.back())],
  });
}
