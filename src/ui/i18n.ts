/**
 * Langue de l'interface (Options › Langue : Français / English). Le jeu est écrit en français ;
 * en anglais, les menus, écrans de conteneurs et noms d'objets sont traduits à l'affichage
 * (widgets des menus, titres, libellés « Préfixe : valeur », infobulles). Les messages du chat
 * des serveurs intégrés restent en français.
 */
import { ItemRegistry } from '../inventory/ItemRegistry';

let lang: 'fr' | 'en' = 'fr';
export function setLanguage(l: 'fr' | 'en' | undefined) {
  lang = l === 'en' ? 'en' : 'fr';
}
export const language = () => lang;

const EN: Record<string, string> = {
  // écran titre, mondes
  Solo: 'Singleplayer', Multijoueur: 'Multiplayer', 'Options...': 'Options...', Options: 'Options', 'Quitter le jeu': 'Quit Game', Aide: 'Help', Crédits: 'Credits',
  'Sélectionner un monde': 'Select World', 'Jouer au monde sélectionné': 'Play Selected World', 'Créer un nouveau monde': 'Create New World', Modifier: 'Edit',
  Supprimer: 'Delete', Recréer: 'Re-Create', Annuler: 'Cancel', Retour: 'Back', Terminé: 'Done', Fermer: 'Close', Enregistrer: 'Save',
  'Aucun monde. Créez-en un !': 'No worlds yet. Create one!', 'Voulez-vous vraiment supprimer ce monde ?': 'Are you sure you want to delete this world?',
  'Monde incompatible': 'Incompatible World', 'Modifier le monde': 'Edit World', 'Nom du monde': 'World Name', 'Faire une sauvegarde': 'Make Backup',
  'Activer les triches': 'Allow Cheats', 'Graine pour le générateur de monde': 'Seed for the World Generator', 'Mode de jeu': 'Game Mode', Survie: 'Survival', Créatif: 'Creative',
  'Coffre bonus': 'Bonus Chest', 'Bots joueurs': 'Player Bots', 'Les triches autorisent les commandes comme /give, /tp, /time ou /gamemode.': 'Cheats allow commands like /give, /tp, /time or /gamemode.',
  'Quitter LeCraft ?': 'Quit LeCraft?', 'Sauvegarde impossible': 'Saving Failed', 'Chargement…': 'Loading…', 'Génération du terrain…': 'Generating terrain…',
  // options
  'Champ de vision': 'FOV', Difficulté: 'Difficulty', Paisible: 'Peaceful', Facile: 'Easy', Normale: 'Normal', Difficile: 'Hard', Normal: 'Normal',
  'Graphismes...': 'Video Settings...', Graphismes: 'Video Settings', 'Musique et sons...': 'Music & Sounds...', 'Musique et sons': 'Music & Sounds',
  'Commandes...': 'Controls...', Commandes: 'Controls', 'Packs de ressources...': 'Resource Packs...', 'Packs de ressources': 'Resource Packs',
  'Add-ons (.mcaddon)...': 'Add-ons (.mcaddon)...', 'Add-ons': 'Add-ons', 'Accessibilité...': 'Accessibility...', Accessibilité: 'Accessibility',
  'Infos appareil...': 'Device Info...', 'Infos appareil': 'Device Info', Langue: 'Language',
  Qualité: 'Quality', Basse: 'Low', Moyenne: 'Medium', Haute: 'High', 'Distance de rendu': 'Render Distance', 'FPS max': 'Max FPS', Résolution: 'Resolution',
  Ombres: 'Shadows', NON: 'OFF', OUI: 'ON', Entités: 'Entities', 'Entités + OA': 'Entities + AO', Particules: 'Particles', Toutes: 'All', Réduites: 'Decreased', Minimales: 'Minimal',
  Eau: 'Water', Animée: 'Animated', Simple: 'Simple', Shaders: 'Shaders', Activés: 'On', Activé: 'On', 'Ultra (ombres)': 'Ultra (shadows)', Nuages: 'Clouds',
  'Qualité automatique': 'Auto Quality', 'Afficher les FPS': 'Show FPS', 'Balancement de la vue': 'View Bobbing',
  'Commandes tactiles': 'Touch Controls', Joystick: 'Joystick', 'Croix (classique)': 'D-pad (classic)', 'Visée tactile': 'Touch Aim', 'Au doigt': 'Tap', 'Au viseur': 'Crosshair',
  Sensibilité: 'Sensitivity', 'Inverser la souris': 'Invert Mouse', 'Taille des boutons': 'Button Size', 'Mode gaucher': 'Left-Handed', 'Saut automatique': 'Auto-Jump',
  Vibrations: 'Vibrations', Orientation: 'Orientation', Paysage: 'Landscape', Portrait: 'Portrait', Auto: 'Auto',
  'Disposition des boutons...': 'Button Layout...', 'Réinitialiser la disposition': 'Reset Layout', 'Touches clavier...': 'Key Binds...', 'Touches clavier': 'Key Binds',
  'Réinitialiser les touches': 'Reset Keys', '> Appuyez sur une touche <': '> Press a key <',
  Musique: 'Music', 'Blocs et créatures': 'Blocks & Creatures', 'Ambiance/environnement': 'Ambient/Environment', 'Morceau suivant': 'Next Track',
  'Importer des musiques...': 'Import Music...', 'Retirer mes musiques': 'Remove My Music', 'Importer un pack...': 'Import Pack...', 'Retirer le pack': 'Remove Pack',
  'Importer un add-on...': 'Import Add-on...', 'Aucun add-on installé.': 'No add-ons installed.', 'Supprimer cet add-on ?': 'Delete this add-on?', 'Redémarrer pour appliquer': 'Restart to Apply',
  // touches
  Avancer: 'Walk Forwards', Reculer: 'Walk Backwards', Gauche: 'Strafe Left', Droite: 'Strafe Right', Sauter: 'Jump', "S'accroupir": 'Sneak', Courir: 'Sprint',
  "Jeter l'objet": 'Drop Item', Discussion: 'Open Chat', Commande: 'Open Command', Utiliser: 'Use Item', 'Vue (1re / 3e personne)': 'Toggle Perspective',
  'Écran de débogage': 'Debug Screen', Pause: 'Pause', Espace: 'Space', 'Maj gauche': 'Left Shift', 'Maj droite': 'Right Shift', 'Ctrl gauche': 'Left Ctrl', Entrée: 'Enter', Échap: 'Escape',
  // jeu
  'Menu du jeu': 'Game Menu', 'Retour au jeu': 'Back to Game', Sauvegarder: 'Save', Progrès: 'Advancements', Statistiques: 'Statistics',
  'Ouvrir au multijoueur': 'Open to LAN', 'Ouvrir la partie': 'Open Game', 'Fermer la partie': 'Close Game', 'Combat JcJ': 'PvP', 'Joueurs max': 'Max Players',
  Réapparaître: 'Respawn', Déconnecté: 'Disconnected', Skin: 'Skin', Général: 'General', Blocs: 'Blocks', Objets: 'Items',
  'Jouer en multijoueur': 'Play Multiplayer', 'Parties en réseau (vrais joueurs)...': 'Network Games (real players)...', 'Parties en réseau': 'Network Games',
  'Rejoindre le serveur': 'Join Server', Actualiser: 'Refresh', 'Serveurs intégrés : fonctionnent hors ligne, les autres joueurs sont des bots.': 'Built-in servers: they work offline, other players are bots.',
  Boutique: 'Shop',
  // interfaces de conteneurs
  Inventaire: 'Inventory', Fabrication: 'Crafting', Coffre: 'Chest', Fourneau: 'Furnace', "Coffre de l'Ender": 'Ender Chest', Enchanter: 'Enchant',
  'Réparer et nommer': 'Repair & Name', Alambic: 'Brewing Stand', Distributeur: 'Dispenser', Dropper: 'Dropper', Entonnoir: 'Hopper', Tonneau: 'Barrel',
  'Blocs de construction': 'Building Blocks', 'Blocs naturels': 'Natural Blocks', 'Blocs fonctionnels': 'Functional Blocks', 'Outils et utilitaires': 'Tools & Utilities',
  Combat: 'Combat', 'Nourriture et boissons': 'Food & Drinks', Ingrédients: 'Ingredients', 'Aucune recette': 'No recipes', 'Ingrédients manquants': 'Missing ingredients',
};

/** Traduit un texte d'interface (sans effet en français ou si la traduction est inconnue). */
export function t(text: string): string {
  if (lang === 'fr' || !text) return text;
  const exact = EN[text] ?? EN[text.replace(/\s*:$/, '')];
  if (exact) return text.endsWith(':') && !exact.endsWith(':') ? `${exact}:` : exact;
  // « Préfixe : valeur » (boutons cycliques, curseurs)
  const m = /^(.+?) : (.+)$/.exec(text);
  if (m) {
    const v = m[2].replace(/ tronçons$/, ' chunks');
    return `${EN[m[1]] ?? m[1]}: ${EN[v] ?? v}`;
  }
  return text;
}

/** Nom d'objet anglais tiré de son identifiant (« diamond_sword » → « Diamond Sword »). */
export function itemName(id: string, frName?: string): string {
  if (lang === 'fr') return frName ?? ItemRegistry.get(id)?.name ?? id;
  return id
    .replace(/^minecraft:/, '')
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
