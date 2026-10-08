/**
 * Japan Itinerary 2026 - Main Entry Point
 * 
 * Features:
 * - Interactive maps with Leaflet
 * - Global search across all activities and locations
 * - Weather, news, and events widgets
 * - Light/dark theme support
 * - PWA with offline support
 * - Fully accessible (WCAG 2.1)
 */

// Import styles
import './styles/main.css';

// Import components
import './components/Navbar';
import './components/SearchBar';

// Import modules
import { ITINERARY } from '@/data/itinerary';
import { initTheme } from '@/modules/theme';
import { initCountdown } from '@/modules/countdown';
import { initWidgets } from '@/modules/widgets';
import { centerNavOnActive } from '@/modules/nav';
import { observeOverviewMap } from '@/modules/overviewLazy';

// ============================================
// Application Initialization
// ============================================

/**
 * Initialize the application
 */
// Leaflet-backed map code, loaded lazily so the landing hero never waits for it.
let mapModule: typeof import('@/modules/map') | null = null;

function init(): void {
  // Initialize theme first for smooth loading
  initTheme();
  
  // Initialize countdown on index page
  initCountdown();
  
  // Center navigation on active item
  requestAnimationFrame(() => {
    setTimeout(centerNavOnActive, 100);
  });

  // Register PWA Service Worker
  registerServiceWorker();

  // Setup event listeners
  // Leaflet is loaded on demand (see initializeMap): only retheme once it is there.
  window.addEventListener('theme-changed', () => mapModule?.updateMapTheme());

  // Initialize map based on current page
  initializeMap();
  
  // Log initialization complete
  if (import.meta.env.DEV) {
    console.log('🇯🇵 Japan Itinerary 2026 initialized');
  }
}

/**
 * Register Service Worker for PWA functionality
 */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  // Only register in production
  if (import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js')
      .then(registration => {
        if (import.meta.env.DEV) {
          console.log('SW registered:', registration.scope);
        }
      })
      .catch(err => {
        console.warn('Service Worker registration failed:', err.message);
      });
  }
}

/**
 * Initialize the appropriate map for the current page
 */
function initializeMap(): void {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  const page = mapEl.dataset.city;
  
  if (page === 'overview') {
    // Landing demo: below the fold, so it must not compete with the hero (LCP).
    observeOverviewMap(mapEl, () => {
      void import('@/modules/overviewMap').then((m) => m.initOverviewMap(mapEl, document.getElementById('overview-cities')));
    });
    return;
  }
  
  if (page && page in ITINERARY) {
    initWidgets(page);
    void import('@/modules/map').then((m) => {
      mapModule = m;
      m.initCityMap(page);
    });
  }
}

// ============================================
// Bootstrap
// ============================================

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for testing
export { init, registerServiceWorker, initializeMap };
