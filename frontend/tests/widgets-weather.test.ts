import { describe, it, expect, vi, afterEach } from 'vitest';
import { initWidgets } from '@/modules/widgets';
import { setCache } from '@/modules/utils';
import { ITINERARY } from '@/data/itinerary';
import type { WeatherData } from '@/types';

// Open-Meteo returns daily.time as date-only strings in Asia/Tokyo. The
// forecast weekday must be that calendar day's weekday in every viewer zone
// (BIZ-11) — new Date('2026-02-23') made it Sunday instead of Monday in the
// Americas.

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function renderForecast(): Promise<string[]> {
  const [lat, lon] = ITINERARY.tokyo.center;
  const data: WeatherData = {
    current: { temperature_2m: 5, weather_code: 0 },
    daily: {
      time: ['2026-02-22', '2026-02-23', '2026-02-24', '2026-02-25', '2026-02-26'],
      weather_code: [0, 1, 2, 3, 61],
      temperature_2m_max: [10, 11, 12, 13, 14],
      temperature_2m_min: [1, 2, 3, 4, 5],
    },
  };
  setCache(`weather_${lat}_${lon}`, data);

  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private cb: IntersectionObserverCallback) {}
      observe(): void {
        this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      disconnect(): void {}
    },
  );

  document.body.innerHTML = '<div class="page-card"></div>';
  initWidgets('tokyo');
  await new Promise((r) => setTimeout(r, 0));
  return Array.from(document.querySelectorAll('.forecast-date')).map((el) => el.textContent ?? '');
}

describe('weather forecast weekdays (BIZ-11)', () => {
  it.each(['America/Argentina/Buenos_Aires', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland', 'Etc/GMT+12'])(
    'shows Mon–Thu for Feb 23–26 2026 in %s',
    async (tz) => {
      process.env.TZ = tz;
      expect(await renderForecast()).toEqual(['Mon', 'Tue', 'Wed', 'Thu']);
    },
  );
});
