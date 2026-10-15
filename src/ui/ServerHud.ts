/**
 * Affichages propres au serveur de mini-jeux HypXL : barre de boss (message défilant du serveur)
 * et liste des joueurs (touche Tab maintenue ou /list), avec rangs, niveaux et ping.
 * Les éléments sont ajoutés à la racine du HUD et retirés en quittant le serveur.
 */
import { el } from './dom';
import { setMcText } from './McText';

export interface TabEntry {
  /** Nom formaté (codes couleur §). */
  name: string;
  ping: number;
}

export class ServerHud {
  private bar: HTMLElement;
  private barText: HTMLElement;
  private barFill: HTMLElement;
  private tab: HTMLElement;
  private tabTimer = 0;
  private tabHeld = false;
  private offs: (() => void)[] = [];

  constructor() {
    const root = document.querySelector('.hud-root') ?? document.body;
    this.barText = el('div', { style: 'font-size:calc(var(--gs, 2) * 7px);color:#fff;text-shadow:1px 1px 0 #3f3f3f;white-space:nowrap' });
    this.barFill = el('div', { style: 'height:100%;width:100%;background:linear-gradient(#f9e04b,#d39b16);transition:width .25s' });
    this.bar = el(
      'div',
      { class: 'hypxl-bossbar', style: 'position:absolute;top:calc(6px + var(--safe-top, 0px));left:50%;transform:translateX(-50%);width:min(380px,56vw);text-align:center;pointer-events:none;z-index:2' },
      this.barText,
      el('div', { style: 'height:6px;margin-top:2px;background:#000a;border:1px solid #000;overflow:hidden' }, this.barFill),
    );
    this.tab = el('div', {
      class: 'hypxl-tablist',
      style: 'position:absolute;top:calc(34px + var(--safe-top, 0px));left:50%;transform:translateX(-50%);max-width:94vw;background:rgba(0,0,0,.55);padding:4px 6px;pointer-events:none;z-index:3;font-size:calc(var(--gs, 2) * 6px);color:#fff;text-shadow:1px 1px 0 #3f3f3f',
    });
    this.tab.style.display = 'none';
    root.append(this.bar, this.tab);
    const kd = (e: KeyboardEvent) => {
      if (e.code !== 'Tab' || this.typing()) return;
      e.preventDefault();
      this.tabHeld = true;
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Tab') this.tabHeld = false;
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this.offs.push(() => window.removeEventListener('keydown', kd), () => window.removeEventListener('keyup', ku));
  }

  private typing() {
    const a = document.activeElement;
    return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement;
  }

  /** Message de la barre de boss (null : masquée) et remplissage 0..1. */
  setBar(text: string | null, frac = 1) {
    this.bar.style.display = text === null ? 'none' : '';
    if (text === null) return;
    if (this.bar.dataset.text !== text) {
      this.bar.dataset.text = text;
      setMcText(this.barText, text);
    }
    this.barFill.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  }

  /** Affiche la liste des joueurs quelques secondes (/list, bouton). */
  showTab(seconds = 6) {
    this.tabTimer = seconds;
  }

  /** La liste est-elle visible (Tab maintenue ou /list récent) ? */
  get tabVisible() {
    return this.tabHeld || this.tabTimer > 0;
  }

  /** Met à jour la liste des joueurs (appelée régulièrement par le serveur). */
  update(dt: number, header: string, footer: string, entries: () => TabEntry[]) {
    this.tabTimer = Math.max(0, this.tabTimer - dt);
    const show = this.tabVisible;
    this.tab.style.display = show ? '' : 'none';
    if (!show) return;
    const list = entries();
    const cols = list.length > 30 ? 3 : list.length > 12 ? 2 : 1;
    const head = el('div', { style: 'text-align:center;margin-bottom:3px' });
    setMcText(head, header);
    const grid = el('div', { style: `display:grid;grid-template-columns:repeat(${cols}, minmax(0, 1fr));column-gap:10px;row-gap:1px` });
    for (const e of list) {
      const name = el('span', { style: 'overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0' });
      setMcText(name, e.name);
      const bars = e.ping < 60 ? 5 : e.ping < 100 ? 4 : e.ping < 160 ? 3 : e.ping < 260 ? 2 : 1;
      const ping = el('span', { style: `color:${bars >= 4 ? '#5f5' : bars >= 3 ? '#ff5' : '#f55'};margin-left:6px;flex:none` }, '▮'.repeat(bars));
      grid.append(el('div', { style: 'display:flex;justify-content:space-between;background:rgba(255,255,255,.08);padding:0 3px' }, name, ping));
    }
    const foot = el('div', { style: 'text-align:center;margin-top:3px' });
    setMcText(foot, footer);
    this.tab.replaceChildren(head, grid, foot);
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
    this.bar.remove();
    this.tab.remove();
  }
}
