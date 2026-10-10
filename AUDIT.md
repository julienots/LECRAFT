# Audit LeCraft v2.25 — diagnostic et corrections

Audit du jeu existant mené selon la mission « finaliser et polir le jeu voxel existant ».
Le moteur et l'architecture n'ont pas changé : TypeScript, Three.js (WebGL), Vite, Capacitor
pour Android, sauvegarde IndexedDB. Aucun fichier, asset, son ou fonctionnalité n'a été
supprimé. La seule exception est une recette qui ne pouvait jamais être fabriquée (voir le
tableau) : elle est remplacée par la mécanique d'origine du jeu.

## Méthode

1. **Lecture du code** par systèmes :
   - conteneurs, supports d'armure, sauvegarde, fuites mémoire ;
   - options, menus, recettes, audio.
2. **Vérifications automatiques existantes** :
   - 15 suites de tests de bout en bout dans un vrai navigateur (Chromium, rendu logiciel),
     avec plus de 300 vérifications ;
   - 14 fichiers de tests unitaires.
3. **Nouveaux tests** pour chaque correction :
   - `tests/recipes.test.ts` : chaque recette est réellement fabricable ;
   - `scripts/e2e-audit.mjs` : support d'armure, armure, tonneau, fourneau, citrouille,
     sauvegarde puis rechargement.

## Tableau de diagnostic

| Système | État constaté | Problème concret | Correction | Priorité | Test de confirmation |
|---|---|---|---|---|---|
| Sauvegarde : créatures | cassé | Au chargement, seules les créatures des chunks déjà chargés réapparaissaient. Les autres (animaux apprivoisés ou nommés plus loin) étaient **perdues définitivement**. | Les créatures restantes attendent le chargement de leur chunk. | P0 | e2e Chargement, e2e-audit Rechargement |
| Sauvegarde : créatures en attente | cassé | Une sauvegarde faite juste après le chargement (pause, portail) écrivait une liste de créatures vide. | Le snapshot inclut les créatures en attente. | P0 | relecture + e2e-audit |
| Sauvegarde en chaîne | cassé | L'échec d'une sauvegarde bloquait toutes les suivantes (l'erreur était relancée). | L'erreur précédente n'empêche plus la sauvegarde suivante. | P0 | relecture |
| Quitter / portail après un échec de sauvegarde | cassé | L'erreur était ignorée : quitter ou changer de dimension jetait les chunks non sauvegardés. | Nouvelle tentative de sauvegarde. Si elle échoue encore : confirmation avant de quitter, et voyage par portail annulé. | P0 | relecture |
| Fourneau cassé ou explosé | cassé | Entrée, combustible et résultat **détruits**. | Le contenu est lâché au sol, comme pour le coffre. | P0 | e2e-audit « Fourneau cassé » |
| Coffre de structure explosé | partiel | Le butin jamais ouvert disparaissait. | Le butin est tiré au sort et lâché. | P1 | relecture |
| Serveurs (HypXL, SMP) en quittant | cassé | Les minuteries continuaient après la sortie : messages de bots dans le chat du monde suivant, partie de mini-jeu non restaurée. | `dispose()` sur les deux serveurs, appelé en quittant le monde. | P1 | e2e-server, e2e-smp |
| Tonnerre après avoir quitté | cassé | Le son du tonnerre programmé jouait encore après la sortie. | Minuterie annulée en quittant. | P2 | relecture |
| Tonneau, boîtes de shulker | manquant | Texture présente mais aucune interface. | 27 cases comme un coffre, sauvegardées, contenu lâché à la casse. | P2 | e2e-audit « Tonneau » + rechargement |
| Fumoir, haut fourneau | manquant | Aucune interface. | Interface et cuisson du fourneau. | P2 | relecture + unitaires fourneau |
| Support d'armure | manquant | Objet uniquement : il ne pouvait pas être posé. | Entité complète, voir la description plus bas. | P2 | e2e-audit (6 vérifications) |
| Armure portée | manquant | Aucune armure n'était dessinée sur le joueur ni sur les modèles. | Calques d'armure : textures du pack (`entity/equipment`), cuir teinté, version peinte sans pack. | P2 | e2e-audit « Armure du joueur » |
| Recettes infabricables | cassé | Masse du golem (motif mal centré). Boîtes de shulker colorées (la blanche gagnait toujours). Ardoise des abîmes polie (masquée par les briques). Citrouille sculptée (masquée par les graines). | Motif corrigé. Teinture avec boîte + colorant. Briques d'ardoise à partir d'ardoise polie, comme le jeu original. Citrouille sculptée avec des **cisailles sur une citrouille**, comme le jeu original. | P1 | `tests/recipes.test.ts` (toutes les recettes) |
| Sons silencieux | cassé | `break` (abattage du SMP) et `whoosh` (gadget HypXL) n'existaient pas. | Remplacés par des sons existants. | P3 | relecture |
| Coffre : son de fermeture | manquant | Son à l'ouverture seulement. | Son « couvercle » synthétisé, remplaçable par le pack. | P3 | relecture |
| Son d'équipement d'armure | manquant | Aucun son. | Cliquetis synthétisé, remplaçable par le pack. | P3 | relecture |
| Option Particules « Minimales » | cassé | Aucune particule (limite 0). | Quelques particules gardées (40), comme le jeu original. | P2 | relecture |
| Option Ombres | partiel | « Entités » et « Entités + OA » donnaient le même rendu. | Occlusion ambiante pleine seulement avec « + OA ». | P3 | relecture |
| Option Résolution | partiel | Le curseur descendait à 50 % alors que le moteur plafonne à 75 % : sans effet sous 75 %. | Curseur de 75 à 100 %. | P3 | relecture |
| Profil de qualité « Basse » | partiel | Les shaders restaient actifs. | Shaders coupés en profil Bas. | P3 | relecture |
| Disposition des boutons | cassé | Retour / Échap ne fermait pas l'éditeur. | Retour = « Terminer ». | P2 | relecture |
| Modifier le monde | cassé | « Activer les triches » était modifié même en cliquant « Annuler ». | Appliqué seulement par « Enregistrer ». | P2 | relecture |
| Recréer un monde | partiel | Perdait les réglages triches et bots. | Les mêmes options sont reprises. | P3 | relecture |
| Quitter le jeu (navigateur) | cassé | Le bouton ne faisait rien dans un navigateur. | Bouton affiché seulement dans l'application. | P3 | relecture |
| Test « double toucher » | test fragile | Échouait avec le pack (aussi en v2.24) : le test créait le 2e toucher après la fin du traitement du 1er. Aucun objet n'était perdu (planches sur le curseur). | Événements horodatés d'avance, comme un vrai écran. | — | e2e : 39/39 |

### Support d'armure

- Il se pose avec l'objet « Support d'armure » sur le dessus d'un bloc, face au joueur.
- Toucher avec une pièce d'armure l'équipe. Si une pièce occupait déjà cette place, elle est
  échangée et revient en main.
- Toucher la main vide reprend une pièce.
- Le modèle est la géométrie officielle avec la texture du pack.
- Un coup le casse : il rend le support et toute son armure.
- Il est sauvegardé avec son armure.

## Systèmes vérifiés fonctionnels (sans modification)

Les suites de tests e2e couvrent :

- Démarrage et menus.
- Création de monde et génération.
- Déplacements tactiles, saut, nage.
- Minage, pose, drops et ramassage.
- Inventaire à curseur, fabrication 2×2 et 3×3, livre de recettes.
- Fourneau.
- Portes, trappes, leviers, plaques.
- Lits, seaux, agriculture.
- Créatures (IA de poursuite et de fuite, creeper, reproduction).
- Combat, mort et réapparition.
- Sauvegarde et rechargement (position, inventaire, blocs).
- Nether, End, dragon, Wither, dimension Pâte à papier.
- Structures, météo, explosions.
- Packs de ressources et add-ons.
- Multijoueur réseau, serveur HypXL, serveur SMP.
- Aucune erreur dans la console du navigateur.

## Limites levées en v2.26

Toutes les limites listées en v2.25 sont maintenant traitées et testées
(`scripts/e2e-stations.mjs`, 21 vérifications ; `tests/magic.test.ts`) :

- **Table d'enchantement, enclume, alambic** : interfaces et systèmes complets (enchantements,
  réparation et fusion, potions).
- **Distributeur, dropper, entonnoir** : inventaires, redstone et transferts.
- **Coffre de l'Ender** : inventaire personnel partagé et sauvegardé.
- **Boîte de shulker** : elle garde son contenu.
- **Couvercle du coffre** : animé.
- **Langue** : français / anglais pour les menus, les interfaces et les noms d'objets.
- **Touches clavier** : réassignables.

## Limites restantes

- **Sons réels** : le pack fourni ne contient aucun son. Les vrais cris des animaux sont
  utilisés dès qu'un pack contenant `sounds/mob/...` est importé (Options › Packs de
  ressources). Sans cela, les sons restent synthétisés par le jeu.
- **Langue anglaise** : les messages du chat des serveurs intégrés (bots, HypXL) restent en
  français.
- **Redstone** : simplifiée. Il n'y a pas de poudre de redstone conductrice ; les sources
  (levier, bouton, plaque) agissent sur les blocs voisins.
