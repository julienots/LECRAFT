/**
 * Menus d'avant-partie dans la charte de l'édition mobile : écran de démarrage, menu principal, Jouer,
 * Créer à partir de…, Créer un nouveau monde, modifier un monde, chargement, Social, Profil, Vestiaire, Magasin.
 */
import type { Game } from '../core/Game';
import type { Screen } from './UIManager';
import type { WorldMeta, WorldOptions } from '../save/SaveManager';
import type { Difficulty, GameMode } from '../core/Config';
import { SAVE_VERSION } from '../core/Config';
import { el } from './dom';
import { t } from './i18n';
import { drawLandscape, drawStudioMark, drawTitleLogo } from './MenuArt';
import { drawFigure } from './ContainerArt';
import { PLAYER_SKINS } from '../render/TextureManager';
import { importAddon, listAddons, removeAddon, setAddonEnabled, type InstalledAddon } from '../addons/AddonManager';
import { importPack, loadInstalledPack, removePack, declineBundledPack } from '../render/ResourcePack';
import { randomTip } from './Tips';
import { joinPanel } from './NetUI';
import { serversPanel } from './ServerUI';
import {
  ICON_GRID, ICON_PENCIL, ICON_SOCIAL, bmBtn, bmInput, bmModal, bmRow, bmScreen, bmScrollbar, bmSection, bmSegment, bmSlider, bmToggle, itemIcon,
} from './BedrockUI';

// ---------------------------------------------------------------- art partagé
let artCache: { logo: string; land: string } | null = null;
export function resetBedrockArt() {
  artCache = null;
}
function art(game: Game) {
  if (!artCache) artCache = { logo: drawTitleLogo(game.textures), land: drawLandscape(game.textures) };
  return artCache;
}

/** Phrases jaunes de l'écran titre (originales). */
const SPLASHES = [
  '100 % hors ligne !', 'Fait de blocs !', 'Maintenant avec des lits !', 'Attention aux araignées !', 'Creusez droit vers le bas... ou pas !',
  'Des cubes partout !', 'Le blé pousse mieux près de l’eau !', 'Allez, encore une nuit !', 'Fabriqué sur téléphone !', 'Pierre, fer, diamant !',
  'Ne creusez pas sous vos pieds !', 'Les moutons sont multicolores !', 'TNT : à manier avec soin !', 'Pixel par pixel !', 'Bonjour le monde !',
  'Rien à télécharger !', 'Le sable tombe !', 'Plus de 120 blocs !', 'Des poules et des œufs !', 'Bon minage !',
];

/** Style d'un décor pixel-art (paysage du menu, arbre au centre) : aperçu d'un monde sans miniature. */
function sceneStyle(game: Game, n: number, w = 212, h = 121): string {
  const k = Math.abs(Math.floor(n)) % 18;
  const cx = (3 + 11 * k) * 16 + 8;
  const sc = (h / 256) * 1.35;
  const p = Math.min(1, Math.max(0, (cx * sc - w / 2) / (2048 * sc - w)));
  return `background:url(${art(game).land}) ${(p * 100).toFixed(2)}% 100% / auto 135% no-repeat,linear-gradient(#6a9be0,#bcd7f8);image-rendering:pixelated`;
}

let panoShot: { url: string; at: number } | null = null;
/** Vue actuelle du panorama (3D) : aperçu des mondes sans miniature, comme le décor du jeu ; null hors du menu. */
function panoramaShot(game: Game): string | null {
  if (game.state !== 'menu') return null;
  if (!panoShot || performance.now() - panoShot.at > 30000) {
    const url = game.renderer.snapshot(0.8);
    panoShot = url ? { url, at: performance.now() } : null;
  }
  return panoShot?.url ?? null;
}

/** Aperçu d'un monde : vue du panorama (fond « cover ») ou décor pixel-art de repli. */
function previewStyle(game: Game, n: number, w = 212, h = 121): string {
  const url = panoramaShot(game);
  return url ? `background:url(${url}) center / cover no-repeat` : sceneStyle(game, n, w, h);
}

const pad2 = (n: number) => String(n).padStart(2, '0');
function shortDate(ms: number) {
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${String(d.getFullYear()).slice(2)}`;
}

/** Personnage du joueur (vue de face, couches comprises) sur un canvas. */
function figureCanvas(game: Game, skin: string | undefined, k: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16 * k;
  c.height = 32 * k;
  try {
    const img = game.textures.skin(`player_${skin ?? 'steve'}`).image as HTMLCanvasElement;
    drawFigure(c.getContext('2d')!, 0, 0, img, k);
  } catch {
    /* skin indisponible : canvas vide */
  }
  return c;
}

/** Visage (tête + chapeau) du joueur. */
function faceURL(game: Game, skin?: string): string {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  try {
    const img = game.textures.skin(`player_${skin ?? 'steve'}`).image as HTMLCanvasElement;
    const s = img.width / 64;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 8 * s, 8 * s, 8 * s, 8 * s, 0, 0, 8, 8);
    ctx.drawImage(img, 40 * s, 8 * s, 8 * s, 8 * s, 0, 0, 8, 8);
  } catch {
    /* skin indisponible */
  }
  return c.toDataURL();
}

// ---------------------------------------------------------------- écran de démarrage
export interface Intro {
  /** Avancement du chargement (0..1). */
  progress(f: number): void;
  /** Termine : barre à 100 %, fondu, retrait. */
  finish(): Promise<void>;
}

/** Écran rouge du studio puis chargement avec barre et pourcentage (superposé à tout, retiré à la fin). */
export function createIntro(root: HTMLElement): Intro {
  const bar = el('i');
  const pct = el('div', { class: 'pct' }, '0%');
  const logo = el('img', { class: 'bm-logo', src: drawTitleLogo(null), alt: 'LeCraft' });
  const dark = el('div', { class: 'dark' }, logo, el('div', { class: 'spin' }), el('div', { class: 'pb' }, bar), pct);
  const red = el('div', { class: 'red' }, el('img', { class: 'studio', src: drawStudioMark(), alt: 'LeCraft Studios' }));
  const box = el('div', { class: 'bm-intro' }, dark, red);
  root.append(box);
  const t0 = performance.now();
  let target = 0, shown = 0, done = false;
  let redGone = false;
  const hideRed = () => {
    if (redGone) return;
    redGone = true;
    red.classList.add('gone');
    setTimeout(() => red.remove(), 400);
  };
  red.addEventListener('pointerdown', hideRed);
  const timer = window.setInterval(() => {
    if (!redGone && performance.now() - t0 > 1250) hideRed();
    // la barre rattrape l'avancement réel sans reculer
    shown += Math.max(0.004, (target - shown) * 0.12);
    if (shown > target) shown = target;
    bar.style.width = `${Math.round(shown * 100)}%`;
    pct.textContent = `${Math.round(shown * 100)}%`;
  }, 33);
  return {
    progress(f) {
      target = Math.max(target, Math.min(1, f));
    },
    finish() {
      return new Promise<void>((resolve) => {
        target = 1;
        const end = () => {
          if (!redGone || shown < 0.995) {
            if (!done) {
              if (performance.now() - t0 > 1250) hideRed();
              setTimeout(end, 40);
            }
            return;
          }
          if (done) return;
          done = true;
          window.clearInterval(timer);
          setTimeout(() => {
            box.classList.add('out');
            setTimeout(() => {
              box.remove();
              resolve();
            }, 460);
          }, 160);
        };
        end();
      });
    },
  };
}

// ---------------------------------------------------------------- menu principal
export function mainMenu(game: Game): Screen {
  const a = art(game);
  const skin = game.settings.playerSkin;
  const name = game.settings.playerName || 'Joueur';
  const splash = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
  const play = bmBtn('Jouer', () => game.ui.push(playScreen(game, 'worlds')), { tone: 'play', cls: 'big' });
  const splashText = t(splash);
  const splashEl = el('div', { class: 'bm-splash splash' }, splashText);
  splashEl.style.fontSize = `calc(var(--u) * ${Math.min(12, 150 / (0.75 * splashText.length)).toFixed(2)} * 1px)`;
  const shopTag = el('div', { class: 'bm-tag' }, t('Extensions !'));
  const shop = bmBtn('Magasin', () => game.ui.push(shopScreen(game)), { tone: 'red', cls: 'big', icon: itemIcon(game, 'chest') });
  const social = bmBtn([el('span', { class: 'sico', html: ICON_SOCIAL }), `${t('Social')} (0)`], () => game.ui.push(socialScreen(game)), { tone: 'gray', cls: 'bm-social-top' });
  const profile = el(
    'div',
    { class: 'bm-profile' },
    bmBtn(el('span', { class: 'qm' }, '?'), () => game.showHelp(), { cls: 'sq' }),
    bmBtn([el('img', { class: 'face', src: faceURL(game, skin), alt: '' }), 'Profil'], () => game.ui.push(profileScreen(game))),
  );
  const wardrobe = bmBtn('Vestiaire', () => game.ui.push(wardrobeScreen(game)), { cls: 'bm-wardrobe' });
  const avatar = el('div', { class: 'bm-avatar' }, figureCanvas(game, skin, 4));
  const s = bmScreen(game, {
    cls: 'bm-main title-screen',
    back: null,
    body: [
      el('div', { class: 'bm-pano2d panorama', style: `background-image:url(${a.land})` }),
      el('div', { class: 'bm-vignette' }),
      el('img', { class: 'bm-logo', src: a.logo, alt: 'LeCraft' }),
      splashEl,
      el(
        'div',
        { class: 'bm-menu' },
        play,
        bmBtn('Paramètres', () => game.showSettings(), { cls: 'big' }),
        bmBtn('Realms', () => game.ui.push(playScreen(game, 'realms')), { tone: 'purple', cls: 'big' }),
        el('div', { class: 'bm-tagwrap' }, shop, shopTag),
      ),
      social,
      profile,
      wardrobe,
      el('div', { class: 'bm-gamertag' }, name),
      avatar,
      el('div', { class: 'bm-corner l' }, '©LeCraft'),
      el('div', { class: 'bm-corner r' }, `v${__APP_VERSION__}`),
    ],
  });
  return { el: s.el, onBack: s.onBack };
}

// ---------------------------------------------------------------- Jouer
type PlayTab = 'worlds' | 'realms' | 'servers';

export function playScreen(game: Game, initial: PlayTab = 'worlds'): Screen {
  let tab: PlayTab = initial;
  let worlds: WorldMeta[] = [];
  const content = el('div', { style: 'display:contents' });
  const tabsBar = el('div', { class: 'bm-tabs' });
  const wrap = el('div', { class: 'bm-wrap' }, tabsBar, content);
  const tabDefs: [PlayTab, string, string][] = [
    ['worlds', 'Mondes', 'grass_block'],
    ['realms', 'Realms', 'obsidian'],
    ['servers', 'Serveurs', 'compass'],
  ];
  const buttons = new Map<PlayTab, HTMLElement>();
  const drawTabs = () => {
    tabsBar.replaceChildren();
    for (const [k, label, icon] of tabDefs) {
      const b = el('button', { class: `bm-tab${tab === k ? ' on' : ''}`, type: 'button' }, el('img', { class: 'tic', src: itemIcon(game, icon), alt: '' }), el('span', {}, k === 'worlds' ? `${t(label)} (${worlds.length})` : t(label)), tab === k ? el('i', { class: 'u' }) : null);
      b.addEventListener('click', () => {
        if (tab === k) return;
        game.audio.play('click', { volume: 0.3 });
        tab = k;
        show();
      });
      buttons.set(k, b);
      tabsBar.append(b);
    }
  };
  const show = () => {
    drawTabs();
    content.replaceChildren();
    if (tab === 'worlds') content.append(...worldsTab());
    else if (tab === 'realms') content.append(...panelTab(joinPanel(game)));
    else content.append(...panelTab(serversPanel(game)));
  };
  const panelTab = (p: HTMLElement) => {
    p.classList.add('bm-tabpanel');
    return [p];
  };

  function worldsTab(): HTMLElement[] {
    const list = el('div', { class: 'bm-list' });
    const toggle = bmBtn(el('span', { html: ICON_GRID, style: 'display:contents' }), () => {
      const one = list.classList.toggle('one');
      toggle.setAttribute('aria-pressed', String(one));
    }, { tone: 'darker', cls: 'bm-grid-btn' });
    const create = bmBtn('Créer un nouveau monde', () => game.ui.push(createFromScreen(game)), { tone: 'green', cls: 'bm-create-btn' });
    const tools = el('div', { class: 'bm-tools' }, toggle, create);
    const draw = () => {
      list.replaceChildren();
      if (!worlds.length) list.append(el('div', { class: 'bm-empty' }, t('Aucun monde. Créez-en un !')));
      for (const w of worlds) {
        const old = (w.version ?? 1) < SAVE_VERSION;
        const chips = el('div', { class: 'chips' }, el('span', { class: 'chip' }, w.options?.hardcore ? t('Hardcore') : w.gameMode === 'creative' ? t('Créatif') : t('Survie')));
        if (w.options?.experiments?.length) chips.append(el('span', { class: 'chip y' }, t('Expérimental')));
        if (old) chips.append(el('span', { class: 'chip r' }, t('Ancienne version')));
        const shot = el('div', { class: 'shot' }, w.thumbnail ? el('img', { src: w.thumbnail, alt: '' }) : null, chips);
        if (!w.thumbnail) shot.style.cssText = previewStyle(game, w.seed, 220, 124);
        const edit = el('button', { class: 'edit', type: 'button', 'aria-label': 'Modifier le monde', html: ICON_PENCIL });
        edit.addEventListener('click', (e) => {
          e.stopPropagation();
          game.audio.play('click', { volume: 0.4 });
          game.ui.push(editWorldScreen(game, w, loadWorlds));
        });
        const card = el(
          'div',
          { class: 'world-entry bm-card', role: 'button', tabindex: '0' },
          shot,
          el('div', { class: 'info' }, el('div', { class: 'txt' }, el('div', { class: 'n name' }, w.name), el('div', { class: `s sub${old ? ' old' : ''}` }, old ? t('Ancienne version (incompatible)') : shortDate(w.lastPlayed))), edit),
        );
        card.title = `${w.name} · ${t('Graine')} ${w.seed}`;
        const go = () => {
          game.audio.play('click', { volume: 0.4 });
          void game.playWorld(w);
        };
        card.addEventListener('click', go);
        card.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && go());
        list.append(card);
      }
    };
    const loadWorlds = async () => {
      worlds = await game.saves.listWorlds().catch(() => []);
      if (tab === 'worlds') {
        draw();
        drawTabs();
      }
    };
    void loadWorlds();
    return [tools, list];
  }

  const s = bmScreen(game, { cls: 'bm-play', title: 'Jouer', dim: true, body: [wrap] });
  // la liste des mondes se charge en arrière-plan : l'onglet « Mondes (n) » se met à jour tout seul
  show();
  return { el: s.el, onBack: s.onBack };
}

// ---------------------------------------------------------------- Créer à partir de…
export function createFromScreen(game: Game): Screen {
  let sel: 'pass' | 'creators' | 'mine' = 'mine';
  let owned: InstalledAddon[] = [];
  const right = el('div', { class: 'bm-main2' });
  const nav = el('div', {});
  const draw = () => {
    nav.replaceChildren();
    const items: ['pass' | 'creators' | 'mine', string][] = [['pass', 'Marketplace Pass'], ['creators', 'Créateurs en vedette'], ['mine', `Mes possessions (${owned.length + (game.textures.packName ? 1 : 0)})`]];
    for (const [k, label] of items) {
      const b = el('button', { class: `bm-navitem${sel === k ? ' on' : ''}`, type: 'button' }, el('span', {}, t(label)));
      b.addEventListener('click', () => {
        sel = k;
        draw();
      });
      nav.append(b);
    }
    right.replaceChildren();
    if (sel === 'mine') {
      const tiles = el('div', { class: 'bm-tiles' });
      if (game.textures.packName) tiles.append(tile(itemIcon(game, 'painting'), game.textures.packName, 'Pack de ressources'));
      for (const a of owned) tiles.append(tile(itemIcon(game, a.enabled ? 'enchanted_book' : 'book'), a.name, `Add-on · ${a.enabled ? t('Activé') : t('Désactivé')}`));
      if (!tiles.children.length) right.append(el('div', { class: 'bm-banner' }, el('div', {}, t('Vous ne possédez aucun contenu. Importez des add-ons et des packs de ressources depuis le Magasin.'))));
      else right.append(tiles);
    } else {
      right.append(
        el('div', { class: 'bm-banner' }, el('div', { class: 'big' }, t(sel === 'pass' ? 'Marketplace Pass' : 'Créateurs en vedette')), el('div', {}, t('Ce contenu en ligne n’est pas disponible : LeCraft fonctionne entièrement hors ligne. Vos add-ons et packs importés sont dans « Mes possessions ».'))),
      );
    }
  };
  const tile = (icon: string, name: string, sub: string) => el('div', { class: 'bm-tile' }, el('div', { class: 'pic' }, el('img', { src: icon, alt: '' })), el('div', { class: 'cap' }, el('div', {}, name), el('div', { class: 'sm' }, sub)));
  void listAddons().then((a) => {
    owned = a;
    draw();
  }).catch(() => draw());
  const create = bmBtn('Créer un nouveau monde', () => game.ui.push(newWorldScreen(game)), { tone: 'green' });
  const side = el('div', { class: 'bm-side' }, create, nav);
  const s = bmScreen(game, { cls: 'bm-from', title: 'Créer à partir de...', social: false, dim: true, body: [el('div', { class: 'bm-cols' }, side, right)] });
  draw();
  return { el: s.el, onBack: s.onBack };
}

// ---------------------------------------------------------------- Créer un nouveau monde
const MODE_DESC: Record<GameMode, string> = {
  survival: 'Explorez un monde mystérieux où vous construisez, prélevez, fabriquez, et affrontez des monstres.',
  creative: 'Ressources illimitées, vol libre et destruction instantanée des blocs. Aucun danger.',
};
const DIFF_DESC: Record<Difficulty, string> = {
  peaceful: 'Aucune créature hostile n’apparaît et la santé se régénère toute seule.',
  easy: 'Des créatures hostiles apparaissent mais infligent moins de dégâts. La barre de faim se vide et réduit la santé jusqu’à 5 cœurs.',
  normal: 'Des créatures hostiles apparaissent et infligent des dégâts normaux. La barre de faim se vide et réduit la santé à un demi-cœur.',
  hard: 'Des créatures hostiles apparaissent et infligent de gros dégâts. La barre de faim se vide et peut vous tuer.',
};

interface NavDef {
  id: string;
  label: string;
  icon: string;
}

export function newWorldScreen(game: Game): Screen {
  // état du formulaire
  const S = {
    name: '', mode: 'survival' as GameMode, diff: (game.settings.difficulty === 'peaceful' ? 'normal' : game.settings.difficulty) as Difficulty,
    hardcore: false, flat: false, startingMap: false, bonus: false, coords: false, days: false, recipes: true,
    fireTick: true, tnt: true, mobLoot: true, regen: true, tileDrops: true, sleep: true, sleepPercent: 100, instant: false, respawnExplode: true, spawnRadius: 10, sim: 4,
    multiplayer: true, access: 'friends', perm: 'member', lan: true, friendlyFire: true, waypoints: true,
    cheats: false, eternalDay: false, keepInv: false, mobSpawn: true, mobGrief: true, entityLoot: true, weather: true, commandBlocks: true, education: false, randomTick: 1,
    sharedPacks: false, bots: false,
  };
  const experiments = new Set<string>();
  let seedText = String((Math.random() * 2 ** 31) | 0);

  const right = el('div', { class: 'bm-right' });
  const left = el('div', { class: 'bm-left' });
  const secs = new Map<string, HTMLElement>();
  const addSection = (id: string, parts: HTMLElement[]) => {
    const wrapper = el('div', { class: 'bm-section', 'data-sec': id }, ...parts);
    secs.set(id, wrapper);
    right.append(wrapper);
  };
  const toggle = (title: string, desc: string, key: keyof typeof S, extra: { onChange?: (v: boolean) => void; icon?: string } = {}) =>
    bmToggle(title, desc, S[key] as boolean, (v) => {
      (S[key] as boolean) = v;
      extra.onChange?.(v);
    }, { icon: extra.icon });
  const heart = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11 9"><path fill="#f4f4f4" d="M1 0h3v1h1v1h1V1h1V0h3v1h1v4h-1v1h-1v1h-1v1H7v1H4V8H3V7H2V6H1V5H0V1h1z"/><path fill="#8a8a8a" d="M1 1h2v1H2v2H1z"/></svg>')}`;

  // ----- Général
  const nameIn = bmInput('', { placeholder: 'Mon monde', maxlength: 32 });
  void game.saves.listWorlds().then((all) => {
    const names = new Set(all.map((w) => w.name));
    let n = 'Mon monde', i = 2;
    while (names.has(n)) n = `Mon monde (${i++})`;
    nameIn.placeholder = n;
  }).catch(() => {});
  const nameRow = bmRow('Nom du monde', undefined, nameIn);
  const modeRow = bmSegment<GameMode>('Mode de jeu', [['survival', 'Survie'], ['creative', 'Créatif']], S.mode, (v) => (S.mode = v), (v) => MODE_DESC[v]);
  const diffRow = bmSegment<Difficulty>('Difficulté', [['peaceful', 'Paisible'], ['easy', 'Facile'], ['normal', 'Normale'], ['hard', 'Difficile']], S.diff, (v) => (S.diff = v), (v) => DIFF_DESC[v]);
  addSection('general', [nameRow, modeRow.el, diffRow.el, toggle('Hardcore', 'Vous ne pourrez pas réapparaître si vous mourez. Bonne chance ! Vous en aurez besoin.', 'hardcore', { icon: heart }).el]);

  // ----- Avancé
  const seedIn = bmInput(seedText, { maxlength: 40, numeric: false });
  seedIn.addEventListener('input', () => (seedText = seedIn.value));
  const seedBtn = bmBtn('Modèles', () => {
    void game.saves.listWorlds().then((all) => {
      const buttons = [{ label: 'Graine aléatoire', tone: 'green' as const, onClick: () => ((seedIn.value = seedText = String((Math.random() * 2 ** 31) | 0)), true) }];
      for (const w of all.slice(0, 5)) buttons.push({ label: `Graine de « ${w.name} »`, tone: 'green' as const, onClick: () => ((seedIn.value = seedText = String(w.seed)), true) });
      bmModal(s.root, { title: 'Modèles de graine', body: ['Choisissez une graine : un monde créé avec la même graine a le même relief.'], buttons: [...buttons.map((b) => ({ ...b, tone: 'gray' as const })), { label: 'Retour' }] });
    });
  }, { tone: 'gray' });
  const seedRow = bmRow('Graine de monde', undefined, el('div', { class: 'bm-inrow' }, seedIn, seedBtn), el('div', { class: 'd', style: 'margin-top:calc(var(--u) * 6 * 1px)' }, t('Guider l’algorithme qui crée votre monde comme par magie')));
  const sleepVal = el('span', { class: 'val' }, '(100%) (tous)');
  const sleepSlider = bmSlider(0, 100, 5, 100, (v) => {
    S.sleepPercent = v;
    sleepVal.textContent = `(${v}%)${v === 100 ? ' (tous)' : ''}`;
  });
  const sleepRow = el('div', { class: 'bm-rw' }, el('div', { class: 't' }, t('Joueurs endormis requis'), sleepVal), el('div', { class: 'd' }, t('Combien de joueurs doivent être au lit pour faire passer la nuit ?')), sleepSlider.el);
  const radiusIn = bmInput('10', { maxlength: 3, numeric: true });
  radiusIn.addEventListener('change', () => {
    const n = Math.min(128, Math.max(0, parseInt(radiusIn.value, 10) || 0));
    S.spawnRadius = n;
    radiusIn.value = String(n);
  });
  const simRow = bmSegment<number>('Distance de simulation', [[4, '4 chunks'], [6, '6 chunks'], [8, '8 chunks']], S.sim, (v) => (S.sim = v), (v) => `Le jeu charge et applique les modifications dans un rayon de ${v * 16}x${v * 16} blocs autour du joueur.`);
  addSection('advanced', [
    seedRow,
    toggle('Monde plat', 'Un monde plat à développer ou à exploiter', 'flat').el,
    toggle('Carte de départ', 'Créez une carte vierge pour explorer votre monde.', 'startingMap').el,
    toggle('Coffre bonus', 'Apparaissez près d’un coffre contenant des objets pour bien commencer', 'bonus').el,
    toggle('Afficher les coordonnées', 'Affichez votre position actuelle', 'coords').el,
    toggle('Afficher le nombre de jours joués', 'Afficher le nombre de jours de jeu joués', 'days').el,
    toggle('Débloquer des recettes', 'Collectez des matériaux pour débloquer des recettes dans votre livre de recettes', 'recipes').el,
    toggle('Propagation du feu', 'Le feu se propage entre les entités', 'fireTick').el,
    toggle('Explosion de TNT', 'La boîte rouge explose', 'tnt').el,
    toggle('Butin des créatures', 'Les créatures laissent tomber des objets lorsqu’elles sont tuées', 'mobLoot').el,
    toggle('Régénération auto', 'Obtenez ou perdez de la santé en fonction de votre faim', 'regen').el,
    toggle('Butin des blocs', 'Les blocs laissent tomber des objets lorsqu’ils sont cassés', 'tileDrops').el,
    toggle('Dormir pour passer la nuit', 'Dormir dans un lit pendant la nuit fera passer le temps jusqu’au matin', 'sleep').el,
    sleepRow,
    toggle('Réapparition immédiate', 'Passez le menu « Vous avez succombé ! » et réapparaissez immédiatement', 'instant').el,
    toggle('Les blocs de réapparition explosent', 'Les ancres de réapparition et les lits peuvent exploser', 'respawnExplode').el,
    bmRow('Rayon de réapparition', undefined, radiusIn, el('div', { class: 'd', style: 'margin-top:calc(var(--u) * 6 * 1px)' }, t('Réapparaissez dans le rayon de ce bloc lorsque vous mourez et qu’aucun point d’apparition personnalisé n’est défini (max : 128).'))),
    simRow.el,
  ]);

  // ----- Multijoueur
  const accessRow = bmSegment<string>('Accès des joueurs', [['invite', 'Joueurs invités'], ['friends', 'Amis'], ['fof', 'Amis d’amis']], S.access, (v) => (S.access = v), () => 'Toute personne que vous avez ajoutée en tant qu’ami peut rejoindre la partie');
  const person = (n: number) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="7" cy="5" r="2.5"/><path d="M2.5 14v-2c0-1.8 1.5-3 4.5-3s4.5 1.2 4.5 3v2"/>${n === 2 ? '<path d="M11 3l3 3-3 3" stroke-linecap="square"/>' : n === 1 ? '<path d="M12 3v4M10 5h4"/>' : '<path d="M10 4l4 4M14 4l-4 4"/>'}</svg>`;
  const permRow = bmSegment<string>('Autorisations par défaut des joueurs', [['visitor', 'Visiteur'], ['member', 'Membre'], ['operator', 'Opérateur']], S.perm, (v) => (S.perm = v), (v) => (v === 'visitor' ? 'Les visiteurs peuvent regarder le monde mais ni construire, ni récolter.' : v === 'member' ? 'Les membres peuvent construire et récolter, attaquer des joueurs et des créatures, et interagir avec des objets et des entités' : 'Les opérateurs peuvent en plus utiliser les commandes et gérer les autres joueurs.'), { icons: { visitor: person(0), member: person(1), operator: person(2) } });
  addSection('multi', [
    toggle('Partie multijoueur', 'D’autres joueurs peuvent rejoindre votre monde.', 'multiplayer').el,
    ...bmSection('Paramètres'),
    accessRow.el,
    permRow.el,
    toggle('Visible pour les joueurs en LAN', 'Les joueurs de votre réseau local peuvent rejoindre votre monde.', 'lan').el,
    toggle('Feu allié', 'Les joueurs s’infligent des dégâts entre eux', 'friendlyFire').el,
    toggle('Points de passage de joueur', 'Sélectionne quels joueurs sont affichés comme points de passage sur la barre de localisation', 'waypoints').el,
    toggle('Bots joueurs', 'Des bots joueurs rejoignent votre monde : ils coupent du bois, minent, construisent leur maison, cultivent, vous aident contre les monstres et discutent.', 'bots').el,
  ]);

  // ----- Triche
  const cheatRows: HTMLElement[] = [];
  const dayRow = bmSegment<string>('Cycle jour/nuit', [['normal', 'Normale'], ['eternal', 'Jour éternel']], 'normal', (v) => (S.eternalDay = v === 'eternal'), (v) => (v === 'normal' ? 'Les heures du jeu s’écoulent normalement, du jour jusqu’à la nuit' : 'Le temps reste figé : il fait toujours jour.'));
  cheatRows.push(
    dayRow.el,
    toggle('Conservation de l’inventaire', 'Vous gardez tous les objets de votre inventaire lorsque vous mourez', 'keepInv').el,
    toggle('Apparition des créatures', 'Les créatures apparaissent naturellement', 'mobSpawn').el,
    toggle('Ingérence des créatures', 'Les créatures peuvent déplacer et détruire des blocs dans votre monde', 'mobGrief').el,
    toggle('Butin des entités', 'Les entités autres que les créatures, comme les tableaux, laissent tomber des objets lorsqu’elles sont détruites', 'entityLoot').el,
    toggle('Cycle météorologique', 'Possibilité de pluie, de neige et d’orages', 'weather').el,
    toggle('Blocs de commandes', 'Utiliser des commandes pour programmer ces blocs', 'commandBlocks').el,
    toggle('Fonctionnalités éducatives', 'Active les articles éducatifs comme le kit de chimie', 'education').el,
  );
  const tickIn = bmInput('1', { maxlength: 4, numeric: true });
  const applyTick = () => {
    const n = Math.min(4096, Math.max(0, parseInt(tickIn.value, 10) || 0));
    S.randomTick = n;
    tickIn.value = String(n);
  };
  tickIn.addEventListener('change', applyTick);
  const tickReset = bmBtn('Réinitialiser', () => {
    tickIn.value = '1';
    applyTick();
  }, { tone: 'gray' });
  cheatRows.push(bmRow('Rapidité de tick aléatoire', undefined, el('div', { class: 'bm-inrow' }, tickIn, tickReset), el('div', { class: 'd', style: 'margin-top:calc(var(--u) * 6 * 1px)' }, t('Affecte le comportement de certains blocs, comme la rapidité de croissance et de décomposition de la végétation (max 4096)'))));
  const cheatHolder = el('div', {}, ...bmSection('Paramètres de triche'), ...cheatRows);
  const setCheatsEnabled = (on: boolean) => {
    cheatHolder.querySelectorAll<HTMLElement>('.bm-rw').forEach((r) => r.classList.toggle('dis', !on));
    cheatHolder.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input').forEach((b) => (b.disabled = !on));
  };
  setCheatsEnabled(false);
  addSection('cheats', [toggle('Triche', 'Personnaliser le jeu avec les paramètres de triche', 'cheats', { onChange: setCheatsEnabled }).el, cheatHolder]);

  // ----- Packs
  const packsBox = el('div', {});
  const behBox = el('div', {});
  let addons: InstalledAddon[] = [];
  const subTabs = (st: { v: 'on' | 'off' }, redraw: () => void) => {
    const mk = (k: 'on' | 'off', label: string) => {
      const b = el('button', { type: 'button', class: st.v === k ? 'on' : '' }, t(label));
      b.addEventListener('click', () => {
        st.v = k;
        redraw();
      });
      return b;
    };
    return el('div', { class: 'bm-subtabs' }, mk('on', 'Activé'), mk('off', 'Disponible'));
  };
  const packEntry = (icon: string, name: string, sub: string, action?: HTMLElement) => el('div', { class: 'bm-pk' }, el('img', { src: icon, alt: '' }), el('div', { class: 'tx' }, el('div', {}, name), el('div', { class: 'd' }, sub)), action ?? null);
  const stRes = { v: 'on' as 'on' | 'off' };
  const stBeh = { v: 'on' as 'on' | 'off' };
  const note = el('div', { class: 'bm-rw' }, el('div', { class: 'd' }, t('Les add-ons s’appliquent à tous vos mondes. Le changement prend effet au redémarrage du jeu.')));
  const drawRes = () => {
    packsBox.replaceChildren(subTabs(stRes, drawRes));
    const act = stRes.v === 'on';
    const pk = game.textures.packName;
    if (act) {
      packsBox.append(packEntry(itemIcon(game, 'painting'), pk ?? 'Textures par défaut', pk ? 'Pack de ressources installé' : 'Textures intégrées au jeu'));
      for (const a of addons.filter((x) => x.enabled && x.packs.some((p) => p.type === 'resources'))) packsBox.append(packEntry(itemIcon(game, 'book'), a.name, 'Add-on · ressources', bmBtn('Désactiver', async () => (await setAddonEnabled(a.id, false), void refreshAddons()), { w: 70, h: 28 })));
    } else {
      const off = addons.filter((x) => !x.enabled && x.packs.some((p) => p.type === 'resources'));
      if (!off.length) packsBox.append(el('div', { class: 'bm-rw' }, el('div', { class: 'd' }, t('Aucun autre pack de ressources. Importez-en depuis le Magasin.'))));
      for (const a of off) packsBox.append(packEntry(itemIcon(game, 'book'), a.name, 'Add-on · ressources', bmBtn('Activer', async () => (await setAddonEnabled(a.id, true), void refreshAddons()), { w: 70, h: 28 })));
    }
    packsBox.append(bmBtn([el('span', {}, `${t('Obtenez plus de packs')}`)], () => game.ui.push(shopScreen(game)), { tone: 'darker', cls: 'bm-getmore' }));
  };
  const drawBeh = () => {
    behBox.replaceChildren(subTabs(stBeh, drawBeh));
    const act = stBeh.v === 'on';
    const list = addons.filter((x) => x.enabled === act && x.packs.some((p) => p.type === 'data' || p.type === 'script'));
    if (!list.length) behBox.append(el('div', { class: 'bm-rw' }, el('div', { class: 'd' }, t(act ? 'Aucun pack de comportement activé.' : 'Aucun pack de comportement disponible. Importez un add-on depuis le Magasin.'))));
    for (const a of list) behBox.append(packEntry(itemIcon(game, 'enchanted_book'), a.name, `Add-on · ${a.packs.map((p) => (p.type === 'data' ? 'comportement' : p.type)).join(' + ')}`, bmBtn(act ? 'Désactiver' : 'Activer', async () => (await setAddonEnabled(a.id, !a.enabled), void refreshAddons()), { w: 70, h: 28 })));
    behBox.append(note.cloneNode(true) as HTMLElement);
  };
  const refreshAddons = async () => {
    addons = await listAddons().catch(() => []);
    drawRes();
    drawBeh();
  };
  void refreshAddons();
  addSection('packs', [toggle('Packs partagés', 'Les joueurs sont invités à télécharger tous les packs locaux pour pouvoir participer au jeu.', 'sharedPacks').el, packsBox]);
  addSection('behavior', [behBox]);

  // ----- Expérimentations
  const exp = (id: string, title: string, desc: string) =>
    bmToggleExp(title, desc, id);
  function bmToggleExp(title: string, desc: string, id: string) {
    const row = bmToggle(title, desc, false, (v) => {
      if (!v) {
        experiments.delete(id);
        return;
      }
      if (confirmed) {
        experiments.add(id);
        return;
      }
      // demande confirmation : revient en arrière si on annule
      row.set(false);
      bmModal(s.root, {
        title: 'Vraiment ?',
        body: ['Vous ne pouvez pas désactiver les expérimentations après avoir créé votre monde.', 'Les expérimentations pourraient entraîner un crash du jeu à tout moment, alors ne construisez rien d’important parce que vous risquez de le perdre.'],
        buttons: [
          { label: 'Annuler et revenir en arrière', tone: 'green' },
          {
            label: 'Activer les expérimentations dans tous les cas',
            onClick: () => {
              confirmed = true;
              experiments.add(id);
              row.set(true);
            },
          },
        ],
      });
    });
    return row.el;
  }
  let confirmed = false;
  addSection('experiments', [
    el('div', { class: 'bm-info' }, t('Les expérimentations sont de potentielles nouvelles fonctionnalités. Faites attention, car elles ne sont pas stables.')),
    ...bmSection('Gameplay', 'Changer la façon dont votre monde fonctionne'),
    exp('trade_rebalance', 'Rééquilibrage du commerce avec les villageois', 'Contient une mise à jour des échanges proposés par les villageois dans une optique de rééquilibrage'),
    ...bmSection('Créateurs d’extensions', 'Pour les créateurs de packs de jeux et autres extensions'),
    exp('creator_features', 'Fonctionnalités de créateur à venir', 'Inclut les propriétés des acteurs et les volumes de brouillard'),
    exp('beta_api', 'API bêta', 'Utiliser les versions « -bêta » des modules API dans les packs d’extensions'),
    exp('creator_camera', 'Caractéristiques de la caméra du créateur expérimental', 'Permet l’utilisation des dernières fonctionnalités de la caméra personnalisée'),
    exp('voxel_shapes', 'Formes en voxels expérimentales', 'Permet d’utiliser des formes en voxels pour certains blocs classiques et personnalisés'),
    exp('poi', 'Points of Interest (POI)', 'Ajoute des points d’intérêt à la commande locate et à l’API de script'),
    exp('world_clocks', 'Fonctions Horloges du monde pour les créateurs', 'Active l’utilisation des horloges du monde pour les créateurs'),
  ]);

  // ----- panneau gauche : aperçu, boutons, navigation
  const navs: NavDef[] = [
    { id: 'general', label: 'Général', icon: 'crafting_table' },
    { id: 'advanced', label: 'Avancé', icon: 'furnace' },
    { id: 'multi', label: 'Multijoueur', icon: 'jukebox' },
    { id: 'cheats', label: 'Triche', icon: 'command_block' },
    { id: 'packs', label: 'Packs de ressources', icon: 'painting' },
    { id: 'behavior', label: 'Packs de comportement', icon: 'bookshelf' },
    { id: 'experiments', label: 'Expérimentations', icon: 'tnt' },
  ];
  const pv = el('div', { class: 'pv' });
  if (game.lastThumbnail) pv.style.backgroundImage = `url(${game.lastThumbnail})`;
  else pv.style.cssText = previewStyle(game, Math.floor(Math.random() * 18));
  const navBtns = new Map<string, HTMLElement>();
  const navBox = el('div', { class: 'navs' });
  for (const n of navs) {
    const b = el('button', { class: 'bm-navitem', type: 'button' }, el('img', { class: 'ni', src: itemIcon(game, n.icon), alt: '' }), el('span', {}, t(n.label)));
    b.addEventListener('click', () => {
      game.audio.play('click', { volume: 0.3 });
      const sec = secs.get(n.id);
      if (sec) right.scrollTo({ top: sec.offsetTop - (n.id === 'general' ? 0 : 0), behavior: 'smooth' });
    });
    navBtns.set(n.id, b);
    navBox.append(b);
  }
  let creating = false;
  const collect = (): WorldOptions => {
    const rules: Record<string, boolean> = {
      tntExplodes: S.tnt,
      naturalRegeneration: S.regen,
      showCoordinates: S.coords,
      doImmediateRespawn: S.instant,
      doDaylightCycle: !S.eternalDay,
      keepInventory: S.keepInv,
      doMobSpawning: S.mobSpawn,
      mobGriefing: S.mobGrief,
      doWeatherCycle: S.weather,
    };
    return {
      hardcore: S.hardcore, flat: S.flat, startingMap: S.startingMap, showDays: S.days, unlockRecipes: S.recipes, fireTick: S.fireTick, mobLoot: S.mobLoot, tileDrops: S.tileDrops,
      sleepSkipsNight: S.sleep, sleepPercent: S.sleepPercent, respawnBlocksExplode: S.respawnExplode, spawnRadius: S.spawnRadius, simulationDistance: S.sim,
      multiplayer: S.multiplayer, playerAccess: S.access, defaultPermission: S.perm, lanVisible: S.lan, friendlyFire: S.friendlyFire, waypoints: S.waypoints,
      entityLoot: S.entityLoot, commandBlocks: S.commandBlocks, education: S.education, randomTickSpeed: S.randomTick, sharedPacks: S.sharedPacks,
      experiments: [...experiments], rules,
    };
  };
  const make = async (realms: boolean) => {
    if (creating) return;
    creating = true;
    const name = nameIn.value.trim() || nameIn.placeholder || 'Mon monde';
    await game.createWorld(name, seedIn.value, S.mode, S.diff, S.bonus, S.cheats, S.bots, collect());
    if (realms && game.session) {
      game.pause();
      game.showHostScreen();
    }
    creating = false;
  };
  const go = bmBtn('CRÉER', () => void make(false), { tone: 'green', cls: 'go' });
  const realms = bmBtn('Créer sur Realms', () => void make(true), { tone: 'purple' });
  left.append(pv, go, realms, navBox);

  const sbar = bmScrollbar(right);
  const rightWrap = el('div', { style: 'position:relative;flex:1;min-width:0;display:flex' }, right, sbar);
  right.style.flex = '1';
  // surbrillance de la section visible + défilement de la colonne de gauche
  const spy = () => {
    let cur = 'general';
    for (const n of navs) {
      const sec = secs.get(n.id);
      if (sec && sec.offsetTop <= right.scrollTop + 24) cur = n.id;
    }
    if (right.scrollTop + right.clientHeight >= right.scrollHeight - 2) cur = navs[navs.length - 1].id;
    for (const [id, b] of navBtns) b.classList.toggle('on', id === cur);
    const want = right.scrollTop > 6 ? left.scrollHeight : 0;
    if (Math.abs(left.scrollTop - (want ? left.scrollHeight - left.clientHeight : 0)) > 2) left.scrollTop = want ? left.scrollHeight : 0;
  };
  right.addEventListener('scroll', spy, { passive: true });
  const s = bmScreen(game, { cls: 'bm-create', title: 'Créer un nouveau monde', solid: true, body: [el('div', { class: 'bm-cols' }, left, rightWrap)] });
  requestAnimationFrame(spy);
  return { el: s.el, onBack: s.onBack };
}

// ---------------------------------------------------------------- Modifier un monde
export function editWorldScreen(game: Game, w: WorldMeta, done: () => void): Screen {
  const name = bmInput(w.name, { maxlength: 32 });
  let cheats = w.cheats ?? true;
  const status = el('div', { class: 'bm-status' });
  const modeName = w.gameMode === 'creative' ? 'Créatif' : 'Survie';
  const diffName: Record<Difficulty, string> = { peaceful: 'Paisible', easy: 'Facile', normal: 'Normale', hard: 'Difficile' };
  const pv = el('div', { class: 'pv' });
  if (w.thumbnail) pv.style.backgroundImage = `url(${w.thumbnail})`;
  else pv.style.cssText = previewStyle(game, w.seed);
  const save = bmBtn('ENREGISTRER', async () => {
    w.name = name.value.trim() || w.name;
    // les triches ne changent qu'en enregistrant (« Annuler » ne modifie rien)
    w.cheats = cheats;
    await game.saves.updateMeta(w);
    done();
    game.ui.back();
  }, { tone: 'green', cls: 'go' });
  const play = bmBtn('Jouer', () => void game.playWorld(w), { tone: 'gray' });
  const left = el('div', { class: 'bm-left' }, pv, save, play);
  const del = bmBtn('Supprimer le monde', async () => {
    if (await game.ui.confirm('Voulez-vous vraiment supprimer ce monde ?', `« ${w.name} » sera perdu à jamais ! (Très longtemps !)`, 'Supprimer')) {
      await game.saves.deleteSave(w.id);
      done();
      game.ui.back();
    }
  }, { tone: 'red' });
  const right = el(
    'div',
    { class: 'bm-right' },
    bmRow('Nom du monde', undefined, name),
    bmRow('Informations', `${t(modeName)} · ${t(diffName[w.difficulty])} · ${t('Graine')} ${w.seed}`),
    bmToggle('Activer les triches', 'Les triches autorisent les commandes comme /give, /tp, /time ou /gamemode.', cheats, (v) => (cheats = v)).el,
    el(
      'div',
      { class: 'bm-rw' },
      el('div', { class: 't' }, t('Sauvegardes')),
      el('div', { class: 'bm-inrow', style: 'margin-top:calc(var(--u) * 6 * 1px);flex-wrap:wrap' },
        bmBtn('Faire une sauvegarde', async () => {
          await game.saves.backupSave(w.id);
          status.textContent = t('Copie de sauvegarde créée');
          done();
        }, { w: 150 }),
        bmBtn('Recréer', () => void game.recreateWorld(w), { w: 150 }),
        del,
      ),
      status,
    ),
  );
  const s = bmScreen(game, { cls: 'bm-create', title: 'Modifier le monde', solid: true, body: [el('div', { class: 'bm-cols' }, left, el('div', { style: 'position:relative;flex:1;min-width:0;display:flex' }, right, bmScrollbar(right)))] });
  right.style.flex = '1';
  return { el: s.el, onBack: s.onBack };
}

// ---------------------------------------------------------------- chargement du monde
export function loadingScreen(game: Game | null, title: string, bg: string | null) {
  const bar = el('i');
  const dots = el('span', {}, '..');
  const tip = el('div', { class: 'tip' }, t(randomTip()));
  const root = el(
    'div',
    { class: 'screen mc-screen bm-screen bm-loading' },
    el('div', { class: 'bg', style: bg ? `background-image:url(${bg})` : '' }),
    el('img', { class: 'bm-logo', src: art(game as Game).logo, alt: 'LeCraft' }),
    el('div', { class: 'bm-lbox' }, el('div', { class: 'lt' }, title === 'Chargement…' ? el('span', {}, t('Chargement')) : el('span', {}, t(title)), dots), el('div', { class: 'lb' }, tip, el('div', { class: 'bar' }, bar))),
  );
  const iv = window.setInterval(() => {
    if (!root.isConnected) {
      window.clearInterval(iv);
      return;
    }
    dots.textContent = '.'.repeat(2 + (Math.floor(performance.now() / 450) % 2));
  }, 220);
  // une nouvelle astuce toutes les quelques secondes si le chargement dure
  const tp = window.setInterval(() => {
    if (!root.isConnected) return window.clearInterval(tp);
    tip.textContent = t(randomTip());
  }, 6500);
  const screen: Screen = { el: root, onBack: () => true };
  return {
    screen,
    progress(f: number) {
      bar.style.width = `${Math.round(Math.max(0.02, f) * 100)}%`;
      root.dataset.progress = String(Math.round(f * 100));
    },
  };
}

// ---------------------------------------------------------------- Social, Profil, Vestiaire, Magasin
export function socialScreen(game: Game): Screen {
  const s = bmScreen(game, {
    cls: 'bm-play',
    title: 'Social',
    social: false,
    dim: true,
    body: [
      el(
        'div',
        { class: 'bm-wrap' },
        el('div', { class: 'bm-rw bm-panel', style: 'margin-top:calc(var(--u) * 10 * 1px)' },
          el('div', { class: 't' }, t('Amis') + ' (0)'),
          el('div', { class: 'd' }, t('Aucun ami connecté. LeCraft fonctionne hors ligne : pour jouer avec d’autres joueurs, ouvrez votre monde au multijoueur (menu du jeu) ou rejoignez une partie dans Realms.')),
          el('div', { class: 'bm-inrow', style: 'margin-top:calc(var(--u) * 8 * 1px)' }, bmBtn('Realms', () => { game.ui.back(); game.ui.push(playScreen(game, 'realms')); }, { tone: 'purple', w: 120 })),
        ),
      ),
    ],
  });
  return { el: s.el, onBack: s.onBack };
}

export function profileScreen(game: Game): Screen {
  const st = game.settings;
  const name = bmInput(st.playerName ?? '', { placeholder: 'Joueur', maxlength: 16 });
  name.addEventListener('change', () => {
    st.playerName = name.value.trim().replace(/[^\p{L}\p{N}_\- ]/gu, '').slice(0, 16) || undefined;
    game.saveSettings();
  });
  const fig = el('div', { class: 'bm-avatar', style: 'position:static;width:calc(var(--u) * 72 * 1px);margin:calc(var(--u) * 12 * 1px) auto' }, figureCanvas(game, st.playerSkin, 5));
  const left = el('div', { class: 'bm-left' }, fig, bmBtn('Vestiaire', () => game.ui.push(wardrobeScreen(game)), { tone: 'green', cls: 'go' }));
  const right = el(
    'div',
    { class: 'bm-right' },
    bmRow('Pseudo', 'Affiché au-dessus de votre personnage et dans les parties en réseau.', name),
    el('div', { class: 'bm-rw' }, el('div', { class: 'bm-inrow', style: 'flex-wrap:wrap' }, bmBtn('Aide', () => game.showHelp(), { w: 130 }), bmBtn('Crédits', () => game.showCredits(), { w: 130 }))),
  );
  right.style.flex = '1';
  const s = bmScreen(game, { cls: 'bm-create', title: 'Profil', solid: true, body: [el('div', { class: 'bm-cols' }, left, right)] });
  return { el: s.el, onBack: s.onBack };
}

export function wardrobeScreen(game: Game): Screen {
  const st = game.settings;
  const grid = el('div', { class: 'bm-tiles', style: 'grid-template-columns:repeat(5,1fr);padding:calc(var(--u) * 10 * 1px) calc(var(--u) * 16 * 1px)' });
  const draw = () => {
    grid.replaceChildren();
    for (const k of PLAYER_SKINS) {
      const on = (st.playerSkin ?? 'steve') === k;
      const b = el('button', { class: `bm-card${on ? ' sel' : ''}`, type: 'button', style: `align-items:center;padding:calc(var(--u) * 6 * 1px);${on ? 'outline:calc(var(--u) * 1.5 * 1px) solid #fff' : ''}` }, figureCanvas(game, k, 3), el('div', { class: 'txt', style: 'padding:calc(var(--u) * 4 * 1px) 0 0;text-align:center' }, k[0].toUpperCase() + k.slice(1)));
      b.querySelector('canvas')!.style.cssText = 'width:calc(var(--u) * 32 * 1px);image-rendering:pixelated';
      b.addEventListener('click', () => {
        st.playerSkin = k;
        game.saveSettings();
        draw();
      });
      grid.append(b);
    }
  };
  draw();
  const s = bmScreen(game, { cls: 'bm-play', title: 'Vestiaire', dim: true, body: [el('div', { class: 'bm-wrap' }, grid)], back: () => (game.ui.back(), void 0) });
  return { el: s.el, onBack: s.onBack };
}

/** Magasin : tout ce qui s'ajoute au jeu hors ligne (add-ons .mcaddon/.mcpack, packs de ressources). */
export function shopScreen(game: Game): Screen {
  const status = el('div', { class: 'bm-status' });
  const list = el('div', { class: 'bm-addons' });
  const restart = bmBtn('Redémarrer pour appliquer', async () => {
    if (game.session) await game.saveNow();
    location.reload();
  }, { tone: 'green' });
  restart.style.display = 'none';
  const changed = () => (restart.style.display = '');
  const typeName: Record<string, string> = { resources: 'ressources', data: 'comportement', script: 'scripts', skin_pack: 'skins', world_template: 'modèle de monde', unknown: 'inconnu' };
  const refresh = async () => {
    const all = await listAddons().catch(() => [] as InstalledAddon[]);
    list.replaceChildren();
    if (!all.length) list.append(el('div', { class: 'bm-rw' }, el('div', { class: 'd' }, t('Aucun add-on installé.'))));
    for (const a of all) {
      const packs = a.packs.map((p) => `${typeName[p.type] ?? p.type}${p.hasScripts ? ' (scripts ignorés)' : ''}`).join(' + ');
      list.append(
        el('div', { class: 'bm-rw world-entry', style: 'cursor:default' },
          el('div', { class: 't name' }, a.name),
          el('div', { class: 'd sub' }, `${a.fileName} · ${packs}`),
          el('div', { class: 'd sub' }, a.packs[0]?.description ?? ''),
          el('div', { class: 'bm-inrow', style: 'flex-wrap:wrap' },
            bmBtn(a.enabled ? 'Activé : OUI' : 'Activé : NON', async (e) => {
              await setAddonEnabled(a.id, !a.enabled);
              changed();
              void refresh();
              void e;
            }, { w: 120, h: 28 }),
            bmBtn('Supprimer', async () => {
              if (await game.ui.confirm('Supprimer cet add-on ?', `« ${a.name} » sera retiré. Les blocs qu'il ajoutait deviendront des « blocs inconnus » dans vos mondes.`, 'Supprimer')) {
                await removeAddon(a.id);
                changed();
                void refresh();
              }
            }, { w: 100, h: 28, tone: 'red' }),
          ),
        ),
      );
    }
  };
  const file = el('input', { type: 'file', accept: '.mcaddon,.mcpack,.zip,application/zip,application/octet-stream', style: 'display:none' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    status.textContent = t('Import en cours…');
    try {
      const a = await importAddon(f);
      status.textContent = `« ${a.name} » ${t('importé')} (${a.packs.length} pack(s)).`;
      changed();
      void refresh();
    } catch (e) {
      status.textContent = `${t("Échec de l'import")} : ${(e as Error).message}`;
    }
    file.value = '';
  });
  const packFile = el('input', { type: 'file', accept: '.zip,.jar,application/zip,application/java-archive', style: 'display:none' });
  const packName = el('div', { class: 'd' });
  const showPack = () => (packName.textContent = game.textures.packName ? `${t('Pack actif')} : ${game.textures.packName}` : t('Pack actif : Par défaut (textures du jeu)'));
  showPack();
  packFile.addEventListener('change', async () => {
    const f = packFile.files?.[0];
    if (!f) return;
    status.textContent = t('Import en cours…');
    try {
      const info = await importPack(f);
      const pack = info.files || info.sounds ? await loadInstalledPack() : null;
      if (info.files || info.sounds) game.applyPack(pack);
      status.textContent = `${info.files} ${t('textures importées')}`;
      showPack();
    } catch (e) {
      status.textContent = `${t("Échec de l'import")} : ${(e as Error).message}`;
    }
    packFile.value = '';
  });
  const r = game.addonResult;
  const loaded = r && (r.counts.blocks || r.counts.items || r.counts.mobs || r.counts.recipes || r.counts.textures || r.counts.functions)
    ? `Chargés : ${r.counts.blocks} blocs, ${r.counts.items} objets, ${r.counts.recipes} recettes, ${r.counts.mobs} créatures, ${r.counts.functions} fonctions, ${r.counts.textures} textures.`
    : '';
  void refresh();
  const right = el(
    'div',
    { class: 'bm-right' },
    ...bmSection('Extensions', 'Add-ons de l’édition mobile (.mcaddon, .mcpack) : nouveaux blocs, objets, recettes, créatures, textures, fonctions. Les scripts JavaScript ne sont pas exécutés.'),
    el('div', { class: 'bm-rw' }, el('div', { class: 'bm-inrow', style: 'flex-wrap:wrap' }, bmBtn('Importer un add-on...', () => file.click(), { tone: 'green', w: 170 }), restart), status, loaded ? el('div', { class: 'd' }, loaded) : null, ...(r?.report ?? []).map((x) => el('div', { class: 'd', style: 'color:#ffe96b' }, x))),
    list,
    ...bmSection('Packs de ressources', 'Importez le .zip d’un pack ou le .jar de version de votre propre copie du jeu : les textures restent sur votre appareil.'),
    el('div', { class: 'bm-rw' }, packName, el('div', { class: 'bm-inrow', style: 'flex-wrap:wrap;margin-top:calc(var(--u) * 6 * 1px)' },
      bmBtn('Importer un pack...', () => packFile.click(), { w: 150 }),
      bmBtn('Retirer le pack', async () => {
        await removePack();
        declineBundledPack();
        game.applyPack(null);
        showPack();
        status.textContent = t('Pack retiré');
      }, { w: 150, tone: 'red' }),
    ), file, packFile),
  );
  right.style.flex = '1';
  const left = el('div', { class: 'bm-left' }, el('div', { class: 'bm-rw', style: 'border:0;box-shadow:none' }, el('div', { class: 't' }, t('Magasin')), el('div', { class: 'd' }, t('LeCraft est hors ligne : ici, vous ajoutez vos propres contenus.'))));
  const s = bmScreen(game, { cls: 'bm-create', title: 'Magasin', solid: true, body: [el('div', { class: 'bm-cols' }, left, el('div', { style: 'position:relative;flex:1;min-width:0;display:flex' }, right, bmScrollbar(right)))] });
  return { el: s.el, onBack: s.onBack };
}
