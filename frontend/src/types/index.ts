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

// ============================================
// API Response Types (mirrors backend schema)
// ============================================

export interface ApiActivity {
  id: string;
  name: string;
  lat: number;
  lng: number;
  notes: string | null;
  is_optional: boolean;
  optional_label?: string;
  is_generic: boolean;
  maps_url: string | null;
  order_index: number;
  time: string | null;
}

export interface ApiDay {
  id: string;
  date: string;
  label: string;
  color_hex: string;
  order_index: number;
  activities: ApiActivity[];
}

export interface ApiHotel {
  id: string;
  name: string;
  lat: number;
  lng: number;
  check_in_date: string | null;
  check_out_date: string | null;
  url: string | null;
}

export interface ApiDestination {
  id: string;
  trip_id: string;
  city_name: string;
  country: string;
  start_date: string | null;
  end_date: string | null;
  lat: number;
  lng: number;
  zoom_level: number;
  order_index: number;
  hotel?: ApiHotel;
  days: ApiDay[];
}

export interface ApiTrip {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  cover_image_url: string | null;
  is_public: boolean;
  destinations: ApiDestination[];
}

export interface ApiUser {
  id: string;
  keycloak_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  preferences: Record<string, unknown> | null;
}

declare global {
  interface Window {
    currentMap: Map | null;
    currentTileLayer: TileLayer | null;
  }
}
