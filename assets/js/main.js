// Japan Itinerary - Main Entry Point
import './components/Navbar.js'; // Import Web Component
import { ITINERARY } from './modules/config.js';
import { initTheme } from './modules/theme.js';
import { initCountdown } from './modules/countdown.js';
import { initWidgets } from './modules/widgets.js';
import { initCityMap, initOverviewMap, updateMapTheme, centerNavOnActive } from './modules/map.js';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initCountdown();
  
  // Navbar is now handled by the Web Component <travel-nav>
  // We just need to ensure the nav scrolling happens after it renders
  setTimeout(centerNavOnActive, 100);

  // Listen for theme changes dispatched by the Navbar component
  window.addEventListener('theme-changed', () => {
    updateMapTheme();
  });

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