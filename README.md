# LeCraft — sandbox voxel 3D hors ligne pour Android

LeCraft est un jeu sandbox voxel 3D original (exploration, minage, construction, fabrication,
combat, créatures, donjons, boss) conçu pour **Android** et livré sous forme d'**APK**.
Le moteur est écrit en **TypeScript + Three.js (WebGL 2)** et embarqué dans une application
Android native via **Capacitor**. **Tout fonctionne hors ligne** : terrain, textures, modèles,
sons, musique, recettes et sauvegardes sont générés ou stockés localement.

> Identité originale : aucune texture, aucun son, aucun modèle, aucun nom ni code provenant de
> Minecraft. Toutes les textures (atlas 16×16), icônes, modèles de créatures, sons et musiques
> sont **générés procéduralement par le code du jeu**.

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
| Biomes (14) | plaine, forêt, forêt dense, désert, jungle, savane, marais, montagne, taïga, toundra, plage, océan, rivière, zone glacée — data-driven, teinte d'herbe/feuillage par biome |
| Grottes | salles géantes, grands tunnels, petits tunnels, gouffres, lacs souterrains d'eau, lave en profondeur, minerais visibles, mousse et champignons lumineux, géodes de cristal |
| Blocs (68) | dont air, terre, herbe, pierre, sable, gravier, bois, feuilles, planches, verre, eau, lave, neige, glace, charbon, cuivre, fer, or, cristal rare, minerai d'aurite… |
| Rendu | Face culling, **greedy meshing**, atlas de textures, occlusion ambiante par sommet, éclairage ciel + blocs lissé, frustum culling, brouillard, eau/lave animées, végétation animée, ciel dégradé, soleil/lune/étoiles, nuages, particules, ombres « blob » des entités |
| Interaction | Raycast DDA, contour du bloc visé, fissures + anneau de progression, appui long = miner, toucher = poser/utiliser, prévisualisation verte/rouge, orientation des blocs |
| Inventaire | Hotbar 9 + 27 cases + 4 armures ; empiler, séparer (appui long), déplacer, jeter, détruire, équiper, manger, transférer avec un coffre |
| Fabrication | 82 recettes data-driven (142 objets) (main, établi, four avec combustible), outils bois→pierre→cuivre→fer→or→aurite, armures, arc et flèches, boussoles |
| Combat | Cadence d'attaque, dégâts par arme, critiques en chute, recul, invincibilité temporaire, armure, faiblesses des boss, projectiles |
| Créatures (13) | 4 animaux de ferme, ours (neutre), rôdeur nocturne, arachne des cavernes, gelée (se divise), archer d'os, spectre cristallin, chef rôdeur (mini-boss), 2 boss |
| IA | Entity → AIController → StateMachine (IDLE, WANDER, FOLLOW, CHASE, ATTACK, FLEE, SEARCH, RETURN, DEAD), ligne de vue, évitement des falaises et de la lave, LOD de simulation |
| Boss | **Golem des profondeurs** (3 phases : coups, bond + onde de choc, rochers, invocations ; faible aux pioches) ; **Liche de givre** (3 phases : éclats de glace ralentissants, téléportation, anneau de projectiles, pics de glace, spectres ; faible à l'or) — arènes dédiées, barre de vie, butin unique |
| Structures | villages, maisons abandonnées, ruines, tours (escalier), temples (piège + salle cachée), sanctuaire de givre, camps, mines, donjons (salles, couloirs, pièges, cages, coffres, chef), repaire du golem |
| Monde vivant | Cycle jour/crépuscule/nuit/aube, pluie, orage avec éclairs/tonnerre, neige selon le biome, eau et lave qui s'écoulent (sources infinies, obsidienne), sable/gravier qui tombent, plantes qui exigent un support |
| Agriculture / élevage | Houe, terre cultivable (hydratation), blé et carottes (croissance selon lumière, eau, pluie), pousses → arbres ; nourrir, attirer, reproduire, bébés qui grandissent |
| Progression | XP et niveaux (cœurs bonus), 18 succès, statistiques, biomes visités, collection d'objets rares |
| Sauvegarde | IndexedDB, plusieurs mondes (nom, seed, date, temps de jeu, miniature), sauvegarde auto/manuelle/à la mise en arrière-plan, checksums, copie de secours automatique, copie manuelle d'un monde |
| Interface | Menu principal (logo et paysage générés), mondes, nouveau monde, paramètres (graphismes/contrôles/audio/gameplay), aide, crédits, pause, mort, progression, éditeur de position des boutons |
| Audio | 87 effets synthétisés (blocs par matériau, pas, armes, créatures, météo, menus), ambiances (vent, oiseaux, grillons, grotte, pluie), musique générative jour/nuit/menu |
| Performance | Détection LOW/MEDIUM/HIGH (GPU, cœurs, mémoire, écran), ajustement dynamique de la résolution puis de la distance, limitation 30/45/60 FPS, pools (modèles, particules), libération des ressources WebGL |

Les éléments **non réalisés** sont listés honnêtement dans [Limites connues / TODO](#16-limites-connues--todo).

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
│   │               FluidSimulator.ts, WorldTicker.ts, DayCycle.ts, Weather.ts
│   ├── blocks/     Block.ts, BlockRegistry.ts, BlockBehaviors.ts (drops, minage, butin)
│   ├── player/     Player.ts, PlayerController.ts, PlayerPhysics.ts, PlayerInteraction.ts
│   ├── inventory/  Inventory.ts, Item.ts, ItemRegistry.ts
│   ├── crafting/   Recipe.ts, RecipeRegistry.ts, CraftingSystem.ts
│   ├── entities/   Entity.ts, EntityManager.ts, Mob.ts, Animal.ts, Monster.ts, Boss.ts,
│   │               ItemEntity.ts, Projectile.ts, Physics.ts
│   ├── ai/         AIController.ts, StateMachine.ts
│   ├── combat/     CombatSystem.ts, DamageSystem.ts
│   ├── render/     Renderer.ts, ChunkMesher.ts, Lighting.ts, ChunkMaterial.ts, Padded.ts,
│   │               TextureGenerator.ts, TileRegistry.ts, TextureManager.ts, Sky.ts, MobModels.ts,
│   │               ParticleSystem.ts, WeatherRenderer.ts, BlockHighlight.ts, HeldItem.ts
│   ├── input/      InputState.ts, TouchController.ts, VirtualJoystick.ts, KeyboardMouse.ts
│   ├── save/       SaveManager.ts, WorldSerializer.ts
│   ├── ui/         UIManager.ts, HUD.ts, Screens.ts (menus), SettingsUI.ts, InventoryUI.ts,
│   │               MenuArt.ts, IconTemplates.ts, dom.ts, styles.css
│   ├── audio/      AudioManager.ts, Synth.ts
│   ├── platform/   Platform.ts (Capacitor : retour, cycle de vie, orientation, vibrations)
│   └── workers/    world.worker.ts, protocol.ts
├── android/                   # projet Android (Gradle) généré par Capacitor et personnalisé
│   └── app/src/main/java/com/lecraft/game/MainActivity.java  (plein écran immersif)
├── scripts/                   # e2e.mjs, e2e-gameplay.mjs, perf.mjs, screens.mjs, tour.mjs,
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
`src/data/recipes.ts` :
```ts
r('ruby_block', 1, 'table', ['ruby', 9]),
r('stew', 1, 'furnace', ['raw_meat', 1], ['carrot', 2]),   // le four consomme 1 unité de combustible
```
Stations : `hand`, `table`, `furnace`. Groupes interchangeables : `tag:log`, `tag:coal` (table `TAGS`).

### Ajouter une créature
1. `src/data/mobs.ts`, à la fin de `MOB_DEFS` : santé, dégâts, vitesse, `detectionRange`,
   `attackRange`, `attackCooldown`, `drops`, `xp`, `food` (reproduction), `ranged`, `traits`
   (`burnsInSun`, `climbs`, `hops`, `flies`, `splits`, `knockbackResist`), `spawn`
   (`where: 'surface' | 'cave'`, `light`, `group`, `weight`), `sounds`, `weakness`.
2. Modèle dans `src/render/MobModels.ts` (`MODELS.maCreature = () => quadruped({...})` ou `humanoid({...})`).
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
Personnalisation : sensibilité, inversion, taille du joystick et des boutons, mode gaucher,
saut automatique, et **déplacement libre des boutons** (Paramètres → Contrôles → Personnaliser).

**Clavier/souris** : ZQSD/WASD, Espace, Maj (accroupi), Ctrl (sprint), clic gauche (miner/attaquer),
clic droit (utiliser), molette/1–9 (hotbar), E (inventaire), G (jeter), F3 (diagnostic), Échap (retour).

---

## 14. Tests

```bash
npm test                         # 36 tests unitaires : génération déterministe, biomes, grottes,
                                 # mesher/lumière, physique, liquides, inventaire, recettes, drops,
                                 # butin, survie, sauvegarde/corruption (fake-indexeddb)
npm run build && npm run preview &   # puis, dans un autre terminal :
npm run e2e                      # 37 vérifications pilotées par de vrais événements tactiles (CDP)
npm run e2e:gameplay             # 21 vérifications : agriculture, élevage, four, structures, coffres,
                                 # liquides, lave, météo, apparitions nocturnes, boss à phases, mémoire
npm run screens                  # captures 16:9, 20:9, petit écran, tablette, portrait
npm run perf                     # coûts CPU par frame
```
Les scripts Playwright utilisent Chromium (variable `CHROME` pour indiquer un autre binaire).

Scénario E2E couvert : lancement → menu → paramètres → nouveau monde (seed) → génération →
déplacement au joystick → caméra → saut → minage par appui long → ramassage → pose → hotbar →
inventaire → fabrication (planches, établi, pioche) → déplacement d'objet → établi posé et ouvert →
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
- **TODO** : seau (transporter l'eau/la lave), portes, échelles, escaliers et dalles, lits,
  villageois (PNJ), décomposition des feuilles, animation de chute du sable (la chute est instantanée),
  récupération des flèches tirées, enchantements, mode multijoueur.
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
