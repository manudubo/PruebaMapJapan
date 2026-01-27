import './styles/main.css'; // Importante: Carga los estilos globales
import './components/Navbar';
import { ITINERARY } from './data/itinerary';
import { initTheme } from './modules/theme';
import { initCountdown } from './modules/countdown';
import { initWidgets } from './modules/widgets';
import { initCityMap, initOverviewMap, updateMapTheme, centerNavOnActive } from './modules/map';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initCountdown();
  setTimeout(centerNavOnActive, 100);

  // Register PWA Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW Fail', err));
  }

  // Event Listeners
  window.addEventListener('theme-changed', updateMapTheme);

  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  const page = mapEl.dataset.city;
  if (page === 'overview') {
    initOverviewMap();
  } else if (page && ITINERARY[page]) {
    initCityMap(page);
    initWidgets(page);
  }
});