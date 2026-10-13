import type { Game } from '../core/Game';
import type { Session } from '../core/Session';
import { ItemRegistry } from '../inventory/ItemRegistry';
import type { ItemStack } from '../inventory/Item';
import { stackName } from '../inventory/StackInfo';
import { enchantLines } from '../inventory/Enchantments';
import { PROFESSIONS, type Villager } from '../entities/Creatures';
import { el } from './dom';
import { mcButton, mcScreen, setLabel } from './Mc';

/** Écran d'échange avec un villageois (émeraudes ↔ objets selon la profession). */
export function openTrades(game: Game, s: Session, v: Villager): boolean {
  const prof = PROFESSIONS[v.profession];
  const trades = v.trades().filter((t) => ItemRegistry.has(t.give[0]) && ItemRegistry.has(t.get[0]) && (!t.give2 || ItemRegistry.has(t.give2[0])));
  return game.openScriptForm((close) => {
    const inv = s.player.inventory;
    const name = (id: string) => ItemRegistry.get(id)?.name ?? id;
    const icon = (id: string) => el('img', { class: 'trade-icon', src: game.textures.iconURL(id), alt: '' });
    const rows = trades.map((t) => {
      const out: ItemStack = { id: t.get[0], count: t.get[1], ...(ItemRegistry.maxDurability(t.get[0]) > 0 ? { durability: ItemRegistry.maxDurability(t.get[0]) } : {}), ...(t.meta ? { meta: t.meta } : {}) };
      const getName = t.meta ? `${stackName(out)} (${enchantLines(out).join(', ')})` : name(t.get[0]);
      const label = `${t.give[1]} × ${name(t.give[0])}${t.give2 ? ` + ${t.give2[1]} × ${name(t.give2[0])}` : ''}  →  ${t.get[1]} × ${getName}`;
      const b = mcButton(el('span', { class: 'trade-row' }, icon(t.give[0]), el('span', {}, label), icon(t.get[0])), () => {
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
      }, { w: 300 });
      b.dataset.trade = t.give[0];
      return { b, t, label };
    });
    const refresh = () => {
      for (const r of rows) {
        r.b.disabled = inv.count(r.t.give[0]) < r.t.give[1] || (!!r.t.give2 && inv.count(r.t.give2[0]) < r.t.give2[1]);
        void setLabel;
      }
    };
    refresh();
    const screen = mcScreen({
      title: `${prof.name} — échanges`,
      body: [el('div', { class: 'trade-list' }, ...rows.map((r) => r.b))],
      footer: [mcButton('Fermer', close, { w: 200 })],
      bg: 'dim',
      onBack: () => (close(), true),
    });
    screen.el.classList.add('trade-screen');
    return screen;
  });
}
