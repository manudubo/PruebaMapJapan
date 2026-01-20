# Japón 2025 – Itinerario Interactivo

Aplicación web minimalista para visualizar el itinerario de viaje a Japón.

## Fechas

| Ciudad | Fechas | Días |
|--------|--------|------|
| Tokyo | 22 Feb – 1 Mar | 8 |
| Nagoya | 2–3 Mar | 2 |
| Takayama | 4–7 Mar | 4 |
| Kyoto | 8–13 Mar | 6 |
| Osaka | 14–17 Mar | 4 |

## Características

- Diseño Liquid Glass minimalista
- Modo claro / oscuro con toggle
- Mapas interactivos (Leaflet)
- Filtro por día
- Responsive (mobile-first)
- Sin emojis, tipografía Inter

## Reservas confirmadas

- TeamLab Planets: 24 Feb 19:00
- Ghibli Park: 2 Mar 11:00
- Nintendo Museum: 11 Mar 14:00–14:30

## Estructura

```
├── index.html      # Vista general
├── tokyo.html      
├── nagoya.html     
├── takayama.html   
├── kyoto.html      
├── osaka.html      
├── styles.css      # Liquid Glass CSS
└── assets/
    └── js/
        └── main.js # Datos y lógica
```

## Uso

Abrir `index.html` en un navegador. Requiere conexión a internet para cargar Leaflet y las fuentes.

## Tecnologías

- Leaflet.js
- CARTO Tiles (light/dark)
- Inter (Google Fonts)
- CSS Variables + Backdrop Filter
