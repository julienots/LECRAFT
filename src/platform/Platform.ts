import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export interface PlatformHandlers {
  onBack(): void;
  onPause(): void;
  onResume(): void;
}

/**
 * Abstraction plateforme : Android natif via Capacitor (bouton retour, cycle de vie,
 * barre d'état, orientation, vibrations) avec repli navigateur pour le développement.
 */
export class Platform {
  readonly native = Capacitor.isNativePlatform();
  readonly isAndroid = Capacitor.getPlatform() === 'android';

  async init(h: PlatformHandlers) {
    if (this.native) {
      App.addListener('backButton', () => h.onBack());
      App.addListener('pause', () => h.onPause());
      App.addListener('resume', () => h.onResume());
      try {
        await StatusBar.hide();
      } catch {
        /* non disponible */
      }
    } else {
      document.addEventListener('visibilitychange', () => (document.hidden ? h.onPause() : h.onResume()));
      window.addEventListener('pagehide', () => h.onPause());
    }
  }

  async hideSplash() {
    if (this.native) {
      try {
        await SplashScreen.hide();
      } catch {
        /* ignore */
      }
    }
  }

  async setOrientation(o: 'landscape' | 'portrait' | 'auto') {
    if (!this.native) return;
    try {
      if (o === 'auto') await ScreenOrientation.unlock();
      else await ScreenOrientation.lock({ orientation: o });
    } catch {
      /* ignore */
    }
  }

  haptic(kind: 'light' | 'medium' | 'heavy') {
    if (!this.native) {
      navigator.vibrate?.(kind === 'heavy' ? 40 : kind === 'medium' ? 20 : 8);
      return;
    }
    Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {});
  }

  exit() {
    if (this.native) App.exitApp();
  }

  /** Plein écran navigateur (le mode immersif Android est géré nativement dans MainActivity). */
  requestFullscreen() {
    if (this.native) return;
    const d = document.documentElement;
    if (!document.fullscreenElement && d.requestFullscreen && matchMedia('(pointer: coarse)').matches) d.requestFullscreen().catch(() => {});
  }
}
