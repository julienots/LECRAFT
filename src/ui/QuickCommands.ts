/**
 * Boutons rapides de l'écran « Tchat et commandes » : définir le point d'apparition, se téléporter
 * (Qui / Où), régler l'heure, changer la météo. Chaque choix lance la vraie commande
 * (/setworldspawn, /tp, /time set, /weather) du jeu.
 */
import type { Session } from '../core/Session';

export interface QItem {
  label: string;
  /** Pictogramme dessiné (cf. quickIcon) des choix de liste (heure, météo). */
  icon?: string;
  /** Début de commande écrit dans le champ quand la sous-liste est ouverte. */
  prefix?: string;
  /** Commande lancée tout de suite au toucher. */
  run?: () => string;
  /** Sous-liste. */
  children?: QItem[];
  /** Choix d'un paramètre mémorisé (cible de la téléportation) : retour à la liste précédente. */
  pick?: () => void;
}

export function QUICK(s: Session, who: () => string, setWho: (w: string) => void): QItem[] {
  const target = (label: string, sel: string): QItem => ({ label, pick: () => setWho(sel) });
  const sp = s.player.spawn;
  const to = (label: string, dest: () => string): QItem => ({ label, run: () => `/tp ${who()} ${dest()}` });
  return [
    { label: 'Définir le point d’apparition', run: () => '/setworldspawn' },
    {
      label: 'Se téléporter',
      prefix: '/tp',
      children: [
        {
          label: 'Qui',
          prefix: '/tp',
          children: [target('Moi-même', '@s'), target('Tous les joueurs', '@a'), target('Un joueur au hasard', '@r'), target('Toutes les créatures', '@e')],
        },
        {
          label: 'Où',
          prefix: '/tp',
          children: [
            to('10 blocs plus haut', () => '~ ~10 ~'),
            to('10 blocs plus bas', () => '~ ~-10 ~'),
            to('10 blocs devant', () => '^ ^ ^10'),
            to('10 blocs derrière', () => '^ ^ ^-10'),
            to('Point d’apparition', () => `${Math.floor(sp[0])} ${Math.floor(sp[1])} ${Math.floor(sp[2])}`),
          ],
        },
      ],
    },
    {
      label: 'Heure',
      prefix: '/time set',
      children: [
        { label: 'Aube', icon: 'sunrise', run: () => '/time set sunrise' },
        { label: 'Jour', icon: 'day', run: () => '/time set day' },
        { label: 'Midi', icon: 'noon', run: () => '/time set noon' },
        { label: 'Crépuscule', icon: 'sunset', run: () => '/time set sunset' },
        { label: 'Nuit', icon: 'night', run: () => '/time set night' },
        { label: 'Minuit', icon: 'midnight', run: () => '/time set midnight' },
      ],
    },
    {
      label: 'Météo',
      prefix: '/weather',
      children: [
        { label: 'Dégagée', icon: 'clear', run: () => '/weather clear' },
        { label: 'Pluie', icon: 'rain', run: () => '/weather rain' },
        { label: 'Orage', icon: 'thunder', run: () => '/weather thunder' },
      ],
    },
  ];
}

const cache = new Map<string, string>();

/** Vignette 16 × 16 d'un choix de la liste (ciel à l'heure donnée, temps qu'il fait). */
export function quickIcon(name: string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const sky = (top: string, bottom: string) => {
    const gr = g.createLinearGradient(0, 0, 0, 16);
    gr.addColorStop(0, top);
    gr.addColorStop(1, bottom);
    g.fillStyle = gr;
    g.fillRect(0, 0, 16, 16);
  };
  const disc = (x: number, y: number, r: number, col: string) => {
    g.fillStyle = col;
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + 1) g.fillRect(x + i, y + j, 1, 1);
  };
  const ground = (col: string) => {
    g.fillStyle = col;
    g.fillRect(0, 13, 16, 3);
  };
  switch (name) {
    case 'sunrise':
      sky('#6d86b5', '#f0b070');
      disc(8, 11, 3, '#fff3b0');
      ground('#2d3a22');
      break;
    case 'day':
      sky('#7cb2f4', '#b9dcff');
      disc(8, 7, 3, '#ffffff');
      ground('#5a9a3a');
      break;
    case 'noon':
      sky('#4f9cf2', '#9ccbff');
      disc(8, 4, 3, '#ffffff');
      ground('#5a9a3a');
      break;
    case 'sunset':
      sky('#4a4f8c', '#e8905a');
      disc(8, 11, 3, '#ffd080');
      ground('#2d3a22');
      break;
    case 'night':
      sky('#0b1230', '#2a3560');
      disc(11, 5, 2, '#e8ecff');
      g.fillStyle = '#fff';
      g.fillRect(3, 3, 1, 1);
      g.fillRect(6, 7, 1, 1);
      ground('#1c2a18');
      break;
    case 'midnight':
      sky('#02040f', '#0e1530');
      disc(5, 4, 2, '#cfd6f0');
      g.fillStyle = '#fff';
      g.fillRect(10, 3, 1, 1);
      g.fillRect(12, 8, 1, 1);
      ground('#101a0e');
      break;
    case 'clear':
      sky('#6aa8f0', '#bfe0ff');
      disc(8, 7, 3, '#ffffff');
      break;
    case 'rain':
      sky('#6c7480', '#9aa2ae');
      g.fillStyle = '#6aa0f0';
      for (let i = 0; i < 6; i++) g.fillRect(2 + i * 2, 5 + ((i * 5) % 7), 1, 3);
      break;
    case 'thunder':
      sky('#2c303a', '#555b68');
      g.fillStyle = '#ffe566';
      g.fillRect(8, 3, 2, 3);
      g.fillRect(7, 6, 2, 3);
      g.fillRect(8, 9, 2, 3);
      break;
    default:
      sky('#777', '#999');
  }
  // liseré clair, comme les vignettes de la liste d'origine
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.strokeRect(0.5, 0.5, 15, 15);
  const url = c.toDataURL();
  cache.set(name, url);
  return url;
}
