# LeCraft — sandbox voxel 3D hors ligne pour Android

LeCraft est un jeu sandbox voxel 3D original (exploration, minage, construction, fabrication,
combat, créatures, donjons, boss) conçu pour **Android** et livré sous forme d'**APK**.
Le moteur est écrit en **TypeScript + Three.js (WebGL 2)** et embarqué dans une application
Android native via **Capacitor**. **Tout fonctionne hors ligne** : terrain, textures, modèles,
sons, musique, recettes et sauvegardes sont générés ou stockés localement.

> **Fidèle au jeu de blocs « Java » de référence** dans ses mécaniques (blocs, recettes en grille,
> fourneau, inventaire à curseur, menus, HUD, créatures, lits, portes, seaux, TNT…), mais **aucun
> fichier de Minecraft n'est distribué** : toutes les textures (atlas 16×16 dans le style vanilla),
> icônes, skins de créatures, police pixel, sons et musiques sont **dessinés/générés par le code du jeu**.
> Pour retrouver les textures exactes, chacun peut **importer le pack de ressources ou le `.jar` de sa
> propre copie du jeu** directement sur son téléphone (voir [Packs de ressources](#packs-de-ressources)).

---

## Sommaire
1. [État du projet](#1-état-du-projet)
2. [Prérequis](#2-prérequis)
3. [Installation](#3-installation)
4. [Développement](#4-développement)
5. [Build web](#5-build-web)
6. [Build Android — APK debug](#6-build-android--apk-debug)
7. [APK release et AAB signés](#7-apk-release-et-aab-signés)
8. [Structure du projet](#8-structure-du-projet)
9. [Architecture technique](#9-architecture-technique)
10. [Ajouter du contenu (blocs, objets, créatures, biomes, recettes, structures)](#10-ajouter-du-contenu)
11. [Sauvegardes](#11-sauvegardes)
12. [Optimisation et profils de qualité](#12-optimisation-et-profils-de-qualité)
13. [Contrôles](#13-contrôles)
14. [Tests](#14-tests)
15. [Compatibilité et hors ligne](#15-compatibilité-et-hors-ligne)
16. [Limites connues / TODO](#16-limites-connues--todo)
17. [Dépannage](#17-dépannage)

---

## 1. État du projet

**Vérifié automatiquement** (voir [Tests](#14-tests)) : build web, `npx cap sync android`,
`./gradlew assembleDebug`, `assembleRelease` + `bundleRelease` signés, et le gameplay
complet piloté par de vrais événements tactiles dans Chromium (même moteur que le WebView Android).

| Domaine | Fonctionnalités terminées |
|---|---|
| Application Android | Capacitor 8, APK debug/release, AAB, icône adaptative, splash screen, plein écran immersif, écran toujours allumé, orientation configurable, bouton retour, pause/reprise sur mise en arrière-plan, vibrations |
| Monde | Chunks 16×16×128, seed déterministe, génération + meshing dans un Web Worker, chargement/déchargement progressif, files de priorité, cache des chunks modifiés |
| Terrain | Bruits continentalité, érosion, pics/vallées, détail, température, humidité, rivières ; plaines, collines, montagnes enneigées, vallées, océans, rivières, plages, déserts, forêts, jungles, marécages, toundra, zone glacée |
| Biomes (14) | Plaines, Forêt, Forêt noire, Désert, Jungle, Savane, Marais, Pics enneigés, Taïga, Plaines enneigées, Plage, Océan, Rivière, Pics de glace — data-driven, teinte d'herbe/feuillage par biome |
| Grottes | salles géantes, grands tunnels, petits tunnels, gouffres, lacs souterrains d'eau, lave en profondeur, minerais visibles, mousse et champignons lumineux, géodes de cristal |
| Blocs (131) | blocs vanilla aux noms officiels français : 6 essences (bûches, planches, feuilles, pousses), granite/diorite/andésite, 8 minerais et 8 blocs de minerai, 16 laines, briques, pierres taillées, verre, TNT, bibliothèque, obsidienne, coffre, table de fabrication, fourneau (allumé/éteint), cultures, cactus, canne à sucre, citrouille, pastèque, fleurs, champignons, mousse, améthyste… |
| Formes de blocs | dalles (bas/haut/double), escaliers (4 orientations, inversés), portes (2 blocs, ouverture), échelles (escalade), torches au sol et murales, barrières et vitres connectées, lit (2 blocs), coffre, couche de neige, terre labourée, cactus, plaque de pression, lanterne — collisions, rendu et contour de sélection précis |
| Rendu | Face culling, **greedy meshing**, atlas de textures, occlusion ambiante par sommet, éclairage ciel + blocs lissé, frustum culling, brouillard, eau/lave animées, végétation animée, ciel dégradé, soleil/lune/étoiles, nuages, particules, ombres « blob » des entités |
| Interaction | Raycast DDA, contour du bloc visé, fissures + anneau de progression, appui long = miner, toucher = poser/utiliser, prévisualisation verte/rouge, orientation des blocs |
| Inventaire | Interfaces classiques au pixel près (176×166, cases de 18 px) : objet tenu au **curseur**, toucher = prendre/poser/échanger, appui long = moitié/un seul, double toucher = transfert rapide, toucher hors de la fenêtre = jeter ; armure, coffre 27 cases, info-bulles ; **inventaire créatif** par onglets |
| Fabrication | **Grille 2×2** (inventaire) et **3×3** (table de fabrication) avec motifs vanilla (position libre, miroir, recettes sans forme, tags de bois), **livre de recettes** qui remplit la grille ; **fourneau** à cases (entrée/combustible/résultat, flamme et flèche de progression, 10 s par objet, durées de combustion vanilla, XP) — 116 recettes + 21 cuissons, 228 objets ; outils bois/pierre/cuivre/fer/or/diamant et armures cuir/fer/or/diamant aux valeurs vanilla |
| Combat | Cadence d'attaque, dégâts par arme, critiques en chute, recul, invincibilité temporaire, armure, faiblesses des boss, projectiles |
| Créatures (27) | vache (lait), mouton (laine colorée, tonte, repousse), cochon, poule (œufs), zombie, squelette (arc), creeper (mèche de 1,5 s, explosion qui creuse le terrain, poudre à canon), piglin zombifié, ghast, cube de magma, blaze (Nether), enderman (regard, téléportation, déplace des blocs), loup (apprivoisable aux os, assis/debout, défend son maître), calamar et calamar luisant (nage, encre), chauve-souris (grottes), zombie momifié (désert, faim), noyé (océans, rivières, trident), vagabond (neige, flèches de lenteur), sorcière (potions), villageois (villages avec cloche, 7 métiers, échanges contre des émeraudes) ; araignée (neutre le jour), araignée venimeuse, slime (se divise), chef zombie (mini-boss), 2 boss — modèles aux proportions et disposition UV vanilla (compatibles avec les skins d'un pack) |
| IA | Entity → AIController → StateMachine (IDLE, WANDER, FOLLOW, CHASE, ATTACK, FLEE, SEARCH, RETURN, DEAD), ligne de vue, évitement des falaises et de la lave, LOD de simulation |
| Boss | **Golem des profondeurs** (3 phases : coups, bond + onde de choc, rochers, invocations ; faible aux pioches) ; **Liche de givre** (3 phases : éclats de glace ralentissants, téléportation, anneau de projectiles, pics de glace, spectres ; faible à l'or) — arènes dédiées, barre de vie, butin unique |
| Structures | villages, maisons abandonnées, ruines, tours (escalier), temples (piège + salle cachée), sanctuaire de givre, camps, mines, donjons (salles, couloirs, pièges, cages, coffres, chef), repaire du golem |
| Monde vivant | Cycle jour/crépuscule/nuit/aube, pluie, orage avec éclairs/tonnerre, neige selon le biome, eau et lave qui s'écoulent (sources infinies, obsidienne), sable/gravier qui tombent, plantes qui exigent un support |
| Agriculture / élevage | Houe, terre cultivable (hydratation), blé, carottes, pommes de terre, canne à sucre, pousses → arbres (dont chêne noir 2×2), poudre d'os ; nourrir, attirer, reproduire, bébés qui grandissent |
| Mécaniques vanilla | décomposition des feuilles, sable/gravier qui tombent (animés), flèches récupérables, lit (dormir la nuit, point de réapparition, monstres proches), portes (charnière, doubles portes), seaux (eau, lave, lait), briquet + TNT (mèche, explosion, cratère, réaction en chaîne), piège à plaque de pression des temples, cisailles, boussole, coffre bonus |
| Progression | XP et niveaux (cœurs bonus), 18 succès, statistiques, biomes visités, collection d'objets rares |
| Sauvegarde | IndexedDB (format v2), plusieurs mondes (nom, seed, date, temps de jeu, miniature), sauvegarde auto/manuelle/à la mise en arrière-plan, checksums, copie de secours automatique, copie manuelle d'un monde |
| Interface | Menus du jeu de référence : écran titre avec **panorama 3D** d'un vrai monde généré (Solo, Options…, Quitter le jeu, phrase d'accueil jaune), Sélectionner un monde (Jouer / Créer / Modifier / Supprimer / Recréer / Annuler), Créer un nouveau monde (mode, difficulté, graine, coffre bonus), Menu du jeu, Options (Graphismes, Musique et sons, Commandes, Packs de ressources…), Progrès, Statistiques, « Vous êtes mort ! » avec score ; boutons pierre, curseurs, **police pixel** générée ; HUD classique (barre d'objets, cœurs, faim, armure, bulles, XP) |
| Audio | ~100 effets synthétisés (dont portes, explosions, seaux, cisailles, XP) (blocs par matériau, pas, armes, créatures, météo, menus), ambiances (vent, oiseaux, grillons, grotte, pluie), musique générative jour/nuit/menu |
| Performance | Détection LOW/MEDIUM/HIGH (GPU, cœurs, mémoire, écran), ajustement dynamique de la résolution puis de la distance, limitation 30/45/60 FPS, pools (modèles, particules), libération des ressources WebGL |

Les éléments **non réalisés** sont listés honnêtement dans [Limites connues / TODO](#16-limites-connues--todo).

### Grottes et sous-sol

- **Ardoise des abîmes** sous y = 16 (transition irrégulière sur 8 blocs) avec ses 8 minerais
  (charbon, cuivre, fer, or, redstone, lapis, diamant, émeraude des abîmes).
- **Minerais répartis selon l'altitude** comme en 1.18 (distributions triangulaires ramenées à la
  hauteur du monde) : diamant et redstone tout au fond, or et lapis bas, fer à mi-hauteur et dans
  les montagnes, cuivre au milieu, charbon en hauteur, émeraude dans les montagnes.
- Grottes « fromage », « spaghetti » et « nouilles », gouffres, nappes d'eau, **lacs de lave au fond**.
- **Grottes luxuriantes** : mousse, argile, herbe, azalées, lichen lumineux, **lianes à baies
  lumineuses** (éclairent, donnent des baies), fleurs sporifères, racines suspendues, mares d'eau.
- **Grottes de spéléothèmes** : blocs de spéléothème, **stalactites et stalagmites** (blessent).
- **Géodes d'améthyste** : sphères creuses de basalte lisse, calcite, améthyste et améthyste
  bourgeonnante, grappes vers l'intérieur.
- Mines abandonnées avec **toiles d'araignée** (ralentissent fortement), donjons à cages.

### Le Nether

- **Portail** : cadre d'obsidienne rectangulaire (intérieur de 2×3 à 21×21, coins facultatifs, vertical
  dans un plan X ou Z) allumé au **briquet** ; casser le cadre éteint le portail. Le briquet pose
  aussi du **feu** (éternel sur netherrack/magma, éphémère ailleurs).
- **Passage** : 4 s dans le portail (1 s en créatif), voile violet ondulant et bourdonnement ; il
  faut sortir du portail pour repartir. Coordonnées **÷ 8** vers le Nether, **× 8** vers la surface ;
  un portail existant proche est réutilisé (registre des portails), sinon un nouveau portail est
  construit sur un emplacement dégagé (plateforme d'obsidienne au besoin).
- **Génération** (`NetherGenerator`) : grandes cavernes de netherrack (bruit 3D), bedrock en haut
  et en bas, **océan de lave à y = 31**, 5 biomes (désolation, forêts carmin et biscornue avec
  champignons géants et champilampes, vallée des âmes avec piliers de basalte et feu des âmes,
  deltas de basalte avec magma), minerais de quartz et d'or du Nether, débris antiques, grappes de
  pierre lumineuse au plafond, gravier et sable des âmes près de la lave.
- **Forteresses** : ponts couverts de briques du Nether en croix (piliers jusqu'au sol, fenêtres en
  barrières), salle centrale avec **générateur de blazes**, sable des âmes et coffres (butin de
  forteresse). `/locate fortress` et la boussole les trouvent.
- **Créatures** : piglin zombifié (neutre, toute la bande attaque si on en frappe un), ghast (vol,
  boules de feu explosives), cube de magma (saute, se divise), blaze (vol, boules de feu) — toutes
  insensibles au feu et à la lave. Modèles et UV du jeu de référence (skins d'un pack Java).
- **Règles** : pas de jour/nuit ni de météo, brouillard teinté par biome, l'**eau s'évapore**, un
  **lit explose** ; mourir dans le Nether ramène au point d'apparition de la surface.
- **Sauvegarde** : chunks séparés (`<monde>:nether:x:z`), coffres/fourneaux/créatures de chaque
  dimension conservés. `/execute in minecraft:the_nether run tp @s x y z` (et `in minecraft:overworld`)
  fait voyager directement.

### L'End

- **Œil de l'Ender** (perle de l'Ender + poudre de blaze) : lancé, il s'envole vers le **fort** le plus
  proche puis retombe (80 %) ou se brise. Les forts (souterrains, ~1 tous les 768 blocs) ont des
  couloirs de briques de pierre, une bibliothèque, des coffres et la **salle du portail** : 12 cadres
  autour d'un bassin de lave (environ 1 sur 10 a déjà un œil).
- Un œil posé sur chaque cadre **ouvre le portail** (3×3) ; y entrer mène instantanément dans l'End,
  sur une plateforme d'obsidienne.
- **L'End** (`EndGenerator`) : île de pierre de l'End au-dessus du **vide** (4 dégâts / 0,5 s en
  tombant), dix **piliers d'obsidienne** (deux en cage de barreaux de fer) surmontés de **cristaux**,
  fontaine de bedrock au centre, grand vide puis îles extérieures au-delà de 400 blocs ; endermen.
- **Dragon de l'Ender** (200 PV, barre de boss), **modèle de l'édition Java** (texture `enderdragon/dragon.png`
  du pack, ailes articulées qui battent, cou et queue segmentés qui ondulent, yeux lumineux) : vol circulaire, charges, boules de feu, se pose sur
  la fontaine et souffle ; soigné par le cristal le plus proche (rayon visible) — détruire ce cristal
  le blesse. Vaincu : 500 XP, **portail de sortie** et **œuf de dragon** ; la sortie ramène au point
  d'apparition. `/execute in minecraft:the_end run tp @s x y z` y mène directement.

### Le Wither et les finitions

- **Squelettes wither** dans les forteresses du Nether (épée de pierre, coup = effet *Wither*,
  5 % de chance de lâcher leur **crâne**).
- **Invocation du Wither** : T de 4 blocs de sable (ou terre) des âmes + 3 crânes de squelette wither
  posés dessus. Il charge 10 s (invulnérable, santé qui remonte), explose, puis vole autour du
  joueur, se régénère, tire des **crânes noirs** (explosifs) et parfois **bleus**, casse les blocs
  autour de lui quand on le frappe ; sous la moitié de sa santé, son **armure** arrête les flèches et
  il fonce sur le joueur. Vaincu : **étoile du Nether**.
- **Placement comme le jeu original** : plus de bloc fantôme, seulement le contour noir et les fissures.
- **Icônes plates** dans l'inventaire et en main pour les fleurs, torches, vitres, barreaux, portes,
  échelles, lanternes… (plus de « cube » pour ces objets).
- **Bras du joueur** en 1re personne (skin du pack, ombré, position calculée comme le jeu original),
  **pose accroupie** du modèle vanilla en vue 3e personne.
- **Objets en main en 3D** : modèle extrudé d'un pixel (épée, outils, nourriture…) avec la pose
  « première personne » du jeu original (épée en diagonale, face visible ; bloc tourné de 45°) et son
  animation de coup ; aussi en 3D au sol et dans la main de l'avatar en vue 3e personne.
- **Ciel** aux couleurs du jeu original (bleu clair #78A7FF, horizon #C0D8FF) et **nuages en 3D** :
  chaque pixel de `clouds.png` devient un nuage de 12 × 4 × 12 blocs (faces ombrées, sans faces
  internes), qui défile vers l'est et s'estompe au loin.
- **Entités d'add-ons** : les géométries vanilla référencées (golem de neige, minecart, villageois…)
  et les textures de blocs du jeu sont reconnues ; les entités « techniques » sans rendu sont invisibles.
- **Comme l'édition Java** : objets au sol en 3D (petit cube pour un bloc, icône plate sinon) qui
  tournent et flottent, éclairés par le monde, 1 à 5 modèles selon la pile, fusion des piles voisines,
  ramassés à ~1 bloc (sans aimant) avec l'animation de vol vers le joueur ; ciel du pack (soleil,
  8 phases de la lune — `moon_phases.png` ou `celestial/moon/*.png` —, nuages `clouds.png` à 12 blocs
  par pixel, ciel de l'End `end_sky.png`) ; blocs cassés en 4×4×4 fragments de leur texture (herbe → terre,
  feuilles teintées), éclairés comme le monde ; pluie et neige en rideaux texturés (`rain.png`,
  `snow.png`) par colonne, arrêtés par le premier bloc (plus de pluie sous un toit), avec gouttes au sol ; caméra qui s'incline quand on est blessé ; étincelles
  beiges des coups critiques ; mobs qui basculent sur le côté en mourant puis disparaissent dans un nuage
  de fumée ; le dragon s'élève dans les explosions ; yeux lumineux des araignées, endermen et du
  dragon dans le noir (`*_eyes.png` du pack, sinon extraits de la skin).
- **Shaders** (Options › Graphismes › Shaders) : *Activés* par défaut — lumière directionnelle du
  soleil (chaude) et de la lune (bleutée), eau qui reflète le ciel avec reflet du soleil et vaguelettes,
  brouillard éclairé par le couchant, couleurs plus riches et vignette ; *Ultra* ajoute de vraies
  **ombres projetées** (carte d'ombres du soleil, filtrée, découpe des feuilles et herbes respectée) ;
  *NON* revient au rendu classique.
- **Boutons tactiles comme l'édition mobile** : carrés gris translucides à icônes en pixel art
  (croix directionnelle, sauter, s'accroupir, courir, pause, chat) ; pas de bouton « attaquer » ni
  « utiliser » : toucher une créature la frappe (sauf interaction : nourrir, échanger, apprivoiser…),
  toucher un bloc pose, appui long casse ; en vol (créatif) « s'accroupir » devient « descendre »
  (maintenu) ; la vue (1re / 3e personne) se règle dans le menu pause. Les durées de toucher sont
  mesurées sur l'horodatage réel des événements (un ralentissement ne change pas un toucher en appui).
- **Visée tactile au doigt** (Options › Commandes › Visée tactile) : comme les commandes classiques
  de l'édition mobile, un toucher bref pose / utilise **là où l'on touche** et un appui long mine le
  bloc sous le doigt ; *Au viseur* garde la visée au centre de l'écran.
- **Portes, trappes et portillons** des 12 essences de bois (chêne, sapin, bouleau, acajou, acacia,
  chêne noir, cerisier, palétuvier, chêne pâle, carmin, biscornu, bambou) avec leurs recettes ;
  **porte et trappe en fer** qui ne s'ouvrent qu'avec la redstone : **levier**, **boutons** (pierre et
  bois, relâchés après 1 / 1,5 s) et **plaques de pression** (joueur et créatures ; objets aussi sur
  le bois) alimentent les ouvrants dans un rayon d'un bloc.
- **Distance de vue** : profils à 4 / 6 / 10 tronçons (jusqu'à 12), brouillard du jeu original
  limité à la fin de la distance (on voit beaucoup plus loin), textures avec **mipmaps** (moins de
  scintillement au loin, niveau choisi sans couture entre tuiles).
- **Liquides et blocs** : surface de l'eau et de la lave en pente comme le jeu original (hauteur de
  chaque coin moyennée, plus de trous entre niveaux), animation à 16 images (8 images/s) issue du pack,
  surfaces translucides sans « parois fantômes », glace et verre sans double face contre l'eau ;
  coffre aux couleurs de `entity/chest/normal.png` avec loquet en relief.
- **Rendu plus net** : anticrénelage (sauf profil *Bas*), pleine résolution par défaut (les anciens
  réglages sont relevés une fois), image non pixelisée à l'agrandissement, simulation par sous-pas
  (physique stable même quand l'image ralentit) ; plus de messages superflus à l'écran.
- **Génération plus fidèle** : nouveaux biomes — **forêt de bouleaux**, **forêt fleurie**,
  **prairie** (en altitude), **cerisaie** (arbres roses à branches), **taïga enneigée**, **badlands**
  (sable rouge, plateaux en terrasses, strates de terre cuite colorée), **pics rocheux** (pierre et
  calcite), **océan profond** — choisis par un bruit de « variante » comme la bizarrerie du jeu
  original ; pics de glace plus rares. **Plantes hautes** sur deux blocs (hautes herbes, grandes
  fougères, lilas, rosier, pivoine : se posent sur deux blocs, casser une moitié retire l'autre, un seul
  objet lâché ; colorants), **nénuphars** dans les marais.
- **Villages comme le jeu original** : puits et cloche au centre, 2 à 4 rues en terre battue qui
  suivent le relief, bâtiments orientés vers la rue avec **vraies portes**, toits à deux pans en
  **escaliers**, poteaux en bûches, soubassement en pierre, vitres, lits, coffres, lanternes et torches ;
  petites et grandes maisons, **bibliothèque**, **forge**, **champs** irrigués et **lampadaires** ; style
  selon le biome (chêne, sapin, acacia, grès à toit plat dans le désert) ; les villages s'installent
  sur un terrain assez plat et sec.
- **Créatures plus intelligentes** : recherche de chemin **A*** (marche, saut d'un bloc, descente
  jusqu'à 3 blocs, nage ; évite lave, cactus et barrières ; traverse portes et portillons ouverts) pour
  poursuivre, chercher le joueur, rentrer, suivre la nourriture et errer ; si la cible est inaccessible,
  elles vont au plus près ; les morts-vivants cherchent l'**ombre** quand ils brûlent au soleil.
- **Multijoueur : serveur de mini-jeux intégré « HypXL »** (écran titre › *Multijoueur*, nommé
  « LeCraft Network » avant la v2.25) — un serveur intégré, sans logo ni ressource d'un serveur
  réel, qui fonctionne **hors ligne** :
  les autres joueurs sont des **bots** (skins du pack, pseudos, rangs VIP/MVP, chat). Liste des
  serveurs avec message du jour, joueurs en ligne et ping. **Hub** : île avec fontaine, PNJ des jeux
  (toucher pour jouer), boussole « Menu des jeux », bots qui se promènent et discutent (ils répondent
  au chat), tableau de scores latéral (pièces, victoires, éliminations), hub protégé. **Mini-jeux** :
  **SkyWars** (8 joueurs, cages de verre, coffres pillés, ponts de laine des bots, dernier en vie),
  **Spleef** (pelle en diamant, les bots cassent la neige là où l'adversaire va poser le pied),
  **TNT Run** (le sol disparaît sous les pas, 3 couches), **Duel** (1 contre 1 en fer contre un bot de
  niveau 1 à 10), **Parkour** (36 sauts, 5 points de contrôle, chrono et record). Compte à rebours,
  titres, élimination puis spectateur, annonce du gagnant et du classement, **pièces** gagnées
  (victoire, élimination, participation), retour au hub ; la carte est restaurée après chaque partie.
  **Bots** : recherche de chemin, combat de joueur (sprint, coups critiques en sautant, esquive
  latérale seulement s'il y a du sol de chaque côté, recul et pomme dorée quand la vie est basse),
  pillage des coffres (meilleure arme, armure), ponts au-dessus du vide. Commandes : `/hub`, `/jeux`,
  `/play <jeu>`. Profil (pièces, victoires, record) conservé sur l'appareil ; le monde du serveur
  n'est jamais sauvegardé.
- **Serveur de survie moddé « LeCraft SMP »** (Multijoueur › 2e serveur, ou PNJ « Survie moddée »
  du hub, `/server smp`) — un monde de survie **sauvegardé** (masqué de la liste Solo) où 3 à 6 **bots**
  sont en ligne : ils **rejoignent et quittent** la partie (messages), **coupent du bois** (arbre entier),
  fabriquent de meilleurs outils (bois → pierre → fer → diamant, four pour le fer), **minent en
  escalier** (3 blocs de haut, torches, minerais visibles ramassés, lave bouchée), **choisissent un
  terrain** plat et sec (hors des arbres) et **construisent leur maison bloc par bloc** (déblaiement,
  fondations, murs, toit, porte, lit), rentrent la nuit et **combattent les monstres**. Ils **parlent**
  entre eux et **répondent** : « tu fais quoi ? », « suis-moi » (ils se téléportent s'ils sont loin),
  « donne-moi du fer/bois/pierre… », « où est ta maison ? », salut, merci… ; un bot tué revient et
  proteste. **Mods** : abattage d'arbre entier (hache), filons de minerai (pioche), **tombes** (vos
  objets dans un coffre à l'endroit de la mort). **Plugins** : `/spawn`, `/sethome`, `/home`, `/tpa`,
  `/rtp`, `/money`, `/pay`, `/shop` (boutique), `/sell` (vendre l'objet en main), `/msg`, `/list`,
  spawn protégé, **pièces** gagnées en minant et en tuant des monstres. Profils des bots (outils,
  inventaire, maison) sauvegardés avec le monde.
- **Mini-jeux améliorés** : file d'attente (les joueurs arrivent un par un, k/N), bots qui **tirent à
  l'arc** à distance (Duel, SkyWars), **niveau** du joueur, PNJ et `/server` pour changer de serveur.
- **Moins de lag sur téléphone** : la résolution est plafonnée selon le profil (Bas 1×, Moyen 1,5×,
  Haut 2× au lieu de jusqu'à 2× partout), anticrénelage seulement en profil Haut, qualité automatique
  plus réactive (baisse de résolution en 3 s) et mémorisée d'un lancement à l'autre, shaders
  désactivés par défaut en profil Bas. Créatures : saut à 1,3 bloc (comme le joueur), nage pour
  sortir de l'eau, peuvent sauter dans l'eau depuis plus haut.
- **Serveur HypXL (v2.25)** — le serveur de mini-jeux devient **HypXL** (`play.hypxl.net`) :
  - **Spawn refait** : île flottante avec stalactites, place à motifs et fontaine à étages,
    **logo HYPXL géant**, 8 PNJ de jeux en arc de cercle sur des socles, tours, remparts,
    jardins (cerisiers, bouleaux, chênes), arche d'entrée avec balise, boutique de cosmétiques,
    autel des boîtes mystères, mur du classement et **parcours du hub** en spirale autour d'une
    tour (chrono et record).
  - **Hologrammes** : accueil, classement des meilleurs joueurs, parcours.
  - **Beaucoup plus de joueurs** : 16 / 28 / 40 bots selon la qualité graphique. Ils arrivent et
    partent du lobby, portent des cosmétiques et parlent des jeux.
  - **12 lobbys** à choisir.
  - **8 mini-jeux**. Trois sont nouveaux :
    - **BedWars** : 4 équipes de 2. Lits, générateur de fer et marchand payé en fer.
      Réapparition tant que le lit existe, puis élimination finale. Les bots défendent ou
      attaquent : ils construisent des ponts de laine et cassent les lits.
    - **Sumo** : pousser les autres hors de l'arène ronde, sans dégâts.
    - **Block Party** : une couleur est annoncée et les autres disparaissent. Le temps pour
      courir diminue à chaque manche.
    - Les jeux existants restent : SkyWars, Duel, TNT Run, Spleef, Parkour.
  - **44 cosmétiques** achetés avec les pièces : traînées de particules, chapeaux (blocs
    portés), compagnons qui suivent, couleurs de chat, rangs (VIP, MVP, MVP+ affichés dans le
    chat) et gadgets (feu d'artifice, confettis, bond, orage).
  - **Boîtes mystères** à tirage animé, avec un cadeau de bienvenue de 1000 pièces.
  - **Menus du serveur** : objets du hub (boussole pour les jeux et le nombre de joueurs, livre
    pour le profil et les statistiques, émeraude pour les cosmétiques, colorant pour cacher les
    joueurs, étoile pour les lobbys, gadget).
  - **Tableau latéral** : rang, niveau, pièces, victoires, cosmétiques, lobby et joueurs.
  - **Commandes** : `/menu`, `/cosmetiques`, `/profil`, `/lobby <n>`, `/play <jeu>`.
- **Créatures complètes (v2.24)** — sens des rotations des modèles officiels corrigé (pose de
  repos, cubes tournés autour de leur centre) : vache, cochon, tortue, renard, lama, chat,
  ocelot, poule, dauphin… s'affichent entiers et à leur place.
- **Corrections du rendu (v2.23)** — torches (et torches de redstone, bâtons de l'End) avec le
  modèle incliné du jeu quand elles sont posées au mur ; verre teinté et vitres teintées
  réellement translucides ; cube de magma (nouvelle texture 64×64) et golem de neige (avec sa
  citrouille sculptée) corrigés ; slime avec sa couche extérieure translucide ; citrouilles
  taillées avec une seule face sculptée. Zombie « ultra réaliste » : skin peinte en haute
  définition (512×512 : peau marbrée en relief, orbites creuses, yeux laiteux, dents cassées,
  plaies, chemise et jean en lambeaux), couches extérieures (cheveux, lambeaux) et tête penchée.
- **Rendu fidèle au jeu original (v2.22)** — modèles 3D des blocs non cubiques au format des
  modèles de blocs du jeu (lanternes, chaînes, bougies, gâteau, chaudron, entonnoir, enclumes,
  cloche, alambic, table d'enchantement, tailleur de pierre, pupitre, meule, feux de camp,
  composteur, répéteur, comparateur, échafaudage, balise, paratonnerres, cacao, cultures, rails,
  capteurs et hurleurs de sculk, œufs de renifleur, ghast desséché…) : plus de « trous » dans les
  blocs ; les cages (générateurs, coffres-forts, grilles) se voient des deux côtés. Créatures :
  géométrie exacte des modèles officiels (scripts/gen-entity-geometry.py, d'après les
  échantillons publics de l'édition Bedrock) avec les vraies textures du pack. Image nette :
  résolution native de l'écran, anticrénelage dès le profil moyen, mipmaps jusqu'au niveau 4
  (plus de scintillement au loin), herbe et feuillage bien teintés au loin, bords sans liseré
  sombre. L'inventaire, le bras et le corps du joueur utilisent sa vraie skin.
- **Toutes les textures du pack (v2.21)** — chaque texture de bloc et d'objet du pack de
  ressources a maintenant un usage : faces multiples (dessus / dessous / avant / dos) pour ~70 blocs
  existants (quartz, basalte, grès, fourneaux, ruches, observateur, fabricateur, vitres…), ~370
  nouveaux blocs (bougies, rails, ampoules, chaînes, portes et trappes en cuivre, étagères, coffres-
  forts, générateurs d'épreuve, blocs de commande, œufs de renifleur, ghast desséché, coraux morts,
  stades de culture…), ~250 nouveaux objets (bateaux, pancartes, sacs, harnais, lances, armure en
  cuivre, disques, tessons, modèles de forge, motifs de bannière, potions, seaux de poissons…) et
  15 nouvelles créatures (embourbé, desséché, piglin barbare, évocateur, marchand ambulant, mule,
  chevaux squelette et zombie, zoglin, chat, poisson-globe, têtard…). Atlas agrandi à 64×64 tuiles.
  Les données sont générées par `scripts/gen-vanilla-pack.py` (noms + couleurs moyennes, aucune
  image incluse) ; sans pack, des tuiles de repli sont dessinées. Restent seulement les images
  techniques (cadres d'animation de l'horloge et de la boussole, surcouches, textures de débogage).
- **Nouvelle dimension : la « Pâte à papier » (v2.20)** — un monde entièrement en papier. Construisez
  un cadre de **papier mâché** (comme un portail du Nether : 4×5, intérieur 2×3 ; recette : 8 papiers
  + 1 boule d'argile → 4) et ouvrez-le avec une **plume encrée** (plume + poche d'encre + papier).
  Quatre biomes : **plaines de papier** (fleurs en papier, confettis, lanternes sur poteaux),
  **forêts d'origami** (troncs en tubes de carton, feuillages pliés verts et roses), **canyons de
  carton** en terrasses, **marais d'encre** (papier journal, flaques d'encre) ; sous-sol en carton et
  papier froissé avec **filons de graphite** ; **temples d'origami** arc-en-ciel (trésor, cage à
  gribouilles). Ciel pastel en plein jour permanent, musique propre. **Créatures** : grue en papier
  (vole), grenouille en origami, **gribouille** (silhouette d'encre), **boulette de papier** (rebondit et
  se divise), **avion de papier** (pique sur le joueur), **golem de carton** (mini-boss). **Objets** :
  outils en **graphite**, armure en **carton**, couronne de papier, **ciseaux géants**, avions en papier
  à lancer, fruits en origami ; ~30 blocs (papier ligné/quadrillé, journal, carton, papiers de
  couleur, lanterne en papier…). `/execute in paper run tp …` et `/locate paper_temple` fonctionnent.
- **Textures des packs récents** : les vaches, cochons et meuh-champis des packs 1.21.5+ (textures
  64×64) s'affichent correctement ; les boules de neige se lancent.
- **Vrai multijoueur en réseau (v2.19)** — jouez avec de **vrais joueurs** (Wi-Fi local ou Internet) :
  un joueur ouvre son monde (*Menu du jeu › Ouvrir au multijoueur* : JcJ, bots joueurs, 4 à 16 joueurs),
  les autres le rejoignent (*Multijoueur › Parties en réseau*). Un petit **serveur relais sans
  dépendance** fait le lien : `npm run server` (port 25580 ; sert aussi le jeu aux navigateurs du
  réseau) ou `npm run dev`/`npm run preview` (relais à la même adresse). L'hôte reste maître du monde :
  **chunks modifiés** transmis à l'arrivée, **blocs en direct** dans les deux sens, **joueurs** visibles
  (skin, pseudo, objet en main, accroupi/nage), **créatures et bots** de l'hôte affichés chez les invités,
  coups sur les créatures (le **butin va au joueur** qui tue), créatures qui **poursuivent n'importe quel
  joueur**, terrain simulé autour de chaque joueur, **JcJ**, **chat**, **coffres partagés**, temps et
  météo synchronisés, les invités **suivent l'hôte** dans le Nether et l'End. Limites : les fourneaux
  et les objets au sol de l'hôte restent locaux ; seul l'hôte change de dimension.
- **Bots joueurs dans n'importe quel monde** (option *Bots joueurs* à la création ou à l'ouverture
  au multijoueur) et **bots plus logiques** : ils **mangent** et récupèrent, **ramassent** les objets,
  **fuient les creepers** et se replient quand leur vie est basse, **viennent aider** un joueur attaqué,
  et les **fermiers** cultivent un champ de blé près de leur maison (labour, semis, récolte, pain).
- **Créatures (v2.19)** : apparitions corrigées (herbe haute et fleurs acceptées, plusieurs essais par
  seconde, seules les créatures proches comptent dans la limite, les lointaines sont libérées, autour
  de chaque joueur) et **30 nouvelles créatures** : meuh-champi, chèvre, cheval, âne, lama, dromadaire,
  ours polaire, panda, lapin, renard, ocelot, grenouille, tortue, perroquet, abeille, tatou, morue,
  saumon, poisson tropical, dauphin, axolotl, gardien, golem de fer (protège les villages), golem de
  neige, zombie villageois, pillard, vindicateur, phantom (la nuit, en piqué), poisson d'argent,
  endermite, piglin, hoglin, arpenteur, shulker — et un **œuf d'apparition** par créature.
- **~290 nouveaux blocs** : escaliers/dalles/barrières de toutes les essences, **murets** et escaliers
  de toutes les pierres, **bûches écorcées** (hache : clic droit) et bois, **tapis**, **terre cuite
  émaillée**, boîtes de shulker, **coraux**, champignons géants, sculk, lanternes de grenouille, cuivre
  sculpté, ardoise, pierre noire, tuf, glace bleue, éponge, miel, ruches, pistons, observateurs…
- **Nouveaux objets** : **marteaux** (minage **3×3**) et **excavateurs** (pelletage 3×3) du bois à la
  netherite (accroupi : un seul bloc), outils et armures en **netherite** et en **mailles**, carapace
  de tortue, poissons, lapin, ragoût, miel, algues, longue-vue, brochette de champignons…
- **Nage facilitée** : sous l'eau, avancer suffit pour nager (le sprint nage plus vite), accroupi pour
  plonger, on flotte à la surface et on **se hisse hors de l'eau** contre un bord.
- **Portail de l'End corrigé** : cadres à la vraie hauteur (13/16) avec l'**œil posé dessus** (les
  cadres ne deviennent plus transparents avec un pack), portail fin rendu en **ciel étoilé animé**
  (couches d'étoiles en espace écran, comme le jeu original).
- **Musique** : pièces **composées** dans l'esprit des musiques calmes du jeu (piano feutré, accords
  de septième, nappes, cloches, réverbération) selon l'ambiance (menu, jour, nuit, grottes, sous l'eau,
  créatif, Nether, End) ; *Options › Musique et sons* : **importer vos propres musiques** (.ogg/.mp3)
  et morceau suivant ; les musiques d'un pack de ressources (`sounds/music`) sont aussi importées.
- **Petites touches LeCraft** : des **feuilles tombent** des arbres ; à la mort, la **position** est
  affichée et, après la réapparition, une **boussole** guide 5 minutes vers le lieu de la mort.

### Commandes (chat)

Bouton 💬 (ou touche **T**, **/** au clavier) : chat avec historique et **autocomplétion**. Syntaxe du
jeu de référence, identifiants avec ou sans `minecraft:`, états de blocs `bloc["etat"=valeur]`,
coordonnées absolues, relatives `~` et locales `^`, sélecteurs `@s @p @a @r @e @initiator` avec
filtres `type`, `name`, `tag`, `family`, `r`, `rm`, `c`, `x/y/z`, `dx/dy/dz`, `scores`, `m`, `l/lm`, `hasitem` :

`/help` `/give` `/clear` `/tp` (rotation, `facing`) `/time` `/weather` `/toggledownfall` `/gamemode`
`/difficulty` `/kill` `/summon` `/setblock` `/fill` `/clone` `/effect` (34 effets, `clear`, `infinite`)
`/xp` `/spawnpoint` `/setworldspawn` `/seed` `/say` `/me` `/tell` `/tellraw` `/title` `/titleraw` `/list`
`/locate` `/gamerule` `/function` `/playsound` `/particle` `/enchant` `/tag` `/scoreboard`
(objectives, players set/add/remove/reset/list/test/random/operation, setdisplay) `/scriptevent`
`/damage` `/camerashake` `/loot` `/replaceitem` `/spreadplayers` `/testfor` `/testforblock`
`/alwaysday` `/structure load` et **`/execute`** (`as`, `at`, `positioned`, `align`, `anchored`,
`facing`, `rotated`, `in`, `if|unless entity|block|blocks|score`, `run`, ancienne syntaxe `detect`).
Acceptées sans effet visible : `/playanimation`, `/camera`, `/ride`, `/inputpermission`, `/event`,
`/fog`, `/hud`, `/dialogue`, `/stopsound`, `/music`.

Règles (`/gamerule`) : `keepInventory`, `doDaylightCycle`, `doWeatherCycle`, `doMobSpawning`,
`tntExplodes`, `showCoordinates`, `naturalRegeneration`, `fallDamage`, `doImmediateRespawn`,
`mobGriefing` (explosions de creeper sans destruction de blocs si désactivée) (les autres règles sont mémorisées pour les scripts). Les commandes de triche suivent l'option
**Activer les triches** du monde (création ou « Modifier »).

### Add-ons de l'édition mobile (.mcaddon / .mcpack)

**Options… → Add-ons (.mcaddon)… → Importer un add-on…**, puis « Redémarrer pour appliquer ».
Les `.mcaddon` (y compris avec des `.mcpack` imbriqués) et `.mcpack` sont lus sur l'appareil et
stockés localement ; chaque add-on peut être activé, désactivé ou supprimé.

| Pris en charge | Détail |
|---|---|
| Packs de ressources | textures (blocs, objets, entités, noms Bedrock convertis), `terrain_texture.json`, `item_texture.json`, `blocks.json`, textes `.lang`, PNG et TGA ; **sons** (`sound_definitions.json`, `.ogg`/`.wav`) et sons des entités (`sounds.json`) |
| Blocs | identifiant, textures par face, dureté, lumière, rendu, collision/sélection, friction, butin ; **états et permutations** (`states`, `traits` placement_direction / placement_position / connection, conditions Molang), **géométries personnalisées** (`*.geo.json`, os, rotations, UV par face ou « box », visibilité d'os), `transformation` ; jusqu'à 4096 blocs |
| Objets | icône, nom, pile, nourriture, dégâts, durabilité, outils, armures, combustible, poseur de bloc, temps de recharge, étiquettes |
| Recettes | `recipe_shaped`, `recipe_shapeless`, `recipe_furnace` (tags, anciens identifiants `dye:N`, objets d'add-ons) ; le rapport liste les ingrédients manquants |
| Entités | santé, vitesse, attaque, hostilité, taille, reproduction, butin, vol, attaque à distance (`minecraft:shooter`), familles, propriétés d'entité ; **géométrie Bedrock** + texture ; **animations à images clés et contrôleurs d'animation** ; sons ; œufs d'apparition ; règles d'apparition ; **projectiles** (`minecraft:projectile` : dégâts, explosion, effet) |
| Structures | fichiers **`.mcstructure`** (NBT) : `/structure load`, `world.structureManager` |
| Fonctions | `.mcfunction` (`/function nom`), `tick.json` |
| **Scripts** | **`@minecraft/server`** (1.x et 2.x) et **`@minecraft/server-ui`** : voir ci-dessous |

**API de script.** Les fichiers JavaScript du pack sont chargés comme modules ES (imports relatifs,
avec ou sans `.js`) dans le jeu, sans réseau. Implémentés : `world` (dimensions, joueurs, entités,
propriétés dynamiques **sauvegardées**, tableau des scores, heure, météo, règles, messages, sons,
`structureManager`), `system` (`run`, `runTimeout`, `runInterval`, `runJob`, `waitTicks`,
`sendScriptEvent`), `Dimension` (blocs, `getEntities` avec filtres, `spawnEntity`, `spawnItem`,
`spawnParticle`, `createExplosion`, `runCommand`, rayons), `Block` / `BlockPermutation` (états,
étiquettes, inventaire des coffres), `Entity` / `Player` (composants `health`, `inventory`,
`equippable`, `type_family`, `projectile`, `item`…, effets, étiquettes, téléportation, dégâts,
impulsions, regard, `runCommand`, `onScreenDisplay`, sons, niveaux), `ItemStack` (description,
propriétés dynamiques, composants `durability`, `enchantable`, `cooldown`, `food`), `Container` /
`ContainerSlot`, ~60 événements avant/après (dégâts, mort, apparition, interactions, casse/pose,
utilisation d'objets, chat, inventaire, météo, mode de jeu, `scriptEventReceive`…), **composants
personnalisés** de blocs (`onPlayerInteract`, `onTick`, `onRandomTick`, `onPlace`, `onPlayerBreak`,
`beforeOnPlayerPlace`, `onStepOn/Off`, `onEntityFallOn`) et d'objets (`onUse`, `onUseOn`,
`onConsume`, `onCompleteUse`, `onHitEntity`, `onMineBlock`, `onBeforeDurabilityDamage`),
commandes personnalisées, et les formulaires `ActionFormData`, `ModalFormData`, `MessageFormData`
(affichés avec les boutons et curseurs du jeu, codes couleur `§`). Une erreur de script est
interceptée et journalisée sans arrêter la partie (les 3 premières sont affichées dans le chat).

**Testé avec 6 add-ons réels** (Vanilla Upgrade, Titans of Extinction, No Limits, The Quartermaster's
Armory, Nightmare Blade, Morphing Bracelet) : les 5 packs à scripts se chargent et s'exécutent sans
erreur ; un test automatique place/utilise/casse chacun des 101 blocs et 31 objets à composants
personnalisés et fait apparaître les 50 créatures sans erreur de script.

**Limites (honnêtement) :** les scripts s'exécutent sans bac à sable (comme tout code d'un add-on
que l'on choisit d'installer) ; pas de redstone (`onRedstoneUpdate` n'est jamais appelé,
`getRedstonePower()` vaut 0) ; pas de chevauchement (`rideable.addRider` ne fait rien) ; les
événements d'entité (`triggerEvent`, groupes de composants dynamiques) n'ont pas d'effet ; pas de
caméra scriptée ni de HUD personnalisé (`ui/*.json`) ; un seul joueur (`getAllPlayers()` renvoie le
joueur local) ; les dimensions Nether et End sont vides ; contrôleurs de rendu, particules
personnalisées et attachables ne sont pas dessinés (les particules utilisent des effets du jeu) ;
pas de génération de structures/biomes/features d'add-ons dans le monde ; les blocs du jeu de
référence absents de LeCraft sont remplacés par l'équivalent le plus proche (signalé dans le
rapport). Les blocs d'add-ons gardent un identifiant stable : un add-on retiré laisse des
« blocs inconnus » sans corrompre les mondes.

**Palette élargie** : environ 280 blocs et objets supplémentaires du jeu de référence (béton, terre
cuite, verre teinté, colorants, cerisier, palétuvier, carmin, biscornu, bambou, ardoise des abîmes,
Nether, End, quartz, cuivre, prismarine, fleurs, torches, tonneau, feu de camp…), aux textures
générées, avec leurs recettes : ils servent aussi aux recettes et scripts des add-ons
(251 des 268 recettes des 6 add-ons testés sont chargées ; les autres demandent des composants
de redstone absents).

### Packs de ressources

**Options… → Packs de ressources… → Importer un pack…** accepte :
- un pack de ressources au format Java (`.zip` contenant `assets/minecraft/textures/…`) ;
- le fichier **`.jar` de version** de votre propre copie du jeu (par ex. `versions/1.21.x/1.21.x.jar`).

Le fichier est lu **sur l'appareil** (lecture ZIP + `DecompressionStream`), seules les images utiles
sont extraites et stockées dans IndexedDB (`lecraft-packs`) ; rien n'est envoyé ni téléchargé.
Sont remplacés : les tuiles de blocs (`block/*.png`, herbe/feuilles en niveaux de gris teintées par
biome, superposition latérale de l'herbe, eau et lave animées), les icônes d'objets (`item/*.png`,
armure en cuir teintée), les skins des créatures (`entity/…`, modèles à disposition UV vanilla),
les fonds des interfaces (`gui/container/*.png`), les sprites du HUD et des boutons
(`gui/sprites/hud`, `gui/sprites/widget`, ou les anciens `gui/icons.png` / `gui/widgets.png`).
Les textures sans équivalent (coffre et lit en entité, boss) gardent le dessin du jeu.
« Retirer le pack » rétablit les textures d'origine. Le logo du jeu n'est jamais importé.
Les archives dont le dossier racine précède `assets/` (ex. `Default-Java-1.21.11/assets/…`) sont acceptées.

**Pack par défaut dans votre propre build.** Pour que votre copie de l'application démarre
directement avec un pack (sans import manuel) :

```bash
npm run pack:embed -- /chemin/vers/MonPack.zip   # copie dans public/default-pack.zip (ignoré par git)
npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)
npm run pack:embed -- --remove                   # retire le pack intégré
```

Au premier lancement, s'il n'y a aucun pack installé, ce fichier est importé automatiquement.
« Retirer le pack » le désactive définitivement sur l'appareil. **Ce fichier n'est jamais
versionné** : n'intégrez que des textures que vous avez le droit d'utiliser, et ne publiez pas un
APK qui contient des textures sous droits d'auteur.

---

## 2. Prérequis

| Outil | Version testée |
|---|---|
| Node.js | 22.x (≥ 20 requis) |
| npm | 10.x |
| JDK | 21 (Android Gradle Plugin 8.x exige ≥ 17) |
| Android SDK | Platform 36, Build-Tools 36.0.0, Platform-Tools |
| Gradle | fourni par le wrapper `android/gradlew` (8.14.3) |

Variables d'environnement : `ANDROID_HOME` (ou `ANDROID_SDK_ROOT`) pointant vers le SDK, ou un
fichier `android/local.properties` contenant `sdk.dir=/chemin/vers/Android/Sdk` (non versionné).

Installation du SDK en ligne de commande (sans Android Studio) :
```bash
# commandlinetools : https://developer.android.com/studio#command-tools
sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"
```

---

## 3. Installation

```bash
npm install
```

---

## 4. Développement

```bash
npm run dev          # serveur Vite (http://localhost:5173), accessible depuis un téléphone du réseau local
npm run typecheck    # vérification TypeScript
npm test             # tests unitaires (Vitest)
```
Sur ordinateur : clavier/souris (voir [Contrôles](#13-contrôles)). Sur téléphone : ouvrir
l'adresse réseau affichée par Vite pour tester les contrôles tactiles.

Console de diagnostic (navigateur) : `__lecraft.debug.findBiome('jungle')`,
`__lecraft.debug.teleport(x, z)`, `__lecraft.debug.findStructure('golem_lair')`,
`__lecraft.debug.give('iron_pickaxe')`, `__lecraft.debug.setTime(0.75)`. Touche **F3** : infos de performance.

---

## 5. Build web

```bash
npm run build        # tsc --noEmit + vite build → dist/
npm run preview      # sert dist/ sur http://localhost:4173
```
Le build est **relatif** (`base: './'`) et ne référence aucune ressource externe.

---

## 6. Build Android — APK debug

```bash
npm install
npm run build
npx cap sync android
cd android
./gradlew assembleDebug          # Windows : gradlew.bat assembleDebug
```
Résultat : **`android/app/build/outputs/apk/debug/app-debug.apk`**

Raccourci : `npm run android:debug`.

Installation sur le téléphone (débogage USB activé) :
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```
ou copier l'APK sur le téléphone et l'ouvrir (autoriser « sources inconnues »).

Android Studio : `npx cap open android` puis *Run*.

### Icônes et splash screen
Ils sont générés à partir des textures du jeu (déjà présents dans le dépôt). Pour les régénérer :
```bash
npm run build && npm run assets:android
```

---

## 7. APK release et AAB signés

**Ne mettez jamais la clé de signature dans le dépôt** (`*.jks`, `*.keystore` et
`android/keystore.properties` sont ignorés par git).

1. Créer la clé (une seule fois, à conserver précieusement hors du dépôt) :
   ```bash
   keytool -genkeypair -v -keystore ~/cles/lecraft-release.jks -alias lecraft \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Copier `android/keystore.properties.example` en `android/keystore.properties` et le remplir :
   ```properties
   storeFile=/home/moi/cles/lecraft-release.jks
   storePassword=...
   keyAlias=lecraft
   keyPassword=...
   ```
3. Construire :
   ```bash
   npm run build && npx cap sync android
   cd android
   ./gradlew assembleRelease     # → app/build/outputs/apk/release/app-release.apk (signé)
   ./gradlew bundleRelease       # → app/build/outputs/bundle/release/app-release.aab (Google Play)
   ```
   Sans `keystore.properties`, `assembleRelease` produit `app-release-unsigned.apk`.
4. Vérifier la signature : `apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk`

Version : `appVersionCode` / `appVersionName` dans `android/variables.gradle`
(incrémenter `appVersionCode` à chaque publication). Identifiant : `com.lecraft.game`.

---

## 8. Structure du projet

```
├── index.html                 # page unique (CSP stricte hors ligne)
├── capacitor.config.ts        # appId, nom, splash, barre d'état
├── vite.config.ts / tsconfig.json / vitest.config.ts
├── public/icon.png
├── src/
│   ├── main.ts                # point d'entrée
│   ├── core/       Game.ts (états, navigation), GameLoop.ts (FPS cap), Session.ts (partie en cours),
│   │               Config.ts (constantes, profils), Settings.ts, DeviceProfiler.ts, Progression.ts,
│   │               GameContext.ts (interfaces partagées), Events.ts, DebugTools.ts
│   ├── data/       blocks.ts, items.ts, recipes.ts, biomes.ts, mobs.ts   ← contenu data-driven
│   ├── world/      World.ts, Chunk.ts, ChunkData.ts, ChunkManager.ts, WorldGenerator.ts, Noise.ts,
│   │               BiomeManager.ts, CaveGenerator.ts, StructureGenerator.ts, Trees.ts,
│   │               FluidSimulator.ts, WorldTicker.ts, DayCycle.ts, Weather.ts, Explosions.ts (TNT)
│   ├── blocks/     Block.ts, BlockRegistry.ts, BlockBehaviors.ts (drops, minage, butin, supports),
│   │               Shapes.ts (dalles, escaliers, portes, lits… : rendu, collisions, visée)
│   ├── player/     Player.ts, PlayerController.ts, PlayerPhysics.ts, PlayerInteraction.ts
│   ├── inventory/  Inventory.ts, Item.ts, ItemRegistry.ts
│   ├── crafting/   Recipe.ts, RecipeRegistry.ts, CraftingSystem.ts
│   ├── entities/   Entity.ts, EntityManager.ts, Mob.ts, Animal.ts, Monster.ts, Boss.ts,
│   │               ItemEntity.ts, Projectile.ts, Physics.ts
│   ├── ai/         AIController.ts, StateMachine.ts
│   ├── combat/     CombatSystem.ts, DamageSystem.ts
│   ├── render/     Renderer.ts, ChunkMesher.ts, Lighting.ts, ChunkMaterial.ts, Padded.ts,
│   │               TextureGenerator.ts, TileRegistry.ts, TextureManager.ts, Sky.ts, MobModels.ts,
│   │               MobSkins.ts (skins UV vanilla), VoxelModels.ts (boss), ResourcePack.ts (import .zip/.jar),
│   │               ParticleSystem.ts, WeatherRenderer.ts, BlockHighlight.ts, HeldItem.ts
│   ├── input/      InputState.ts, TouchController.ts, VirtualJoystick.ts, KeyboardMouse.ts
│   ├── save/       SaveManager.ts, WorldSerializer.ts
│   ├── ui/         UIManager.ts, HUD.ts, Screens.ts (menus), SettingsUI.ts, InventoryUI.ts,
│   │               Mc.ts (widgets), Theme.ts, PixelFont.ts + FontBuilder.ts (police TrueType générée),
│   │               ContainerArt.ts (fonds des conteneurs), HudArt.ts, MenuArt.ts, IconTemplates.ts, dom.ts, styles.css
│   ├── audio/      AudioManager.ts, Synth.ts
│   ├── platform/   Platform.ts (Capacitor : retour, cycle de vie, orientation, vibrations)
│   └── workers/    world.worker.ts, protocol.ts
├── android/                   # projet Android (Gradle) généré par Capacitor et personnalisé
│   └── app/src/main/java/com/lecraft/game/MainActivity.java  (plein écran immersif)
├── scripts/                   # e2e.mjs, e2e-gameplay.mjs, e2e-vanilla.mjs, perf.mjs, screens.mjs, tour.mjs,
│                              # gen-android-assets.mjs
└── tests/                     # tests unitaires Vitest
```

---

## 9. Architecture technique

**Choix du moteur.** Three.js + WebGL 2 avec des shaders personnalisés pour les chunks :
- *Phaser* est un moteur 2D, inadapté à un monde voxel 3D ;
- *WebGL brut* aurait demandé de réécrire caméra, scène, matériaux et gestion des ressources
  pour un gain négligeable, puisque le coût est dominé par les meshes de chunks (déjà optimisés).
- Three.js apporte le frustum culling, la gestion des buffers et une API stable, tandis que le
  rendu des chunks passe par un `ShaderMaterial` dédié (atlas, lumière, AO, animations).

```
Thread principal                                   Web Worker
─────────────────                                  ──────────────────────────
Game ─ Session ─ World (blocs, méta)  ── edits ──▶ miroir des chunks
         │        ChunkManager        ── load ───▶ WorldGenerator (seed) / chunk sauvegardé
         │                            ◀─ chunk ──
         │                            ── mesh ───▶ volume « padded » → Lighting (BFS)
         │                            ◀─ mesh ─── → ChunkMesher (greedy + AO) → tableaux typés
         ├─ Player / Controller / Interaction (raycast)
         ├─ EntityManager → Mob → AIController → StateMachine
         ├─ WorldTicker (liquides, ticks aléatoires, gravité)
         ├─ Renderer (Three.js) / Sky / Particles / HUD (DOM)
         └─ SaveManager (IndexedDB)
```

Points clés :
- **Chunks** 16×16×128, index `x + z·16 + y·256` ; le worker garde un miroir des données et ne
  reçoit que les modifications ; le thread principal reste autoritaire (physique, raycast).
- **Lumière** : propagation BFS ciel + blocs sur un volume étendu de 14 blocs autour du chunk.
- **Sommets compacts** : positions `Int16` (×16), UV `Uint8`, infos `Uint8×4` (tuile, drapeaux,
  lumière ciel, lumière bloc), teinte+ombrage `Uint8×4` — ≈ 18 octets/sommet.
- **Structures inter-chunks** : chaque type découpe le monde en régions ; la structure d'une région
  est reconstruite (déterministe) et seuls ses blocs du chunk courant sont écrits.
- **Boucle** : physique/contrôles à chaque frame, simulation à 20 ticks/s fixes, rendu limité à 30/45/60 FPS.

---

## 10. Ajouter du contenu

Tout le contenu est déclaratif dans `src/data/`. **Règle importante** : l'ordre des blocs,
biomes et créatures détermine leur identifiant numérique stocké dans les sauvegardes —
**ajoutez toujours à la fin des listes**.

### Ajouter un bloc
1. `src/data/blocks.ts`, à la fin de `BLOCK_DEFS` :
   ```ts
   { key: 'basalt', name: 'Basalte', textures: { top: 'basalt_top', side: 'basalt_side', bottom: 'basalt_top' },
     hardness: 2, tool: 'pickaxe', minTier: 1, sound: 'stone',
     drops: [{ item: 'basalt' }], light: 0, color: '#3a3a42' },
   ```
   Champs disponibles : `render` (`cube`, `cutout`, `cross`, `liquid`, `translucent`), `solid`, `liquid`,
   `light` (0–15), `flammable`, `gravity`, `drops` (`{ item, min, max, chance }`), `lightFilter`,
   `replaceable`, `sway`, `contactDamage`, `friction`, `interact`, `needsSupport`, `supportBlocks`, `orientable`.
2. Dessiner les tuiles dans `src/render/TextureGenerator.ts` (`painters['basalt_top'] = (t) => …`).
   Le test `tests/gameplay.test.ts` vérifie que chaque tuile a un peintre.
3. L'objet correspondant est créé automatiquement (voir fin de `src/data/items.ts`).

### Ajouter un objet
`src/data/items.ts`, dans `ITEM_DEFS` :
```ts
{ key: 'ruby', name: 'Rubis', icon: sprite('gem', '#e0303a', '#ffb0b0'), rare: true },
{ key: 'stew', name: 'Ragoût', icon: sprite('bread', '#8a5a32', '#c89050'), food: { hunger: 8, saturation: 9 }, maxStack: 16 },
```
Les icônes `sprite` utilisent les gabarits pixel-art de `src/ui/IconTemplates.ts`
(ajoutez un gabarit 16×16 si nécessaire). Outils : `tool: { type, tier, speed, durability, material }`,
armures : `armor: { slot, defense, durability, material }`, usages : `use: 'till' | 'plant' | 'shoot' | 'compass' | 'cast'`.

### Ajouter une recette
`src/data/recipes.ts` — recettes à motif (comme les fichiers JSON du jeu de référence) :
```ts
shaped('ruby_block', 1, ['RRR', 'RRR', 'RRR'], { R: 'ruby' }),
shapeless('ruby', 9, 'ruby_block'),
smelt('raw_ruby', 'ruby', 1.0),           // fourneau : 10 s par objet, XP
```
Un motif de 2×2 au plus est réalisable dans l'inventaire, les autres demandent la table de
fabrication. Le motif peut être placé n'importe où dans la grille et est aussi reconnu en miroir.
Groupes interchangeables : `tag:planks`, `tag:logs`, `tag:wool`, `tag:coals`, `tag:stone_tool` (table `TAGS`).

### Ajouter une créature
1. `src/data/mobs.ts`, à la fin de `MOB_DEFS` : santé, dégâts, vitesse, `detectionRange`,
   `attackRange`, `attackCooldown`, `drops`, `xp`, `food` (reproduction), `ranged`, `traits`
   (`burnsInSun`, `climbs`, `hops`, `flies`, `splits`, `knockbackResist`), `spawn`
   (`where: 'surface' | 'cave'`, `light`, `group`, `weight`), `sounds`, `weakness`.
2. Modèle dans `src/render/MobModels.ts` (`VANILLA.maCreature`, cubes en pixels au format des modèles
   du jeu de référence : origine UV, taille, pivot) et skin procédurale dans `src/render/MobSkins.ts`
   (même disposition UV : un pack de ressources peut la remplacer, chemin dans `SKIN_PATHS` de `TextureManager`).
3. Rendre la créature présente dans un biome : ajouter sa clé à `animals` ou `hostiles` dans `src/data/biomes.ts`.
   L'IA est générique (catégories passive/neutre/hostile) ; un comportement spécial peut être ajouté
   en dérivant `Monster`/`Animal` ou via des handlers d'états personnalisés (voir `Boss.ts`).

### Ajouter un biome
`src/data/biomes.ts`, à la fin de `BIOME_DEFS` (température, humidité, blocs de surface, arbres,
végétation, animaux, monstres, structures, météo, couleurs), puis l'intégrer à la règle de
sélection `BiomeManager.selectLand()` (`src/world/BiomeManager.ts`).

### Ajouter une structure
Dans `src/world/StructureGenerator.ts`, ajouter un objet au tableau `TYPES` :
`{ key, spacing, chance, radius, underground?, anyBiome?, build(w, ox, oz, rng, terrain) }`, puis
ajouter la clé aux `structures` des biomes concernés. Utilisez uniquement `rng` et `terrain`
(fonctions pures) dans `build` pour que la génération reste déterministe entre chunks.

---

## 11. Sauvegardes

`SaveManager` (`src/save/SaveManager.ts`) stocke dans **IndexedDB** (données privées de
l'application Android, incluses dans la sauvegarde automatique Android) :

| Magasin | Contenu |
|---|---|
| `worlds` | nom, seed, date de création, dernière partie, temps de jeu, miniature JPEG, mode, difficulté |
| `states` | position, orientation, inventaire, armure, santé, faim, air, XP, point d'apparition, heure, météo, coffres, compteurs des cages, boss vaincus, progression/succès, combustible, animaux importants |
| `chunks` | uniquement les chunks **modifiés** (RLE), les autres sont régénérés à partir du seed |

API : `save()`, `load()`, `deleteSave()`, `backupSave()` (copie complète d'un monde), `listWorlds()`.

Anti-corruption :
- une seule **transaction atomique** par sauvegarde (état + méta + chunks) ;
- **checksum** FNV-1a de chaque enregistrement ;
- l'état précédent valide est conservé en **copie de secours** ; si l'état principal est corrompu,
  le chargement bascule automatiquement dessus (message affiché) ;
- un chunk corrompu est ignoré (régénéré) plutôt que de bloquer le chargement ;
- demande de stockage persistant (`navigator.storage.persist`).

Moments de sauvegarde : automatique toutes les 60 s, bouton *Sauvegarder* (pause), en quittant,
après la défaite d'un boss, et **quand l'application passe en arrière-plan** (événement Android `pause`).

---

## 12. Optimisation et profils de qualité

| Profil | Distance | Simulation | Particules | Entités | Ombres | Eau | Nuages |
|---|---|---|---|---|---|---|---|
| LOW | 3 chunks | 2 | 150 | 14 | non | simple | non |
| MEDIUM | 5 chunks | 3 | 400 | 24 | blob | animée | oui |
| HIGH | 8 chunks | 4 | 900 | 36 | blob + AO | animée | oui |

- Détection au premier lancement (`DeviceProfiler.ts`) : GPU (Adreno/Mali/PowerVR…), cœurs,
  mémoire, résolution d'écran.
- **Ajustement automatique** : si les FPS restent sous 80 % de la cible, la résolution baisse
  (jusqu'à 55 %), puis la distance de rendu ; elle remonte quand la marge revient.
- Rendu : greedy meshing, faces cachées supprimées, un draw call par chunk et par passe, frustum
  culling, atlas unique, aucune allocation par frame pour les particules (pool fixe), pool de modèles
  de créatures, LOD de simulation (les créatures lointaines sont mises à jour 4× moins souvent,
  au-delà de la distance de simulation elles sont figées).
- Mémoire : géométries des chunks détruites au déchargement, textures/matériaux libérés en quittant
  une partie (vérifié par `npm run e2e:gameplay`), aucun écouteur/timer laissé actif.

Mesures (Chromium headless, CPU de serveur, rendu logiciel — ordre de grandeur uniquement) :
simulation ≈ 0,7 ms/frame en moyenne, meshing ≈ 10 ms/chunk dans le worker, profil MEDIUM :
≈ 120 draw calls et 210 k triangles. Les FPS réels dépendent du GPU du téléphone (non mesurables ici).

---

## 13. Contrôles

**Tactile (paysage)** : joystick dynamique sur la moitié gauche ; glisser à droite pour la caméra ;
**appui long** à droite (ou bouton ⚔ maintenu) = miner/attaquer ; **toucher** à droite (ou ✋) =
poser / ouvrir / manger / utiliser (maintenir pour poser en continu, maintenir puis relâcher avec un arc) ;
⤒ sauter/nager (double appui = voler en créatif) ; ⇩ accroupi (empêche de tomber) ; » sprint ;
`•••` en bout de hotbar = inventaire ; ❚❚ pause ; bouton **Retour Android** = fermer / pause / reprendre.
**Inventaire** : toucher = prendre/poser/échanger le stack (clic gauche), appui long = prendre la moitié /
poser un seul objet (clic droit), double toucher = transfert rapide (Maj + clic), toucher hors de la
fenêtre = jeter ; tenir un stack et glisser sur plusieurs cases = le répartir (après un appui long : un objet par case) ; bouton vert = livre de recettes (toucher une recette remplit la grille, appui long = autant que possible).
Personnalisation : sensibilité, inversion, taille du joystick et des boutons, mode gaucher,
saut automatique, et **déplacement libre des boutons** (Paramètres → Contrôles → Personnaliser).

**Croix directionnelle (classique)** : Options… → Commandes… → « Commandes tactiles : Croix ».
Flèches avant/arrière/gauche/droite, diagonales avant qui apparaissent en avançant, case centrale =
s'accroupir, double appui sur avant = sprint ; on peut glisser d'une flèche à l'autre.

**Clavier/souris** : ZQSD/WASD, Espace, Maj (accroupi), Ctrl (sprint), clic gauche (miner/attaquer),
clic droit (utiliser), molette/1–9 (hotbar), E (inventaire), Q/G (jeter), T ou Entrée (chat),
/ (commande), F3 (diagnostic), **F5 (vue)**, Échap (retour).

**Mouvements (comme le jeu de référence)** : double appui sur avancer (Z/W/↑) = sprint ; saut en
sprint avec élan ; **nage rapide** (sprint la tête sous l'eau : corps à l'horizontale, on suit le
regard pour plonger ou remonter) ; on **rampe** sous un plafond d'un bloc ; poussière soulevée en
sprintant ; les créatures proches suivent le joueur du regard.

**Vues (comme le jeu de référence)** : F5, le bouton 👁 en haut à droite ou la croix ↑ de la manette
font défiler **1re personne → 3e personne de dos → 3e personne de face**. En 3e personne, le modèle
du joueur est affiché (skin `entity/player/wide/steve.png` du pack de ressources si présent, sinon
skin générée), avec l'objet tenu ; la caméra se place à 4 blocs et se rapproche devant un mur. Le viseur
est masqué en vue de face ; les interactions visent toujours depuis les yeux du joueur.

**Manette** (Xbox, PlayStation, manettes Bluetooth Android — API Gamepad, disposition standard) :
détectée dès le premier appui ; les commandes tactiles disparaissent (elles reviennent au premier
toucher de l'écran). Disposition de l'édition console/mobile :

| Commande | En jeu | Menus / inventaire |
|---|---|---|
| Stick gauche | se déplacer (clic : sprint) | déplacer le curseur |
| Stick droit | regarder (clic : s'accroupir ; maintenu en vol : descendre) | faire défiler |
| A | sauter (double appui : voler) | sélectionner / prendre / poser |
| B | lâcher l'objet | retour / fermer |
| X | utiliser | prendre la moitié / poser un seul objet |
| Y | inventaire | déplacement rapide |
| RT / LT | miner-attaquer / utiliser-poser | — |
| LB / RB | objet précédent / suivant | onglets (molette) |
| Croix | ↑ vue, → chat, ↓ lâcher l'objet | déplacement précis du curseur |
| Start / Select | pause / diagnostic | retour |

La sensibilité et l'inversion de l'axe vertical des Paramètres s'appliquent aussi au stick droit.

---

## 14. Tests

```bash
npm test                         # 53 tests unitaires : génération déterministe, biomes (nouveaux biomes,
                                 # plantes hautes, badlands), grottes, recherche de chemin A*,
                                 # mesher/lumière, physique, liquides, inventaire, grilles 2x2/3x3,
                                 # fourneau, formes/orientations, drops, butin, survie, police TrueType,
                                 # sauvegarde/corruption (fake-indexeddb)
npm run build && npm run preview &   # puis, dans un autre terminal :
npm run e2e                      # 39 vérifications pilotées par de vrais événements tactiles (CDP)
npm run e2e:gameplay             # 23 vérifications : agriculture, élevage, fourneau à cases, structures,
                                 # coffres, liquides, lave, météo, apparitions nocturnes, boss, mémoire
npm run e2e:vanilla              # 29 vérifications : dalles, porte, lit et sommeil, seaux, poudre d'os,
                                 # cisailles, échelle, TNT et explosion, sable qui tombe, décomposition des
                                 # feuilles, flèches récupérées, glisser pour répartir, double porte, creeper,
                                 # import/retrait d'un pack de ressources
npm run e2e:addons               # 33 vérifications : import d'un .mcaddon généré (packs imbriqués,
                                 # JSON commenté), blocs/objets/recettes/créature/fonctions d'add-on,
                                 # textures remplacées, commandes, chat, triches, croix directionnelle,
                                 # désactivation (identifiants conservés)
npm run e2e:nether               # 18 vérifications : portail (allumage, cadre cassé), passage, génération,
                                 # ambiance, eau, lit, créatures et colère des piglins, forteresse, retour
                                 # par le portail relié, persistance des blocs du Nether
npm run e2e:mobs                 # 14 vérifications : zombie qui contourne un mur (A*), modèles, loup (apprivoisement, défense), enderman
                                 # (regard, téléportation), échanges, calamar, boule de feu renvoyée,
                                 # flèche de lenteur, village (cloche, villageois)
npm run e2e:movement             # 8 vérifications : sprint au double appui, saut en sprint, poussière,
                                 # nage rapide (pose, vitesse, plongée), ramper, regard des créatures
npm run e2e:end                  # 12 vérifications : œil de l'Ender, fort et 12 cadres, ouverture,
                                 # arrivée, cristaux et dragon, soin et cristal détruit, vide, victoire
                                 # (portail de sortie, œuf), retour à la surface
npm run e2e:doors                # 11 vérifications : plantes hautes (pose, casse, remplacement), portes des 12 essences, trappe, portillon,
                                 # porte en fer (pas à la main), levier, bouton, plaque de pression,
                                 # visée au doigt (bloc posé là où on touche)
npm run e2e:server               # 20 vérifications : file d'attente, arc des bots, : menu Multijoueur, hub (PNJ, bots qui marchent, tableau
                                 # de scores, hub protégé), menu des jeux, Duel (le bot frappe, victoire,
                                 # pièces), SkyWars (cages, coffres, bots armés et ponts), Spleef, carte
                                 # restaurée, TNT Run, Parkour (record), réponses des bots au chat
npm run e2e:paper                # 8 vérifications : plume encrée sur le cadre de papier mâché, voyage,
                                 # terrain et créatures de papier, portail de retour, temple, retour
npm run e2e:multi                # 22 vérifications : deux navigateurs (hôte + invité), liste des parties,
                                 # chunks modifiés, blocs dans les deux sens, chat, créatures, butin, bots,
                                 # coffre partagé, JcJ, déconnexion, serveur autonome
npm run e2e:smp                  # 17 vérifications : connexion, bots qui rejoignent et travaillent, maison
                                 # construite, chat (tu fais quoi, donne, suis-moi), /sethome /home /tpa
                                 # /sell /shop, abattage d'arbre, filon, tombe, sauvegarde des bots
npm run e2e:wither               # 26 vérifications : pas de bloc fantôme, icônes plates, squelette
                                 # wither, invocation, charge, crânes, armure, étoile du Nether, bras
                                 # en 1re personne, pose accroupie, feuilles qui tombent, objets au sol
                                 # en 3D (fusion, ramassage, éclairage), ciel du pack, caméra blessée,
                                 # fragments de blocs texturés, pluie par colonne, shaders et ombres,
                                 # modèle du dragon, yeux lumineux, chute à la mort, lieu de mort
npm run e2e:controls             # 25 vérifications : manette simulée (curseur des menus, déplacement,
                                 # regard, gâchettes poser/casser, LB/RB, saut, inventaire A/B, pause,
                                 # lâcher), vues 1re/3e personne (F5, croix ↑), caméra contre un mur
node scripts/shots-biomes.mjs    # captures des nouveaux biomes ; shots-village.mjs : un village
npm run screens                  # captures 16:9, 20:9, petit écran, tablette, portrait
npm run perf                     # coûts CPU par frame
```
Les scripts Playwright utilisent Chromium (variable `CHROME` pour indiquer un autre binaire).

Scénario E2E couvert : lancement → écran titre → Options → Solo → créer un monde (graine) → génération →
déplacement au joystick → caméra → saut → minage par appui long → ramassage → pose → hotbar →
inventaire à curseur → grille 2×2 (planches) → livre de recettes (table, bâtons) → déplacement d'objet →
table posée et ouverte → grille 3×3 (pioche) →
attaque d'une créature → fuite (IA) → poursuite par un monstre → dégâts reçus → pause (retour) →
simulation figée → reprise → sauvegarde → quitter → **rechargement de la page** → liste des mondes →
reprise de la partie (position, inventaire, blocs modifiés restaurés) → mort → réapparition.

---

## 15. Compatibilité et hors ligne

- **Android 7.0+ (API 24)** minimum, ciblé et testé pour **Android 10+** ; GPU OpenGL ES 3.0 requis
  (WebGL 2, déclaré via `uses-feature`), WebView Android/Chrome ≥ 80 (Web Workers en module).
- Écrans testés en simulation : 16:9 (640×360), 20:9 (800×360, 915×412), petit écran (568×320),
  tablette (1280×800), portrait (412×915). Zones de sécurité (encoches) gérées.
- **Hors ligne** : aucun appel réseau. Une Content-Security-Policy (`index.html`) interdit tout
  chargement ou connexion externe. La permission `INTERNET` est déclarée uniquement parce que le
  WebView Android en a besoin pour servir les fichiers locaux de l'application (`https://localhost`
  intercepté par Capacitor) ; c'est une permission « normale » sans demande à l'utilisateur.
  Autres permissions : `VIBRATE`.

---

## 16. Limites connues / TODO

Ces éléments ne sont **pas** réalisés (ou partiellement) — ils ne sont pas simulés :

- **TODO — test sur un vrai téléphone/émulateur** : l'environnement de build n'offre pas de
  virtualisation (pas de KVM), l'APK a été construit et vérifié (signature, manifeste, contenu) mais
  pas exécuté sur un appareil. Le jeu a été testé dans Chromium, moteur du WebView Android.
- **TODO — ombres portées dynamiques (shadow maps)** : non implémentées (coût élevé sur mobile) ;
  remplacées par l'occlusion ambiante par sommet, la lumière du ciel et des ombres « blob » sous les entités.
  Pas de normal mapping (inutile pour ce style pixel-art).
- **TODO — LOD des chunks lointains et instancing** : la distance de rendu + le brouillard en tiennent lieu ;
  les créatures sont peu nombreuses (pool de modèles au lieu d'instancing).
- **Non reproduits du jeu de référence** (volontairement ou faute de temps) : Creeper et autres créatures
  à design protégé, Nether, End, circuits de redstone, effets des enchantements (ils sont stockés sur
  les objets pour les scripts mais n'agissent pas), alambics, villageois et commerce, feu qui se
  propage, mode multijoueur, Realms. Le briquet n'allume que la TNT. Les blocs de fonction de la
  palette élargie (tonneau, juke-box, métier à tisser…) sont décoratifs.
- **Add-ons** : voir la liste des limites de l'API de script et des add-ons ci-dessus (redstone,
  chevauchement, événements d'entité, structures/biomes générés, contrôleurs de rendu, particules
  et HUD personnalisés).
- **TODO** : rendu 3D du coffre et du lit tenus en main, animation d'ouverture du coffre,
  flèches texturées (pavé coloré actuellement).
- **Mondes de la version 1** : l'identifiant des blocs a changé avec la refonte vanilla ; un ancien
  monde est signalé « incompatible » et peut être **recréé avec la même graine**.
- La lumière est recalculée par chunk avec une marge de 14 blocs : une source lumineuse située à plus
  de 14 blocs du bord d'un chunk voisin n'éclaire pas ce chunk (approximation imperceptible en pratique).
- Un seul Web Worker gère génération et meshing (suffisant pour les profils ciblés).

---

## 17. Dépannage

| Problème | Solution |
|---|---|
| `SDK location not found` | définir `ANDROID_HOME` ou créer `android/local.properties` avec `sdk.dir=…` |
| `Unsupported class file major version` | utiliser le JDK 17 ou 21 (`java -version`) |
| Écran noir « Erreur au démarrage » | l'appareil ne supporte pas WebGL 2 / OpenGL ES 3.0 |
| Le jeu rame | Paramètres → Graphismes → Qualité Basse, distance 2–3, FPS 30 (ou laisser l'ajustement automatique) |
| Les modifications web n'apparaissent pas dans l'APK | relancer `npm run build && npx cap sync android` avant Gradle |
| Débogage du WebView | passer `webContentsDebuggingEnabled: true` dans `capacitor.config.ts`, puis `chrome://inspect` |
