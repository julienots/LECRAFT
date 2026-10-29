import type { Game } from '../core/Game';
import type { Session } from '../core/Session';
import { ACHIEVEMENTS } from '../core/Progression';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { Screen } from './UIManager';
import { el, formatDuration } from './dom';
import { mcButton, mcLabel, mcScreen } from './Mc';
import { mainMenu as bmMainMenu, playScreen, createFromScreen, resetBedrockArt, loadingScreen as bmLoading } from './BedrockMenus';
import { bmRow, bmScreen, bmSection } from './BedrockUI';

export function resetMenuArt() {
  resetBedrockArt();
}

/** Écran titre (voir BedrockMenus). */
export function mainMenu(game: Game): Screen {
  return bmMainMenu(game);
}

/** Écran Jouer (onglet Mondes). */
export function worldsScreen(game: Game): Screen {
  return playScreen(game, 'worlds');
}

/** Créer un nouveau monde : passe par « Créer à partir de… » comme le jeu de référence. */
export function newWorldScreen(game: Game): Screen {
  return createFromScreen(game);
}

export { playScreen };

/** Menu de pause : voir PauseUI.ts (interface de l'édition mobile). */
export { pauseScreen } from './PauseUI';

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
  player: 'a été tué par un autre joueur',
  explosion: 'a explosé',
};

/** Message de mort du jeu original : « Joueur a été tué par Zombie », « Joueur s'est noyé »… */
function deathMessage(s: Session): string {
  const p = s.player;
  const cause = p.deathCause ?? 'mob';
  const who = p.name || 'Joueur';
  const att = p.lastAttacker as { def?: { name?: string }; name?: string } | null;
  const by = att && att !== (p as unknown) ? att.def?.name ?? att.name : undefined;
  if (by && (cause === 'mob' || cause === 'boss' || cause === 'player')) return `${who} a été tué par ${by}`;
  if (by && cause === 'projectile') return `${who} a été abattu par ${by}`;
  return `${who} ${CAUSES[cause] ?? 'est mort'}`;
}

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
      mcLabel(deathMessage(s), 'white'),
      el('div', { class: 'mc-label white' }, 'Score : ', el('span', { style: 'color:#ffff55' }, String(Math.floor(score)))),
      ...(s.lastDeath ? [mcLabel(`Position : ${s.lastDeath.x}, ${s.lastDeath.y}, ${s.lastDeath.z}`)] : []),
      el('div', { style: 'height:calc(var(--gs) * 24px)' }),
      respawn,
      title,
    ],
    onBack: () => true,
  });
}

/** Écran de chargement du monde (logo, astuce, barre verte) sur le dernier décor affiché. */
export function loadingScreen(game: Game, title: string, bg: string | null) {
  return bmLoading(game, title, bg);
}

function textScreen(game: Game, title: string, blocks: [string, string[]][]): Screen {
  const rows: HTMLElement[] = [];
  for (const [h, lines] of blocks) {
    if (h) rows.push(...bmSection(h));
    for (const l of lines) rows.push(bmRow(l));
  }
  const right = el('div', { class: 'bm-right' }, ...rows);
  right.style.flex = '1';
  const s = bmScreen(game, { cls: 'bm-create', title, solid: true, body: [el('div', { class: 'bm-cols' }, right)] });
  return { el: s.el, onBack: s.onBack };
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
