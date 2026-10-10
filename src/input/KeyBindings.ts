/**
 * Touches du clavier personnalisables (Options › Commandes › Touches clavier…). Chaque action a
 * ses touches par défaut (dont les variantes AZERTY / flèches) ; une touche choisie par le
 * joueur remplace la touche principale, les flèches restent toujours actives pour se déplacer.
 */
export type KeyAction =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sneak' | 'sprint'
  | 'inventory' | 'drop' | 'chat' | 'command' | 'use' | 'perspective' | 'debug' | 'pause';

export const KEY_ACTIONS: { id: KeyAction; name: string; defaults: string[]; fixed?: string[] }[] = [
  { id: 'forward', name: 'Avancer', defaults: ['KeyW', 'KeyZ'], fixed: ['ArrowUp'] },
  { id: 'back', name: 'Reculer', defaults: ['KeyS'], fixed: ['ArrowDown'] },
  { id: 'left', name: 'Gauche', defaults: ['KeyA', 'KeyQ'], fixed: ['ArrowLeft'] },
  { id: 'right', name: 'Droite', defaults: ['KeyD'], fixed: ['ArrowRight'] },
  { id: 'jump', name: 'Sauter', defaults: ['Space'] },
  { id: 'sneak', name: "S'accroupir", defaults: ['ShiftLeft', 'ShiftRight'] },
  { id: 'sprint', name: 'Courir', defaults: ['ControlLeft'] },
  { id: 'inventory', name: 'Inventaire', defaults: ['KeyE', 'KeyI'] },
  { id: 'drop', name: "Jeter l'objet", defaults: ['KeyG'] },
  { id: 'chat', name: 'Discussion', defaults: ['KeyT', 'Enter'] },
  { id: 'command', name: 'Commande', defaults: ['Slash'] },
  { id: 'use', name: 'Utiliser', defaults: ['KeyF'] },
  { id: 'perspective', name: 'Vue (1re / 3e personne)', defaults: ['F5'] },
  { id: 'debug', name: 'Écran de débogage', defaults: ['F3'] },
  { id: 'pause', name: 'Pause', defaults: ['Escape', 'KeyP'] },
];

/** Touches effectives d'une action (choix du joueur + touches fixes). */
export function keysFor(action: KeyAction, custom: Partial<Record<KeyAction, string>> | undefined): string[] {
  const a = KEY_ACTIONS.find((k) => k.id === action)!;
  const c = custom?.[action];
  // « Q » sert à gauche en AZERTY : il ne jette l'objet que si « gauche » a été changé
  return [...(c ? [c] : a.defaults), ...(a.fixed ?? []), ...(action === 'drop' && !c && custom?.left ? ['KeyQ'] : [])];
}

/** Action d'une touche (null si aucune). Échap reste toujours la pause / le retour. */
export function actionOf(code: string, custom: Partial<Record<KeyAction, string>> | undefined): KeyAction | null {
  if (code === 'Escape') return 'pause';
  for (const a of KEY_ACTIONS) if (keysFor(a.id, custom).includes(code)) return a.id;
  return null;
}

/** Nom lisible d'une touche (« KeyW » → « W », « ShiftLeft » → « Maj gauche »…). */
export function keyLabel(code: string): string {
  const names: Record<string, string> = {
    Space: 'Espace', ShiftLeft: 'Maj gauche', ShiftRight: 'Maj droite', ControlLeft: 'Ctrl gauche', ControlRight: 'Ctrl droite',
    AltLeft: 'Alt', AltRight: 'Alt Gr', Enter: 'Entrée', Escape: 'Échap', Tab: 'Tab', Backspace: 'Retour arrière', CapsLock: 'Verr. maj',
    ArrowUp: 'Flèche haut', ArrowDown: 'Flèche bas', ArrowLeft: 'Flèche gauche', ArrowRight: 'Flèche droite', Slash: '/',
  };
  if (names[code]) return names[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Pavé ${code.slice(6)}`;
  return code;
}
