---
phase: 05-internationalization-translate-all-user-facing-ui-strings-ht
plan: "04"
subsystem: frontend/city-html-pages
tags: [i18n, html, translation, spanish-to-english]
dependency_graph:
  requires: [05-01]
  provides: [translated-city-html-pages]
  affects: [frontend/tokyo.html, frontend/kyoto.html, frontend/osaka.html, frontend/nagoya.html, frontend/naoshima.html, frontend/takayama.html, frontend/hakone.html, frontend/tokyo2.html]
tech_stack:
  added: []
  patterns: [static-html-translation]
key_files:
  modified:
    - frontend/tokyo.html
    - frontend/kyoto.html
    - frontend/osaka.html
    - frontend/nagoya.html
    - frontend/naoshima.html
    - frontend/takayama.html
    - frontend/hakone.html
    - frontend/tokyo2.html
decisions:
  - Applied translation to actual 8 worktree city pages (nagoya, naoshima, takayama, tokyo2) instead of plan-listed cities (hiroshima, nara, nikko, kamakura) which do not exist
  - Only translated aria-labels present in each file; did not add missing aria-labels to stripped-down pages
metrics:
  duration: "~10 minutes"
  completed: "2026-05-13"
  tasks_completed: 2
  files_modified: 8
---

# Phase 05 Plan 04: City HTML Pages Translation Summary

All 8 city HTML files translated from Spanish to English: lang attribute, meta descriptions, page titles, skip-links, date strings, aria-labels, and h3 headings.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Translate tokyo.html, kyoto.html, osaka.html, nagoya.html | 6c30c65 | 4 city HTML files |
| 2 | Translate naoshima.html, takayama.html, hakone.html, tokyo2.html | 15da882 | 4 city HTML files |

## Changes Applied Per File

For each of the 8 files, the following transformations were applied:

1. `lang="es"` → `lang="en"` on `<html>` element
2. `meta description`: Spanish text → English (city-specific)
3. `<title>`: "Japón" → "Japan"
4. Skip-link: "Saltar al contenido principal" → "Skip to main content"
5. Date string: "DD Mes YYYY · N días" → "Mon DD – DD, YYYY · N days" (en-US)
6. `title="Ir al hotel"` → `title="Go to hotel"`
7. `<h3>Actividades</h3>` → `<h3>Activities</h3>`

tokyo.html additionally had full aria-label set translated:
- `aria-label="Filtrar por día"` → `aria-label="Filter by day"`
- `aria-label="Mapa de Tokyo"` → `aria-label="Map of Tokyo"`
- `aria-label="Centrar mapa en hotel"` → `aria-label="Center map on hotel"`
- `aria-label="Leyenda de actividades"` → `aria-label="Activity legend"`

## Date Translations (en-US format)

| File | Spanish | English |
|------|---------|---------|
| tokyo.html | 22 Febrero – 1 Marzo 2026 · 8 días | Feb 22 – Mar 1, 2026 · 8 days |
| nagoya.html | 2 – 3 Marzo 2026 · 2 días | Mar 2 – 3, 2026 · 2 days |
| takayama.html | 4 – 7 Marzo 2026 · 4 días | Mar 4 – 7, 2026 · 4 days |
| kyoto.html | 8 – 13 Marzo 2026 · 6 días | Mar 8 – 13, 2026 · 6 days |
| osaka.html | 14 – 17 Marzo 2026 · 4 días | Mar 14 – 17, 2026 · 4 days |
| naoshima.html | 18 – 19 Marzo 2026 · 2 días | Mar 18 – 19, 2026 · 2 days |
| hakone.html | 20 – 21 Marzo 2026 · 2 días | Mar 20 – 21, 2026 · 2 days |
| tokyo2.html | 22 – 23 Marzo 2026 · 2 días | Mar 22 – 23, 2026 · 2 days |

## Deviations from Plan

### File-list Mismatch (Rule 3 — Blocked by non-existent files)

The plan listed: tokyo, kyoto, osaka, **hiroshima, nara, nikko, kamakura**, hakone.

The worktree contains: tokyo, kyoto, osaka, **nagoya, naoshima, takayama**, hakone, **tokyo2**.

The 4 plan-listed files (hiroshima, nara, nikko, kamakura) do not exist. The intent — translate all 8 city HTML files — was applied to the 8 actual files in the worktree. This is documented as a plan authoring error, not a functional deviation.

### Sparse aria-labels (no deviation — correct behavior)

Only tokyo.html has the full aria-label set. The other 7 files use stripped-down markup without role/aria attributes. No attributes were added; only existing Spanish text was translated.

## Known Stubs

None. All city-specific values (dates, city names in descriptions) are hardcoded real trip data.

## Self-Check: PASSED

- frontend/tokyo.html — modified, committed at 6c30c65
- frontend/kyoto.html — modified, committed at 6c30c65
- frontend/osaka.html — modified, committed at 6c30c65
- frontend/nagoya.html — modified, committed at 6c30c65
- frontend/naoshima.html — modified, committed at 15da882
- frontend/takayama.html — modified, committed at 15da882
- frontend/hakone.html — modified, committed at 15da882
- frontend/tokyo2.html — modified, committed at 15da882
- Zero Spanish accent characters in all 8 city HTML files (verified via rg)
- Zero `lang="es"` in all 8 city HTML files (verified via rg)
