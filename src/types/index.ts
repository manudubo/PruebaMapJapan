import type { Map, TileLayer, LatLngExpression } from 'leaflet';

export interface Activity {
  name: string;
  coords: [number, number];
  notes: string | null;
  optional?: string;
  isGeneric?: boolean;
}

export interface Day {
  label: string;
  color: string;
  hasOptions?: boolean;
  activities: Activity[];
}

export interface Hotel {
  name: string;
  coords: [number, number];
}

export interface CityData {
  name: string;
  center: [number, number];
  zoom: number;
  hotel: Hotel;
  dates: string;
  days: Record<string, Day>;
}

export type Itinerary = Record<string, CityData>;

export interface CityMarker {
  name: string;
  coords: LatLngExpression;
  dates: string;
  color: string;
  link: string;
}

export interface NewsItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

export interface WeatherData {
  current: {
    temperature_2m: number;
    weather_code: number;
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
  };
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export type Theme = 'light' | 'dark';

export interface ThemeConfig {
  tileUrl: string;
  routeColor: string;
}

declare global {
  interface Window {
    currentMap: Map | null;
    currentTileLayer: TileLayer | null;
  }
}
