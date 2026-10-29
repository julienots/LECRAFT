/**
 * Traductions anglaises de l'interface mobile (paramètres, pause, tchat et commandes rapides).
 * Le jeu est écrit en français ; `tb` traduit à l'affichage quand la langue choisie est l'anglais.
 */
import { language, t } from './i18n';

const EN: Record<string, string> = {
  // pause
  'Reprendre le jeu': 'Resume Game', Paramètres: 'Settings', 'Parcourez les extensions !': 'Browse add-ons!', 'Sauv. et quitter': 'Save & Quit', 'Se déconnecter': 'Disconnect',
  'Jeu en pause': 'Game Paused', Vestiaire: 'Wardrobe', Social: 'Social',
  // paramètres : navigation
  PARAMÈTRES: 'SETTINGS', Profil: 'Profile', Accessibilité: 'Accessibility', Monde: 'World', Jeu: 'Game', Multijoueur: 'Multiplayer', Commandes: 'Controls',
  'Clavier-souris': 'Keyboard & Mouse', Manette: 'Controller', Toucher: 'Touch', Groupe: 'Party', Général: 'General', Vidéo: 'Video', Audio: 'Audio', Compte: 'Account',
  'Ressources globales': 'Global Resources', Créateur: 'Creator', Extensions: 'Add-ons', 'Packs de ressources': 'Resource Packs', 'Add-ons': 'Add-Ons',
  // paramètres : titres et descriptions
  PROFIL: 'PROFILE', 'Votre nom et votre apparence': 'Your name and appearance', JOUEUR: 'PLAYER', 'Nom affiché dans le tchat et en multijoueur': 'Name shown in chat and in multiplayer', 'Nom du joueur': 'Player name',
  ACCESSIBILITÉ: 'ACCESSIBILITY', 'Rendez le jeu plus confortable': 'Make the game more comfortable', VISIBILITÉ: 'VISIBILITY', 'RETOUR TACTILE': 'HAPTIC FEEDBACK',
  'Balancement de la vue': 'View Bobbing', 'La caméra oscille légèrement quand vous marchez.': 'The camera sways slightly when you walk.', Vibrations: 'Vibrations', "L'appareil vibre quand vous cassez un bloc ou subissez des dégâts.": 'The device vibrates when you break a block or take damage.',
  JEU: 'GAME', 'Modifiez les paramètres du monde et le style de jeu': 'Change the world settings and play style', 'Ouvrez un monde pour modifier ses paramètres.': 'Open a world to change its settings.',
  'Vous ne pouvez pas obtenir de succès dans ce monde.': 'You cannot earn achievements in this world.', 'Nom du monde': 'World Name', Difficulté: 'Difficulty', Paisible: 'Peaceful', Facile: 'Easy', Normale: 'Normal', Difficile: 'Hard',
  "Aucune créature hostile n'apparaît. La santé se régénère et la barre de faim ne se vide pas.": 'No hostile mobs spawn. Health regenerates and the hunger bar does not drain.',
  'Les créatures hostiles apparaissent mais infligent moins de dégâts. La barre de faim se vide et peut réduire la santé jusqu’à 5 cœurs.': 'Hostile mobs spawn but deal less damage. The hunger bar drains and can reduce health down to 5 hearts.',
  'Des créatures hostiles apparaissent et infligent des dégâts normaux. La barre de faim se vide et réduit la santé à un demi-cœur.': 'Hostile mobs spawn and deal normal damage. The hunger bar drains and reduces health to half a heart.',
  'Des créatures hostiles apparaissent et infligent de lourds dégâts. La barre de faim se vide et peut vous faire mourir.': 'Hostile mobs spawn and deal heavy damage. The hunger bar drains and can kill you.',
  'Mode de jeu': 'Game Mode', 'Change votre mode de jeu actuel.': 'Changes your current game mode.', 'Les triches sont désactivées dans ce monde.': 'Cheats are disabled in this world.', Survie: 'Survival', Créatif: 'Creative',
  AFFICHAGE: 'DISPLAY', 'Afficher les coordonnées': 'Show Coordinates', 'Affiche votre position en haut à gauche de l’écran.': 'Shows your position at the top left of the screen.',
  'Afficher le nombre de jours joués': 'Show Days Played', 'Affiche le nombre de jours écoulés dans ce monde.': 'Shows the number of days elapsed in this world.',
  'RÈGLES DU JEU': 'GAME RULES', 'Modifiez le fonctionnement du monde': 'Change how the world works', 'Activez les triches du monde pour modifier ces règles': 'Enable cheats in the world to change these rules',
  "Garder l'inventaire": 'Keep Inventory', 'Conserve les objets après la mort.': 'Keeps your items after death.', 'Cycle jour et nuit': 'Daylight Cycle', 'Le temps passe : le soleil et la lune se déplacent.': 'Time passes: the sun and moon move.',
  'Cycle météo': 'Weather Cycle', 'La pluie et les orages se déclenchent naturellement.': 'Rain and thunderstorms occur naturally.', 'Apparition des créatures': 'Mob Spawning', 'Les créatures apparaissent naturellement.': 'Mobs spawn naturally.',
  'Destruction par les créatures': 'Mob Griefing', 'Les créatures peuvent modifier les blocs.': 'Mobs can change blocks.', 'La TNT explose': 'TNT Explodes', 'La TNT enflammée explose.': 'Lit TNT explodes.',
  'Régénération naturelle': 'Natural Regeneration', 'La santé se régénère quand la faim est pleine.': 'Health regenerates when hunger is full.', 'Dégâts de chute': 'Fall Damage', 'Les chutes de haut infligent des dégâts.': 'Falling from a height deals damage.',
  'Réapparition immédiate': 'Immediate Respawn', "Pas d'écran de mort : réapparition instantanée.": 'No death screen: respawn instantly.', 'Message des blocs de commande': 'Command Block Output', 'Les blocs de commande affichent leurs résultats dans le tchat.': 'Command blocks show their results in chat.',
  PARTIE: 'GAME', 'Sauvegarder maintenant': 'Save Now', 'Enregistre le monde sur cet appareil.': 'Saves the world on this device.', Sauvegarder: 'Save',
  MULTIJOUEUR: 'MULTIPLAYER', 'Invitez d’autres joueurs dans votre monde': 'Invite other players to your world', 'Ouvrez un monde pour inviter des joueurs.': 'Open a world to invite players.',
  'Vous êtes connecté à la partie d’un autre joueur : seul son hôte peut la gérer.': 'You are connected to another player’s game: only its host can manage it.', 'PARTIE MULTIJOUEUR': 'MULTIPLAYER GAME', 'Partage du monde en réseau': 'Share the world over the network',
  'Gérer la partie': 'Manage Game', 'Ouvrir au multijoueur': 'Open to Multiplayer', 'Choisissez le salon et partagez le lien.': 'Pick the room and share the link.', 'Ouvrir…': 'Open…',
  'CLAVIER ET SOURIS': 'KEYBOARD AND MOUSE', 'Réglages de la souris et des touches du clavier': 'Mouse and keyboard key settings', SOURIS: 'MOUSE', Sensibilité: 'Sensitivity', 'Vitesse de rotation de la caméra.': 'Camera turning speed.',
  'Inverser l’axe vertical': 'Invert Y-Axis', 'Pousser vers le haut regarde vers le bas.': 'Pushing up looks down.', TOUCHES: 'KEYS', 'Touchez une action puis appuyez sur la nouvelle touche': 'Select an action then press the new key',
  'Touches par défaut': 'Default Keys', Réinitialiser: 'Reset',
  Avancer: 'Walk Forwards', Reculer: 'Walk Backwards', Gauche: 'Strafe Left', Droite: 'Strafe Right', Sauter: 'Jump', "S'accroupir": 'Sneak', Courir: 'Sprint', Inventaire: 'Inventory', "Jeter l'objet": 'Drop Item', Discussion: 'Open Chat', Commande: 'Open Command', Utiliser: 'Use Item', 'Vue (1re / 3e personne)': 'Toggle Perspective', 'Écran de débogage': 'Debug Screen', Pause: 'Pause',
  MANETTE: 'CONTROLLER', 'Réglages de la manette': 'Controller settings', 'Branchez une manette ou appairez-la en Bluetooth : elle est reconnue automatiquement et remplace les commandes tactiles.': 'Plug in a controller or pair it over Bluetooth: it is detected automatically and replaces the touch controls.',
  VISÉE: 'AIMING', 'Vitesse de rotation avec le joystick droit.': 'Turning speed with the right stick.',
  TOUCHER: 'TOUCH', 'Options de saisie, paramètres de sensibilité et configuration des commandes pour les écrans tactiles.': 'Input options, sensitivity settings and control configuration for touch screens.',
  'Commandes personnalisées': 'Custom Controls', 'Permet de modifier la taille et la position des boutons à l’écran afin de s’adapter à votre style de jeu.': 'Lets you change the size and position of on-screen buttons to suit your play style.', Personnaliser: 'Customize',
  'Mode de contrôle': 'Control Mode', 'Faites glisser le joystick pour vous déplacer. Faites glisser n’importe où pour regarder autour de vous. Appuyez longuement sur les blocs pour interagir avec eux.': 'Drag the joystick to move. Drag anywhere to look around. Long-press blocks to interact with them.',
  'Joystick et appuyer pour interagir': 'Joystick and tap to interact', 'Croix directionnelle': 'D-pad', Visée: 'Aim', 'Interagir à l’endroit touché ou au viseur central.': 'Interact where you tap or at the center crosshair.', 'Au doigt': 'At finger', 'Au viseur': 'At crosshair',
  'Vitesse de rotation de la caméra au toucher.': 'Camera turning speed on touch.', 'Faire glisser vers le haut regarde vers le bas.': 'Dragging up looks down.', 'Saut automatique': 'Auto-Jump', 'Saute automatiquement par-dessus les blocs d’une hauteur.': 'Automatically jumps over one-block-high obstacles.',
  'Mode gaucher': 'Left-Handed', 'Inverse la disposition des commandes.': 'Mirrors the control layout.', 'Taille du joystick': 'Joystick Size', 'Taille des boutons': 'Button Size', 'Orientation de l’écran': 'Screen Orientation', Paysage: 'Landscape', Portrait: 'Portrait', Automatique: 'Automatic',
  'Disposition par défaut': 'Default Layout', 'Remet les boutons à leur place d’origine.': 'Puts the buttons back where they started.',
  GROUPE: 'PARTY', 'Amis et groupes': 'Friends and parties', 'Les groupes et les listes d’amis ne sont pas disponibles dans LeCraft. Pour jouer à plusieurs, utilisez Multijoueur.': 'Parties and friend lists are not available in LeCraft. To play with others, use Multiplayer.',
  GÉNÉRAL: 'GENERAL', 'Réglages généraux du jeu': 'General game settings', LANGUE: 'LANGUAGE', Langue: 'Language', 'Langue des menus et des noms d’objets.': 'Language of menus and item names.',
  VIDÉO: 'VIDEO', 'Réglez la qualité graphique et visuelle': 'Adjust graphics and visual quality', 'Paramètres vidéo généraux': 'General video settings', 'Champ de vision': 'Field of View', 'Angle de vue de la caméra en jeu': 'In-game camera view angle',
  'Point de vue caméra': 'Camera Perspective', 'Sélectionner le point de vue de la caméra en jeu': 'Select the in-game camera perspective', 'Disponible une fois dans un monde': 'Available once in a world',
  'Première personne': 'First Person', 'Troisième personne (arrière)': 'Third Person (Back)', 'Troisième personne (avant)': 'Third Person (Front)',
  'GRAPHISME, PERFORMANCES ET CONFIGURATION': 'GRAPHICS, PERFORMANCE AND SETUP', 'Contrôlez l’apparence et les performances du jeu': 'Control the look and performance of the game',
  'Qualité graphique': 'Graphics Quality', 'Profil de réglages (distance, ombres, eau, nuages…).': 'Settings preset (distance, shadows, water, clouds…).', Basse: 'Low', Moyenne: 'Medium', Haute: 'High',
  'Distance d’affichage': 'Render Distance', 'Nombre de tronçons de terrain affichés autour de vous.': 'Number of terrain chunks shown around you.', Résolution: 'Resolution', 'Définition du rendu 3D (moins = plus fluide).': '3D render definition (lower = smoother).',
  'Limite d’images par seconde': 'Frame Rate Limit', 'Qualité automatique': 'Auto Quality', 'Ajuste la résolution et la distance selon la fluidité.': 'Adjusts resolution and distance according to smoothness.', 'Afficher les images par seconde': 'Show Frames Per Second',
  'EFFETS VISUELS': 'VISUAL EFFECTS', Ombres: 'Shadows', Désactivées: 'Off', Créatures: 'Mobs', 'Créatures et occlusion ambiante': 'Mobs and ambient occlusion', Particules: 'Particles', Toutes: 'All', Réduites: 'Reduced', Minimales: 'Minimal',
  Eau: 'Water', Animée: 'Animated', Simple: 'Simple', Éclairage: 'Lighting', 'Soleil, eau réfléchissante, brouillard.': 'Sunlight, reflective water, fog.', Activé: 'On', 'Ultra (ombres projetées)': 'Ultra (cast shadows)', Désactivé: 'Off',
  Nuages: 'Clouds', 'Voir à travers les portails': 'See Through Portals', 'Affiche la dimension d’arrivée dans le cadre du portail.': 'Shows the destination dimension inside the portal frame.',
  'Réglez le volume et la musique': 'Adjust volume and music', VOLUME: 'VOLUME', Musique: 'Music', Désactivée: 'Off', 'Blocs et créatures': 'Blocks and Mobs', 'Ambiance et environnement': 'Ambient and Environment',
  MUSIQUE: 'MUSIC', 'Compositions du jeu ou vos propres fichiers': 'Game compositions or your own files', 'Morceau suivant': 'Next Track', Suivant: 'Next', 'Importer des musiques': 'Import Music', 'Fichiers audio stockés sur cet appareil.': 'Audio files stored on this device.', Importer: 'Import', 'Retirer mes musiques': 'Remove My Music', Retirer: 'Remove',
  COMPTE: 'ACCOUNT', 'Votre profil de joueur': 'Your player profile', 'Les comptes en ligne ne sont pas disponibles : LeCraft conserve vos mondes et réglages sur cet appareil.': 'Online accounts are not available: LeCraft keeps your worlds and settings on this device.',
  PROGRESSION: 'PROGRESS', Progrès: 'Advancements', 'Les succès débloqués dans ce monde.': 'The achievements unlocked in this world.', Afficher: 'Show', Statistiques: 'Statistics', 'Distances, blocs cassés, créatures vaincues…': 'Distances, blocks broken, mobs defeated…',
  'RESSOURCES GLOBALES': 'GLOBAL RESOURCES', 'Ressources appliquées à tous vos mondes': 'Resources applied to all your worlds', 'Aucun pack importé : textures du jeu par défaut.': 'No pack imported: default game textures.', 'Importez ou retirez un pack de textures.': 'Import or remove a texture pack.', 'Gérer…': 'Manage…',
  CRÉATEUR: 'CREATOR', 'Outils pour les créateurs et informations techniques': 'Creator tools and technical information', DÉBOGAGE: 'DEBUG', 'Afficher l’écran de débogage': 'Show Debug Screen', 'Position, tronçons, appels de rendu (touche F3 au clavier).': 'Position, chunks, draw calls (F3 on a keyboard).', APPAREIL: 'DEVICE',
  'PACKS DE RESSOURCES': 'RESOURCE PACKS', 'Textures, sons et interfaces personnalisés': 'Custom textures, sounds and interfaces', 'Importer un pack': 'Import Pack', 'Retirer le pack': 'Remove Pack', 'Rétablit les textures par défaut.': 'Restores the default textures.',
  'Importez un pack de ressources (.zip) ou le fichier .jar de version de votre propre copie du jeu : les textures des blocs, objets, créatures et interfaces seront utilisées.': 'Import a resource pack (.zip) or the version .jar of your own copy of the game: block, item, mob and interface textures will be used.',
  'Les fichiers restent uniquement sur cet appareil. LeCraft ne contient ni ne télécharge aucune texture d’un autre jeu.': 'Files stay on this device only. LeCraft neither contains nor downloads textures from another game.',
  'ADD-ONS': 'ADD-ONS', 'Blocs, objets, recettes et créatures supplémentaires': 'Additional blocks, items, recipes and mobs', 'Importer un add-on': 'Import Add-On', 'Redémarrer pour appliquer': 'Restart to Apply', Supprimer: 'Delete', 'Aucun add-on installé.': 'No add-ons installed.',
  'Importez des add-ons de l’édition mobile (.mcaddon, .mcpack) : nouveaux blocs, objets, recettes, créatures, textures, fonctions. Les scripts JavaScript ne sont pas exécutés.': 'Import mobile edition add-ons (.mcaddon, .mcpack): new blocks, items, recipes, mobs, textures, functions. JavaScript scripts are not run.',
  // tchat
  'Tchat et commandes': 'Chat and Commands', Quitter: 'Exit', Retour: 'Back', 'Définir le point d’apparition': 'Set Spawn Point', 'Se téléporter': 'Teleport', Heure: 'Time', Météo: 'Weather', Qui: 'Who', Où: 'Where',
  'Moi-même': 'Myself', 'Tous les joueurs': 'All players', 'Un joueur au hasard': 'Random player', 'Toutes les créatures': 'All mobs', '10 blocs plus haut': '10 blocks up', '10 blocs plus bas': '10 blocks down', '10 blocs devant': '10 blocks ahead', '10 blocs derrière': '10 blocks behind', 'Point d’apparition': 'Spawn point',
  Aube: 'Sunrise', Jour: 'Day', Midi: 'Noon', Crépuscule: 'Sunset', Nuit: 'Night', Minuit: 'Midnight', Dégagée: 'Clear', Pluie: 'Rain', Orage: 'Thunderstorm',
};

/** Texte de l'interface mobile dans la langue choisie (français par défaut). */
export function tb(text: string): string {
  if (language() === 'fr' || !text) return text;
  return EN[text] ?? t(text);
}
