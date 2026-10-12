import './styles/main.css';
import './styles/landing.css';
import { renderLandingPage } from './LandingPage';
import { renderSourcesQualityPage } from './SourcesQualityPage';
import { registerSW } from 'virtual:pwa-register';
import { initI18n } from './services/i18n.ts';
import { shouldRenderLanding as isLandingRoute } from './services/ui-mode.ts';
import { isStaleChunkError, shouldReloadForStaleChunk } from './utils/stale-chunk.ts';

// `App` (et toute la pile carte : maplibre-gl, deck.gl, d3…) n'est chargé que
// lorsque la route tableau de bord est effectivement rendue. La landing et la
// page sources & qualité restent sur ce chemin léger (pas de modulepreload
// de la carte pour ces routes).
async function renderDashboard(container: HTMLElement): Promise<void> {
  document.documentElement.classList.remove('fm-landing-mode');
  document.body.classList.remove('fm-landing-mode');
  const { App } = await import('./App');
  const app = new App(container);
  await app.init();
}

// Stale-chunk guard : voir utils/stale-chunk.ts. Rechargement à chaque nouveau déploiement,
// mais jamais deux fois en moins de 30 s (une boucle signalerait un autre problème).
function installChunkReloadGuard(): void {
  const KEY = 'fm-chunk-reload';
  const reload = (): boolean => {
    try {
      if (!shouldReloadForStaleChunk(sessionStorage.getItem(KEY), Date.now())) return false;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      return false; // stockage bloqué : pas de garde anti-boucle, donc pas de rechargement auto
    }
    window.location.reload();
    return true;
  };
  window.addEventListener('vite:preloadError', (e) => {
    if (reload()) e.preventDefault();
  });
  window.addEventListener('error', (e) => {
    if (isStaleChunkError(e.message ?? '')) reload();
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const msg = String((e.reason as { message?: string } | null)?.message ?? '');
    if (isStaleChunkError(msg)) reload();
  });
}

installChunkReloadGuard();
registerSW({ immediate: true });

function shouldRenderLanding(): boolean {
  const { pathname, search, hash } = new URL(window.location.href);
  return isLandingRoute(pathname, search, hash);
}

function shouldRenderSourcesQuality(): boolean {
  return new URL(window.location.href).pathname === '/sources-quality';
}

void initI18n().then(() => {
  const container = document.getElementById('app');
  if (container) {
    if (shouldRenderSourcesQuality()) {
      renderSourcesQualityPage(container);
    } else if (shouldRenderLanding()) {
      renderLandingPage(container);
    } else {
      void renderDashboard(container);
    }
  }
});
