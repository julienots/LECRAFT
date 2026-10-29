import type { Game } from '../core/Game';
import { applyQuality } from '../core/Settings';
import type { QualityLevel, Difficulty } from '../core/Config';
import type { Screen } from './UIManager';
import { button, el } from './dom';
import { bhButton, bhSegments, bhSelect, bhSlider, bhToggle, bhIconEl, bhSetLabel } from './Bedrock';
import { KEY_ACTIONS, keyLabel, keysFor } from '../input/KeyBindings';
import { importPack, loadInstalledPack, removePack, declineBundledPack } from '../render/ResourcePack';
import { MusicLibrary, moodFromPath } from '../audio/Music';
import { importAddon, listAddons, removeAddon, setAddonEnabled } from '../addons/AddonManager';
import { setLanguage } from './i18n';
import { tb } from './BedrockLang';
import type { GameRules } from '../commands/Commands';

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Contexte partagé par les panneaux de l'écran Paramètres. */
interface Ctx {
  game: Game;
  host: HTMLElement;
  apply: (remesh?: boolean) => void;
  goto: (id: string) => void;
}

type Pane = { title: string; desc: string; rows: (ctx: Ctx) => HTMLElement[] };

// ---------- éléments d'un panneau ----------
const head = (title: string, desc?: string) => el('div', { class: 'bh-head' }, el('div', { class: 'bh-head-t' }, tb(title)), desc ? el('div', { class: 'bh-row-d' }, tb(desc)) : null);
const note = (text: string, warn = false) => el('div', { class: `bh-banner${warn ? ' warn' : ''}` }, bhIconEl('info'), el('span', {}, tb(text)));
const text = (t: string) => el('div', { class: 'bh-text' }, tb(t));

function row(title: string, desc: string | undefined, control?: HTMLElement | null, wide = false): HTMLElement {
  return el('div', { class: `bh-row${wide ? ' wide' : ''}` }, el('div', { class: 'bh-row-l' }, el('div', { class: 'bh-row-t' }, tb(title)), desc ? el('div', { class: 'bh-row-d' }, tb(desc)) : null), control ?? null);
}

function toggleRow(title: string, desc: string | undefined, on: boolean, set: (v: boolean) => void, disabled = false) {
  return row(title, desc, bhToggle(on, set, disabled));
}

function sliderRow(title: string, desc: string | undefined, min: number, max: number, step: number, value: number, fmt: (v: number) => string, set: (v: number) => void, disabled = false) {
  const val = el('span', { class: 'bh-row-v' }, tb(fmt(value)));
  const sl = bhSlider(min, max, step, value, set, (v) => (val.textContent = tb(fmt(v))), disabled);
  return el('div', { class: 'bh-row wide' }, el('div', { class: 'bh-row-line' }, el('div', { class: 'bh-row-t' }, tb(title)), val), desc ? el('div', { class: 'bh-row-d' }, tb(desc)) : null, sl);
}

function selectRow<T extends string | number>(ctx: Ctx, title: string, desc: string | undefined, options: [T, string][], value: T, set: (v: T) => void, disabled = false) {
  return el('div', { class: 'bh-row wide' }, el('div', { class: 'bh-row-t' }, tb(title)), desc ? el('div', { class: 'bh-row-d' }, tb(desc)) : null, bhSelect(title, options, value, set, ctx.host, disabled));
}

function buttonRow(title: string, desc: string | undefined, label: string, run: () => void, disabled = false) {
  const b = bhButton(label, run, { cls: 'small', disabled });
  return row(title, desc, b);
}

/** Libellé de l'état de chaque règle du jeu. */
const RULE_NAMES: [keyof GameRules, string, string][] = [
  ['keepInventory', "Garder l'inventaire", "Conserve les objets après la mort."],
  ['doDaylightCycle', 'Cycle jour et nuit', "Le temps passe : le soleil et la lune se déplacent."],
  ['doWeatherCycle', 'Cycle météo', 'La pluie et les orages se déclenchent naturellement.'],
  ['doMobSpawning', 'Apparition des créatures', 'Les créatures apparaissent naturellement.'],
  ['mobGriefing', 'Destruction par les créatures', 'Les créatures peuvent modifier les blocs.'],
  ['tntExplodes', 'La TNT explose', 'La TNT enflammée explose.'],
  ['naturalRegeneration', 'Régénération naturelle', 'La santé se régénère quand la faim est pleine.'],
  ['fallDamage', 'Dégâts de chute', 'Les chutes de haut infligent des dégâts.'],
  ['doImmediateRespawn', 'Réapparition immédiate', "Pas d'écran de mort : réapparition instantanée."],
  ['commandBlockOutput', 'Message des blocs de commande', 'Les blocs de commande affichent leurs résultats dans le tchat.'],
];

const DIFF_DESC: Record<Difficulty, string> = {
  peaceful: "Aucune créature hostile n'apparaît. La santé se régénère et la barre de faim ne se vide pas.",
  easy: 'Les créatures hostiles apparaissent mais infligent moins de dégâts. La barre de faim se vide et peut réduire la santé jusqu’à 5 cœurs.',
  normal: 'Des créatures hostiles apparaissent et infligent des dégâts normaux. La barre de faim se vide et réduit la santé à un demi-cœur.',
  hard: 'Des créatures hostiles apparaissent et infligent de lourds dégâts. La barre de faim se vide et peut vous faire mourir.',
};

// ---------- panneaux ----------
const PANES: Record<string, Pane> = {
  profile: {
    title: 'PROFIL',
    desc: 'Votre nom et votre apparence',
    rows: ({ game, apply }) => {
      const s = game.settings;
      const name = el('input', { class: 'bh-input', type: 'text', maxlength: '16', value: s.playerName ?? game.session?.player.name ?? 'Joueur', spellcheck: 'false', autocomplete: 'off' });
      name.addEventListener('keydown', (e) => e.stopPropagation());
      name.addEventListener('input', () => {
        const v = name.value.trim().slice(0, 16);
        if (!v) return;
        s.playerName = v;
        if (game.session) game.session.player.name = v;
        apply();
      });
      return [head('JOUEUR', 'Nom affiché dans le tchat et en multijoueur'), el('div', { class: 'bh-row wide' }, el('div', { class: 'bh-row-t' }, tb('Nom du joueur')), name)];
    },
  },
  access: {
    title: 'ACCESSIBILITÉ',
    desc: 'Rendez le jeu plus confortable',
    rows: ({ game, apply }) => {
      const s = game.settings;
      return [
        head('VISIBILITÉ'),
        toggleRow('Balancement de la vue', 'La caméra oscille légèrement quand vous marchez.', s.viewBobbing, (v) => ((s.viewBobbing = v), apply())),
        head('RETOUR TACTILE'),
        toggleRow('Vibrations', "L'appareil vibre quand vous cassez un bloc ou subissez des dégâts.", s.haptics, (v) => ((s.haptics = v), apply())),
      ];
    },
  },
  world: {
    title: 'JEU',
    desc: 'Modifiez les paramètres du monde et le style de jeu',
    rows: (ctx) => {
      const { game, apply } = ctx;
      const s = game.settings, sess = game.session;
      if (!sess) return [note('Ouvrez un monde pour modifier ses paramètres.')];
      const cheats = sess.cheats;
      const out: HTMLElement[] = [];
      if (cheats) out.push(note('Vous ne pouvez pas obtenir de succès dans ce monde.'));
      const nameIn = el('input', { class: 'bh-input', type: 'text', maxlength: '32', value: sess.meta.name, spellcheck: 'false', autocomplete: 'off' });
      nameIn.addEventListener('keydown', (e) => e.stopPropagation());
      nameIn.addEventListener('input', () => {
        const v = nameIn.value.trim();
        if (v) sess.meta.name = v;
      });
      const diffDesc = el('div', { class: 'bh-row-d' }, tb(DIFF_DESC[s.difficulty]));
      out.push(
        el('div', { class: 'bh-row wide' }, el('div', { class: 'bh-row-t' }, tb('Nom du monde')), nameIn),
        el(
          'div',
          { class: 'bh-row wide' },
          el('div', { class: 'bh-row-t' }, tb('Difficulté')),
          bhSegments<Difficulty>([['peaceful', 'Paisible'], ['easy', 'Facile'], ['normal', 'Normale'], ['hard', 'Difficile']], s.difficulty, (v) => {
            s.difficulty = v;
            sess.meta.difficulty = v;
            diffDesc.textContent = tb(DIFF_DESC[v]);
            apply();
          }),
          diffDesc,
        ),
        selectRow(ctx, 'Mode de jeu', cheats ? 'Change votre mode de jeu actuel.' : 'Les triches sont désactivées dans ce monde.', [['survival', 'Survie'], ['creative', 'Créatif']] as [string, string][], sess.player.creative ? 'creative' : 'survival', (v) => {
          sess.runCommand(`/gamemode ${v}`);
        }, !cheats),
        head('AFFICHAGE'),
        toggleRow('Afficher les coordonnées', 'Affiche votre position en haut à gauche de l’écran.', sess.gamerules.showCoordinates, (v) => (sess.gamerules.showCoordinates = v)),
        toggleRow('Afficher le nombre de jours joués', 'Affiche le nombre de jours écoulés dans ce monde.', !!s.showDaysPlayed, (v) => ((s.showDaysPlayed = v), apply())),
        head('RÈGLES DU JEU', cheats ? 'Modifiez le fonctionnement du monde' : 'Activez les triches du monde pour modifier ces règles'),
        ...RULE_NAMES.map(([key, title, desc]) => toggleRow(title, desc, sess.gamerules[key], (v) => (sess.gamerules[key] = v), !cheats)),
        head('PARTIE'),
        buttonRow('Sauvegarder maintenant', 'Enregistre le monde sur cet appareil.', 'Sauvegarder', () => void game.saveNow()),
      );
      return out;
    },
  },
  multi: {
    title: 'MULTIJOUEUR',
    desc: 'Invitez d’autres joueurs dans votre monde',
    rows: ({ game }) => {
      const sess = game.session;
      if (!sess) return [note('Ouvrez un monde pour inviter des joueurs.')];
      if (sess.meta.server || sess.meta.remote) return [note('Vous êtes connecté à la partie d’un autre joueur : seul son hôte peut la gérer.')];
      const n = sess.netHost ? sess.netHost.playerCount : 1;
      return [
        head('PARTIE MULTIJOUEUR', 'Partage du monde en réseau'),
        text(sess.netHost ? `La partie est ouverte : ${n} joueur${n > 1 ? 's' : ''} connecté${n > 1 ? 's' : ''}.` : 'La partie est fermée : vous jouez seul.'),
        buttonRow(sess.netHost ? 'Gérer la partie' : 'Ouvrir au multijoueur', 'Choisissez le salon et partagez le lien.', 'Ouvrir…', () => game.showHostScreen()),
      ];
    },
  },
  kbm: {
    title: 'CLAVIER ET SOURIS',
    desc: 'Réglages de la souris et des touches du clavier',
    rows: ({ game, apply }) => {
      const s = game.settings;
      const label = (a: (typeof KEY_ACTIONS)[number]) => keysFor(a.id, s.keys).filter((k) => !(a.fixed ?? []).includes(k)).map(keyLabel).join(' / ');
      const rows: HTMLButtonElement[] = [];
      const refresh = () => rows.forEach((b, i) => bhSetLabel(b, label(KEY_ACTIONS[i])));
      const keyRows = KEY_ACTIONS.map((a) => {
        const b = bhButton(label(a), () => {
          bhSetLabel(b, '> Appuyez sur une touche <');
          game.keyboard.capture = (code) => {
            // Échap annule ; une touche déjà prise est libérée de son ancienne action
            if (code !== 'Escape') {
              s.keys = { ...(s.keys ?? {}) };
              for (const o of KEY_ACTIONS) if (o.id !== a.id && keysFor(o.id, s.keys).includes(code) && !(o.fixed ?? []).includes(code)) delete s.keys[o.id];
              s.keys[a.id] = code;
              game.applySettings(false);
            }
            refresh();
          };
        }, { cls: 'small keybtn' });
        b.dataset.key = a.id;
        rows.push(b);
        return row(a.name, undefined, b);
      });
      return [
        head('SOURIS'),
        sliderRow('Sensibilité', 'Vitesse de rotation de la caméra.', 0.2, 3, 0.05, s.sensitivity, (v) => `${Math.round(v * 50)} %`, (v) => ((s.sensitivity = v), apply())),
        toggleRow('Inverser l’axe vertical', 'Pousser vers le haut regarde vers le bas.', s.invertY, (v) => ((s.invertY = v), apply())),
        head('TOUCHES', 'Touchez une action puis appuyez sur la nouvelle touche'),
        ...keyRows,
        buttonRow('Touches par défaut', undefined, 'Réinitialiser', () => {
          s.keys = {};
          game.applySettings(false);
          refresh();
        }),
      ];
    },
  },
  pad: {
    title: 'MANETTE',
    desc: 'Réglages de la manette',
    rows: ({ game, apply }) => {
      const s = game.settings;
      return [
        text('Branchez une manette ou appairez-la en Bluetooth : elle est reconnue automatiquement et remplace les commandes tactiles.'),
        head('VISÉE'),
        sliderRow('Sensibilité', 'Vitesse de rotation avec le joystick droit.', 0.2, 3, 0.05, s.sensitivity, (v) => `${Math.round(v * 50)} %`, (v) => ((s.sensitivity = v), apply())),
        toggleRow('Inverser l’axe vertical', 'Pousser vers le haut regarde vers le bas.', s.invertY, (v) => ((s.invertY = v), apply())),
      ];
    },
  },
  touch: {
    title: 'TOUCHER',
    desc: 'Options de saisie, paramètres de sensibilité et configuration des commandes pour les écrans tactiles.',
    rows: (ctx) => {
      const { game, apply } = ctx;
      const s = game.settings;
      const preview = el('div', { class: 'bh-pad' }, el('div', { class: 'bh-pad-joy' }, el('i', {})), el('div', { class: 'bh-pad-btns' }, el('i', {}), el('i', {})));
      return [
        buttonRow('Commandes personnalisées', 'Permet de modifier la taille et la position des boutons à l’écran afin de s’adapter à votre style de jeu.', 'Personnaliser', () => editLayout(game)),
        el(
          'div',
          { class: 'bh-row wide' },
          el('div', { class: 'bh-pad-row' }, el('div', { class: 'bh-row-l' }, el('div', { class: 'bh-row-t' }, tb('Mode de contrôle')), el('div', { class: 'bh-row-d' }, tb('Faites glisser le joystick pour vous déplacer. Faites glisser n’importe où pour regarder autour de vous. Appuyez longuement sur les blocs pour interagir avec eux.'))), preview),
          bhSelect('Mode de contrôle', [['joystick', 'Joystick et appuyer pour interagir'], ['dpad', 'Croix directionnelle']] as ['joystick' | 'dpad', string][], s.controlScheme ?? 'joystick', (v) => ((s.controlScheme = v), apply()), ctx.host),
        ),
        selectRow(ctx, 'Visée', 'Interagir à l’endroit touché ou au viseur central.', [['finger', 'Au doigt'], ['crosshair', 'Au viseur']] as ['finger' | 'crosshair', string][], s.touchAim ?? 'finger', (v) => ((s.touchAim = v), apply())),
        sliderRow('Sensibilité', 'Vitesse de rotation de la caméra au toucher.', 0.2, 3, 0.05, s.sensitivity, (v) => `${Math.round(v * 50)} %`, (v) => ((s.sensitivity = v), apply())),
        toggleRow('Inverser l’axe vertical', 'Faire glisser vers le haut regarde vers le bas.', s.invertY, (v) => ((s.invertY = v), apply())),
        toggleRow('Saut automatique', 'Saute automatiquement par-dessus les blocs d’une hauteur.', s.autoJump, (v) => ((s.autoJump = v), apply())),
        toggleRow('Mode gaucher', 'Inverse la disposition des commandes.', s.leftHanded, (v) => ((s.leftHanded = v), apply())),
        sliderRow('Taille du joystick', undefined, 80, 200, 5, s.joystickSize, (v) => `${v}`, (v) => ((s.joystickSize = v), apply())),
        sliderRow('Taille des boutons', undefined, 0.7, 1.5, 0.05, s.buttonScale, pct, (v) => ((s.buttonScale = v), apply())),
        selectRow(ctx, 'Orientation de l’écran', undefined, [['landscape', 'Paysage'], ['portrait', 'Portrait'], ['auto', 'Automatique']] as ['landscape' | 'portrait' | 'auto', string][], s.orientation, (v) => {
          s.orientation = v;
          apply();
          void game.platform.setOrientation(s.orientation);
        }),
        buttonRow('Disposition par défaut', 'Remet les boutons à leur place d’origine.', 'Réinitialiser', () => (game.touch.resetLayout(), apply())),
      ];
    },
  },
  group: {
    title: 'GROUPE',
    desc: 'Amis et groupes',
    rows: () => [note('Les groupes et les listes d’amis ne sont pas disponibles dans LeCraft. Pour jouer à plusieurs, utilisez Multijoueur.')],
  },
  general: {
    title: 'GÉNÉRAL',
    desc: 'Réglages généraux du jeu',
    rows: (ctx) => {
      const { game, apply } = ctx;
      const s = game.settings;
      return [
        head('LANGUE'),
        selectRow(ctx, 'Langue', 'Langue des menus et des noms d’objets.', [['fr', 'Français'], ['en', 'English']] as ['fr' | 'en', string][], s.language ?? 'fr', (v) => {
          s.language = v;
          setLanguage(v);
          apply();
        }),
      ];
    },
  },
  video: {
    title: 'VIDÉO',
    desc: 'Réglez la qualité graphique et visuelle',
    rows: (ctx) => {
      const { game, apply } = ctx;
      const s = game.settings;
      const sess = game.session;
      const views = ['Première personne', 'Troisième personne (arrière)', 'Troisième personne (avant)'];
      return [
        head('GÉNÉRAL', 'Paramètres vidéo généraux'),
        sliderRow('Champ de vision', 'Angle de vue de la caméra en jeu', 30, 110, 1, s.fov, (v) => `${v}°`, (v) => ((s.fov = v), apply())),
        selectRow(ctx, 'Point de vue caméra', sess ? 'Sélectionner le point de vue de la caméra en jeu' : 'Disponible une fois dans un monde', views.map((v, i) => [i, v] as [number, string]), sess?.perspective ?? 0, (v) => {
          while (sess && sess.perspective !== v) sess.cyclePerspective();
        }, !sess),
        toggleRow('Balancement de la vue', 'La caméra oscille légèrement quand vous marchez.', s.viewBobbing, (v) => ((s.viewBobbing = v), apply())),
        head('GRAPHISME, PERFORMANCES ET CONFIGURATION', 'Contrôlez l’apparence et les performances du jeu'),
        selectRow(ctx, 'Qualité graphique', 'Profil de réglages (distance, ombres, eau, nuages…).', [['LOW', 'Basse'], ['MEDIUM', 'Moyenne'], ['HIGH', 'Haute']] as [QualityLevel, string][], s.quality, (v) => (applyQuality(s, v), apply(true))),
        sliderRow('Distance d’affichage', 'Nombre de tronçons de terrain affichés autour de vous.', 2, 16, 1, s.renderDistance, (v) => `${v} tronçons`, (v) => ((s.renderDistance = v), apply())),
        sliderRow('Résolution', 'Définition du rendu 3D (moins = plus fluide).', 0.75, 1, 0.05, s.resolutionScale, pct, (v) => ((s.resolutionScale = v), apply())),
        selectRow(ctx, 'Limite d’images par seconde', undefined, [[30, '30'], [45, '45'], [60, '60']] as [number, string][], s.fpsCap, (v) => ((s.fpsCap = v as 30 | 45 | 60), apply())),
        toggleRow('Qualité automatique', 'Ajuste la résolution et la distance selon la fluidité.', s.autoQuality, (v) => ((s.autoQuality = v), apply())),
        toggleRow('Afficher les images par seconde', undefined, s.showFps, (v) => ((s.showFps = v), apply())),
        head('EFFETS VISUELS'),
        selectRow(ctx, 'Ombres', undefined, [['off', 'Désactivées'], ['blob', 'Créatures'], ['blob+ao', 'Créatures et occlusion ambiante']] as [string, string][], s.shadows, (v) => ((s.shadows = v as typeof s.shadows), apply())),
        selectRow(ctx, 'Particules', undefined, [['high', 'Toutes'], ['low', 'Réduites'], ['off', 'Minimales']] as [string, string][], s.particles, (v) => ((s.particles = v as typeof s.particles), apply())),
        selectRow(ctx, 'Eau', undefined, [['animated', 'Animée'], ['simple', 'Simple']] as [string, string][], s.waterQuality, (v) => ((s.waterQuality = v as typeof s.waterQuality), apply())),
        selectRow(ctx, 'Éclairage', 'Soleil, eau réfléchissante, brouillard.', [['on', 'Activé'], ['ultra', 'Ultra (ombres projetées)'], ['off', 'Désactivé']] as [string, string][], s.shaders, (v) => ((s.shaders = v as typeof s.shaders), apply())),
        toggleRow('Nuages', undefined, s.clouds, (v) => ((s.clouds = v), apply(true))),
        toggleRow('Voir à travers les portails', 'Affiche la dimension d’arrivée dans le cadre du portail.', s.portalView ?? s.quality !== 'LOW', (v) => ((s.portalView = v), apply())),
        text(`Profil détecté : ${game.device.level} (${game.device.reason})`),
      ];
    },
  },
  audio: {
    title: 'AUDIO',
    desc: 'Réglez le volume et la musique',
    rows: (ctx) => {
      const { game, apply } = ctx;
      const s = game.settings;
      const musicInfo = text('');
      const musicStatus = text('');
      const musicFile = el('input', { type: 'file', accept: 'audio/*,.ogg,.mp3,.wav,.m4a', multiple: '', style: 'display:none' }) as HTMLInputElement;
      const showMusic = () => {
        void MusicLibrary.list().then((l) => {
          const now = game.audio.nowPlaying;
          musicInfo.textContent = `${now ? `En cours : « ${now} » · ` : ''}${l.length ? `${l.length} musique(s) importée(s)` : 'Compositions du jeu (piano, nappes, cloches)'}`;
        });
      };
      musicFile.addEventListener('change', async () => {
        const files = [...(musicFile.files ?? [])];
        if (!files.length) return;
        musicStatus.textContent = 'Import…';
        try {
          const n = await MusicLibrary.add(files.map((f) => ({ name: f.name, mood: moodFromPath(f.name), blob: f })));
          await game.audio.reloadTracks();
          musicStatus.textContent = `${n} musique(s) importée(s). Elles restent sur cet appareil ; l'ambiance est déduite du nom (nether, end, menu, creative, water, night…).`;
        } catch (e) {
          musicStatus.textContent = `Échec de l'import : ${(e as Error).message}`;
        }
        musicFile.value = '';
        showMusic();
      });
      showMusic();
      return [
        head('VOLUME'),
        sliderRow('Musique', undefined, 0, 1, 0.05, s.musicVolume, (v) => (v === 0 ? 'Désactivée' : pct(v)), (v) => ((s.musicVolume = v), apply())),
        sliderRow('Blocs et créatures', undefined, 0, 1, 0.05, s.sfxVolume, (v) => (v === 0 ? 'Désactivé' : pct(v)), (v) => ((s.sfxVolume = v), apply(), game.audio.play('pop'))),
        sliderRow('Ambiance et environnement', undefined, 0, 1, 0.05, s.ambientVolume, (v) => (v === 0 ? 'Désactivée' : pct(v)), (v) => ((s.ambientVolume = v), apply())),
        head('MUSIQUE', 'Compositions du jeu ou vos propres fichiers'),
        buttonRow('Morceau suivant', undefined, 'Suivant', () => {
          game.audio.skipMusic();
          setTimeout(showMusic, 1500);
        }),
        buttonRow('Importer des musiques', 'Fichiers audio stockés sur cet appareil.', 'Importer…', () => musicFile.click()),
        buttonRow('Retirer mes musiques', undefined, 'Retirer', async () => {
          await MusicLibrary.clear();
          await game.audio.reloadTracks();
          musicStatus.textContent = 'Musiques importées retirées : seules les compositions du jeu sont jouées.';
          showMusic();
        }),
        musicInfo,
        musicStatus,
        musicFile,
      ];
    },
  },
  account: {
    title: 'COMPTE',
    desc: 'Votre profil de joueur',
    rows: ({ game }) => {
      const sess = game.session;
      return [
        note('Les comptes en ligne ne sont pas disponibles : LeCraft conserve vos mondes et réglages sur cet appareil.'),
        head('PROGRESSION'),
        buttonRow('Progrès', 'Les succès débloqués dans ce monde.', 'Afficher', () => game.showProgress(), !sess),
        buttonRow('Statistiques', 'Distances, blocs cassés, créatures vaincues…', 'Afficher', () => game.showStats(), !sess),
      ];
    },
  },
  global: {
    title: 'RESSOURCES GLOBALES',
    desc: 'Ressources appliquées à tous vos mondes',
    rows: ({ game, goto }) => {
      const n = game.textures.packName;
      return [
        text(n ? `Pack actif dans tous les mondes : ${n}` : 'Aucun pack importé : textures du jeu par défaut.'),
        buttonRow('Packs de ressources', 'Importez ou retirez un pack de textures.', 'Gérer…', () => goto('packs')),
      ];
    },
  },
  creator: {
    title: 'CRÉATEUR',
    desc: 'Outils pour les créateurs et informations techniques',
    rows: ({ game }) => {
      const d = game.device;
      return [
        head('DÉBOGAGE'),
        toggleRow('Afficher l’écran de débogage', 'Position, tronçons, appels de rendu (touche F3 au clavier).', false, (v) => game.hud.setDebug(v)),
        head('APPAREIL'),
        text(`GPU : ${d.gpu}`),
        text(`${d.cores} cœurs · ${d.memoryGB} Go · écran ${d.screen}`),
        text(`Profil de performance : ${d.level} (${d.reason})`),
      ];
    },
  },
  packs: {
    title: 'PACKS DE RESSOURCES',
    desc: 'Textures, sons et interfaces personnalisés',
    rows: ({ game }) => {
      const status = text('');
      const current = text('');
      const progress = el('div', { class: 'bh-progress', style: 'display:none' }, el('div'));
      const file = el('input', { type: 'file', accept: '.zip,.jar,application/zip,application/java-archive', style: 'display:none' });
      const show = () => {
        const n = game.textures.packName;
        current.textContent = n ? `Pack actif : ${n}` : 'Pack actif : Par défaut (textures du jeu)';
        remove.disabled = !n;
      };
      file.addEventListener('change', async () => {
        const f = file.files?.[0];
        if (!f) return;
        status.textContent = 'Lecture du pack…';
        progress.style.display = '';
        const bar = progress.firstChild as HTMLElement;
        try {
          const info = await importPack(f, (x) => (bar.style.width = `${Math.round(x * 100)}%`));
          status.textContent = `${info.files} textures${info.sounds ? ` et ${info.sounds} sons` : ''} importés. Application…`;
          if (info.music) await game.audio.reloadTracks();
          const pack = info.files || info.sounds ? await loadInstalledPack() : null;
          if (info.files || info.sounds) game.applyPack(pack);
          status.textContent = `${info.files} textures${info.sounds ? `, ${info.sounds} sons (créatures, blocs)` : ''}${info.music ? ` et ${info.music} musiques` : ''} importés depuis « ${info.name} ».`;
        } catch (e) {
          status.textContent = `Échec de l'import : ${(e as Error).message}`;
        }
        progress.style.display = 'none';
        file.value = '';
        show();
      });
      const remove = bhButton('Retirer', async () => {
        await removePack();
        declineBundledPack();
        game.applyPack(null);
        status.textContent = 'Textures par défaut rétablies.';
        show();
      }, { cls: 'small' });
      show();
      return [
        current,
        text('Importez un pack de ressources (.zip) ou le fichier .jar de version de votre propre copie du jeu : les textures des blocs, objets, créatures et interfaces seront utilisées.'),
        text('Les fichiers restent uniquement sur cet appareil. LeCraft ne contient ni ne télécharge aucune texture d’un autre jeu.'),
        buttonRow('Importer un pack', undefined, 'Importer…', () => file.click()),
        row('Retirer le pack', 'Rétablit les textures par défaut.', remove),
        progress,
        status,
        file,
      ];
    },
  },
  addons: {
    title: 'ADD-ONS',
    desc: 'Blocs, objets, recettes et créatures supplémentaires',
    rows: ({ game }) => {
      const list = el('div', { class: 'bh-list' });
      const status = text('');
      const restart = bhButton('Redémarrer pour appliquer', async () => {
        if (game.session) await game.saveNow();
        location.reload();
      }, { cls: 'small' });
      restart.style.display = 'none';
      const changed = () => (restart.style.display = '');
      const file = el('input', { type: 'file', accept: '.mcaddon,.mcpack,.zip,application/zip,application/octet-stream', style: 'display:none' });
      const typeName: Record<string, string> = { resources: 'ressources', data: 'comportement', script: 'scripts', skin_pack: 'skins', world_template: 'modèle de monde', unknown: 'inconnu' };
      const refresh = async () => {
        const all = await listAddons();
        list.replaceChildren();
        if (!all.length) list.append(text('Aucun add-on installé.'));
        for (const a of all) {
          const packs = a.packs.map((p) => `${typeName[p.type] ?? p.type}${p.hasScripts ? ' (scripts ignorés)' : ''}`).join(' + ');
          list.append(
            el(
              'div',
              { class: 'bh-row wide' },
              el('div', { class: 'bh-row-t' }, a.name),
              el('div', { class: 'bh-row-d' }, `${a.fileName} · ${packs}`),
              a.packs[0]?.description ? el('div', { class: 'bh-row-d' }, a.packs[0].description) : null,
              el(
                'div',
                { class: 'bh-inline' },
                el('span', {}, tb('Activé')),
                bhToggle(a.enabled, async (v) => {
                  await setAddonEnabled(a.id, v);
                  changed();
                }),
                bhButton('Supprimer', async () => {
                  if (await game.ui.confirm('Supprimer cet add-on ?', `« ${a.name} » sera retiré. Les blocs qu'il ajoutait deviendront des « blocs inconnus » dans vos mondes.`, 'Supprimer')) {
                    await removeAddon(a.id);
                    changed();
                    void refresh();
                  }
                }, { cls: 'small' }),
              ),
            ),
          );
        }
      };
      file.addEventListener('change', async () => {
        const f = file.files?.[0];
        if (!f) return;
        status.textContent = 'Import en cours…';
        try {
          const a = await importAddon(f);
          status.textContent = `« ${a.name} » importé (${a.packs.length} pack(s)).`;
          changed();
          void refresh();
        } catch (e) {
          status.textContent = `Échec de l'import : ${(e as Error).message}`;
        }
        file.value = '';
      });
      const r = game.addonResult;
      const loaded = r && (r.counts.blocks || r.counts.items || r.counts.mobs || r.counts.recipes || r.counts.textures || r.counts.functions)
        ? `Chargés : ${r.counts.blocks} blocs, ${r.counts.items} objets, ${r.counts.recipes} recettes, ${r.counts.mobs} créatures, ${r.counts.functions} fonctions, ${r.counts.textures} textures.`
        : '';
      void refresh();
      return [
        text('Importez des add-ons de l’édition mobile (.mcaddon, .mcpack) : nouveaux blocs, objets, recettes, créatures, textures, fonctions. Les scripts JavaScript ne sont pas exécutés.'),
        buttonRow('Importer un add-on', undefined, 'Importer…', () => file.click()),
        status,
        loaded ? text(loaded) : null,
        ...(r?.report ?? []).map((t) => el('div', { class: 'bh-text warn' }, t)),
        restart,
        list,
        file,
      ].filter(Boolean) as HTMLElement[];
    },
  },
};

type NavEntry = { id: string; label: string; item: string; sess?: boolean };
const NAV: { header: string; items: NavEntry[] }[] = [
  { header: 'Profil', items: [{ id: 'profile', label: 'Profil', item: 'player_head' }, { id: 'access', label: 'Accessibilité', item: 'ender_eye' }] },
  { header: 'Monde', items: [{ id: 'world', label: 'Jeu', item: 'grass_block', sess: true }, { id: 'multi', label: 'Multijoueur', item: 'compass', sess: true }] },
  { header: 'Commandes', items: [{ id: 'kbm', label: 'Clavier-souris', item: 'oak_button' }, { id: 'pad', label: 'Manette', item: 'repeater' }, { id: 'touch', label: 'Toucher', item: 'oak_sign' }] },
  { header: 'Social', items: [{ id: 'group', label: 'Groupe', item: 'cake' }] },
  { header: 'Général', items: [{ id: 'general', label: 'Général', item: 'redstone_lamp' }, { id: 'video', label: 'Vidéo', item: 'painting' }, { id: 'audio', label: 'Audio', item: 'jukebox' }, { id: 'account', label: 'Compte', item: 'obsidian' }, { id: 'global', label: 'Ressources globales', item: 'chest' }, { id: 'creator', label: 'Créateur', item: 'command_block' }] },
  { header: 'Extensions', items: [{ id: 'packs', label: 'Packs de ressources', item: 'bookshelf' }, { id: 'addons', label: 'Add-ons', item: 'crafting_table' }] },
];

/**
 * Écran « Paramètres » de l'édition mobile : barre claire avec retour et titre, liste des
 * catégories à gauche (Monde, Commandes, Général, Extensions…), options de la catégorie à droite.
 */
export function settingsScreen(game: Game, initial?: string): Screen {
  let remesh = false;
  const apply = (r = false) => {
    remesh ||= r;
    game.applySettings(false);
  };
  const back = bhButton('', () => game.ui.back(), { cls: 'bh-back' });
  back.setAttribute('aria-label', 'Retour');
  back.append(bhIconEl('back'));
  const nav = el('nav', { class: 'bh-nav' });
  const pane = el('main', { class: 'bh-pane' });
  const root = el('div', { class: 'screen bh-settings' }, el('div', { class: 'bh-bar' }, back, el('div', { class: 'bh-bar-title' }, tb('PARAMÈTRES'))), el('div', { class: 'bh-set-body' }, nav, pane));
  const items = new Map<string, HTMLElement>();
  const entries = NAV.flatMap((g) => g.items).filter((e) => !e.sess || !!game.session);
  let current = '';
  const icon = (id: string) => {
    try {
      return `url(${game.textures.iconURL(id)})`;
    } catch {
      return '';
    }
  };
  const ctx: Ctx = { game, host: root, apply, goto: (id) => select(id) };
  const select = (id: string) => {
    if (!PANES[id]) id = entries[0].id;
    current = id;
    items.forEach((b, k) => b.classList.toggle('on', k === id));
    const p = PANES[id];
    pane.replaceChildren(el('div', { class: 'bh-pane-in' }, el('div', { class: 'bh-head big' }, el('div', { class: 'bh-head-t' }, tb(p.title)), el('div', { class: 'bh-row-d' }, tb(p.desc))), ...p.rows(ctx)));
    pane.scrollTop = 0;
  };
  for (const g of NAV) {
    const its = g.items.filter((e) => !e.sess || !!game.session);
    if (!its.length) continue;
    nav.append(el('div', { class: 'bh-nav-h' }, tb(g.header)));
    for (const e of its) {
      const ic = el('i', { class: 'bh-nav-ic' });
      ic.style.backgroundImage = icon(e.item);
      const b = el('button', { class: 'bh-nav-i', type: 'button', 'data-nav': e.id }, ic, el('span', {}, tb(e.label)));
      b.addEventListener('click', () => {
        game.keyboard.capture = null;
        select(e.id);
      });
      items.set(e.id, b);
      nav.append(b);
    }
  }
  select(initial && PANES[initial] ? initial : game.session ? 'world' : 'general');
  void current;
  return {
    el: root,
    onBack: () => {
      game.keyboard.capture = null;
      return false;
    },
    onClose: () => {
      game.keyboard.capture = null;
      game.applySettings(remesh);
    },
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
  const screen = { el: el('div', { style: 'position:absolute;inset:0;pointer-events:none' }, banner), onBack: () => ((banner.querySelector('button') as HTMLButtonElement | null)?.click(), true) };
  banner.style.pointerEvents = 'auto';
  game.ui.push(screen);
}
