import type { Page } from '@playwright/test';

/**
 * Shared pieces of the mobile specs (mobile-*.spec.ts): the viewport matrix and an in-page audit
 * of the things that routinely break on phones. The audit runs inside the page so it sees the
 * layout the browser really computed (no guessing from CSS).
 */

/** Phone widths in CSS px: iPhone SE 1st gen / small Android, Galaxy S, iPhone mini, 13/14, Plus, Pro Max. */
export const PHONE_WIDTHS = [320, 360, 375, 390, 414, 430] as const;
/** Landscape phone (iPhone SE/8-class) and the two common tablet widths. */
export const LANDSCAPE = { width: 667, height: 375 } as const;
export const TABLETS = [768, 1024] as const;

/** A phone is tall: 2.1:1 is typical for current devices, so heights follow the width. */
export const phoneViewport = (width: number) => ({ width, height: Math.round(width * 2.05) });

/** WCAG 2.5.5 (AAA) and the iOS HIG / Material guidance: a finger needs 44x44 CSS px. */
export const MIN_TARGET = 44;
/** Safari zooms the page into any focused field whose font-size is below 16px. */
export const MIN_INPUT_FONT = 16;

export interface Offender {
  /** CSS-ish path to find the element (tag#id.class), plus its text for readability. */
  el: string;
  detail: string;
}

export interface AuditOptions {
  /** Extra selectors to ignore (e.g. an element the spec has proven is intentionally small). */
  ignore?: string[];
  /** Skip the target-size rule (e.g. a map, whose tiles/markers are not tap targets). */
  targets?: boolean;
}

export interface AuditResult {
  hscroll: { scrollWidth: number; clientWidth: number } | null;
  smallTargets: Offender[];
  smallInputs: Offender[];
  clipped: Offender[];
}

/**
 * Walk the DOM and report: horizontal page scroll, interactive elements under 44x44, text inputs
 * under 16px (iOS focus-zoom) and interactive elements pushed outside the viewport.
 *
 * Deliberate exemptions (kept here, in one place, so they are reviewable):
 *  - links that sit inside running text (WCAG 2.5.8 "inline" exception),
 *  - the skip link while it is off-screen,
 *  - elements inside a scroll container are only checked against that container's own bounds,
 *  - the Leaflet attribution links (legal text, inline with the attribution sentence),
 *  - visually hidden native inputs whose styled label is the target (the label is measured).
 */
export async function audit(page: Page, options: AuditOptions = {}): Promise<AuditResult> {
  return page.evaluate(
    ({ ignore, targets, min, minFont }) => {
      const describe = (e: Element): string => {
        const h = e as HTMLElement;
        const id = h.id ? `#${h.id}` : '';
        const cls = typeof h.className === 'string' && h.className.trim() ? `.${h.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
        const txt = (h.innerText || h.getAttribute('aria-label') || h.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 30);
        return `${e.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
      };
      const ignored = (e: Element) => ignore.some((s) => e.closest(s));
      const visible = (e: Element): boolean => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        for (let n: Element | null = e; n; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
          if (n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true') return false;
          if (cs.clip !== 'auto' && /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip)) return false;
        }
        return true;
      };
      const scrollParent = (e: Element): Element | null => {
        for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) {
          const o = getComputedStyle(n).overflowX;
          if (o === 'auto' || o === 'scroll') return n;
        }
        return null;
      };
      const isInlineText = (e: Element): boolean => {
        if (e.tagName !== 'A') return false;
        if (getComputedStyle(e).display !== 'inline') return false;
        const parent = e.parentElement;
        if (!parent) return false;
        const own = Array.from(parent.childNodes).some((c) => c.nodeType === 3 && (c.textContent ?? '').trim().length > 2);
        return own;
      };

      const root = document.scrollingElement!;
      const hscroll = root.scrollWidth > root.clientWidth + 1 ? { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth } : null;

      const sel = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=option], [role=menuitem], [role=link], [tabindex="0"]';
      const smallTargets: { el: string; detail: string }[] = [];
      const smallInputs: { el: string; detail: string }[] = [];
      const clipped: { el: string; detail: string }[] = [];
      const vw = document.documentElement.clientWidth;

      // <travel-nav> and <search-bar> keep their controls in open shadow roots: walk into them.
      const collect = (root: ParentNode): Element[] => {
        const out = Array.from(root.querySelectorAll(sel));
        for (const host of Array.from(root.querySelectorAll('*'))) {
          if (host.shadowRoot) out.push(...collect(host.shadowRoot));
        }
        return out;
      };
      for (const e of collect(document)) {
        if (ignored(e) || e.closest('.leaflet-control-attribution')) continue;
        if (e.classList.contains('skip-link')) continue;
        // A "stretched link": its ::after covers the whole card, so the card is the target.
        if (e.tagName === 'A' && getComputedStyle(e, '::after').position === 'absolute') continue;
        const isNativeCheck = e instanceof HTMLInputElement && (e.type === 'checkbox' || e.type === 'radio');
        // A native check/radio is measured through its label (the bigger, tappable thing).
        const target: Element = isNativeCheck ? e.closest('label') ?? e : e;
        if (!visible(target)) continue;
        const r = target.getBoundingClientRect();

        // Leaflet markers: the map is pannable, so a marker outside the viewport is not clipped,
        // and the glyph (28px) is smaller than the finger target the CSS gives it as a hit area.
        const marker = e.classList.contains('leaflet-marker-icon');
        if (marker) {
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const mapBox = e.closest('.leaflet-container')!.getBoundingClientRect();
          const vh = window.innerHeight;
          const inView = (x: number, y: number) => x >= 0 && x < vw - 1 && y >= 0 && y < vh - 1
            && x >= mapBox.left && x <= mapBox.right && y >= mapBox.top && y <= mapBox.bottom;
          // Probe the four edges of a 44x44 box centred on the marker; each probe must land on
          // a marker (this one or a neighbour that legitimately overlaps), not on the bare map.
          // Probes that fall off-screen, outside the map or onto a map control are not testable.
          const half = min / 2 - 2;
          const probes: Array<[number, number]> = [[cx - half, cy], [cx + half, cy], [cx, cy - half], [cx, cy + half]];
          const miss = probes.filter(([x, y]) => {
            if (!inView(x, y)) return false;
            const hit = document.elementFromPoint(x, y);
            return !hit?.closest('.leaflet-marker-icon, .leaflet-control, .leaflet-popup, .leaflet-interactive');
          });
          if (targets && miss.length) smallTargets.push({ el: describe(e), detail: `hit area ${Math.round(r.width)}px, ${miss.length}/4 edge probes land on the map` });
          continue;
        }

        const sp = scrollParent(target);
        const box = sp ? sp.getBoundingClientRect() : { left: 0, right: vw };
        if (r.left < box.left - 1 || r.right > box.right + 1) {
          if (!sp) clipped.push({ el: describe(e), detail: `x ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}` });
        }
        if (sp) {
          const spr = sp.getBoundingClientRect();
          if (spr.left < -1 || spr.right > vw + 1) clipped.push({ el: describe(sp), detail: `scroller x ${Math.round(spr.left)}..${Math.round(spr.right)} of ${vw}` });
        }

        if (targets && !isInlineText(e) && (r.width < min - 0.5 || r.height < min - 0.5)) {
          smallTargets.push({ el: describe(e), detail: `${Math.round(r.width)}x${Math.round(r.height)}` });
        }
        if (e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement) {
          const t = e instanceof HTMLInputElement ? e.type : '';
          if (!['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color', 'image'].includes(t)) {
            const fs = parseFloat(getComputedStyle(e).fontSize);
            if (fs < minFont) smallInputs.push({ el: describe(e), detail: `${fs}px` });
          }
        }
      }
      return { hscroll, smallTargets, smallInputs, clipped };
    },
    { ignore: options.ignore ?? [], targets: options.targets ?? true, min: MIN_TARGET, minFont: MIN_INPUT_FONT },
  );
}

/** Human-readable failure message for expect(...).toEqual([]) on an offender list. */
export const lines = (o: Offender[]): string[] => o.map((x) => `${x.el} (${x.detail})`);

/** Wait until the page has painted its main content and Leaflet (if any) has laid out. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}
