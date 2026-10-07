/** Scroll the top nav so the active city is centred. Kept out of map.ts so pages can use it without loading Leaflet. */
export function centerNavOnActive(): void {
  const nav = document.querySelector('.top-nav') as HTMLElement | null;
  const activeItem = nav?.querySelector('.is-active') as HTMLElement | null;
  if (!nav || !activeItem) return;
  const navRect = nav.getBoundingClientRect();
  const activeRect = activeItem.getBoundingClientRect();
  const scrollLeft = activeItem.offsetLeft - (navRect.width / 2) + (activeRect.width / 2);
  nav.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
}
