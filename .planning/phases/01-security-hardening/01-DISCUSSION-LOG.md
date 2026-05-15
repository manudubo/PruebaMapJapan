# Phase 1: Security Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-26
**Phase:** 01-security-hardening
**Areas discussed:** innerHTML fix breadth, dom.ts API design, Keycloak audience scope, DOMPurify placement

---

## innerHTML Fix Breadth

| Option | Description | Selected |
|--------|-------------|----------|
| Required 3 files only | dashboard.ts, tripDetail.ts, map.ts — the 11+ sites named in SEC-01. widgets.ts / profile.ts / SearchBar.ts deferred. | ✓ |
| All user-data innerHTML sites | Also fix widgets.ts, profile.ts, SearchBar.ts. Bigger diff, but leaves no injection surface behind. | |
| Required 3 + profile.ts | Add profile.ts due to personally identifying passkey data. | |

**User's choice:** Required 3 files only
**Notes:** None

---

## dom.ts API Design

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal: setText + setStyle | setText(el, text) sets textContent. setStyle(el, prop, value) uses el.style.setProperty(). Exactly covers SEC-01 scope. | ✓ |
| Richer: add createElement + setAttr | Also exports createElement and setAttr. Useful for Phase 2 Trip Builder. | |
| Ultra-minimal: just setText | Handle style attributes directly at call sites, not through dom.ts. | |

**User's choice:** Minimal: setText + setStyle

### Style Attribute Sanitization

| Option | Description | Selected |
|--------|-------------|----------|
| el.style.setProperty() via setStyle | Browser parses CSS value — script injection blocked. Safe, zero dependencies. | ✓ |
| CSS custom property | Set --cover-image / --day-color, read via var() in CSS. More indirection. | |

**User's choice:** el.style.setProperty() via setStyle
**Notes:** None

---

## Keycloak Audience Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — update realm-export.json | Add audience mapper for japan-trip-frontend in realm-export.json. Complete fix. | ✓ |
| Code-only + dev note | Remove 'account' from validAudiences, leave TODO for Keycloak admin action. | |

**User's choice:** Yes — update realm-export.json

### Accepted Audiences

| Option | Description | Selected |
|--------|-------------|----------|
| japan-trip-frontend only | Matches SEC-04 exactly. Single audience, smaller attack surface. | ✓ |
| Both japan-trip-api and japan-trip-frontend | Keeps a second accepted audience. | |

**User's choice:** japan-trip-frontend only
**Notes:** None

---

## DOMPurify Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Leaflet popups only | buildPopup and buildHotelPopup in tripDetail.ts — exactly SEC-02. textContent path needs no sanitization. | ✓ |
| Also guard dom.ts setHtml | Add setHtml(el, html) to dom.ts running DOMPurify before innerHTML. | |

**User's choice:** Leaflet popups only

### DOMPurify Install Method

| Option | Description | Selected |
|--------|-------------|----------|
| npm install dompurify | Bundled by Vite, TypeScript types via @types/dompurify, tree-shaken. | ✓ |
| CDN script tag | No npm dep but breaks module boundary. | |

**User's choice:** npm install dompurify
**Notes:** None

---

## Claude's Discretion

- @types/dompurify version selection
- Exact structure of audience mapper in realm-export.json
- Comment style on dom.ts functions (follow project no-comment-unless-why convention)

## Deferred Ideas

- innerHTML in widgets.ts, profile.ts, SearchBar.ts — future cleanup phase
- CSP response header — future milestone
