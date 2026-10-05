import type { Game } from '../core/Game';
import { commandList, suggest } from '../commands/Commands';
import type { Screen } from './UIManager';
import { el } from './dom';

interface Line {
  text: string;
  kind: 'info' | 'error' | 'chat';
  at: number;
}

/**
 * Chat du jeu : messages récents en bas à gauche (s'effacent après 10 s) ; écran de saisie avec
 * historique (flèches), autocomplétion des commandes (Tab ou toucher une suggestion).
 */
export class ChatUI {
  private lines: Line[] = [];
  private feed: HTMLElement;
  private history: string[] = [];
  private screen: Screen | null = null;

  constructor(private game: Game, hudRoot: HTMLElement) {
    this.feed = el('div', { class: 'chat-feed' });
    hudRoot.append(this.feed);
    setInterval(() => this.renderFeed(), 1000);
  }

  add(text: string, kind: Line['kind'] = 'info') {
    for (const part of text.split('\n')) this.lines.push({ text: part, kind, at: performance.now() });
    if (this.lines.length > 100) this.lines.splice(0, this.lines.length - 100);
    this.renderFeed();
    this.refreshLog?.();
  }

  clear() {
    this.lines = [];
    this.renderFeed();
  }

  private lineEl(l: Line) {
    return el('div', { class: `chat-line ${l.kind}` }, l.text);
  }

  private renderFeed() {
    const now = performance.now();
    const recent = this.lines.filter((l) => now - l.at < 10000).slice(-8);
    this.feed.replaceChildren(...recent.map((l) => this.lineEl(l)));
    this.feed.style.display = this.screen ? 'none' : '';
  }

  private refreshLog: (() => void) | null = null;

  get isOpen() {
    return !!this.screen;
  }

  /** Ouvre la saisie (préremplie par exemple avec « / »). */
  open(prefill = '') {
    const game = this.game;
    if (this.screen || !game.session) return;
    const log = el('div', { class: 'chat-log' });
    const sugg = el('div', { class: 'chat-sugg' });
    const input = el('input', { class: 'chat-input', type: 'text', maxlength: '256', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'send', placeholder: 'Message ou /commande (ex. /help)' });
    input.value = prefill;
    let hIdx = this.history.length;
    const send = el('button', { class: 'mc-btn chat-send', type: 'button', style: '--w:24', 'aria-label': 'Envoyer' }, el('span', {}, '➤'));
    const slash = el('button', { class: 'mc-btn chat-send', type: 'button', style: '--w:20' }, el('span', {}, '/'));
    const close = el('button', { class: 'mc-btn chat-send', type: 'button', style: '--w:20' }, el('span', {}, '✕'));
    this.refreshLog = () => {
      log.replaceChildren(...this.lines.slice(-60).map((l) => this.lineEl(l)));
      log.scrollTop = log.scrollHeight;
    };
    this.refreshLog();
    const updateSugg = () => {
      const v = input.value;
      if (!v.startsWith('/')) {
        sugg.replaceChildren();
        return;
      }
      const list = suggest(v);
      sugg.replaceChildren(
        ...list.slice(0, 10).map((s) => {
          const b = el('div', { class: 'chat-sugg-item' }, s);
          b.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            applySuggestion(s);
          });
          return b;
        }),
      );
    };
    const applySuggestion = (s: string) => {
      const v = input.value;
      if (s.startsWith('/')) {
        // nom de commande : on garde seulement le mot-clé
        input.value = `${s.split(' ')[0]} `;
      } else {
        const parts = v.split(' ');
        parts[parts.length - 1] = s;
        input.value = `${parts.join(' ')} `;
      }
      input.focus();
      updateSugg();
    };
    const submit = () => {
      const v = input.value.trim();
      if (!v) return this.close();
      this.history.push(v);
      if (this.history.length > 50) this.history.shift();
      if (v.startsWith('/')) {
        this.add(v, 'chat');
        game.session?.runCommand(v);
      } else this.add(`<Joueur> ${v}`, 'chat');
      this.close();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') this.close();
      else if (e.key === 'Tab') {
        e.preventDefault();
        const first = sugg.firstElementChild?.textContent;
        if (first) applySuggestion(first);
      } else if (e.key === 'ArrowUp' && this.history.length) {
        hIdx = Math.max(0, hIdx - 1);
        input.value = this.history[hIdx];
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        hIdx = Math.min(this.history.length, hIdx + 1);
        input.value = this.history[hIdx] ?? '';
        e.preventDefault();
      }
    });
    input.addEventListener('input', updateSugg);
    send.addEventListener('click', submit);
    slash.addEventListener('click', () => {
      if (!input.value.startsWith('/')) input.value = `/${input.value}`;
      input.focus();
      updateSugg();
    });
    close.addEventListener('click', () => this.close());
    const help = el('div', { class: 'chat-help' }, `${commandList().length} commandes : tapez / pour voir les suggestions`);
    const root = el('div', { class: 'screen chat-screen' }, log, el('div', { class: 'chat-bottom' }, sugg, help, el('div', { class: 'chat-row' }, slash, input, send, close)));
    root.addEventListener('pointerdown', (e) => {
      if (e.target === root) this.close();
    });
    this.screen = { el: root, onBack: () => (this.close(), true) };
    game.ui.push(this.screen);
    updateSugg();
    setTimeout(() => input.focus(), 30);
    this.renderFeed();
  }

  close() {
    if (!this.screen) return;
    const s = this.screen;
    this.screen = null;
    this.refreshLog = null;
    this.game.ui.remove(s);
    this.game.onChatClosed();
    this.renderFeed();
  }
}
