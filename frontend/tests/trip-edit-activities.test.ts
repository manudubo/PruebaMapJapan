import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/client', () => ({
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
  reorderActivities: vi.fn(),
}));

import { renderActivitiesSection } from '@/pages/trip-edit/activities';
import { reorderActivities } from '@/api/client';
import type { ApiActivity, ApiDay } from '@/types';

function act(id: string, name: string, order_index: number): ApiActivity {
  return {
    id,
    name,
    lat: 35,
    lng: 139,
    notes: null,
    is_optional: false,
    is_generic: false,
    maps_url: null,
    order_index,
    time: null,
  };
}

function makeDay(): ApiDay {
  return {
    id: '7',
    date: '2026-02-22',
    label: 'Day 1',
    color_hex: '#000000',
    order_index: 0,
    activities: [act('1', 'A', 0), act('2', 'B', 1), act('3', 'C', 2)],
  };
}

function renderedNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.activity-name')).map((el) => el.textContent ?? '');
}

function moveDownButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button[title="Move down"]'));
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe('trip-edit activities reorder (BUG-01)', () => {
  let container: HTMLElement;
  let day: ApiDay;

  beforeEach(() => {
    vi.mocked(reorderActivities).mockReset();
    document.body.innerHTML = '<div id="acts"></div>';
    container = document.getElementById('acts')!;
    day = makeDay();
    renderActivitiesSection(container, day, '1', '2');
  });

  it('keeps the new order visible after the optimistic re-render', async () => {
    let resolveApi: (v: ApiActivity[]) => void = () => {};
    vi.mocked(reorderActivities).mockReturnValue(new Promise((r) => { resolveApi = r; }));

    moveDownButtons(container)[0].click(); // move A below B

    // Before the API answers, the optimistic render must already show B, A, C.
    expect(renderedNames(container)).toEqual(['B', 'A', 'C']);
    expect(day.activities.map((a) => [a.id, a.order_index])).toEqual([['2', 0], ['1', 1], ['3', 2]]);

    resolveApi([act('2', 'B', 0), act('1', 'A', 1), act('3', 'C', 2)]);
    await flush();
    expect(renderedNames(container)).toEqual(['B', 'A', 'C']);
  });

  it('sends the full ordered id set to the API', async () => {
    vi.mocked(reorderActivities).mockResolvedValue([]);
    moveDownButtons(container)[1].click(); // move B below C
    await flush();
    expect(reorderActivities).toHaveBeenCalledWith('1', '2', '7', [1, 3, 2]);
  });

  it('adopts order_index values returned by the API', async () => {
    // Server answers with its own (e.g. gapped) order_index values.
    vi.mocked(reorderActivities).mockResolvedValue([
      act('2', 'B', 10), act('1', 'A', 20), act('3', 'C', 30),
    ]);
    moveDownButtons(container)[0].click();
    await flush();
    const byId = Object.fromEntries(day.activities.map((a) => [a.id, a.order_index]));
    expect(byId).toEqual({ '2': 10, '1': 20, '3': 30 });
    expect(renderedNames(container)).toEqual(['B', 'A', 'C']);
  });

  it('reverts to the original order and shows an error when the API fails', async () => {
    vi.mocked(reorderActivities).mockRejectedValue(new Error('network'));
    moveDownButtons(container)[0].click();
    await flush();
    expect(renderedNames(container)).toEqual(['A', 'B', 'C']);
    expect(day.activities.map((a) => [a.id, a.order_index])).toEqual([['1', 0], ['2', 1], ['3', 2]]);
    expect(container.querySelector('.error-msg')).not.toBeNull();
  });
});
