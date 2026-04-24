/**
 * seed.ts — Populate the database with the Japan 2026 itinerary.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx backend/src/db/seed.ts
 *
 * The script is idempotent: it checks whether the demo user already exists
 * and skips the insert if so.
 */

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import * as schema from './schema';
import { createDb } from './index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

// ---------------------------------------------------------------------------
// Google Maps URL lookup (inline copy to avoid frontend import)
// ---------------------------------------------------------------------------

const MAPS_URLS: Record<string, string> = {
  // Hotels
  'Via Inn Prime Akasaka': 'https://maps.app.goo.gl/FJ2AmEECHEvtAf1B9',
  'Hotel Trusty Nagoya Shirakawa': 'https://maps.app.goo.gl/Yoia569FJnB1up5MA',
  'Amanek Takayama Hotel': 'https://maps.app.goo.gl/9mjsh3fECxZhohNj8',
  'Hotel Amanek Kyoto Kawaramachi Gojo': 'https://maps.app.goo.gl/r6dyhYeh6dS8q7HN7',
  'Shizutetsu Hotel Prezio Shinsaibashi': 'https://maps.app.goo.gl/WJi1sYEh9JjN5NVr5',
  'UNO Hotel': 'https://maps.app.goo.gl/XC3h5EcEoRbGZmtZ9',
  'Asante Inn': 'https://maps.app.goo.gl/UgR6g5cmUjvzSNnd6',
  // Tokyo Activities
  'Palacio Imperial (Kōkyo)': 'https://maps.app.goo.gl/V5gwBaj5LM7DdZ4w8',
  'Santuario Hie': 'https://maps.app.goo.gl/P1ZPEG3Wq8LHUJLr5',
  'Akasaka Hikawa Shrine': 'https://maps.app.goo.gl/MMZoWfnhJbg4LFZk7',
  'National Art Center Tokyo': 'https://maps.app.goo.gl/rfcQgvweqZeqt5GS8',
  '21_21 Design Sight': 'https://maps.app.goo.gl/YS6jGMYPqHBN8yb8A',
  'TeamLab Planets': 'https://maps.app.goo.gl/JadxgYPibYbcEaCNA',
  'Tsukiji Fish Market': 'https://maps.app.goo.gl/RbauhHqFirrokYNf9',
  'Okuno Building': 'https://maps.app.goo.gl/BRwNHiAWWjBu3irXA',
  'Jardines Hamarikyu': 'https://maps.app.goo.gl/uxUiGuVj8XUHthwg6',
  'Institute for Nature Study': 'https://maps.app.goo.gl/zzY3qRvUpq7uuuWh8',
  'Walking Tour Shibuya': 'https://maps.app.goo.gl/zjRcWPMfx4dbw7J16',
  'Santuario Meiji': 'https://maps.app.goo.gl/P9AHzT2FpTsfnirx7',
  'Yoyogi Park': 'https://maps.app.goo.gl/azkhRgb5w24ai8bs5',
  'R32 Ichioku Tours': 'https://maps.app.goo.gl/3x3Us6dSboMzmHHx6',
  'Hanazono Shrine': 'https://maps.app.goo.gl/51qUuoaWjyHhjZJC9',
  'Omoide Yokocho': 'https://maps.app.goo.gl/ypmbomBkweFSFZPM7',
  'Golden-Gai': 'https://maps.app.goo.gl/zZP451VFmtGaru1j6',
  'Shinjuku Gyoen': 'https://maps.app.goo.gl/VuoxugzTZJjRqnCt8',
  'Walking Tour Shinjuku': 'https://maps.app.goo.gl/SGww3HoLXAXtdQbf6',
  'Jardín Botánico Koishikawa': 'https://maps.app.goo.gl/kPFsJ9VV8ay6xFqAA',
  'Tokyo City Flea Market': 'https://maps.app.goo.gl/5hQDTrh1LspvjuZ6A',
  'Shimokitazawa': 'https://maps.app.goo.gl/EvKWWttKi1ahhw4H8',
  // Nagoya Activities
  'Ghibli Park': 'https://maps.app.goo.gl/sY8BZo8bQPQtds199',
  // Takayama Activities
  'Hida no Sato Folk Village': 'https://maps.app.goo.gl/5dKbgcizZrAxkyLZ9',
  'Shirakawa-go': 'https://maps.app.goo.gl/H9waF7h4BjHUHQ818',
  'Mont Deus Ski Park': 'https://maps.app.goo.gl/kRw9xcPJPpQ7xkEd8',
  'Hounokidaira Ski Area': 'https://maps.app.goo.gl/kRw9xcPJPpQ7xkEd8',
  'Hounokidaira Ski (día 2)': 'https://maps.app.goo.gl/kRw9xcPJPpQ7xkEd8',
  'Shinhotaka Ropeway': 'https://maps.app.goo.gl/gVdzn5NgvUrB7oYf9',
  'Gokayama': 'https://maps.app.goo.gl/nxV8cAcb8QHiTMd37',
  // Kyoto Activities
  'Gion': 'https://maps.app.goo.gl/xQxMxRgCMwfYqQCh7',
  'Hanamikoji-dori': 'https://maps.app.goo.gl/NiWVBsDLMBk5gGQ27',
  'Parque Maruyama': 'https://maps.app.goo.gl/LzkLiQGg37kFtFeY8',
  'Santuario Yasaka': 'https://maps.app.goo.gl/8jDHiGJbKwBE2XHn7',
  'Puente Shijo': 'https://maps.app.goo.gl/xmmFimdV5ZkgVSmLA',
  'Pontocho Alley': 'https://maps.app.goo.gl/RwLEEbKuWjSubqAZ7',
  'Mercado Nishiki': 'https://maps.app.goo.gl/J8twELbyYxsBoTKz8',
  'Uji': 'https://maps.app.goo.gl/M8gVetzanqaQpTYE9',
  'Nintendo Museum': 'https://maps.app.goo.gl/8azBeVxi7ERnmtWf6',
  'Fushimi Inari Taisha': 'https://maps.app.goo.gl/vMAcsJ4shHcjyMpr5',
  'Templo Komyo-in': 'https://maps.app.goo.gl/hP2Q71nBcidg4DqC9',
  'Río Kamo': 'https://maps.app.goo.gl/Rp53QtCaUnobA4rQ8',
  'Kiyomizu-dera': 'https://maps.app.goo.gl/WUG1VfDvHcwNcucK8',
  'Ishibe Alley': 'https://maps.app.goo.gl/MwZRNsHu1MvZivaUA',
  'Ninenzaka & Sanneizaka': 'https://maps.app.goo.gl/GYYNnsUT7FTUsmG39',
  'Yasaka Koshindo': 'https://maps.app.goo.gl/V2UNGnrmNcxKv7Pk7',
  "Kawai Kanjiro's House": 'https://maps.app.goo.gl/kj5YSweNsWaDD6ub9',
  'Arashiyama Bamboo Forest': 'https://maps.app.goo.gl/KNxwUwf77bTSX5ck8',
  'Okochi Sanso Garden': 'https://maps.app.goo.gl/MrANoJGdUbcNTvsF7',
  'Arashiyama Park Kameyama': 'https://maps.app.goo.gl/Vf5ogK3C4mNTvsTK7',
  'Templo Tenryu-ji': 'https://maps.app.goo.gl/XkwZJ6UdwyLygDHs6',
  'Monkey Park Iwatayama': 'https://maps.app.goo.gl/pSwPiRxab3QRMR846',
  'Arashiyama East Park': 'https://maps.app.goo.gl/j5YnsXn62zbBJ5TB8',
  // Osaka Activities
  'Dotonbori': 'https://maps.app.goo.gl/4kGeKczmbLFaqFM67',
  'Hozen-ji Temple': 'https://maps.app.goo.gl/zK5dVoxbWhraBfb59',
  'Kuromon Market': 'https://maps.app.goo.gl/XvoYPDDPxahuqHRS7',
  'Namba Yasaka Shrine': 'https://maps.app.goo.gl/EDwmdQ7qkCictkEh6',
  'Osaka Castle Walking Tour': 'https://maps.app.goo.gl/NsiEymJJ1JJf5gKU8',
  'Tenma & Tenmabashi': 'https://maps.app.goo.gl/G91Bc3NZ2w7upjZD8',
  'Osaka Tenmangu': 'https://maps.app.goo.gl/gFn9M9wssSBX9uSKA',
  'Nakazaki': 'https://maps.app.goo.gl/f49RFKnLK2y2wQUi9',
  'Universal Studios Japan': 'https://maps.app.goo.gl/pmZG7kpWyJS8ppscA',
  'Templo Katsuo-ji + Minoh Falls': 'https://maps.app.goo.gl/C8iQvpVAjXFi26kX9',
  // Naoshima Activities
  'Naoshima Island': 'https://maps.app.goo.gl/DvSaukjSE9cPhET39',
};

function getMapsUrl(name: string): string | null {
  if (name in MAPS_URLS) return MAPS_URLS[name];
  if (name.startsWith('Check-in ')) {
    const hotelName = name.replace('Check-in ', '');
    if (hotelName in MAPS_URLS) return MAPS_URLS[hotelName];
    for (const key of Object.keys(MAPS_URLS)) {
      if (hotelName.includes(key) || key.includes(hotelName)) return MAPS_URLS[key];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Itinerary data — reproduced faithfully from frontend/src/data/itinerary.ts
// ---------------------------------------------------------------------------

interface ActivityData {
  name: string;
  coords: [number, number];
  notes: string | null;
  isGeneric?: boolean;
  optional?: string;
}

interface DayData {
  label: string;
  color: string;
  hasOptions?: boolean;
  activities: ActivityData[];
}

interface DestinationData {
  key: string;
  name: string;
  center: [number, number];
  zoom: number;
  hotel: { name: string; coords: [number, number] };
  dates: string;
  startDate: string;
  endDate: string;
  days: Record<string, DayData>;
}

const ITINERARY: DestinationData[] = [
  {
    key: 'tokyo',
    name: 'Tokyo',
    center: [35.6762, 139.705],
    zoom: 12,
    hotel: { name: 'Via Inn Prime Akasaka', coords: [35.6747, 139.7371] },
    dates: '22 Feb – 1 Mar 2026',
    startDate: '2026-02-22',
    endDate: '2026-03-01',
    days: {
      '2026-02-22': {
        label: 'Dom 22',
        color: '#ff3b30',
        activities: [
          { name: 'Check-in Via Inn Prime Akasaka', coords: [35.6747, 139.7371], notes: null },
          { name: 'Palacio Imperial (Kōkyo)', coords: [35.6852, 139.7528], notes: null },
        ],
      },
      '2026-02-23': {
        label: 'Lun 23',
        color: '#ff9500',
        activities: [
          { name: 'Santuario Hie', coords: [35.6747, 139.7396], notes: null },
          { name: 'Akasaka Hikawa Shrine', coords: [35.6683, 139.7357], notes: null },
          { name: 'National Art Center Tokyo', coords: [35.6653, 139.7263], notes: 'Comprar entrada en el lugar' },
          { name: '21_21 Design Sight', coords: [35.6675, 139.7304], notes: 'Comprar entrada en el lugar' },
        ],
      },
      '2026-02-24': {
        label: 'Mar 24',
        color: '#ffcc00',
        activities: [
          { name: 'TeamLab Planets', coords: [35.6491, 139.7876], notes: 'Reservado 19:00' },
          { name: 'Tsukiji Fish Market', coords: [35.6651, 139.7705], notes: null },
          { name: 'Okuno Building', coords: [35.6728, 139.7672], notes: null },
          { name: 'Ginza', coords: [35.6716, 139.764], notes: null, isGeneric: true },
          { name: 'Jardines Hamarikyu', coords: [35.6596, 139.7636], notes: null },
        ],
      },
      '2026-02-25': {
        label: 'Mié 25',
        color: '#34c759',
        activities: [
          { name: 'Ebisu', coords: [35.6464, 139.7134], notes: null, isGeneric: true },
          { name: 'Institute for Nature Study', coords: [35.636, 139.7213], notes: 'Comprar entrada en el lugar' },
          { name: 'Nakameguro', coords: [35.6443, 139.6992], notes: null, isGeneric: true },
          { name: 'Daikanyamacho', coords: [35.6488, 139.7032], notes: null, isGeneric: true },
        ],
      },
      '2026-02-26': {
        label: 'Jue 26',
        color: '#5ac8fa',
        activities: [
          { name: 'Shibuya', coords: [35.6595, 139.7005], notes: null, isGeneric: true },
          { name: 'Walking Tour Shibuya', coords: [35.6595, 139.7005], notes: '10:00-12:00 · Estatua Hachiko, salida A8' },
          { name: 'Santuario Meiji', coords: [35.6762, 139.6993], notes: null },
          { name: 'Yoyogi Park', coords: [35.6713, 139.6948], notes: null },
          { name: 'Harajuku', coords: [35.6713, 139.7048], notes: null, isGeneric: true },
          { name: 'R32 Ichioku Tours', coords: [35.6595, 139.7037], notes: 'Reserva 10:45' },
        ],
      },
      '2026-02-27': {
        label: 'Vie 27',
        color: '#007aff',
        activities: [
          { name: 'Shinjuku', coords: [35.6896, 139.6918], notes: null, isGeneric: true },
          { name: 'Hanazono Shrine', coords: [35.6932, 139.7067], notes: null },
          { name: 'Omoide Yokocho', coords: [35.693, 139.6995], notes: null },
          { name: 'Golden-Gai', coords: [35.694, 139.7047], notes: null },
          { name: 'Shinjuku Gyoen', coords: [35.6853, 139.7094], notes: null },
          { name: 'Walking Tour Shinjuku', coords: [35.6896, 139.6917], notes: 'Reserva 17:45 · Tochomae, salida A4' },
        ],
      },
      '2026-02-28': {
        label: 'Sáb 28',
        color: '#af52de',
        activities: [
          { name: 'Jinbocho', coords: [35.6955, 139.7581], notes: null, isGeneric: true },
          { name: 'Kagurazaka', coords: [35.7022, 139.7414], notes: null, isGeneric: true },
          { name: 'Hakusan', coords: [35.7212, 139.7525], notes: null, isGeneric: true },
          { name: 'Jardín Botánico Koishikawa', coords: [35.7167, 139.75], notes: 'Comprar en el lugar · No abre lunes' },
        ],
      },
      '2026-03-01': {
        label: 'Dom 1',
        color: '#ff2d55',
        activities: [
          { name: 'Tokyo City Flea Market', coords: [35.6282, 139.7745], notes: null },
          { name: 'Shimokitazawa', coords: [35.6617, 139.6683], notes: null },
        ],
      },
    },
  },
  {
    key: 'nagoya',
    name: 'Nagoya',
    center: [35.17, 136.9],
    zoom: 11,
    hotel: { name: 'Hotel Trusty Nagoya Shirakawa', coords: [35.1658, 136.8987] },
    dates: '2–3 Mar 2026',
    startDate: '2026-03-02',
    endDate: '2026-03-03',
    days: {
      '2026-03-02': {
        label: 'Lun 2',
        color: '#34c759',
        activities: [
          { name: 'Check-in Hotel Trusty', coords: [35.1658, 136.8987], notes: 'Tren desde Tokyo 07:00' },
          { name: 'Ghibli Park', coords: [35.1804, 137.0858], notes: 'Reservado 11:00' },
        ],
      },
      '2026-03-03': {
        label: 'Mar 3',
        color: '#007aff',
        activities: [
          { name: 'Explorar Nagoya', coords: [35.1706, 136.8816], notes: 'Día libre', isGeneric: true },
        ],
      },
    },
  },
  {
    key: 'takayama',
    name: 'Takayama',
    center: [36.14, 137.25],
    zoom: 10,
    hotel: { name: 'Amanek Takayama Hotel', coords: [36.139, 137.2527] },
    dates: '4–7 Mar 2026',
    startDate: '2026-03-04',
    endDate: '2026-03-07',
    days: {
      '2026-03-04': {
        label: 'Mié 4',
        color: '#ff3b30',
        activities: [
          { name: 'Check-in Amanek Takayama', coords: [36.139, 137.2527], notes: 'Comprar pasajes para daytrips' },
          { name: 'Hida no Sato Folk Village', coords: [36.1578, 137.2175], notes: 'Museo al aire libre' },
        ],
      },
      '2026-03-05': {
        label: 'Jue 5',
        color: '#34c759',
        activities: [
          { name: 'Shirakawa-go', coords: [36.2569, 136.9067], notes: 'Bus info: nouhibus.co.jp' },
        ],
      },
      '2026-03-06': {
        label: 'Vie 6',
        color: '#007aff',
        hasOptions: true,
        activities: [
          { name: 'Mont Deus Ski Park', coords: [36.0864, 137.3181], notes: '14km de Takayama', optional: 'A', isGeneric: true },
          { name: 'Hirayu Onsen Ski Area', coords: [36.2261, 137.6], notes: 'Pocas pistas, poca dificultad', optional: 'B', isGeneric: true },
          { name: 'Hounokidaira Ski Area', coords: [36.23, 137.58], notes: '~75 USD con equipo', optional: 'C' },
        ],
      },
      '2026-03-07': {
        label: 'Sáb 7',
        color: '#af52de',
        hasOptions: true,
        activities: [
          { name: 'Hounokidaira Ski (día 2)', coords: [36.23, 137.58], notes: '~75 USD con equipo', optional: '1' },
          { name: 'Shinhotaka Ropeway', coords: [36.2925, 137.5943], notes: 'Bus: nouhibus.co.jp', optional: '2' },
          { name: 'Gokayama', coords: [36.415, 136.8978], notes: 'Alternativa a Shirakawa-go', optional: '3' },
        ],
      },
    },
  },
  {
    key: 'kyoto',
    name: 'Kyoto',
    center: [35.0, 135.76],
    zoom: 12,
    hotel: { name: 'Hotel Amanek Kyoto Kawaramachi Gojo', coords: [34.9968, 135.7665] },
    dates: '8–13 Mar 2026',
    startDate: '2026-03-08',
    endDate: '2026-03-13',
    days: {
      '2026-03-08': {
        label: 'Dom 8',
        color: '#ff3b30',
        activities: [
          { name: 'Check-in Amanek Kyoto', coords: [34.9968, 135.7665], notes: null },
          { name: 'Gion', coords: [35.0036, 135.7755], notes: null },
          { name: 'Hanamikoji-dori', coords: [35.003, 135.7755], notes: 'Calle tradicional de geishas' },
        ],
      },
      '2026-03-09': {
        label: 'Lun 9',
        color: '#ff9500',
        activities: [
          { name: 'Parque Maruyama', coords: [35.0028, 135.7822], notes: null },
          { name: 'Santuario Yasaka', coords: [35.0036, 135.7785], notes: null },
          { name: 'Puente Shijo', coords: [35.0038, 135.7695], notes: null },
          { name: 'Pontocho Alley', coords: [35.0067, 135.7712], notes: null },
          { name: 'Mercado Nishiki', coords: [35.0049, 135.7642], notes: null },
        ],
      },
      '2026-03-10': {
        label: 'Mar 10',
        color: '#ffcc00',
        activities: [
          { name: 'Día libre', coords: [35.0, 135.76], notes: 'A definir', isGeneric: true },
        ],
      },
      '2026-03-11': {
        label: 'Mié 11',
        color: '#34c759',
        activities: [
          { name: 'Uji', coords: [34.8907, 135.808], notes: null },
          { name: 'Nintendo Museum', coords: [34.9378, 135.7583], notes: 'Reservado 14:00–14:30' },
          { name: 'Fushimi Inari Taisha', coords: [34.9671, 135.7727], notes: 'Recomendado a la noche' },
          { name: 'Templo Komyo-in', coords: [34.9691, 135.7733], notes: 'Lindo al atardecer' },
          { name: 'Río Kamo', coords: [35.0, 135.77], notes: null },
        ],
      },
      '2026-03-12': {
        label: 'Jue 12',
        color: '#5ac8fa',
        activities: [
          { name: 'Kiyomizu-dera', coords: [34.9949, 135.785], notes: null },
          { name: 'Ishibe Alley', coords: [34.9978, 135.7807], notes: null },
          { name: 'Ninenzaka & Sanneizaka', coords: [34.9966, 135.7801], notes: 'Muy concurrido' },
          { name: 'Yasaka Koshindo', coords: [34.9965, 135.7785], notes: null },
          { name: "Kawai Kanjiro's House", coords: [34.9932, 135.7791], notes: null },
        ],
      },
      '2026-03-13': {
        label: 'Vie 13',
        color: '#af52de',
        activities: [
          { name: 'Arashiyama Bamboo Forest', coords: [35.0171, 135.6716], notes: null },
          { name: 'Okochi Sanso Garden', coords: [35.0185, 135.67], notes: null },
          { name: 'Arashiyama Park Kameyama', coords: [35.0152, 135.6763], notes: null },
          { name: 'Templo Tenryu-ji', coords: [35.0154, 135.6748], notes: null },
          { name: 'Monkey Park Iwatayama', coords: [35.011, 135.678], notes: null },
          { name: 'Arashiyama East Park', coords: [35.0133, 135.68], notes: null },
        ],
      },
    },
  },
  {
    key: 'osaka',
    name: 'Osaka',
    center: [34.69, 135.5],
    zoom: 12,
    hotel: { name: 'Shizutetsu Hotel Prezio Shinsaibashi', coords: [34.6789, 135.4983] },
    dates: '14–17 Mar 2026',
    startDate: '2026-03-14',
    endDate: '2026-03-17',
    days: {
      '2026-03-14': {
        label: 'Sáb 14',
        color: '#ff3b30',
        activities: [
          { name: 'Check-in Shizutetsu Hotel', coords: [34.6789, 135.4983], notes: null },
          { name: 'Dotonbori', coords: [34.6685, 135.5015], notes: null },
          { name: 'Hozen-ji Temple', coords: [34.6688, 135.5037], notes: null },
          { name: 'Kuromon Market', coords: [34.6639, 135.5068], notes: null },
          { name: 'Namba Yasaka Shrine', coords: [34.6621, 135.4975], notes: null },
        ],
      },
      '2026-03-15': {
        label: 'Dom 15',
        color: '#34c759',
        activities: [
          { name: 'Osaka Castle Walking Tour', coords: [34.685, 135.524], notes: '09:00 · Lawson S Otemae Rest House' },
          { name: 'Tenma & Tenmabashi', coords: [34.7025, 135.513], notes: null },
          { name: 'Osaka Tenmangu', coords: [34.7025, 135.515], notes: null },
          { name: 'Nakazaki', coords: [34.7075, 135.5033], notes: 'Vintage y coffee hopping' },
        ],
      },
      '2026-03-16': {
        label: 'Lun 16',
        color: '#007aff',
        activities: [
          { name: 'Universal Studios Japan', coords: [34.6654, 135.4323], notes: 'Día completo · Reserva confirmada' },
        ],
      },
      '2026-03-17': {
        label: 'Mar 17',
        color: '#af52de',
        hasOptions: true,
        activities: [
          { name: 'Templo Katsuo-ji + Minoh Falls', coords: [34.8781, 135.4869], notes: 'Ir temprano, taxi a Dainichi Parking', optional: 'A' },
          { name: 'Día libre', coords: [34.69, 135.5], notes: 'Explorar Osaka a tu ritmo', optional: 'B', isGeneric: true },
        ],
      },
    },
  },
  {
    key: 'naoshima',
    name: 'Naoshima',
    center: [34.46, 133.995],
    zoom: 13,
    hotel: { name: 'UNO Hotel', coords: [34.4893, 133.9496] },
    dates: '18–19 Mar 2026',
    startDate: '2026-03-18',
    endDate: '2026-03-19',
    days: {
      '2026-03-18': {
        label: 'Mié 18',
        color: '#ff3b30',
        activities: [
          { name: 'Check-in UNO Hotel', coords: [34.4893, 133.9496], notes: null },
        ],
      },
      '2026-03-19': {
        label: 'Jue 19',
        color: '#34c759',
        activities: [
          { name: 'Naoshima Island', coords: [34.46, 133.995], notes: 'Isla del arte' },
          { name: 'Museos de Arte', coords: [34.455, 133.99], notes: 'Chichu Art Museum, Benesse House, etc.', isGeneric: true },
        ],
      },
    },
  },
  {
    key: 'hakone',
    name: 'Hakone',
    center: [35.233, 139.107],
    zoom: 12,
    hotel: { name: 'Asante Inn', coords: [35.233, 139.107] },
    dates: '20–21 Mar 2026',
    startDate: '2026-03-20',
    endDate: '2026-03-21',
    days: {
      '2026-03-20': {
        label: 'Vie 20',
        color: '#ff3b30',
        activities: [
          { name: 'Check-in Asante Inn', coords: [35.233, 139.107], notes: null },
        ],
      },
      '2026-03-21': {
        label: 'Sáb 21',
        color: '#34c759',
        activities: [
          { name: 'Recorrer Hakone', coords: [35.233, 139.107], notes: 'Onsen, vistas del Fuji', isGeneric: true },
        ],
      },
    },
  },
  {
    key: 'tokyo2',
    name: 'Tokyo',
    center: [35.6762, 139.705],
    zoom: 12,
    hotel: { name: 'Via Inn Prime Akasaka', coords: [35.6747, 139.7371] },
    dates: '22–23 Mar 2026',
    startDate: '2026-03-22',
    endDate: '2026-03-23',
    days: {
      '2026-03-22': {
        label: 'Dom 22',
        color: '#ff3b30',
        activities: [
          { name: 'Check-in Via Inn Prime Akasaka', coords: [35.6747, 139.7371], notes: 'Check-in 15:00' },
        ],
      },
      '2026-03-23': {
        label: 'Lun 23',
        color: '#34c759',
        activities: [
          { name: 'Última recorrida y compras', coords: [35.6762, 139.705], notes: 'Check-out 10:00 · Dejar bolsos en hotel', isGeneric: true },
        ],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------

async function seed() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const db = createDb(databaseUrl);

  console.log('Seeding database...');

  // -------------------------------------------------------------------------
  // 1. Upsert demo user
  // -------------------------------------------------------------------------
  const DEMO_KEYCLOAK_ID = 'demo-user';

  const existing = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.keycloak_id, DEMO_KEYCLOAK_ID))
    .limit(1);

  let userId: number;

  if (existing.length > 0) {
    userId = existing[0]!.id;
    console.log(`Demo user already exists (id=${userId}), skipping user insert.`);
  } else {
    const [newUser] = await db
      .insert(schema.users)
      .values({
        keycloak_id: DEMO_KEYCLOAK_ID,
        email: 'demo@example.com',
        name: 'Demo User',
        preferences: {},
      })
      .returning({ id: schema.users.id });

    if (!newUser) throw new Error('Failed to insert demo user');
    userId = newUser.id;
    console.log(`Created demo user (id=${userId})`);
  }

  // -------------------------------------------------------------------------
  // 2. Check if the trip already exists (idempotency guard)
  // -------------------------------------------------------------------------
  const existingTrips = await db
    .select()
    .from(schema.trips)
    .where(eq(schema.trips.user_id, userId))
    .limit(1);

  if (existingTrips.length > 0) {
    console.log('Trip already seeded, nothing to do.');
    return;
  }

  // -------------------------------------------------------------------------
  // 3. Create the Japan 2026 trip
  // -------------------------------------------------------------------------
  const [trip] = await db
    .insert(schema.trips)
    .values({
      user_id: userId,
      name: 'Japan 2026',
      description: 'Japan trip — Feb 22 to Mar 23, 2026',
      start_date: '2026-02-22',
      end_date: '2026-03-23',
      is_public: false,
    })
    .returning({ id: schema.trips.id });

  if (!trip) throw new Error('Failed to insert trip');
  console.log(`Created trip "Japan 2026" (id=${trip.id})`);

  // -------------------------------------------------------------------------
  // 4. Create destinations → hotels → days → activities
  // -------------------------------------------------------------------------
  for (let destIndex = 0; destIndex < ITINERARY.length; destIndex++) {
    const dest = ITINERARY[destIndex]!;

    const [destination] = await db
      .insert(schema.destinations)
      .values({
        trip_id: trip.id,
        city_name: dest.name,
        country: 'Japan',
        start_date: dest.startDate,
        end_date: dest.endDate,
        lat: String(dest.center[0]),
        lng: String(dest.center[1]),
        zoom_level: dest.zoom,
        order_index: destIndex,
      })
      .returning({ id: schema.destinations.id });

    if (!destination) throw new Error(`Failed to insert destination ${dest.name}`);
    console.log(`  Destination: ${dest.name} (id=${destination.id})`);

    // Hotel
    await db.insert(schema.hotels).values({
      destination_id: destination.id,
      name: dest.hotel.name,
      lat: String(dest.hotel.coords[0]),
      lng: String(dest.hotel.coords[1]),
      check_in_date: dest.startDate,
      check_out_date: dest.endDate,
    });

    // Days
    const sortedDates = Object.keys(dest.days).sort();
    for (let dayIndex = 0; dayIndex < sortedDates.length; dayIndex++) {
      const dateStr = sortedDates[dayIndex]!;
      const dayData = dest.days[dateStr]!;

      const [day] = await db
        .insert(schema.days)
        .values({
          destination_id: destination.id,
          date: dateStr,
          label: dayData.label,
          color_hex: dayData.color,
          order_index: dayIndex,
        })
        .returning({ id: schema.days.id });

      if (!day) throw new Error(`Failed to insert day ${dateStr}`);

      // Activities
      for (let actIndex = 0; actIndex < dayData.activities.length; actIndex++) {
        const act = dayData.activities[actIndex]!;
        const mapsUrl = getMapsUrl(act.name);

        await db.insert(schema.activities).values({
          day_id: day.id,
          name: act.name,
          lat: String(act.coords[0]),
          lng: String(act.coords[1]),
          notes: act.notes,
          is_optional: act.optional !== undefined,
          is_generic: act.isGeneric === true,
          maps_url: mapsUrl,
          order_index: actIndex,
        });
      }
    }
  }

  console.log('Seed complete.');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
