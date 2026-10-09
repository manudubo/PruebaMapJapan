/**
 * Weather code -> label and icon, shared by the demo widgets (widgets.ts) and the trip city view
 * (tripWeather.ts). Icons are hardcoded SVG literals, safe to inject with innerHTML.
 */

const WEATHER_CONDITIONS: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy',
  45: 'Fog', 51: 'Drizzle', 61: 'Rain', 71: 'Snow', 95: 'Thunderstorm'
};

export function getWeatherCondition(code: number): string {
  return WEATHER_CONDITIONS[code] ?? 'Variable';
}

export function getWeatherIcon(code: number): string {
  // Iconos SVG minimalistas en lugar de emojis
  if (code === 0) {
    // Sol
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
  }
  if (code <= 3) {
    // Parcialmente nublado
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`;
  }
  if (code <= 48) {
    // Niebla
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><path d="M3 15h18M3 9h18M3 12h18"/></svg>`;
  }
  if (code <= 67) {
    // Lluvia
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><line x1="8" y1="13" x2="8" y2="21"/><line x1="16" y1="13" x2="16" y2="21"/><line x1="12" y1="15" x2="12" y2="23"/><path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/></svg>`;
  }
  // Generic cloudy
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`;
}
