import type { Game } from '../core/Game';
import type { Session } from '../core/Session';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { ItemStack } from '../inventory/Item';
import { stackName } from '../inventory/StackInfo';
import { enchantLines } from '../inventory/Enchantments';
import { PROFESSIONS, type Villager } from '../entities/Creatures';
import { el } from './dom';
import { BC, drawBArrow, drawBHeader, drawBPanel, drawCross } from './BedrockArt';
import { pixelText } from './PixelFont';

const W = 249;
const H = 210;

/** Écran d'échange avec un villageois (émeraudes ↔ objets selon la profession), dans le style des interfaces Bedrock. */
export function openTrades(game: Game, s: Session, v: Villager): boolean {
  const prof = PROFESSIONS[v.profession];
  const trades = v.trades().filter((t) => ItemRegistry.has(t.give[0]) && ItemRegistry.has(t.get[0]) && (!t.give2 || ItemRegistry.has(t.give2[0])));
  return game.openScriptForm((close) => {
    const inv = s.player.inventory;
    const name = (id: string) => ItemRegistry.get(id)?.name ?? id;
    const icon = (id: string, count: number) => {
      const cell = el('span', { class: 'bi-ticon' }, el('img', { class: 'trade-icon', src: game.textures.iconURL(id) ?? '', alt: '' }));
      if (count > 1) cell.append(pixelText(String(count), { color: '#ffffff', shadow: '#3f3f3f', cls: 'gcount' }));
      return cell;
    };
    const rows = trades.map((t) => {
      const out: ItemStack = { id: t.get[0], count: t.get[1], ...(ItemRegistry.maxDurability(t.get[0]) > 0 ? { durability: ItemRegistry.maxDurability(t.get[0]) } : {}), ...(t.meta ? { meta: t.meta } : {}) };
      const getName = t.meta ? `${stackName(out)} (${enchantLines(out).join(', ')})` : name(t.get[0]);
      const label = `${t.give[1]} × ${name(t.give[0])}${t.give2 ? ` + ${t.give2[1]} × ${name(t.give2[0])}` : ''}  →  ${t.get[1]} × ${getName}`;
      const arrow = document.createElement('canvas');
      arrow.width = 18;
      arrow.height = 14;
      drawBArrow(arrow.getContext('2d')!, 0, 0, 0, 18, '#3c3c3c');
      arrow.className = 'bi-tarrow';
      const b = el('button', { class: 'bi-trade', type: 'button', title: label }, icon(t.give[0], t.give[1]), t.give2 ? icon(t.give2[0], t.give2[1]) : el('span', { class: 'bi-ticon' }), arrow, icon(t.get[0], t.get[1]));
      b.dataset.trade = t.give[0];
      b.addEventListener('click', () => {
        if (b.disabled) return;
        if (inv.count(t.give[0]) < t.give[1] || (t.give2 && inv.count(t.give2[0]) < t.give2[1])) return;
        inv.remove(t.give[0], t.give[1]);
        if (t.give2) inv.remove(t.give2[0], t.give2[1]);
        const left = inv.add({ ...out });
        if (left > 0) s.throwStack({ ...out, count: left });
        s.audio.play('villager_yes', { x: v.x, y: v.y, z: v.z });
        // particules vertes du villageois content (comme le jeu original)
        s.particles.burst('happy', v.x, v.y + 1.8, v.z, 5);
        s.player.addXp(1);
        s.progression.inc('trades');
        refresh();
      });
      return { b, t };
    });
    const refresh = () => {
      for (const r of rows) r.b.disabled = inv.count(r.t.give[0]) < r.t.give[1] || (!!r.t.give2 && inv.count(r.t.give2[0]) < r.t.give2[1]);
    };
    refresh();

    // fenêtre : panneau gris clair, en-tête sombre avec la croix de fermeture, liste des échanges
    const gui = el('div', { class: 'gui', style: `width:${W}px;height:${H}px` });
    const bg = document.createElement('canvas');
    bg.width = W;
    bg.height = H;
    bg.className = 'gui-bg';
    const g = bg.getContext('2d')!;
    drawBPanel(g, 0, 26, W, 184);
    drawBHeader(g, W - 40, 0, 40, 27);
    gui.append(bg);
    const title = pixelText(`${prof.name}`, { color: BC.text, cls: 'gui-abs' });
    title.style.left = '9px';
    title.style.top = '33px';
    const list = el('div', { class: 'trade-list bi-tlist', style: 'left:8px;top:48px;width:233px;height:154px' }, ...rows.map((r) => r.b));
    const cross = document.createElement('canvas');
    cross.width = 5;
    cross.height = 5;
    drawCross(cross.getContext('2d')!, 0, 0);
    cross.className = 'gui-layer';
    cross.style.left = `${W - 21}px`;
    cross.style.top = '9px';
    const closeBtn = el('div', { class: 'gui-btn bi-hbtn', 'data-btn': 'close', style: `position:absolute;left:${W - 27}px;top:3px;width:17px;height:21px` });
    closeBtn.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      close();
    });
    gui.append(title, list, cross, closeBtn);
    const wrap = el('div', { class: 'gui-wrap' }, gui);
    const root = el('div', { class: 'screen gui-screen trade-screen bi-trade-screen' }, wrap);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('pointerup', (e) => {
      if (e.target === root) close();
    });
    const layout = () => {
      const fit = Math.min((window.innerWidth - 12) / Math.max(W, 362), (window.innerHeight - 8) / 235);
      const k = fit >= 2 ? Math.floor(fit * 2) / 2 : Math.max(0.5, fit);
      wrap.style.transform = `scale(${k})`;
      wrap.style.width = `${W}px`;
      wrap.style.height = `${H}px`;
      wrap.style.left = `${Math.round((window.innerWidth - W * k) / 2)}px`;
      wrap.style.top = `${Math.round((window.innerHeight - 235 * k) / 2) - 1}px`;
    };
    window.addEventListener('resize', layout);
    document.body.classList.add('bi-open');
    layout();
    requestAnimationFrame(layout);
    return { el: root, onBack: () => (close(), true), onClose: () => {
        window.removeEventListener('resize', layout);
        document.body.classList.remove('bi-open');
      },
    };
  });
}
