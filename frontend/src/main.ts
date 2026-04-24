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
import { initCityMap, initOverviewMap, updateMapTheme, centerNavOnActive } from '@/modules/map';

// ============================================
// Application Initialization
// ============================================

/**
 * Initialize the application
 */
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
  window.addEventListener('theme-changed', updateMapTheme);

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
    initOverviewMap();
    return;
  }
  
  if (page && page in ITINERARY) {
    initCityMap(page);
    initWidgets(page);
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
