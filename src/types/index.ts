export interface Activity {
  name: string;
  coords?: [number, number];
  notes?: string | null;
  optional?: string;
  isGeneric?: boolean;
}

export interface Day {
  label: string;
  color: string;
  activities: Activity[];
  hasOptions?: boolean;
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

export interface CityMarker {
  name: string;
  coords: [number, number];
  dates: string;
  color: string;
  link: string;
}