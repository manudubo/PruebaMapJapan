import type { Map, TileLayer, LatLngExpression } from 'leaflet';

export interface Activity {
  /** Stable id of a saved activity (user trips); the demo's activities have none. */
  id?: string;
  name: string;
  coords?: [number, number];
  notes: string | null;
  optional?: string;
  isGeneric?: boolean;
  /** "HH:MM" start time, when the activity has one. */
  time?: string;
  /** Stored "open in Maps" link (http/https only). */
  mapsUrl?: string;
}

export interface Day {
  label: string;
  color: string;
  hasOptions?: boolean;
  activities: Activity[];
}

export interface Hotel {
  name: string;
  coords?: [number, number];
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

/**
 * A coordinate as the API returns it: Postgres NUMERIC columns serialise as
 * strings ("35.6762000"), and unset coordinates are null. Requests may send
 * numbers. Convert with toCoords() in tripAdapter before handing to Leaflet.
 */
export type ApiCoordinate = number | string | null;

export interface ApiActivity {
  id: string;
  name: string;
  lat: ApiCoordinate;
  lng: ApiCoordinate;
  notes: string | null;
  is_optional: boolean;
  is_generic: boolean;
  maps_url: string | null;
  order_index: number;
  time: string | null;
}

export interface ApiDay {
  id: string;
  date: string;
  label: string | null;
  color_hex: string | null;
  order_index: number;
  activities: ApiActivity[];
}

export interface ApiHotel {
  id: string;
  name: string;
  lat: ApiCoordinate;
  lng: ApiCoordinate;
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
  lat: ApiCoordinate;
  lng: ApiCoordinate;
  /** Nullable in the DB (defaults to 12 on insert). */
  zoom_level: number | null;
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
  public_slug: string | null;
  destinations: ApiDestination[];
}

export interface ApiUser {
  id: string;
  keycloak_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  preferences: Record<string, unknown> | null;
  /** Absent on older backends: treat as verified. */
  email_verified?: boolean;
  /** Derived by GET /users/me: true for a just-registered account. */
  onboarding?: { is_new: boolean };
}

declare global {
  interface Window {
    currentMap: Map | null;
    currentTileLayer: TileLayer | null;
  }
}
