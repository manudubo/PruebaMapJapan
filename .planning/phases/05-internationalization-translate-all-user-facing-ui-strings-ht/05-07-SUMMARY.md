---
phase: 05-internationalization-translate-all-user-facing-ui-strings-ht
plan: "07"
subsystem: frontend-i18n
tags: [i18n, translation, map, trip-detail]
dependency_graph:
  requires: [05-01]
  provides: [tripDetail.ts-translated, map.ts-translated]
  affects: [frontend/src/pages/tripDetail.ts, frontend/src/modules/map.ts]
tech_stack:
  added: []
  patterns: [string-literal-replacement]
key_files:
  modified:
    - frontend/src/pages/tripDetail.ts
    - frontend/src/modules/map.ts
decisions:
  - "Translated map.ts overview map announcement 'Mapa general cargado con 8 ciudades' to 'Overview map loaded with 8 cities' as a Rule 2 fix — string was in scope for this plan"
metrics:
  duration: "~10 min"
  completed: "2026-05-13"
  tasks: 1
  files: 2
---

# Phase 05 Plan 07: tripDetail.ts + map.ts Translation Summary

Translated all Spanish user-facing strings in tripDetail.ts (trip detail page) and map.ts (Leaflet map module) in a single atomic commit, preserving identical English text at all 13 shared string positions.

## Tasks

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Translate tripDetail.ts and map.ts together | 231354d | frontend/src/pages/tripDetail.ts, frontend/src/modules/map.ts |

## Strings Translated

### Shared (13 positions — identical in both files)

| Spanish | English |
|---------|---------|
| `Opción ${n}` | `Option ${n}` |
| `Ver en Maps` | `View on Maps` |
| `Cómo llegar` (popup span) | `Directions` |
| `Alojamiento` | `Accommodation` |
| `Filtrar por día` | `Filter by day` |
| `Este día tiene opciones alternativas` | `This day has alternative options` |
| `Centrar mapa en hotel` | `Center map on hotel` |
| `Mapa de ${name} cargado con ${n} ubicaciones` | `Map of ${name} loaded with ${n} locations` |
| `Mostrando todos los días` | `Showing all days` |
| `Mostrando ${label}: ${n} ubicaciones` | `Showing ${label}: ${n} locations` |
| `Lista de actividades por día` | `Activity list by day` |
| `Opciones` | `Options` |
| `Ver en Google Maps` (title) | `View on Google Maps` |
| `Cómo llegar` (title attr) | `Directions` |

### tripDetail.ts-only

| Spanish | English |
|---------|---------|
| `Destinos del viaje` | `Trip destinations` |
| `Volver al dashboard` | `Back to dashboard` |
| `No se pudo cargar el viaje: ${msg}` | `Could not load trip: ${msg}` |
| `No se especificó un viaje. Revisá la URL.` | `No trip specified. Check the URL.` |
| `No tenés acceso a este viaje. Pedile al dueño el enlace público.` | `You don't have access to this trip. Ask the owner for the public link.` |
| `¡Copiado!` | `Copied!` |
| `Copiar enlace público` | `Copy public link` |

### map.ts-only

| Spanish | English |
|---------|---------|
| `Ver itinerario` | `View itinerary` |
| `Mapa general cargado con 8 ciudades` | `Overview map loaded with 8 cities` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] Translated overview map Spanish announcement**
- **Found during:** Task 1
- **Issue:** `announceToScreenReader('Mapa general cargado con 8 ciudades')` in `initOverviewMap()` was not listed in the plan but is a Spanish string in the same file under translation
- **Fix:** Translated to `'Overview map loaded with 8 cities'`
- **Files modified:** frontend/src/modules/map.ts
- **Commit:** 231354d

## Verification

- `rg "[áéíóúñ¿¡]"` on both files: **0 matches**
- `rg "Ver en Maps|Cómo llegar|Alojamiento|Filtrar por día"` on both files: **0 matches**
- `rg "View on Maps"` on both files: **hits in both files**

## Known Stubs

None.

## Threat Flags

None — string-only changes, no auth or security surface modified.

## Self-Check: PASSED

- [x] frontend/src/pages/tripDetail.ts exists and modified
- [x] frontend/src/modules/map.ts exists and modified
- [x] Commit 231354d exists
- [x] Zero Spanish accent characters in both files
- [x] All 13 shared string positions identical in English across both files
