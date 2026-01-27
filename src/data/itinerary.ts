import type { Itinerary } from '@/types';

export const ITINERARY: Itinerary = {
  tokyo: {
    name: "Tokyo",
    center: [35.6762, 139.7050],
    zoom: 12,
    hotel: { name: "Via Inn Prime Akasaka", coords: [35.6747, 139.7371] },
    dates: "22 Feb – 1 Mar 2026",
    days: {
      "2026-02-22": {
        label: "Dom 22",
        color: "#ff3b30",
        activities: [
          { name: "Check-in Via Inn Prime Akasaka", coords: [35.6747, 139.7371], notes: null },
          { name: "Palacio Imperial (Kōkyo)", coords: [35.6852, 139.7528], notes: null }
        ]
      },
      "2026-02-23": {
        label: "Lun 23",
        color: "#ff9500",
        activities: [
          { name: "Santuario Hie", coords: [35.6747, 139.7396], notes: null },
          { name: "Akasaka Hikawa Shrine", coords: [35.6683, 139.7357], notes: null },
          { name: "National Art Center Tokyo", coords: [35.6653, 139.7263], notes: "Comprar entrada en el lugar" },
          { name: "21_21 Design Sight", coords: [35.6675, 139.7304], notes: "Comprar entrada en el lugar" }
        ]
      },
      "2026-02-24": {
        label: "Mar 24",
        color: "#ffcc00",
        activities: [
          { name: "TeamLab Planets", coords: [35.6491, 139.7876], notes: "Reservado 19:00" },
          { name: "Tsukiji Fish Market", coords: [35.6651, 139.7705], notes: null },
          { name: "Okuno Building", coords: [35.6728, 139.7672], notes: null },
          { name: "Ginza", coords: [35.6716, 139.7640], notes: null, isGeneric: true },
          { name: "Jardines Hamarikyu", coords: [35.6596, 139.7636], notes: null }
        ]
      },
      "2026-02-25": {
        label: "Mié 25",
        color: "#34c759",
        activities: [
          { name: "Ebisu", coords: [35.6464, 139.7134], notes: null, isGeneric: true },
          { name: "Institute for Nature Study", coords: [35.6360, 139.7213], notes: "Comprar entrada en el lugar" },
          { name: "Nakameguro", coords: [35.6443, 139.6992], notes: null, isGeneric: true },
          { name: "Daikanyamacho", coords: [35.6488, 139.7032], notes: null, isGeneric: true }
        ]
      },
      "2026-02-26": {
        label: "Jue 26",
        color: "#5ac8fa",
        activities: [
          { name: "Shibuya", coords: [35.6595, 139.7005], notes: null, isGeneric: true },
          { name: "Walking Tour Shibuya", coords: [35.6595, 139.7005], notes: "10:00-12:00 · Estatua Hachiko, salida A8" },
          { name: "Santuario Meiji", coords: [35.6762, 139.6993], notes: null },
          { name: "Yoyogi Park", coords: [35.6713, 139.6948], notes: null },
          { name: "Harajuku", coords: [35.6713, 139.7048], notes: null, isGeneric: true },
          { name: "R32 Ichioku Tours", coords: [35.6595, 139.7037], notes: "Reserva 10:45" }
        ]
      },
      "2026-02-27": {
        label: "Vie 27",
        color: "#007aff",
        activities: [
          { name: "Shinjuku", coords: [35.6896, 139.6918], notes: null, isGeneric: true },
          { name: "Hanazono Shrine", coords: [35.6932, 139.7067], notes: null },
          { name: "Omoide Yokocho", coords: [35.6930, 139.6995], notes: null },
          { name: "Golden-Gai", coords: [35.6940, 139.7047], notes: null },
          { name: "Shinjuku Gyoen", coords: [35.6853, 139.7094], notes: null },
          { name: "Walking Tour Shinjuku", coords: [35.6896, 139.6917], notes: "Reserva 17:45 · Tochomae, salida A4" }
        ]
      },
      "2026-02-28": {
        label: "Sáb 28",
        color: "#af52de",
        activities: [
          { name: "Jinbocho", coords: [35.6955, 139.7581], notes: null, isGeneric: true },
          { name: "Kagurazaka", coords: [35.7022, 139.7414], notes: null, isGeneric: true },
          { name: "Hakusan", coords: [35.7212, 139.7525], notes: null, isGeneric: true },
          { name: "Jardín Botánico Koishikawa", coords: [35.7167, 139.7500], notes: "Comprar en el lugar · No abre lunes" }
        ]
      },
      "2026-03-01": {
        label: "Dom 1",
        color: "#ff2d55",
        activities: [
          { name: "Tokyo City Flea Market", coords: [35.6282, 139.7745], notes: null },
          { name: "Shimokitazawa", coords: [35.6617, 139.6683], notes: null }
        ]
      }
    }
  },
  nagoya: {
    name: "Nagoya",
    center: [35.1700, 136.9000],
    zoom: 11,
    hotel: { name: "Hotel Trusty Nagoya Shirakawa", coords: [35.1658, 136.8987] },
    dates: "2–3 Mar 2026",
    days: {
      "2026-03-02": {
        label: "Lun 2",
        color: "#34c759",
        activities: [
          { name: "Check-in Hotel Trusty", coords: [35.1658, 136.8987], notes: "Tren desde Tokyo 07:00" },
          { name: "Ghibli Park", coords: [35.1804, 137.0858], notes: "Reservado 11:00" }
        ]
      },
      "2026-03-03": {
        label: "Mar 3",
        color: "#007aff",
        activities: [
          { name: "Explorar Nagoya", coords: [35.1706, 136.8816], notes: "Día libre", isGeneric: true }
        ]
      }
    }
  },
  takayama: {
    name: "Takayama",
    center: [36.1400, 137.2500],
    zoom: 10,
    hotel: { name: "Amanek Takayama Hotel", coords: [36.1390, 137.2527] },
    dates: "4–7 Mar 2026",
    days: {
      "2026-03-04": {
        label: "Mié 4",
        color: "#ff3b30",
        activities: [
          { name: "Check-in Amanek Takayama", coords: [36.1390, 137.2527], notes: "Comprar pasajes para daytrips" },
          { name: "Hida no Sato Folk Village", coords: [36.1578, 137.2175], notes: "Museo al aire libre" }
        ]
      },
      "2026-03-05": {
        label: "Jue 5",
        color: "#34c759",
        activities: [
          { name: "Shirakawa-go", coords: [36.2569, 136.9067], notes: "Bus info: nouhibus.co.jp" }
        ]
      },
      "2026-03-06": {
        label: "Vie 6",
        color: "#007aff",
        hasOptions: true,
        activities: [
          { name: "Mont Deus Ski Park", coords: [36.0864, 137.3181], notes: "14km de Takayama", optional: "A", isGeneric: true },
          { name: "Hirayu Onsen Ski Area", coords: [36.2261, 137.6000], notes: "Pocas pistas, poca dificultad", optional: "B", isGeneric: true },
          { name: "Hounokidaira Ski Area", coords: [36.2300, 137.5800], notes: "~75 USD con equipo", optional: "C" }
        ]
      },
      "2026-03-07": {
        label: "Sáb 7",
        color: "#af52de",
        hasOptions: true,
        activities: [
          { name: "Hounokidaira Ski (día 2)", coords: [36.2300, 137.5800], notes: "~75 USD con equipo", optional: "1" },
          { name: "Shinhotaka Ropeway", coords: [36.2925, 137.5943], notes: "Bus: nouhibus.co.jp", optional: "2" },
          { name: "Gokayama", coords: [36.4150, 136.8978], notes: "Alternativa a Shirakawa-go", optional: "3" }
        ]
      }
    }
  },
  kyoto: {
    name: "Kyoto",
    center: [35.0000, 135.7600],
    zoom: 12,
    hotel: { name: "Hotel Amanek Kyoto Kawaramachi Gojo", coords: [34.9968, 135.7665] },
    dates: "8–13 Mar 2026",
    days: {
      "2026-03-08": {
        label: "Dom 8",
        color: "#ff3b30",
        activities: [
          { name: "Check-in Amanek Kyoto", coords: [34.9968, 135.7665], notes: null },
          { name: "Gion", coords: [35.0036, 135.7755], notes: null },
          { name: "Hanamikoji-dori", coords: [35.0030, 135.7755], notes: "Calle tradicional de geishas" }
        ]
      },
      "2026-03-09": {
        label: "Lun 9",
        color: "#ff9500",
        activities: [
          { name: "Parque Maruyama", coords: [35.0028, 135.7822], notes: null },
          { name: "Santuario Yasaka", coords: [35.0036, 135.7785], notes: null },
          { name: "Puente Shijo", coords: [35.0038, 135.7695], notes: null },
          { name: "Pontocho Alley", coords: [35.0067, 135.7712], notes: null },
          { name: "Mercado Nishiki", coords: [35.0049, 135.7642], notes: null }
        ]
      },
      "2026-03-10": {
        label: "Mar 10",
        color: "#ffcc00",
        activities: [
          { name: "Día libre", coords: [35.0000, 135.7600], notes: "A definir", isGeneric: true }
        ]
      },
      "2026-03-11": {
        label: "Mié 11",
        color: "#34c759",
        activities: [
          { name: "Uji", coords: [34.8907, 135.8080], notes: null },
          { name: "Nintendo Museum", coords: [34.9378, 135.7583], notes: "Reservado 14:00–14:30" },
          { name: "Fushimi Inari Taisha", coords: [34.9671, 135.7727], notes: "Recomendado a la noche" },
          { name: "Templo Komyo-in", coords: [34.9691, 135.7733], notes: "Lindo al atardecer" },
          { name: "Río Kamo", coords: [35.0000, 135.7700], notes: null }
        ]
      },
      "2026-03-12": {
        label: "Jue 12",
        color: "#5ac8fa",
        activities: [
          { name: "Kiyomizu-dera", coords: [34.9949, 135.7850], notes: null },
          { name: "Ishibe Alley", coords: [34.9978, 135.7807], notes: null },
          { name: "Ninenzaka & Sanneizaka", coords: [34.9966, 135.7801], notes: "Muy concurrido" },
          { name: "Yasaka Koshindo", coords: [34.9965, 135.7785], notes: null },
          { name: "Kawai Kanjiro's House", coords: [34.9932, 135.7791], notes: null }
        ]
      },
      "2026-03-13": {
        label: "Vie 13",
        color: "#af52de",
        activities: [
          { name: "Arashiyama Bamboo Forest", coords: [35.0171, 135.6716], notes: null },
          { name: "Okochi Sanso Garden", coords: [35.0185, 135.6700], notes: null },
          { name: "Arashiyama Park Kameyama", coords: [35.0152, 135.6763], notes: null },
          { name: "Templo Tenryu-ji", coords: [35.0154, 135.6748], notes: null },
          { name: "Monkey Park Iwatayama", coords: [35.0110, 135.6780], notes: null },
          { name: "Arashiyama East Park", coords: [35.0133, 135.6800], notes: null }
        ]
      }
    }
  },
  osaka: {
    name: "Osaka",
    center: [34.6900, 135.5000],
    zoom: 12,
    hotel: { name: "Shizutetsu Hotel Prezio Shinsaibashi", coords: [34.6789, 135.4983] },
    dates: "14–17 Mar 2026",
    days: {
      "2026-03-14": {
        label: "Sáb 14",
        color: "#ff3b30",
        activities: [
          { name: "Check-in Shizutetsu Hotel", coords: [34.6789, 135.4983], notes: null },
          { name: "Dotonbori", coords: [34.6685, 135.5015], notes: null },
          { name: "Hozen-ji Temple", coords: [34.6688, 135.5037], notes: null },
          { name: "Kuromon Market", coords: [34.6639, 135.5068], notes: null },
          { name: "Namba Yasaka Shrine", coords: [34.6621, 135.4975], notes: null }
        ]
      },
      "2026-03-15": {
        label: "Dom 15",
        color: "#34c759",
        activities: [
          { name: "Osaka Castle Walking Tour", coords: [34.6850, 135.5240], notes: "09:00 · Lawson S Otemae Rest House" },
          { name: "Tenma & Tenmabashi", coords: [34.7025, 135.5130], notes: null },
          { name: "Osaka Tenmangu", coords: [34.7025, 135.5150], notes: null },
          { name: "Nakazaki", coords: [34.7075, 135.5033], notes: "Vintage y coffee hopping" }
        ]
      },
      "2026-03-16": {
        label: "Lun 16",
        color: "#007aff",
        activities: [
          { name: "Universal Studios Japan", coords: [34.6654, 135.4323], notes: "Día completo · Reserva confirmada" }
        ]
      },
      "2026-03-17": {
        label: "Mar 17",
        color: "#af52de",
        hasOptions: true,
        activities: [
          { name: "Templo Katsuo-ji + Minoh Falls", coords: [34.8781, 135.4869], notes: "Ir temprano, taxi a Dainichi Parking", optional: "A" },
          { name: "Día libre", coords: [34.6900, 135.5000], notes: "Explorar Osaka a tu ritmo", optional: "B", isGeneric: true }
        ]
      }
    }
  },
  naoshima: {
    name: "Naoshima",
    center: [34.4600, 133.9950],
    zoom: 13,
    hotel: { name: "UNO Hotel", coords: [34.4893, 133.9496] },
    dates: "18–19 Mar 2026",
    days: {
      "2026-03-18": {
        label: "Mié 18",
        color: "#ff3b30",
        activities: [
          { name: "Check-in UNO Hotel", coords: [34.4893, 133.9496], notes: null }
        ]
      },
      "2026-03-19": {
        label: "Jue 19",
        color: "#34c759",
        activities: [
          { name: "Naoshima Island", coords: [34.4600, 133.9950], notes: "Isla del arte" },
          { name: "Museos de Arte", coords: [34.4550, 133.9900], notes: "Chichu Art Museum, Benesse House, etc.", isGeneric: true }
        ]
      }
    }
  },
  hakone: {
    name: "Hakone",
    center: [35.2330, 139.1070],
    zoom: 12,
    hotel: { name: "Asante Inn", coords: [35.2330, 139.1070] },
    dates: "20–21 Mar 2026",
    days: {
      "2026-03-20": {
        label: "Vie 20",
        color: "#ff3b30",
        activities: [
          { name: "Check-in Asante Inn", coords: [35.2330, 139.1070], notes: null }
        ]
      },
      "2026-03-21": {
        label: "Sáb 21",
        color: "#34c759",
        activities: [
          { name: "Recorrer Hakone", coords: [35.2330, 139.1070], notes: "Onsen, vistas del Fuji", isGeneric: true }
        ]
      }
    }
  },
  tokyo2: {
    name: "Tokyo",
    center: [35.6762, 139.7050],
    zoom: 12,
    hotel: { name: "Via Inn Prime Akasaka", coords: [35.6747, 139.7371] },
    dates: "22–23 Mar 2026",
    days: {
      "2026-03-22": {
        label: "Dom 22",
        color: "#ff3b30",
        activities: [
          { name: "Check-in Via Inn Prime Akasaka", coords: [35.6747, 139.7371], notes: "Check-in 15:00" }
        ]
      },
      "2026-03-23": {
        label: "Lun 23",
        color: "#34c759",
        activities: [
          { name: "Última recorrida y compras", coords: [35.6762, 139.7050], notes: "Check-out 10:00 · Dejar bolsos en hotel", isGeneric: true }
        ]
      }
    }
  }
};
