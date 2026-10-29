import './ui/styles.css';
import { Game } from './core/Game';
import { initBedrockScale, setBedrockClick } from './ui/Bedrock';

/** Point d'entrée : démarre le jeu et expose une API de diagnostic (tests automatisés). */
async function start() {
  const root = document.getElementById('app')!;
  try {
    initBedrockScale();
    const game = new Game(root);
    setBedrockClick(() => game.audio.play('click', { volume: 0.5 }));
    (window as unknown as { __lecraft: Game }).__lecraft = game;
    await game.boot();
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="screen"><div class="panel dialog"><h2>Erreur au démarrage</h2><p>${String((e as Error)?.message ?? e)}</p><p class="muted">Votre appareil doit supporter WebGL 2.</p></div></div>`;
  }
}
void start();
