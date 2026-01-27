// Google Maps URLs mapping
// Source: Areas Japon.xlsx

const MAPS_URLS: Record<string, string> = {
  // Tokyo
  "Via Inn Prime Akasaka": "https://maps.app.goo.gl/FJ2AmEECHEvtAf1B9",
  "Palacio Imperial (Kōkyo)": "https://maps.app.goo.gl/V5gwBaj5LM7DdZ4w8",
  "Santuario Hie": "https://maps.app.goo.gl/P1ZPEG3Wq8LHUJLr5",
  "Akasaka Hikawa Shrine": "https://maps.app.goo.gl/MMZoWfnhJbg4LFZk7",
  "National Art Center Tokyo": "https://maps.app.goo.gl/rfcQgvweqZeqt5GS8",
  "21_21 Design Sight": "https://maps.app.goo.gl/YS6jGMYPqHBN8yb8A",
  "TeamLab Planets": "https://maps.app.goo.gl/JadxgYPibYbcEaCNA",
  "Tsukiji Fish Market": "https://maps.app.goo.gl/RbauhHqFirrokYNf9",
  "Okuno Building": "https://maps.app.goo.gl/BRwNHiAWWjBu3irXA",
  "Jardines Hamarikyu": "https://maps.app.goo.gl/uxUiGuVj8XUHthwg6",
  "Institute for Nature Study": "https://maps.app.goo.gl/zzY3qRvUpq7uuuWh8",
  "2 Chome-1 Dogenzaka": "https://maps.app.goo.gl/zjRcWPMfx4dbw7J16", // Walking Tour Shibuya point
  "Walking Tour Shibuya": "https://maps.app.goo.gl/zjRcWPMfx4dbw7J16",
  "Santuario Meiji": "https://maps.app.goo.gl/P9AHzT2FpTsfnirx7",
  "Yoyogi Park": "https://maps.app.goo.gl/azkhRgb5w24ai8bs5",
  "R32 Ichioku Tours": "https://maps.app.goo.gl/3x3Us6dSboMzmHHx6",
  "Hanazono Shrine": "https://maps.app.goo.gl/51qUuoaWjyHhjZJC9",
  "Omoide Yokocho": "https://maps.app.goo.gl/ypmbomBkweFSFZPM7",
  "Golden-Gai": "https://maps.app.goo.gl/zZP451VFmtGaru1j6",
  "Shinjuku Gyoen": "https://maps.app.goo.gl/VuoxugzTZJjRqnCt8",
  "Walking Tour Shinjuku": "https://maps.app.goo.gl/SGww3HoLXAXtdQbf6",
  "Jardín Botánico Koishikawa": "https://maps.app.goo.gl/kPFsJ9VV8ay6xFqAA",
  "Tokyo City Flea Market": "https://maps.app.goo.gl/5hQDTrh1LspvjuZ6A",
  "Shimokitazawa": "https://maps.app.goo.gl/EvKWWttKi1ahhw4H8",

  // Nagoya
  "Hotel Trusty Nagoya Shirakawa": "https://maps.app.goo.gl/Yoia569FJnB1up5MA",
  "Ghibli Park": "https://maps.app.goo.gl/sY8BZo8bQPQtds199",

  // Takayama
  "Amanek Takayama Hotel": "https://maps.app.goo.gl/9mjsh3fECxZhohNj8",
  "Hida no Sato Folk Village": "https://maps.app.goo.gl/5dKbgcizZrAxkyLZ9",
  "Shirakawa-go": "https://maps.app.goo.gl/H9waF7h4BjHUHQ818",
  "Hounokidaira Ski Area": "https://maps.app.goo.gl/kRw9xcPJPpQ7xkEd8",
  "Shinhotaka Ropeway": "https://maps.app.goo.gl/gVdzn5NgvUrB7oYf9",
  "Gokayama": "https://maps.app.goo.gl/nxV8cAcb8QHiTMd37",

  // Kyoto
  "Hotel Amanek Kyoto Kawaramachi Gojo": "https://maps.app.goo.gl/r6dyhYeh6dS8q7HN7",
  "Gion": "https://maps.app.goo.gl/xQxMxRgCMwfYqQCh7",
  "Hanamikoji-dori": "https://maps.app.goo.gl/NiWVBsDLMBk5gGQ27",
  "Parque Maruyama": "https://maps.app.goo.gl/LzkLiQGg37kFtFeY8",
  "Santuario Yasaka": "https://maps.app.goo.gl/8jDHiGJbKwBE2XHn7",
  "Puente Shijo": "https://maps.app.goo.gl/xmmFimdV5ZkgVSmLA",
  "Pontocho Alley": "https://maps.app.goo.gl/RwLEEbKuWjSubqAZ7",
  "Mercado Nishiki": "https://maps.app.goo.gl/J8twELbyYxsBoTKz8",
  "Uji": "https://maps.app.goo.gl/M8gVetzanqaQpTYE9",
  "Nintendo Museum": "https://maps.app.goo.gl/8azBeVxi7ERnmtWf6",
  "Fushimi Inari Taisha": "https://maps.app.goo.gl/vMAcsJ4shHcjyMpr5",
  "Templo Komyo-in": "https://maps.app.goo.gl/hP2Q71nBcidg4DqC9",
  "Río Kamo": "https://maps.app.goo.gl/Rp53QtCaUnobA4rQ8",
  "Kiyomizu-dera": "https://maps.app.goo.gl/WUG1VfDvHcwNcucK8",
  "Ishibe Alley": "https://maps.app.goo.gl/MwZRNsHu1MvZivaUA",
  "Ninenzaka & Sanneizaka": "https://maps.app.goo.gl/GYYNnsUT7FTUsmG39",
  "Yasaka Koshindo": "https://maps.app.goo.gl/V2UNGnrmNcxKv7Pk7",
  "Kawai Kanjiro's House": "https://maps.app.goo.gl/kj5YSweNsWaDD6ub9",
  "Arashiyama Bamboo Forest": "https://maps.app.goo.gl/KNxwUwf77bTSX5ck8",
  "Okochi Sanso Garden": "https://maps.app.goo.gl/MrANoJGdUbcNTvsF7",
  "Arashiyama Park Kameyama": "https://maps.app.goo.gl/Vf5ogK3C4mNTvsTK7",
  "Templo Tenryu-ji": "https://maps.app.goo.gl/XkwZJ6UdwyLygDHs6",
  "Monkey Park Iwatayama": "https://maps.app.goo.gl/pSwPiRxab3QRMR846",
  "Arashiyama East Park": "https://maps.app.goo.gl/j5YnsXn62zbBJ5TB8",

  // Osaka
  "Shizutetsu Hotel Prezio Shinsaibashi": "https://maps.app.goo.gl/WJi1sYEh9JjN5NVr5",
  "Dotonbori": "https://maps.app.goo.gl/4kGeKczmbLFaqFM67",
  "Hozen-ji Temple": "https://maps.app.goo.gl/zK5dVoxbWhraBfb59",
  "Kuromon Market": "https://maps.app.goo.gl/XvoYPDDPxahuqHRS7",
  "Namba Yasaka Shrine": "https://maps.app.goo.gl/EDwmdQ7qkCictkEh6",
  "Osaka Castle Walking Tour": "https://maps.app.goo.gl/NsiEymJJ1JJf5gKU8",
  "Tenma": "https://maps.app.goo.gl/G91Bc3NZ2w7upjZD8", // Mapped to Tenma general area
  "Tenma & Tenmabashi": "https://maps.app.goo.gl/G91Bc3NZ2w7upjZD8",
  "Osaka Tenmangu": "https://maps.app.goo.gl/gFn9M9wssSBX9uSKA",
  "Nakazaki": "https://maps.app.goo.gl/f49RFKnLK2y2wQUi9",
  "Universal Studios Japan": "https://maps.app.goo.gl/pmZG7kpWyJS8ppscA",
  "Templo Katsuo-ji": "https://maps.app.goo.gl/C8iQvpVAjXFi26kX9",
  "Templo Katsuo-ji + Minoh Falls": "https://maps.app.goo.gl/C8iQvpVAjXFi26kX9", // Main point
  "Minoh Falls": "https://maps.app.goo.gl/cRcu4xrQstb44Xdy5",

  // Naoshima & Hakone
  "UNO Hotel": "https://maps.app.goo.gl/XC3h5EcEoRbGZmtZ9",
  "Naoshima Island": "https://maps.app.goo.gl/DvSaukjSE9cPhET39",
  "Asante Inn": "https://maps.app.goo.gl/UgR6g5cmUjvzSNnd6",
};

export function getMapsUrl(name: string): string | null {
  return MAPS_URLS[name] ?? null;
}

export function hasMapsUrl(name: string): boolean {
  return name in MAPS_URLS;
}