# Japón 2026 – Itinerario Interactivo

Aplicación web minimalista con diseño Liquid Glass para visualizar el itinerario de viaje a Japón.

## Fechas

| Ciudad | Fechas | Días | Hotel |
|--------|--------|------|-------|
| Tokyo | 22 Feb – 1 Mar | 8 | Via Inn Prime Akasaka |
| Nagoya | 2–3 Mar | 2 | Hotel Trusty Nagoya Shirakawa |
| Takayama | 4–7 Mar | 4 | Amanek Takayama Hotel |
| Kyoto | 8–13 Mar | 6 | Hotel Amanek Kyoto Kawaramachi Gojo |
| Osaka | 14–17 Mar | 4 | Shizutetsu Hotel Prezio Shinsaibashi |
| Naoshima | 18–19 Mar | 2 | UNO Hotel |
| Hakone | 20–21 Mar | 2 | Asante Inn |
| Tokyo (Final) | 22–23 Mar | 2 | Via Inn Prime Akasaka |

## Características

- Diseño Liquid Glass mejorado con efectos de cristal
- Modo claro / oscuro con toggle y persistencia
- Mapas interactivos (Leaflet + CARTO tiles)
- Countdown en tiempo real hasta la llegada
- Filtro por día con indicador de opcionales
- Botón para centrar en hotel
- Marcadores diferenciados para actividades opcionales
- Responsive (mobile-first)
- Sin emojis, tipografía Inter
- Compatible con GitHub Pages (100% client-side)

## Nuevas Funcionalidades (v2)

### Links a Google Maps en Popups
- Cada actividad en el mapa muestra un popup con:
  - **"Ver en Maps"**: Abre la ubicación exacta en Google Maps (nueva pestaña)
  - **"Cómo llegar"**: Abre direcciones desde tu ubicación con transporte público preseleccionado
- Las actividades genéricas (días libres, etc.) no muestran estos links

### Navbar Mejorada para Mobile
- Scrollbar horizontal siempre visible para indicar navegación
- Al cargar, la navbar se centra automáticamente en la ciudad activa

### Actividades Agrupadas por Día
- La sección inferior de cada página ahora agrupa las actividades por día
- Header con color del día y nombre
- Los días con opciones tienen indicador visual
- Filtrar por día también filtra la lista de actividades

### Botones de Acción en Cards de Actividades
- Cada actividad tiene dos botones:
  - **Ícono de ubicación**: Ver en Google Maps
  - **Ícono de flecha**: Cómo llegar (transporte público)
- En mobile los botones se expanden para mejor usabilidad

## Opcionales

Algunos días tienen actividades opcionales (no todas se pueden hacer):
- **Takayama 6 Mar**: Opciones de ski A, B o C
- **Takayama 7 Mar**: Opcionales 1, 2 o 3
- **Osaka 17 Mar**: Opción A (Katsuo-ji + Minoh) o B (Día libre)

Los días con opciones se muestran con borde punteado morado.

## Reservas confirmadas

- TeamLab Planets: 24 Feb 19:00
- Ghibli Park: 2 Mar 11:00
- Nintendo Museum: 11 Mar 14:00–14:30
- Universal Studios: 16 Mar

## Estructura

```
├── index.html        # Vista general con countdown
├── tokyo.html        
├── nagoya.html       
├── takayama.html     
├── kyoto.html        
├── osaka.html        
├── naoshima.html     
├── hakone.html       
├── tokyo2.html       # Últimos días
├── styles.css        # Liquid Glass CSS
└── assets/
    └── js/
        └── main.js   # Datos y lógica
```

## Despliegue en GitHub Pages

1. Subir todos los archivos al repositorio
2. Ir a Settings > Pages
3. Seleccionar branch `main` y carpeta `/ (root)`
4. El sitio estará disponible en `https://[usuario].github.io/[repo]`

## Tecnologías

- Leaflet.js
- CARTO Tiles (light/dark)
- Inter (Google Fonts)
- CSS Variables + Backdrop Filter
- JavaScript vanilla (sin dependencias)

## Notas sobre Google Maps

Los links de Google Maps usan URLs cortas reales de `maps.app.goo.gl` extraídas del Excel de planificación. Cada ubicación tiene su URL específica que:
- Abre directamente la ubicación correcta en Google Maps
- En móviles, abre la app de Google Maps si está instalada
- Permite obtener direcciones fácilmente desde la ubicación actual

Los links "Cómo llegar" usan la misma URL corta que al hacer click en Google Maps permite elegir el modo de transporte (recomendado: transporte público).
