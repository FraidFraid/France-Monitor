import './styles/main.css';
import { App } from './App';
import { registerSW } from 'virtual:pwa-register';

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

const container = document.getElementById('app');
if (container) {
  const app = new App(container);
  app.init();
}
