import './styles/main.css';
import { App } from './App';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

const container = document.getElementById('app');
if (container) {
  const app = new App(container);
  app.init();
}
