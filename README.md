# 🗾 Itinerario Japón 2025-2026

Sitio web interactivo con mapas del itinerario completo de viaje por Japón. Incluye rutas optimizadas, puntos de interés y alojamientos para cada ciudad.

## 🌟 Características

- ✅ **Mapas interactivos** con Leaflet y OpenStreetMap
- ✅ **Diseño responsive** optimizado para móviles y tablets
- ✅ **Navegación intuitiva** entre diferentes ciudades
- ✅ **Marcadores personalizados** por día con códigos de color
- ✅ **Enlaces directos** a Google Maps para cada ubicación
- ✅ **SEO optimizado** con meta tags y Open Graph
- ✅ **Accesible** con soporte para lectores de pantalla
- ✅ **Performance** con lazy loading y recursos optimizados

## 📍 Ciudades Incluidas

1. **Tokyo** (22 feb - 1 mar 2025) - 8 días con itinerario completo
2. **Nagoya** (2-4 mar 2026) - Incluye visita al Ghibli Park
3. **Takayama** (4-8 mar 2026) - Pueblo tradicional en las montañas
4. **Kyoto** (8-14 mar 2026)
5. **Osaka** (14-18 mar 2026)
6. **Tamano / Naoshima** (18-20 mar 2026) - Isla de arte contemporáneo
7. **Hakone** (20-22 mar 2026) - Onsen y vistas del Monte Fuji

## 🗂️ Estructura del Proyecto

```
PruebaMapJapan/
├── index.html              # Página principal (Tokyo)
├── nagoya.html            # Nagoya
├── takayama.html          # Takayama
├── kyoto.html             # Kyoto
├── osaka.html             # Osaka
├── tamano-naoshima.html   # Tamano/Naoshima
├── hakone.html            # Hakone
├── styles.css             # Estilos globales
├── assets/
│   ├── favicon.svg        # Favicon del sitio
│   ├── leaflet/           # Librería de mapas Leaflet
│   │   ├── leaflet.css
│   │   └── leaflet.js
│   └── js/
│       ├── navigation.js  # Lógica de navegación activa
│       └── simple-map.js  # Inicializador de mapas simples
└── README.md              # Este archivo
```

## 🚀 Uso

### Abrir localmente

1. Clona o descarga el repositorio
2. Abre cualquier archivo `.html` en tu navegador
3. No requiere servidor - funciona directamente desde el sistema de archivos

### Desplegar en la web

Puedes hospedar este proyecto en cualquier servicio de hosting estático:

- **GitHub Pages**: Sube el repositorio y activa GitHub Pages
- **Netlify**: Arrastra la carpeta al panel de Netlify
- **Vercel**: Conecta el repositorio de GitHub
- **Cualquier servidor web**: Sube los archivos por FTP/SFTP

## 🎨 Personalización

### Colores

Los colores principales se definen en `styles.css` usando variables CSS:

```css
:root {
    --bg: #f2f5f8;
    --accent: #0f6ccf;
    --accent-strong: #0a4e9a;
    /* ... más colores */
}
```

### Agregar nueva ciudad

1. Duplica uno de los archivos HTML existentes (ej: `kyoto.html`)
2. Actualiza el contenido del `<head>`:
   - Title, description, keywords
3. Modifica el objeto `hotel` con los datos de alojamiento:
   ```javascript
   const hotel = {
       name: "Nombre del hotel",
       address: "Dirección completa",
       lat: 00.0000000,
       lng: 00.0000000
   };
   ```
4. Actualiza las fechas y contenido del mapa
5. Agrega el link en la navegación de todos los archivos HTML

### Modificar el mapa de Tokyo

El mapa de Tokyo (index.html) tiene una estructura más compleja con múltiples días:

```javascript
const days = [
    {
        name: 'Día 1 - Descripción',
        color: '#e74c3c',
        summary: 'Resumen del día',
        stops: [
            { name: 'Lugar', lat: 00.000, lng: 00.000, note: 'Nota' }
        ]
    }
];
```

## 🔧 Tecnologías Utilizadas

- **HTML5** - Estructura semántica
- **CSS3** - Estilos con variables CSS y Grid/Flexbox
- **JavaScript ES6+** - Lógica y mapas interactivos
- **Leaflet.js** - Librería de mapas de código abierto
- **OpenStreetMap** - Tiles de mapa gratuitos
- **Google Fonts** - Tipografía Space Grotesk

## ♿ Accesibilidad

El sitio incluye características de accesibilidad:

- Skip links para saltar al contenido principal
- Navegación con teclado completa
- Atributos ARIA apropiados
- Contraste de color accesible (WCAG AA)
- Soporte para `prefers-reduced-motion`
- Etiquetas semánticas HTML5

## 📱 Responsive Design

El sitio está optimizado para:

- 📱 Móviles (320px+)
- 📱 Tablets (768px+)
- 💻 Laptops (1024px+)
- 🖥️ Desktops (1200px+)

## 🌐 SEO

Cada página incluye:

- Meta descriptions únicas
- Keywords relevantes
- Open Graph tags para redes sociales
- Twitter Card tags
- Title tags descriptivos
- Favicon SVG moderno

## 📝 Licencia

Este proyecto es personal y está bajo dominio privado. Si quieres usar partes del código, siéntete libre de hacerlo.

## 🤝 Contribuciones

Este es un proyecto personal de itinerario de viaje. No se aceptan contribuciones externas.

## 📧 Contacto

Si tienes preguntas sobre la estructura del código o la implementación, puedes revisar el código fuente que está bien comentado.

---

**Nota**: Los datos de hoteles y ubicaciones son específicos para este viaje. Actualiza las coordenadas y direcciones según tus necesidades.
