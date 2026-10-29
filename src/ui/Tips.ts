/** Astuces de l'écran de chargement (une au hasard à chaque chargement), dans l'esprit du jeu de référence. */
export const TIPS: string[] = [
  "C’est une excellente idée de construire un endroit sûr où passer la nuit.",
  "Utilisez l’outil approprié pour le travail ! Couper du bois avec une hache est bien plus rapide que d’utiliser vos mains.",
  "Même dans LeCraft, vous ressentirez de la faim, alors essayez de trouver quelque chose à manger avant que ça n’arrive.",
  "Dormir dans un lit pendant la nuit fait passer le temps jusqu’au matin et définit votre point de réapparition.",
  "Les créatures hostiles apparaissent dans l’obscurité. Posez des torches pour éclairer vos constructions et leurs alentours.",
  "Les creepers explosent quand ils s’approchent de vous. Gardez vos distances, ou frappez-les puis reculez !",
  "Ne creusez jamais droit vers le bas : vous pourriez tomber dans une grotte, ou pire, dans de la lave.",
  "Le sable et le gravier tombent s’ils ne sont pas soutenus. Faites attention en creusant dessous.",
  "Un seau d’eau éteint le feu, et en poser un à l’atterrissage annule les dégâts de chute.",
  "Faites cuire la viande crue dans un fourneau : elle rassasie davantage et ne risque pas de vous rendre malade.",
  "Les moutons donnent de la laine quand on les tond avec des cisailles. Teignez-les pour changer leur couleur.",
  "Les poules pondent des œufs, et les vaches donnent du lait quand on utilise un seau sur elles.",
  "Nourrissez deux animaux de la même espèce avec leur nourriture favorite pour qu’ils aient un petit.",
  "Apprivoisez un loup avec des os : il vous suivra et vous défendra. Un chat se gagne avec du poisson cru.",
  "Les diamants se trouvent en profondeur, souvent près de la lave. Prenez une pioche en fer et de quoi vous éclairer.",
  "La table de fabrication ouvre une grille 3×3 : toutes les recettes d’outils, d’armes et d’armures s’y fabriquent.",
  "Les enchantements améliorent vos outils, vos armes et vos armures. Il faut des niveaux d’expérience et des lapis-lazuli.",
  "Un coffre sert à ranger vos objets. Deux coffres côte à côte forment un grand coffre.",
  "Placez un panneau pour marquer un endroit, ou un lit pour retrouver votre chemin après un voyage.",
  "Un portail du Nether se construit avec de l’obsidienne et s’allume avec un briquet. Il relie deux mondes très différents.",
  "Dans le Nether, un pas vaut huit pas à la surface : c’est un excellent raccourci pour voyager.",
  "Les arbres donnent du bois, des pommes et des pousses. Replantez toujours une pousse après avoir abattu un arbre.",
  "Les cultures poussent plus vite près de l’eau. Labourez la terre avec une houe avant de semer vos graines.",
  "Les villageois échangent des émeraudes contre des objets. Chaque métier propose des offres différentes.",
  "Mangez pour récupérer de la santé : votre barre de faim doit être bien remplie pour que vous régénériez.",
  "Une pioche en fer permet de miner l’or et les diamants ; une pioche en bois ne suffit pas.",
  "Les pistons, la poudre de redstone et les leviers permettent de construire de vraies machines.",
  "Les squelettes tirent à distance : avancez en zigzag, ou approchez-vous à couvert derrière des blocs.",
  "Appuyez longuement sur un bloc pour le casser. L’outil adapté le casse beaucoup plus vite.",
  "Le TNT explose en chaîne avec ses voisins. Mettez-vous à l’abri avant de l’allumer.",
  "Vous pouvez glisser vos objets dans l’inventaire : touchez pour prendre, touchez pour poser, appui long pour en prendre la moitié.",
];

/** Astuce aléatoire (différente de la précédente quand c'est possible). */
let last = -1;
export function randomTip(): string {
  let i = Math.floor(Math.random() * TIPS.length);
  if (i === last) i = (i + 1) % TIPS.length;
  last = i;
  return TIPS[i];
}
