import type { Theme, ThemeConfig } from '@/types';
import { TILE_PROVIDER } from '@/data/tiles';

const THEME_KEY = 'theme';

// Both themes share the keyless OSM tiles; dark mode darkens them with a CSS
// filter on .leaflet-tile-pane (main.css), so markers and popups keep their colours.
export const THEME_CONFIG: Record<Theme, ThemeConfig> = {
  light: {
    tileUrl: TILE_PROVIDER.url,
    routeColor: '#0071e3'
  },
  dark: {
    tileUrl: TILE_PROVIDER.url,
    routeColor: '#0a84ff'
  }
};

/** localStorage can throw (blocked site data, some private modes); theming must not depend on it. */
function readSavedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch { /* preference just won't persist */ }
}

export function getTheme(): Theme {
  return (document.documentElement.getAttribute('data-theme') as Theme) ?? 'light';
}

export function getThemeConfig(theme?: Theme): ThemeConfig {
  return THEME_CONFIG[theme ?? getTheme()];
}

export function initTheme(): void {
  const saved = readSavedTheme();
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme: Theme = saved ?? (prefersDark ? 'dark' : 'light');
  applyTheme(theme);
  setupSystemThemeListener();
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeButton(theme);
  updateMetaThemeColor(theme);
}

export function toggleTheme(): void {
  const current = getTheme();
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  saveTheme(next);
  applyTheme(next);
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: next } }));
}

export function updateThemeButton(theme: Theme): void {
  const navbar = document.querySelector('travel-nav');
  const btn = navbar?.shadowRoot?.querySelector('.theme-toggle') 
    ?? document.querySelector('.theme-toggle');
  if (!btn) return;

  const icons: Record<Theme, string> = {
    light: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`,
    dark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`
  };

  btn.innerHTML = `${icons[theme]}<span>${theme === 'light' ? 'Dark' : 'Light'}</span>`;
  btn.setAttribute('aria-label', `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`);
}

function updateMetaThemeColor(theme: Theme): void {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#1c1c1e' : '#f5f5f7');
}

function setupSystemThemeListener(): void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', (e) => {
    if (!readSavedTheme()) {
      applyTheme(e.matches ? 'dark' : 'light');
      window.dispatchEvent(new CustomEvent('theme-changed'));
    }
  });
}
