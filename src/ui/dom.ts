/** Petits utilitaires DOM pour construire l'interface sans framework. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

export function button(label: string, onClick: () => void, cls = '', click?: () => void): HTMLButtonElement {
  const b = el('button', { class: `btn ${cls}`.trim(), type: 'button' }, label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    click?.();
    onClick();
  });
  return b;
}

export function toggle(on: boolean, onChange: (v: boolean) => void): HTMLDivElement {
  const t = el('div', { class: `toggle${on ? ' on' : ''}`, role: 'switch' });
  t.addEventListener('click', () => {
    on = !on;
    t.classList.toggle('on', on);
    onChange(on);
  });
  return t;
}

export function slider(min: number, max: number, step: number, value: number, onInput: (v: number) => void, fmt: (v: number) => string = String): HTMLDivElement {
  const wrap = el('div', { class: 'row', style: 'flex-wrap:nowrap' });
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  const val = el('span', { class: 'val' }, fmt(value));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = fmt(v);
    onInput(v);
  });
  wrap.append(input, val);
  return wrap;
}

export function select<T extends string | number>(options: [T, string][], value: T, onChange: (v: T) => void): HTMLSelectElement {
  const s = el('select');
  for (const [v, label] of options) {
    const o = el('option', { value: String(v) }, label);
    if (v === value) o.selected = true;
    s.append(o);
  }
  s.addEventListener('change', () => {
    const found = options.find(([v]) => String(v) === s.value);
    if (found) onChange(found[0]);
  });
  return s;
}

export function setting(label: string, control: HTMLElement, hint?: string): HTMLDivElement {
  return el('div', { class: 'setting' }, el('div', {}, label, hint ? el('div', { class: 'muted' }, hint) : null), control);
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h} h ${m.toString().padStart(2, '0')} min` : `${m} min`;
}
