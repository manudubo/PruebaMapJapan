# Phase 2: Trip Builder - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-28
**Phase:** 02-trip-builder
**Areas discussed:** Edit form placement

---

## Edit form placement

| Option | Description | Selected |
|--------|-------------|----------|
| Modal overlay | Reuses .overlay/.modal pattern — consistent with destructive confirm and dashboard create-trip form. Focus trapping, Escape to cancel already wired. | ✓ |
| Inline expand | Row expands below to show form in-context. No overlay. More complex DOM state per row. | |

**User's choice:** Modal overlay

**Notes:** User confirmed via mockup preview showing Ciudad/País/Llegada/Salida/Coords fields with Cancelar + Guardar buttons.

---

## Add form placement

| Option | Description | Selected |
|--------|-------------|----------|
| Same modal for add and edit | Title changes ("Agregar" vs "Editar"), fields empty for add, pre-filled for edit. Single modal DOM element per entity type. | ✓ |
| Inline add form at bottom of list | Add form as blank row at list bottom; edit still uses modal. Two distinct patterns. | |

**User's choice:** Same modal for add and edit

---

## Claude's Discretion

- Activity time field UX: use `<input type="time">` (HH:MM picker) — column is text, picker output is a valid string
- "Generate all days" conflict: smart merge (add only missing days, keep existing)
- Single vs. separate modal DOM elements per entity type: Claude's choice

## Deferred Ideas

- Activity time UX discussion (not selected by user)
- "Generate all days" conflict handling (not selected by user)
