/**
 * Texte formaté du jeu de référence : codes « § » (couleurs 0-9 a-v, §l gras, §o italique,
 * §k brouillé, §r réinitialisation). Rendu en éléments DOM sûrs (aucun HTML interprété).
 */
const COLORS: Record<string, string> = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA', '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
  g: '#DDD605', h: '#E3D4D1', i: '#CECACA', j: '#443A3B', m: '#971607', n: '#B4684D', p: '#DEB12D', q: '#47A036',
  s: '#2CBAA8', t: '#21497B', u: '#9A5CC6', v: '#EB7114',
};

/** Retire les codes de mise en forme. */
export function stripMc(text: string): string {
  return String(text).replace(/§./g, '').replace(/§$/, '');
}

/** Construit les nœuds DOM d'un texte formaté. */
export function mcNodes(text: string): Node[] {
  const out: Node[] = [];
  let color: string | null = null, bold = false, italic = false, obf = false;
  let buf = '';
  const flush = () => {
    if (!buf) return;
    if (!color && !bold && !italic && !obf) out.push(document.createTextNode(buf));
    else {
      const sp = document.createElement('span');
      sp.textContent = obf ? buf.replace(/\S/g, '▒') : buf;
      if (color) sp.style.color = color;
      if (bold) sp.style.fontWeight = 'bold';
      if (italic) sp.style.fontStyle = 'italic';
      out.push(sp);
    }
    buf = '';
  };
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '§' && i + 1 < s.length) {
      const k = s[i + 1].toLowerCase();
      i++;
      flush();
      if (COLORS[k]) {
        color = COLORS[k];
        obf = false;
      } else if (k === 'l') bold = true;
      else if (k === 'o') italic = true;
      else if (k === 'k') obf = true;
      else if (k === 'r') {
        color = null;
        bold = italic = obf = false;
      }
      continue;
    }
    if (ch === '\n') {
      flush();
      out.push(document.createElement('br'));
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

/** Remplace le contenu d'un élément par un texte formaté. */
export function setMcText(el: HTMLElement, text: string) {
  el.replaceChildren(...mcNodes(text));
}
