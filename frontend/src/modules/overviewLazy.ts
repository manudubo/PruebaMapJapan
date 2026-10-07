// Kept apart from overviewMap.ts so the landing page can observe the map without loading Leaflet.
/**
 * Initialise the overview only when it is about to scroll into view, so the
 * landing hero (LCP) never waits for Leaflet layout or tile requests.
 */
export function observeOverviewMap(el: HTMLElement, init: () => void, rootMargin = '200px'): void {
  if (typeof IntersectionObserver === 'undefined') {
    init();
    return;
  }
  let done = false;
  const io = new IntersectionObserver((entries) => {
    if (done || !entries.some((e) => e.isIntersecting)) return;
    done = true;
    io.disconnect();
    init();
  }, { rootMargin });
  io.observe(el);
}
