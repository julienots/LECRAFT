import type { Game } from '../core/Game';
import { commandList, suggest } from '../commands/Commands';
import type { Screen } from './UIManager';
import { el } from './dom';
import { mcNodes } from './McText';
import { hooks } from '../scripting/Hooks';
import { bhButton, bhIconEl } from './Bedrock';
import { tb } from './BedrockLang';
import { QUICK, quickIcon, type QItem } from './QuickCommands';

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
    const d = el('div', { class: `chat-line ${l.kind}` });
    d.append(...mcNodes(l.text));
    return d;
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

  /** Ouvre la saisie (préremplie par exemple avec « / » : mode commandes avec la liste rapide). */
  open(prefill = '') {
    const game = this.game;
    if (this.screen || !game.session) return;
    const log = el('div', { class: 'chat-log' });
    const sugg = el('div', { class: 'chat-sugg' });
    const usage = el('div', { class: 'bh-usage' });
    const quick = el('div', { class: 'bh-quick' });
    const input = el('input', { class: 'chat-input', type: 'text', maxlength: '256', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'send', placeholder: '' });
    input.value = prefill;
    let hIdx = this.history.length;
    // ----- barre du haut -----
    const backLbl = el('span', {}, tb('Quitter'));
    const back = el('button', { class: 'bh-chat-back', type: 'button' }, bhIconEl('back'), backLbl);
    const bar = el('div', { class: 'bh-chat-bar' }, back, el('div', { class: 'bh-chat-title' }, tb('Tchat et commandes')));
    // ----- barre de saisie : clavier, « / », réglages, champ, envoi -----
    const kb = el('button', { class: 'bh-chat-ib', type: 'button', 'aria-label': 'Clavier' }, bhIconEl('keyboard'));
    const slash = el('button', { class: 'bh-chat-ib', type: 'button', 'aria-label': 'Commandes' }, '/');
    const gear = el('button', { class: 'bh-chat-ib', type: 'button', 'aria-label': 'Paramètres' }, bhIconEl('gear'));
    const send = el('button', { class: 'bh-chat-send', type: 'button', 'aria-label': 'Envoyer' }, bhIconEl('send'));
    const row = el('div', { class: 'bh-chat-input' }, kb, slash, gear, input, send);
    this.refreshLog = () => {
      log.replaceChildren(...this.lines.slice(-60).map((l) => this.lineEl(l)));
      log.scrollTop = log.scrollHeight;
    };
    this.refreshLog();

    // ----- liste rapide (point d'apparition, téléportation, heure, météo) -----
    let commandMode = prefill.startsWith('/');
    let who = '@s';
    const path: QItem[] = [];
    const quickList = () => QUICK(game.session!, () => who, (w) => (who = w));
    const showUsage = (cmd: string | undefined) => {
      const name = cmd?.replace(/^\//, '').split(' ')[0];
      const defs = name ? commandList().filter((c) => c.name === name) : [];
      usage.replaceChildren(...defs.map((d) => el('div', {}, d.usage)));
    };
    const runQuick = (cmd: string) => {
      this.add(cmd, 'chat');
      game.session?.runCommand(cmd);
      path.length = 0;
      input.value = '';
      renderQuick();
    };
    const renderQuick = () => {
      const typing = input.value.trim() !== '' && path.length === 0;
      const visible = commandMode && !typing;
      quick.style.display = visible ? '' : 'none';
      usage.style.display = visible && path.length ? '' : 'none';
      backLbl.textContent = tb(commandMode ? 'Retour' : 'Quitter');
      if (!visible) return;
      const items = path.length ? path[path.length - 1].children ?? [] : quickList();
      const nodes: HTMLElement[] = [];
      if (path.length) {
        const head = path[path.length - 1];
        const b = bhButton(head.label, () => {
          path.pop();
          input.value = path.length ? path[path.length - 1].prefix ?? '' : '';
          showUsage(path[path.length - 1]?.prefix);
          renderQuick();
        }, { cls: 'bh-q head', back: true });
        nodes.push(b);
      }
      items.forEach((it, idx) => {
        const leaf = !it.children;
        const b = bhButton(it.label, () => {
          if (it.pick) it.pick();
          if (it.run) return runQuick(it.run());
          if (it.children) {
            path.push(it);
            input.value = it.prefix ?? '';
            showUsage(it.prefix);
            renderQuick();
          } else if (it.pick) {
            // choix d'un paramètre (cible de téléportation) : retour à la liste précédente
            path.pop();
            input.value = path.length ? `${path[path.length - 1].prefix ?? ''} ${who}`.trim() : '';
            renderQuick();
          }
        }, { cls: `bh-q${path.length ? ' sub' : ''}${leaf && path.length && it.icon ? ' opt' : ''}${idx === 0 ? ' sel' : ''}`, chevron: !!it.children });
        if (it.icon && !it.children) {
          const ic = el('i', { class: 'bh-q-ic' });
          ic.style.backgroundImage = `url(${quickIcon(it.icon)})`;
          b.prepend(ic);
        }
        b.addEventListener('pointerenter', () => nodes.forEach((n) => n.classList.toggle('sel', n === b)));
        nodes.push(b);
      });
      quick.replaceChildren(...nodes);
    };
    const stepBack = () => {
      if (commandMode && path.length) {
        path.pop();
        input.value = path.length ? path[path.length - 1].prefix ?? '' : '';
        showUsage(path[path.length - 1]?.prefix);
        renderQuick();
      } else if (commandMode) {
        commandMode = false;
        input.value = '';
        usage.replaceChildren();
        renderQuick();
        updateSugg();
      } else this.close();
    };
    const updateSugg = () => {
      const v = input.value;
      if (!v.startsWith('/') || (commandMode && path.length)) {
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
      let v = input.value.trim();
      if (!v) return this.close();
      // mode commandes : la barre oblique est facultative
      if (commandMode && !v.startsWith('/')) v = `/${v}`;
      this.history.push(v);
      if (this.history.length > 50) this.history.shift();
      if (v.startsWith('/')) {
        this.add(v, 'chat');
        game.session?.runCommand(v);
      } else if (!hooks.chat?.(v)) {
        const net = game.session?.server;
        this.add(net ? net.formatPlayerChat(v) : `<${game.session?.player.name ?? 'Joueur'}> ${v}`, 'chat');
        net?.playerChat(v);
        game.session?.smp?.playerChat(v);
        game.session?.mp?.chat(v);
      }
      this.close();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') stepBack();
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
    input.addEventListener('input', () => {
      if (!input.value.trim()) path.length = 0;
      renderQuick();
      updateSugg();
    });
    send.addEventListener('click', submit);
    back.addEventListener('click', stepBack);
    kb.addEventListener('click', () => input.focus());
    slash.addEventListener('click', () => {
      // « / » : bascule vers les commandes (liste rapide) ; un second toucher écrit la barre oblique
      if (!commandMode) {
        commandMode = true;
        input.value = '';
        renderQuick();
        updateSugg();
      } else if (!input.value.startsWith('/')) {
        input.value = `/${input.value}`;
        renderQuick();
        updateSugg();
      }
      input.focus();
    });
    gear.addEventListener('click', () => game.showSettings());
    const root = el('div', { class: 'screen bh-chat' }, bar, el('div', { class: 'bh-chat-mid' }, log, usage, quick, sugg), row);
    this.screen = { el: root, onBack: () => (stepBack(), true) };
    document.documentElement.classList.add('bh-chatting');
    game.ui.push(this.screen);
    renderQuick();
    updateSugg();
    setTimeout(() => input.focus(), 30);
    this.renderFeed();
  }

  close() {
    if (!this.screen) return;
    const s = this.screen;
    this.screen = null;
    this.refreshLog = null;
    document.documentElement.classList.remove('bh-chatting');
    this.game.ui.remove(s);
    this.game.onChatClosed();
    this.renderFeed();
  }
}
