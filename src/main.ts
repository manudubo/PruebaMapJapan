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
 * Check if running in production
 */
function isProduction(): boolean {
  return window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
}

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
  
  // Handle search navigation params after map is initialized
  handleSearchParams();
  
  // Log initialization complete
  if (!isProduction()) {
    console.log('🇯🇵 Japan Itinerary 2026 initialized');
  }
}

/**
 * Register Service Worker for PWA functionality
 */
function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  // Only register in production
  if (isProduction()) {
    navigator.serviceWorker.register('./sw.js')
      .then(registration => {
        if (!isProduction()) {
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

/**
 * Handle search navigation params (day selection and map focus)
 * URL params: ?day=YYYY-MM-DD&focus=lat,lng
 */
function handleSearchParams(): void {
  const params = new URLSearchParams(window.location.search);
  const dayParam = params.get('day');
  const focusParam = params.get('focus');
  
  // Select the day if specified
  if (dayParam) {
    selectDay(dayParam);
  }
  
  // Focus on coordinates if specified
  if (focusParam) {
    const coords = parseCoords(focusParam);
    if (coords) {
      focusMapOnCoords(coords);
    }
  }
  
  // Clean URL params after processing (optional)
  if (dayParam || focusParam) {
    cleanUrlParams();
  }
}

/**
 * Select a day by clicking its button
 */
function selectDay(dateKey: string): void {
  const dayBtn = document.querySelector(`.day-btn[data-day="${dateKey}"]`) as HTMLButtonElement | null;
  
  if (dayBtn) {
    // Small delay to ensure map is fully initialized
    setTimeout(() => {
      dayBtn.click();
    }, 200);
  }
}

/**
 * Parse coordinates from string "lat,lng"
 */
function parseCoords(coordsStr: string): [number, number] | null {
  const parts = coordsStr.split(',');
  if (parts.length !== 2) return null;
  
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);
  
  if (isNaN(lat) || isNaN(lng)) return null;
  
  return [lat, lng];
}

/**
 * Focus map on specific coordinates
 */
function focusMapOnCoords(coords: [number, number]): void {
  // Access the map from window (set in map.ts)
  const map = (window as unknown as { currentMap?: L.Map }).currentMap;
  
  if (map) {
    // Delay to allow day selection to complete first
    setTimeout(() => {
      map.setView(coords, 16, { animate: true });
    }, 500);
  }
}

/**
 * Clean URL params without page reload
 */
function cleanUrlParams(): void {
  const url = new URL(window.location.href);
  url.search = '';
  window.history.replaceState({}, '', url.toString());
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
export { init, registerServiceWorker, initializeMap, handleSearchParams };
