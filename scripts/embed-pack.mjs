// Intègre un pack de ressources Java à VOTRE copie locale de l'application (pack par défaut).
// Usage : npm run pack:embed -- chemin/vers/pack.zip   (retrait : npm run pack:embed -- --remove)
// Le fichier public/default-pack.zip est ignoré par git : ne le publiez pas, les textures du
// jeu de référence restent la propriété de leur éditeur.
import { chmodSync, copyFileSync, existsSync, rmSync, statSync } from 'node:fs';
const arg = process.argv[2];
const dest = new URL('../public/default-pack.zip', import.meta.url);
if (!arg) {
  console.error('Usage : npm run pack:embed -- <pack.zip> | --remove');
  process.exit(1);
}
if (arg === '--remove') {
  if (existsSync(dest)) rmSync(dest);
  console.log('Pack par défaut retiré.');
} else {
  copyFileSync(arg, dest);
  chmodSync(dest, 0o644);
  console.log(`Pack par défaut intégré (${(statSync(dest).size / 1e6).toFixed(1)} Mo). Relancez npm run build puis la construction de l'APK.`);
}
