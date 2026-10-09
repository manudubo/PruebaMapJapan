import type { Page } from '@playwright/test';

/**
 * Layout audit of a Keycloak login-theme page on a phone (shared by idp-theme-mobile.spec.ts, which
 * runs it on real Keycloak HTML, and idp-theme-cache.spec.ts). Everything is measured in the
 * browser on the page as drawn; each problem comes back as one readable line, so a failure says
 * what is wrong and where. An empty list is a pass.
 *
 * What the owner saw on a real iPhone (a stale, cached stylesheet from the old theme) was: a card
 * inside a card inside a card, content running past the right edge, indents of 40px+ per level.
 * Each of those has a check below.
 */
export async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    // A mobile browser widens the layout viewport (innerWidth) to fit overflowing content, and iOS
    // clips it: the device width is the real limit.
    const vw = Math.min(window.innerWidth, window.screen.width);
    if (window.innerWidth > window.screen.width) problems.push(`overflowing content widened the layout viewport to ${window.innerWidth}px on a ${window.screen.width}px screen`);
    const sx = window.scrollX; // autofocus may have scrolled a page that overflows: measure from the document's left edge
    const px = (v: string) => parseFloat(v) || 0;
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
    const visible = (el: Element) => {
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1; // .sr-only is 1x1
    };

    // 1. No horizontal overflow: the page does not scroll sideways and nothing is drawn past an edge.
    const scrollWidth = document.scrollingElement!.scrollWidth;
    if (scrollWidth > vw) problems.push(`page scrolls sideways: scrollWidth ${scrollWidth} > innerWidth ${vw}`);
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      if (!visible(el) || el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      const r = el.getBoundingClientRect();
      if (r.right + sx > vw + 0.5 || r.left + sx < -0.5) problems.push(`${name(el)} extends past the viewport (${Math.round(r.left + sx)}..${Math.round(r.right + sx)} of ${vw})`);
    }

    // 2. Exactly one visible card.
    const cards = Array.from(document.querySelectorAll('main.jp-card')).filter(visible);
    if (cards.length !== 1) problems.push(`expected exactly one visible card (main.jp-card), found ${cards.length}`);
    const card = cards[0];
    if (!card) return problems;
    const cs = getComputedStyle(card);
    const cr = card.getBoundingClientRect();
    if (cr.left + sx < 16 - 0.5 || vw - (cr.right + sx) < 16 - 0.5) problems.push(`card gutter < 16px (left ${Math.round(cr.left + sx)}, right ${Math.round(vw - cr.right - sx)})`);
    const padL = px(cs.paddingLeft) + px(cs.borderLeftWidth);
    const padR = px(cs.paddingRight) + px(cs.borderRightWidth);

    // 3. No bordered / filled container with controls inside the card (a box in a box).
    const CONTROL = 'input:not([type=hidden]), button, select, textarea, a[href], summary';
    for (const el of Array.from(card.querySelectorAll('*'))) {
      if (!visible(el) || el.matches(`${CONTROL}, label, svg, svg *, img, hr, .jp-alert, .jp-user, .jp-choice, .jp-input-group, .jp-passkey-hero`)) continue;
      const s = getComputedStyle(el);
      // A box has at least two bordered sides; one side is a divider rule, which is fine.
      const border = ['top', 'right', 'bottom', 'left'].filter((side) => px(s.getPropertyValue(`border-${side}-width`)) > 0 && s.getPropertyValue(`border-${side}-style`) !== 'none').length >= 2;
      const filled = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== cs.backgroundColor;
      if ((border || filled) && el.querySelector(CONTROL)) problems.push(`nested ${border ? 'bordered' : 'filled'} container with controls: ${name(el)}`);
    }

    // 4. Every direct indent inside the card stays within the card's own padding: no wrapper adds
    //    its own (the old theme stacked 40px of padding per wrapper).
    for (const el of Array.from(card.querySelectorAll(CONTROL))) {
      if (!visible(el) || el.closest('details') && el.tagName.toLowerCase() !== 'summary') continue;
      const r = el.getBoundingClientRect();
      if (r.left < cr.left + padL - 0.5 || r.right > cr.right - padR + 0.5) problems.push(`${name(el)} sticks out of the card padding (${Math.round(r.left - cr.left)}..${Math.round(r.right - cr.left)} in a ${Math.round(cr.width)}px card, padding ${padL}/${padR})`);
      if (r.left > cr.left + padL + 24 + 0.5 && el.matches('input:not([type=checkbox]):not([type=radio]), button, .jp-btn, select, textarea') && !el.closest('.jp-input-group, .jp-user')) problems.push(`${name(el)} is indented ${Math.round(r.left - cr.left - padL)}px from the card content edge`);
    }

    // 5. Touch targets and text sizes.
    for (const el of Array.from(document.querySelectorAll(`main.jp-card ${CONTROL.split(', ').join(', main.jp-card ')}, .jp-foot a, label.jp-check__label`))) {
      if (!visible(el) || (el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio') continue;
      const h = el.getBoundingClientRect().height;
      if (h < 44 - 0.5) problems.push(`${name(el)} is ${Math.round(h)}px tall (< 44px)`);
    }
    for (const el of Array.from(card.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]), textarea, select'))) {
      if (visible(el) && px(getComputedStyle(el).fontSize) < 16) problems.push(`${name(el)} font-size ${getComputedStyle(el).fontSize} < 16px (iOS zooms the page on focus)`);
    }
    const h1 = document.querySelector('h1');
    if (h1) {
      const size = px(getComputedStyle(h1).fontSize);
      if (size > 28 || size < 18) problems.push(`h1 font-size ${size}px is outside 18..28px`);
    }
    for (const el of Array.from(card.querySelectorAll('p, label, a, button, span, summary'))) {
      if (visible(el) && px(getComputedStyle(el).fontSize) < 13) problems.push(`${name(el)} text is ${getComputedStyle(el).fontSize} (< 13px)`);
    }

    // 6. The page paints with the theme's own tokens, not browser defaults.
    if (getComputedStyle(document.body).fontFamily.indexOf('Inter') < 0) problems.push(`body font is ${getComputedStyle(document.body).fontFamily}, not Inter`);
    return problems;
  });
}

/** WCAG contrast ratios of an element's text colour against its effective background. */
export async function contrastOf(page: Page, selector: string): Promise<{ selector: string; ratio: number }[]> {
  return page.locator(selector).evaluateAll((els, sel) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number) as number[];
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const backdrop = (el: Element): number[] => {
      let rgb = [255, 255, 255];
      const stack: number[][] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const [r, g, b, a = 1] = parse(getComputedStyle(n).backgroundColor);
        if (a > 0) stack.push([r!, g!, b!, a]);
        if (a === 1) break;
      }
      for (const [r, g, b, a] of stack.reverse()) rgb = [r! * a! + rgb[0]! * (1 - a!), g! * a! + rgb[1]! * (1 - a!), b! * a! + rgb[2]! * (1 - a!)];
      return rgb;
    };
    return els
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => {
        const [a, b] = [lum(parse(getComputedStyle(el).color)), lum(backdrop(el))];
        return { selector: sel, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
  }, selector);
}

export const TEXT_SELECTORS = ['h1', '.jp-subtitle', 'label', '.jp-btn--primary', '.jp-btn--secondary', '.jp-alert__text', '.jp-field__error', '#kc-info a, #kc-info p', '.jp-idp-exit', '.jp-user__name', '.jp-user__change', '.jp-choice__desc', '.jp-details > summary', '#kc-registration'];
