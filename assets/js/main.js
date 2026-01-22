// Japan Itinerary - Main Entry Point (Modular Refactor)
import { ITINERARY } from './modules/config.js';
import { initTheme, toggleTheme } from './modules/theme.js';
import { initCountdown } from './modules/countdown.js';
import { initWidgets } from './modules/widgets.js';
import { initCityMap, initOverviewMap, updateMapTheme, centerNavOnActive } from './modules/map.js';

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initCountdown();
  setTimeout(centerNavOnActive, 100);

  const themeBtn = document.querySelector('.theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      toggleTheme();
      updateMapTheme();
    });
  }

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
