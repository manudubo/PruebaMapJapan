import { describe, it, expect, vi } from 'vitest';
import { cityInitial, coverColors, renderEmptyState, renderLoadError, renderSkeletonCards, renderTripCard, renderTripGroups, showSlowNotice } from '@/pages/tripCards';
import type { ApiTrip } from '@/types';

const NOW = new Date(2027, 1, 10, 12);

function trip(over: Partial<ApiTrip> = {}, cities: string[] = []): ApiTrip {
  return {
    id: '5', user_id: 'u', name: 'Japan', description: null, start_date: '2027-03-01', end_date: '2027-03-08',
    cover_image_url: null, is_public: false, public_slug: null,
    destinations: cities.map((c, i) => ({
      id: `d${i}`, trip_id: '5', city_name: c, country: 'Japan', start_date: null, end_date: null,
      lat: 1, lng: 2, zoom_level: 12, order_index: i, days: [],
    })),
    ...over,
  };
}

describe('renderTripCard', () => {
  it('links the title to the trip overview and Edit to the editor, as siblings (no nested links)', () => {
    const card = renderTripCard(trip({}, ['Tokyo', 'Kyoto']), NOW);
    expect(card.querySelector('h3 > a.trip-card-link')?.getAttribute('href')).toBe('trip.html?tripId=5');
    expect(card.querySelector('.trip-card-edit')?.getAttribute('href')).toBe('trip-edit.html?tripId=5');
    expect(card.querySelectorAll('a a')).toHaveLength(0);
    expect(card.querySelector('.trip-card-edit')?.getAttribute('aria-label')).toBe('Edit Japan');
  });

  it('shows dates, counts, countdown badge and a route strip', () => {
    const card = renderTripCard(trip({ is_public: true }, ['Tokyo', 'Kyoto']), NOW);
    expect(card.querySelector('.trip-card-dates')?.textContent).toBe('1 Mar 2027 – 8 Mar 2027');
    expect([...card.querySelectorAll('.trip-card-meta li')].map((l) => l.textContent)).toEqual(['2 cities', '8 days', '0 places']);
    expect(card.querySelector('.trip-card-badge--phase')?.textContent).toBe('In 19 days');
    expect(card.querySelector('.trip-card-badge--public')?.textContent).toBe('Public');
    expect([...card.querySelectorAll('.trip-card-route li')].map((l) => l.textContent)).toEqual(['T', 'K']);
    expect(card.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('collapses a long route to five chips and a +N', () => {
    const card = renderTripCard(trip({}, ['A', 'B', 'C', 'D', 'E', 'F', 'G']), NOW);
    const chips = [...card.querySelectorAll('.trip-card-route li')].map((l) => l.textContent);
    expect(chips).toEqual(['A', 'B', 'C', 'D', 'E', '+2']);
  });

  it('active trips get an accessible progress bar; past trips are full', () => {
    const active = renderTripCard(trip({ start_date: '2027-02-08', end_date: '2027-02-17' }), NOW);
    const bar = active.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('30');
    expect(bar.getAttribute('aria-valuetext')).toBe('Day 3 of 10');
    expect(bar.getAttribute('aria-label')).toBe('Progress of Japan');
    const past = renderTripCard(trip({ start_date: '2020-02-08', end_date: '2020-02-17' }), NOW);
    expect(past.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
  });

  it('an undated trip says so and has no phase badge', () => {
    const card = renderTripCard(trip({ start_date: null, end_date: null }), NOW);
    expect(card.querySelector('.trip-card-dates')?.textContent).toBe('Dates not set yet');
    expect(card.querySelector('.trip-card-badge--phase')).toBeNull();
  });

  it('treats name, description and cities as text, never markup', () => {
    const evil = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
    const card = renderTripCard(trip({ name: evil, description: evil }, [evil]), NOW);
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('b')).toBeNull();
    expect(card.querySelector('.trip-card-link')?.textContent).toBe(evil);
    expect(card.querySelector('.trip-card-desc')?.textContent).toBe(evil);
    expect(card.querySelector('.trip-card-edit')?.getAttribute('aria-label')).toBe(`Edit ${evil}`);
  });

  it('hostile ids stay inside their query parameter', () => {
    const card = renderTripCard(trip({ id: 'x&tripId=9"><script>' }), NOW);
    expect(card.querySelector('.trip-card-link')?.getAttribute('href')).toBe('trip.html?tripId=x%26tripId%3D9%22%3E%3Cscript%3E');
    expect(card.querySelector('script')).toBeNull();
  });

  describe('cover', () => {
    it('is a generated gradient by default (no background-image of its own)', () => {
      const cover = renderTripCard(trip(), NOW).querySelector<HTMLElement>('.trip-card-cover')!;
      expect(cover.classList.contains('trip-card-cover--generated')).toBe(true);
      expect(cover.style.getPropertyValue('--cover-a')).toMatch(/^hsl\(/);
      expect(cover.style.backgroundImage).toBe('');
    });

    it('uses an http(s) cover image on top of the gradient', () => {
      const cover = renderTripCard(trip({ cover_image_url: 'https://img.example/a b.jpg' }), NOW).querySelector<HTMLElement>('.trip-card-cover')!;
      expect(cover.style.backgroundImage).toContain('url("https://img.example/a%20b.jpg")');
    });

    it.each(['javascript:alert(1)', 'data:text/html,x', 'not a url', '"); background:red;("'])('ignores unsafe cover %s', (url) => {
      const cover = renderTripCard(trip({ cover_image_url: url }), NOW).querySelector<HTMLElement>('.trip-card-cover')!;
      expect(cover.classList.contains('trip-card-cover--image')).toBe(false);
      expect(cover.style.backgroundImage).toBe('');
    });
  });
});

describe('cover helpers', () => {
  it('gradient colours are stable per seed and differ between seeds', () => {
    expect(coverColors('a')).toEqual(coverColors('a'));
    expect(coverColors('a')).not.toEqual(coverColors('b'));
  });

  it('initials skip punctuation and handle non-Latin names', () => {
    expect(cityInitial('tokyo')).toBe('T');
    expect(cityInitial('  "Ōsaka"')).toBe('Ō');
    expect(cityInitial('東京')).toBe('東');
    expect(cityInitial('---')).toBe('·');
    expect(cityInitial('')).toBe('·');
  });
});

describe('renderTripGroups', () => {
  it('adds section headings only when there is more than one group', () => {
    const grid = document.createElement('div');
    renderTripGroups(grid, [trip({ id: '1' }), trip({ id: '2' })], NOW);
    expect(grid.querySelectorAll('h2')).toHaveLength(0);
    expect(grid.querySelectorAll('.trip-card')).toHaveLength(2);

    renderTripGroups(grid, [trip({ id: '1' }), trip({ id: '2', start_date: '2020-01-01', end_date: '2020-01-02' })], NOW);
    expect([...grid.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Upcoming', 'Past trips']);
  });
});

describe('list states', () => {
  it('skeleton: busy grid, decorative cards, one status for screen readers', () => {
    const grid = document.createElement('div');
    renderSkeletonCards(grid, 3);
    expect(grid.getAttribute('aria-busy')).toBe('true');
    expect(grid.querySelectorAll('.trip-card--skeleton[aria-hidden="true"]')).toHaveLength(3);
    expect(grid.querySelector('[role="status"]')?.textContent).toBe('Loading your trips');
    expect(grid.querySelectorAll('a')).toHaveLength(0);
  });

  it('empty: create CTA wired, link to the demo, keeps the legacy message', () => {
    const grid = document.createElement('div');
    const create = vi.fn();
    renderEmptyState(grid, create);
    expect(grid.textContent).toContain("You don't have any trips saved yet.");
    grid.querySelector<HTMLButtonElement>('#empty-state-create-btn')!.click();
    expect(create).toHaveBeenCalledTimes(1);
    expect(grid.querySelector('#empty-state-demo-link')?.getAttribute('href')).toBe('index.html#demo');
    expect(grid.hasAttribute('aria-busy')).toBe(false);
  });

  it('error: an alert with a working retry that is a real button', () => {
    const grid = document.createElement('div');
    const retry = vi.fn();
    renderLoadError(grid, retry);
    expect(grid.querySelector('[role="alert"]')?.textContent).toContain("couldn't load your trips");
    const btn = grid.querySelector<HTMLButtonElement>('#trips-retry-btn')!;
    expect(btn.tagName).toBe('BUTTON');
    btn.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('slow notice: shown once, above the skeleton, as a status with retry', () => {
    const grid = document.createElement('div');
    renderSkeletonCards(grid);
    const retry = vi.fn();
    showSlowNotice(grid, retry);
    showSlowNotice(grid, retry);
    expect(grid.querySelectorAll('#trips-slow')).toHaveLength(1);
    expect(grid.firstElementChild?.id).toBe('trips-slow');
    expect(grid.querySelector('#trips-slow')?.getAttribute('role')).toBe('status');
    grid.querySelector<HTMLButtonElement>('#trips-slow-retry')!.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
