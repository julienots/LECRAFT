import type { Game } from '../core/Game';
import { applyQuality } from '../core/Settings';
import type { QualityLevel, Difficulty } from '../core/Config';
import type { Screen } from './UIManager';
import { button, el } from './dom';
import { mcButton, mcCycle, mcGrid, mcLabel, mcRow, mcScreen, mcSlider, mcToggle } from './Mc';
import { importPack, loadInstalledPack, removePack } from '../render/ResourcePack';
import { importAddon, listAddons, removeAddon, setAddonEnabled } from '../addons/AddonManager';

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Écran « Options » principal (structure des options du jeu de référence). */
export function settingsScreen(game: Game): Screen {
  const s = game.settings;
  const apply = () => game.applySettings(false);
  const sub = (fn: (g: Game) => Screen) => () => game.ui.push(fn(game));
  return mcScreen({
    title: 'Options',
    bg: game.session ? 'dim' : 'dirt',
    body: [
      mcGrid(
        mcSlider((v) => `Champ de vision : ${v === 70 ? 'Normal' : v >= 100 ? 'Quake Pro' : v}`, 30, 110, 1, s.fov, (v) => ((s.fov = v), apply())),
        mcCycle<Difficulty>('Difficulté', [['peaceful', 'Paisible'], ['easy', 'Facile'], ['normal', 'Normale'], ['hard', 'Difficile']], s.difficulty, (v) => {
          s.difficulty = v;
          if (game.session) game.session.meta.difficulty = v;
          apply();
        }),
      ),
      el('div', { style: 'height:calc(var(--gs) * 8px)' }),
      mcGrid(
        mcButton('Graphismes...', sub(videoScreen), { w: 150 }),
        mcButton('Musique et sons...', sub(audioScreen), { w: 150 }),
        mcButton('Commandes...', sub(controlsScreen), { w: 150 }),
        mcButton('Packs de ressources...', sub(packsScreen), { w: 150 }),
        mcButton('Add-ons (.mcaddon)...', sub(addonsScreen), { w: 150 }),
        mcButton('Accessibilité...', sub(accessScreen), { w: 150 }),
        mcButton('Infos appareil...', sub(deviceScreen), { w: 150 }),
      ),
    ],
    footer: [mcButton('Terminé', () => game.ui.back())],
    onClose: () => game.applySettings(false),
  });
}

function videoScreen(game: Game): Screen {
  const s = game.settings;
  let remesh = false;
  const apply = (r = false) => {
    remesh ||= r;
    game.applySettings(false);
  };
  return mcScreen({
    title: 'Graphismes',
    bg: game.session ? 'dim' : 'dirt',
    list: true,
    body: [
      mcGrid(
        mcCycle<QualityLevel>('Qualité', [['LOW', 'Basse'], ['MEDIUM', 'Moyenne'], ['HIGH', 'Haute']], s.quality, (v) => (applyQuality(s, v), apply(true))),
        mcSlider((v) => `Distance de rendu : ${v} tronçons`, 2, 10, 1, s.renderDistance, (v) => ((s.renderDistance = v), apply())),
        mcCycle<number>('FPS max', [[30, '30'], [45, '45'], [60, '60']], s.fpsCap, (v) => ((s.fpsCap = v as 30 | 45 | 60), apply())),
        mcSlider((v) => `Résolution : ${pct(v)}`, 0.5, 1, 0.05, s.resolutionScale, (v) => ((s.resolutionScale = v), apply())),
        mcCycle('Ombres', [['off', 'NON'], ['blob', 'Entités'], ['blob+ao', 'Entités + OA']], s.shadows, (v) => ((s.shadows = v as typeof s.shadows), apply())),
        mcCycle('Particules', [['high', 'Toutes'], ['low', 'Réduites'], ['off', 'Minimales']], s.particles, (v) => ((s.particles = v as typeof s.particles), apply())),
        mcCycle('Eau', [['animated', 'Animée'], ['simple', 'Simple']], s.waterQuality, (v) => ((s.waterQuality = v as typeof s.waterQuality), apply())),
        mcToggle('Nuages', s.clouds, (v) => ((s.clouds = v), apply())),
        mcToggle('Balancement de la vue', s.viewBobbing, (v) => ((s.viewBobbing = v), apply())),
        mcToggle('Afficher les FPS', s.showFps, (v) => ((s.showFps = v), apply())),
        mcToggle('Qualité automatique', s.autoQuality, (v) => ((s.autoQuality = v), apply())),
      ),
      mcLabel(`Profil détecté : ${game.device.level} (${game.device.reason})`),
    ],
    footer: [mcButton('Terminé', () => game.ui.back())],
    onClose: () => game.applySettings(remesh),
  });
}

function audioScreen(game: Game): Screen {
  const s = game.settings;
  const apply = () => game.applySettings(false);
  return mcScreen({
    title: 'Musique et sons',
    bg: game.session ? 'dim' : 'dirt',
    body: [
      mcSlider((v) => `Musique : ${v === 0 ? 'NON' : pct(v)}`, 0, 1, 0.05, s.musicVolume, (v) => ((s.musicVolume = v), apply()), 310),
      mcGrid(
        mcSlider((v) => `Blocs et créatures : ${v === 0 ? 'NON' : pct(v)}`, 0, 1, 0.05, s.sfxVolume, (v) => ((s.sfxVolume = v), apply(), game.audio.play('pop'))),
        mcSlider((v) => `Ambiance/environnement : ${v === 0 ? 'NON' : pct(v)}`, 0, 1, 0.05, s.ambientVolume, (v) => ((s.ambientVolume = v), apply())),
      ),
    ],
    footer: [mcButton('Terminé', () => game.ui.back())],
  });
}

function controlsScreen(game: Game): Screen {
  const s = game.settings;
  const apply = () => game.applySettings(false);
  return mcScreen({
    title: 'Commandes',
    bg: game.session ? 'dim' : 'dirt',
    list: true,
    body: [
      mcGrid(
        mcCycle('Commandes tactiles', [['joystick', 'Joystick'], ['dpad', 'Croix (classique)']], s.controlScheme ?? 'joystick', (v) => ((s.controlScheme = v as typeof s.controlScheme), apply())),
        mcSlider((v) => `Sensibilité : ${Math.round(v * 50)} %`, 0.2, 3, 0.05, s.sensitivity, (v) => ((s.sensitivity = v), apply())),
        mcToggle('Inverser la souris', s.invertY, (v) => ((s.invertY = v), apply())),
        mcSlider((v) => `Joystick : ${v} px`, 80, 200, 5, s.joystickSize, (v) => ((s.joystickSize = v), apply())),
        mcSlider((v) => `Taille des boutons : ${pct(v)}`, 0.7, 1.5, 0.05, s.buttonScale, (v) => ((s.buttonScale = v), apply())),
        mcToggle('Mode gaucher', s.leftHanded, (v) => ((s.leftHanded = v), apply())),
        mcToggle('Saut automatique', s.autoJump, (v) => ((s.autoJump = v), apply())),
        mcToggle('Vibrations', s.haptics, (v) => ((s.haptics = v), apply())),
        mcCycle('Orientation', [['landscape', 'Paysage'], ['portrait', 'Portrait'], ['auto', 'Auto']], s.orientation, (v) => {
          s.orientation = v as typeof s.orientation;
          apply();
          void game.platform.setOrientation(s.orientation);
        }),
        mcButton('Disposition des boutons...', () => editLayout(game), { w: 150 }),
        mcButton('Réinitialiser la disposition', () => (game.touch.resetLayout(), apply()), { w: 150 }),
      ),
    ],
    footer: [mcButton('Terminé', () => game.ui.back())],
  });
}

function accessScreen(game: Game): Screen {
  const s = game.settings;
  const apply = () => game.applySettings(false);
  return mcScreen({
    title: 'Accessibilité',
    bg: game.session ? 'dim' : 'dirt',
    body: [mcGrid(mcToggle('Balancement de la vue', s.viewBobbing, (v) => ((s.viewBobbing = v), apply())), mcToggle('Vibrations', s.haptics, (v) => ((s.haptics = v), apply())))],
    footer: [mcButton('Terminé', () => game.ui.back())],
  });
}

function deviceScreen(game: Game): Screen {
  const d = game.device;
  return mcScreen({
    title: 'Infos appareil',
    bg: game.session ? 'dim' : 'dirt',
    body: [mcLabel(`GPU : ${d.gpu}`, 'white'), mcLabel(`${d.cores} cœurs · ${d.memoryGB} Go · écran ${d.screen}`, 'white'), mcLabel(`Profil de performance : ${d.level} (${d.reason})`)],
    footer: [mcButton('Terminé', () => game.ui.back())],
  });
}

/** Packs de ressources : import local d'un .zip / .jar fourni par l'utilisateur. */
function packsScreen(game: Game): Screen {
  const status = mcLabel('');
  const current = mcLabel('', 'white');
  const progress = el('div', { class: 'mc-progress', style: 'display:none' }, el('div'));
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
      status.textContent = `${info.files} textures importées. Application…`;
      const pack = await loadInstalledPack();
      game.applyPack(pack);
      status.textContent = `${info.files} textures importées depuis « ${info.name} ».`;
    } catch (e) {
      status.textContent = `Échec de l'import : ${(e as Error).message}`;
    }
    progress.style.display = 'none';
    file.value = '';
    show();
  });
  const remove = mcButton('Retirer le pack', async () => {
    await removePack();
    game.applyPack(null);
    status.textContent = 'Textures par défaut rétablies.';
    show();
  }, { w: 150 });
  show();
  return mcScreen({
    title: 'Packs de ressources',
    bg: game.session ? 'dim' : 'dirt',
    body: [
      current,
      el('div', { style: 'height:calc(var(--gs) * 4px)' }),
      mcLabel('Importez un pack de ressources (.zip) ou le fichier .jar de version de votre propre copie du jeu : les textures des blocs, objets, créatures et interfaces seront utilisées.'),
      mcLabel('Les fichiers restent uniquement sur cet appareil. LeCraft ne contient ni ne télécharge aucune texture d’un autre jeu.'),
      el('div', { style: 'height:calc(var(--gs) * 4px)' }),
      mcButton('Importer un pack...', () => file.click(), { w: 150 }),
      remove,
      progress,
      status,
      file,
    ],
    footer: [mcButton('Terminé', () => game.ui.back())],
  });
}

/** Add-ons de l'édition Bedrock : import, activation, suppression (redémarrage pour appliquer). */
function addonsScreen(game: Game): Screen {
  const list = el('div', { class: 'col', style: 'align-items:center;gap:calc(var(--gs) * 3px)' });
  const status = mcLabel('');
  const restart = mcButton('Redémarrer pour appliquer', async () => {
    if (game.session) await game.saveNow();
    location.reload();
  }, { w: 200 });
  restart.style.display = 'none';
  const changed = () => (restart.style.display = '');
  const file = el('input', { type: 'file', accept: '.mcaddon,.mcpack,.zip,application/zip,application/octet-stream', style: 'display:none' });
  const typeName: Record<string, string> = { resources: 'ressources', data: 'comportement', script: 'scripts', skin_pack: 'skins', world_template: 'modèle de monde', unknown: 'inconnu' };
  const refresh = async () => {
    const all = await listAddons();
    list.replaceChildren();
    if (!all.length) list.append(mcLabel('Aucun add-on installé.'));
    for (const a of all) {
      const packs = a.packs.map((p) => `${typeName[p.type] ?? p.type}${p.hasScripts ? ' (scripts ignorés)' : ''}`).join(' + ');
      list.append(
        el('div', { class: 'world-entry', style: 'grid-template-columns:1fr;cursor:default' },
          el('div', {}, el('div', { class: 'name' }, a.name), el('div', { class: 'sub' }, `${a.fileName} · ${packs}`), el('div', { class: 'sub' }, a.packs[0]?.description ?? '')),
          mcRow(
            mcToggle('Activé', a.enabled, async (v) => {
              await setAddonEnabled(a.id, v);
              changed();
            }, 98),
            mcButton('Supprimer', async () => {
              if (await game.ui.confirm('Supprimer cet add-on ?', `« ${a.name} » sera retiré. Les blocs qu'il ajoutait deviendront des « blocs inconnus » dans vos mondes.`, 'Supprimer')) {
                await removeAddon(a.id);
                changed();
                void refresh();
              }
            }, { w: 98 }),
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
  return mcScreen({
    title: 'Add-ons',
    bg: game.session ? 'dim' : 'dirt',
    list: true,
    body: [
      mcLabel('Importez des add-ons de l’édition mobile (.mcaddon, .mcpack) : nouveaux blocs, objets, recettes, créatures, textures, fonctions. Les scripts JavaScript ne sont pas exécutés.'),
      mcButton('Importer un add-on...', () => file.click(), { w: 200 }),
      status,
      loaded ? mcLabel(loaded, 'white') : null,
      ...(r?.report ?? []).map((t) => mcLabel(t, 'yellow')),
      restart,
      list,
      file,
    ],
    footer: [mcButton('Terminé', () => game.ui.back())],
  });
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
