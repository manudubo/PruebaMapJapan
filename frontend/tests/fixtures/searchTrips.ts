// Builders for ApiTrip values in the search tests: just enough structure, readable at the call site.
import type { ApiTrip } from '@/types';

export interface ActSpec {
  name: string;
  notes?: string | null;
  generic?: boolean;
  lat?: number | string | null;
  lng?: number | string | null;
}
export interface DaySpec {
  date: string;
  label?: string | null;
  color?: string | null;
  acts?: Array<ActSpec | string>;
  order?: number;
}
export interface DestSpec {
  city: string;
  order?: number;
  start?: string | null;
  hotel?: string;
  days?: DaySpec[];
}
export interface TripSpec {
  id: string | number;
  name: string;
  start?: string | null;
  end?: string | null;
  dests?: DestSpec[];
  /** A bare list row, as GET /trips returns it (no `destinations` key). */
  bare?: boolean;
}

export function mkTrip(spec: TripSpec): ApiTrip {
  const id = String(spec.id);
  const trip: Record<string, unknown> = {
    id,
    user_id: 'u1',
    name: spec.name,
    description: null,
    start_date: spec.start ?? null,
    end_date: spec.end ?? null,
    cover_image_url: null,
    is_public: false,
    public_slug: null,
  };
  if (!spec.bare) {
    trip['destinations'] = (spec.dests ?? []).map((d, i) => ({
      id: `${id}-d${i}`,
      trip_id: id,
      city_name: d.city,
      country: 'Japan',
      start_date: d.start ?? null,
      end_date: null,
      lat: 35,
      lng: 139,
      zoom_level: 12,
      order_index: d.order ?? i,
      hotel: d.hotel
        ? { id: `${id}-h${i}`, name: d.hotel, lat: 35, lng: 139, check_in_date: null, check_out_date: null, url: null }
        : undefined,
      days: (d.days ?? []).map((day, j) => ({
        id: `${id}-d${i}-day${j}`,
        date: day.date,
        label: day.label ?? null,
        color_hex: day.color ?? null,
        order_index: day.order ?? j,
        activities: (day.acts ?? []).map((a, k) => {
          const act = typeof a === 'string' ? { name: a } : a;
          return {
            id: `${id}-d${i}-day${j}-a${k}`,
            name: act.name,
            notes: act.notes ?? null,
            lat: act.lat ?? null,
            lng: act.lng ?? null,
            is_optional: false,
            is_generic: !!act.generic,
            maps_url: null,
            order_index: k,
            time: null,
          };
        }),
      })),
    }));
  }
  return trip as unknown as ApiTrip;
}

/** Two trips with distinct vocabulary plus one shared word ("ramen"). */
export function sampleTrips(): ApiTrip[] {
  return [
    mkTrip({
      id: 't-spring',
      name: 'Spring in Kansai',
      start: '2026-04-01',
      end: '2026-04-05',
      dests: [
        {
          city: 'Kyoto',
          hotel: 'Gion Ryokan',
          days: [{ date: '2026-04-01', label: 'Temples', acts: [{ name: 'Fushimi Inari', notes: 'Go early' }, 'Ramen alley'] }],
        },
        { city: 'Osaka', days: [{ date: '2026-04-03', label: 'Food', acts: ['Dotonbori ramen'] }] },
      ],
    }),
    mkTrip({
      id: 't-winter',
      name: 'Winter in Hokkaido',
      start: '2026-12-10',
      end: '2026-12-15',
      dests: [{ city: 'Sapporo', days: [{ date: '2026-12-10', label: 'Snow', acts: ['Snow festival', 'Ramen Yokocho'] }] }],
    }),
  ];
}
