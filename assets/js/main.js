import './components/Navbar.js';
import { ITINERARY } from './data/itinerary.js';
import { initTheme, toggleTheme } from './modules/theme.js';
import { initCountdown } from './modules/countdown.js';
import { initWidgets } from './modules/widgets.js';
import { initCityMap, initOverviewMap, updateMapTheme, centerNavOnActive } from './modules/map.js';

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