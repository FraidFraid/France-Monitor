import './styles/main.css';
import './styles/landing.css';
import { App } from './App';
import { renderLandingPage } from './LandingPage';
import { registerSW } from 'virtual:pwa-register';
import { initI18n } from './services/i18n.ts';

// Stale-chunk guard: after a new deploy, old hashed JS chunks are gone.
// Dynamic imports fail with "Failed to fetch dynamically imported module".
// Reloading picks up the new SW and fresh chunks automatically.
function installChunkReloadGuard(): void {
  const reload = (): void => {
    if (!sessionStorage.getItem('fm-chunk-reload')) {
      sessionStorage.setItem('fm-chunk-reload', '1');
      window.location.reload();
    }
  };
  window.addEventListener('error', (e) => {
    const msg = e.message ?? '';
    if (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed') ||
      msg.includes('Unable to preload CSS')
    ) {
      reload();
    }
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const msg = String((e.reason as { message?: string } | null)?.message ?? '');
    if (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed')
    ) {
      reload();
    }
  });
}

installChunkReloadGuard();
registerSW({ immediate: true });

function shouldRenderLanding(): boolean {
  const { pathname, searchParams, hash } = new URL(window.location.href);
  if (searchParams.get('view') === 'app') {
    return false;
  }
  return pathname === '/' && hash === '';
}

void initI18n().then(() => {
  const container = document.getElementById('app');
  if (container) {
    if (shouldRenderLanding()) {
      renderLandingPage(container);
    } else {
      document.documentElement.classList.remove('fm-landing-mode');
      document.body.classList.remove('fm-landing-mode');
      const app = new App(container);
      void app.init();
    }
  }
});
