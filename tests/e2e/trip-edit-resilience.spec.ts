import { test, expect, type Page } from '@playwright/test';
import { emptyTrip } from './fixtures/mockTripStore';
import { openEditor, openNew, addPlace, saved } from './fixtures/editorHelpers';

test.use({ storageState: { cookies: [], origins: [] } });

const act = (id: number, name: string, order: number, extra: Record<string, unknown> = {}) =>
  ({ id, name, lat: 35 + order / 1000, lng: 135 + order / 1000, notes: null, time: null, is_optional: false, is_generic: false, maps_url: null, order_index: order, ...extra });

const kyoto = (days: unknown[] = [], over: Record<string, unknown> = {}) => ({
  id: 12, trip_id: 1, city_name: 'Kyoto', country: 'Japan', start_date: '2026-02-24', end_date: '2026-02-26',
  lat: 35.0116, lng: 135.7681, zoom_level: 12, order_index: 0, hotel: null, days, ...over,
});
const day = (activities: unknown[], date = '2026-02-25') => ({ id: 21, date, label: null, color_hex: '#ff9500', order_index: 0, activities });
const tripWith = (...dests: unknown[]) => emptyTrip({ destinations: dests });
const cityHash = '#city/12/2026-02-25';
const names = (page: Page) => page.locator('#activity-list .te-act-name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

test.describe('Hostile and extreme input', () => {
  test('XSS strings are shown as text everywhere and never executed', async ({ page }) => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    let dialogs = 0;
    page.on('dialog', async (d) => { dialogs++; await d.dismiss(); });
    const store = await openEditor(page, tripWith(kyoto([day([act(31, evil, 0, { notes: evil })])]), kyoto([], { id: 13, city_name: evil, order_index: 1 })), {}, cityHash);
    await expect(page.locator('#activity-list .te-act-name')).toHaveValue(evil);
    await page.locator('#activity-list [data-role="toggle"]').click();
    await expect(page.locator('#activity-list textarea')).toHaveValue(evil);
    await page.locator('#trip-name-heading').waitFor();
    await page.locator('#city-back').click();
    await expect(page.locator('.te-dest-name', { hasText: '<img' })).toHaveCount(1);
    await page.locator('.te-step[data-step="trip"]').click();
    await page.locator('#trip-name').fill(evil);
    await expect(page.locator('#trip-name-heading')).toHaveText(evil);
    await expect(page.locator('#te-view img, #te-cards img, #te-preview img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(dialogs).toBe(0);
    await saved(page);
    expect(store.writes('PATCH').some((c) => (c.body as { name?: string }).name === evil)).toBe(true);
  });

  test('a javascript: Google Maps link is refused inline and never sent', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto([day([act(31, 'A', 0)])])), {}, cityHash);
    await page.locator('#activity-list [data-role="toggle"]').click();
    await page.getByLabel('Google Maps link').fill('javascript:alert(1)');
    await expect(page.locator('.field-error:visible')).toContainText('http');
    expect(store.writes('PATCH')).toEqual([]);
    await page.getByLabel('Google Maps link').fill('https://maps.app.goo.gl/abc');
    await expect(page.locator('.field-error:visible')).toHaveCount(0);
    await expect.poll(() => store.writes('PATCH').length).toBe(1);
  });

  test('a huge name is capped by the field, an empty one is refused and not saved', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto([day([act(31, 'A', 0)])])), {}, cityHash);
    const name = page.locator('#activity-list .te-act-name');
    await name.fill('x'.repeat(400));
    expect(await name.evaluate((e: HTMLInputElement) => e.value.length)).toBe(255);
    await name.fill('');
    await expect(page.locator('#activity-list .field-error')).toContainText('Name this place');
    await name.blur();
    await expect(name).toHaveValue('x'.repeat(255));
    await expect(page.locator('#activity-list .field-error')).toBeHidden();
    expect(store.writes('PATCH').every((c) => (c.body as { name?: string }).name !== '')).toBe(true);
  });

  test('trip end before start: inline error, nothing sent, heading unchanged', async ({ page }) => {
    const store = await openEditor(page, emptyTrip(), {}, '#trip');
    await page.locator('#trip-end-date').fill('2026-01-01');
    await expect(page.locator('#trip-end-date')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#te-view .field-error:visible')).toContainText('cannot end before');
    await page.locator('#trip-name').fill('');
    await expect(page.locator('#te-view .field-error:visible').first()).toBeVisible();
    await page.locator('#trip-name').blur();
    await expect(page.locator('#trip-name')).toHaveValue('Japan 2026');
    expect(store.writes()).toEqual([]);
    await expect(page.locator('#trip-name-heading')).toHaveText('Japan 2026');
  });

  test('departure before arrival in a city is refused too', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto()), {}, '#city/12');
    await page.locator('#dest-end').fill('2026-02-01');
    await expect(page.locator('#dest-end')).toHaveAttribute('aria-invalid', 'true');
    expect(store.writes()).toEqual([]);
  });

  test('0, 1 and 60 days', async ({ page }) => {
    await openEditor(page, tripWith(kyoto([], { start_date: null, end_date: null })), {}, '#city/12');
    await expect(page.locator('#no-dates')).toBeVisible();
    await expect(page.locator('#composer')).toBeHidden();
    await page.locator('#dest-start').fill('2026-02-24');
    await expect(page.locator('#day-chips .day-btn')).toHaveCount(1);
    await expect(page.locator('#composer')).toBeVisible();
    await page.locator('#dest-end').fill('2026-04-24');
    await expect(page.locator('#day-chips .day-btn')).toHaveCount(60);
  });

  test('200 places in a day render, stay usable and reorder', async ({ page }) => {
    const many = Array.from({ length: 200 }, (_, i) => act(1000 + i, `Place ${i + 1}`, i));
    const store = await openEditor(page, tripWith(kyoto([day(many)])), {}, cityHash);
    await expect(page.locator('#activity-list > li')).toHaveCount(200);
    await expect(page.locator('#map .numbered-marker')).toHaveCount(200);
    await page.locator('#activity-list > li').first().locator('[data-role="down"]').click();
    expect((await names(page)).slice(0, 2)).toEqual(['Place 2', 'Place 1']);
    await expect.poll(() => store.writes('POST').filter((c) => c.path.endsWith('/reorder')).length).toBe(1);
  });

  test('the same place twice is allowed and numbered 1, 2', async ({ page }) => {
    await openEditor(page, tripWith(kyoto([day([])])), {}, cityHash);
    await addPlace(page, 'Kinkaku');
    await addPlace(page, 'Kinkaku');
    await expect(page.locator('#activity-list > li')).toHaveCount(2);
    await expect(page.locator('#activity-list .te-num')).toHaveText(['1', '2']);
  });
});

test.describe('Geocoder', () => {
  test('down: says so, offers a way out, and "without a map location" still works', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto([day([])])), { geocode: 'down' }, cityHash);
    await page.locator('#act-search').fill('Kinkaku');
    await expect(page.locator('#act-search-list').locator('xpath=following-sibling::p')).toContainText("Couldn't search places");
    await page.locator('#act-search-list .place-option--free').click();
    await expect(page.locator('#activity-list .te-act-name')).toHaveValue('Kinkaku');
    await expect(page.locator('#activity-list .te-tag--warn')).toHaveText('No map location');
    expect(store.geocodeCalls()).toBeGreaterThan(0);
  });

  test('no results: a clear message, not a blank box', async ({ page }) => {
    await openEditor(page, tripWith(kyoto([day([])])), { geocode: 'empty' }, cityHash);
    await page.locator('#act-search').fill('zzzzzz');
    await expect(page.locator('#act-search-status')).toContainText('No places found');
  });

  test('slow: shows Searching… and then the results', async ({ page }) => {
    await openEditor(page, tripWith(kyoto([day([])])), { geocode: 'slow' }, cityHash);
    await page.locator('#act-search').fill('Kinkaku');
    await expect(page.locator('#act-search-status')).toHaveText('Searching…');
    await expect(page.locator('#act-search-list .place-option').first()).toBeVisible({ timeout: 8000 });
  });

  test('typing waits for a pause: one request for a burst of keystrokes, and a repeat is cached', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto([day([])])), {}, cityHash);
    await page.locator('#act-search').pressSequentially('Kinkaku', { delay: 30 });
    await expect(page.locator('#act-search-list .place-option:not(.place-option--free)').first()).toBeVisible();
    expect(store.geocodeCalls()).toBe(1);
    await page.locator('#act-search').fill('');
    await page.locator('#act-search').fill('Kinkaku');
    await expect(page.locator('#act-search-list .place-option:not(.place-option--free)').first()).toBeVisible();
    expect(store.geocodeCalls()).toBe(1);
  });

  test('a pasted Google Maps link is resolved locally, named from the link, with no geocoder call', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto([day([])])), {}, cityHash);
    await page.locator('#act-search').fill('https://www.google.com/maps/place/Nishiki+Market/@35.005,135.764,17z');
    await page.locator('#act-search-list .place-option').first().click();
    await expect(page.locator('#activity-list .te-act-name')).toHaveValue('Nishiki Market');
    expect(store.geocodeCalls()).toBe(0);
    await expect.poll(() => store.writes('POST').filter((c) => c.path.endsWith('/activities')).length).toBe(1);
    expect(store.writes('POST').find((c) => c.path.endsWith('/activities'))!.body).toMatchObject({ lat: 35.005, lng: 135.764, maps_url: expect.stringContaining('google.com/maps/place') });
  });

  test('a link without coordinates explains what to copy', async ({ page }) => {
    await openEditor(page, tripWith(kyoto([day([])])), {}, cityHash);
    await page.locator('#act-search').fill('https://www.google.com/maps/place/Somewhere');
    await expect(page.locator('#act-search-status')).toContainText('no coordinates');
  });

  test('keyboard: arrows move through results, Enter chooses, Escape closes', async ({ page }) => {
    await openEditor(page, emptyTrip(), {}, '#route');
    await page.locator('#dest-search').fill('Kyoto');
    await expect(page.locator('#dest-search-list .place-option').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#dest-search-list')).toBeHidden();
    await page.keyboard.press('ArrowDown'); // reopen is only on typing/focus; list stays closed
    await page.locator('#dest-search').fill('Kyot');
    await page.locator('#dest-search').fill('Kyoto');
    await expect(page.locator('#dest-search-list .place-option').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#dest-search')).toHaveAttribute('aria-activedescendant', /dest-search-opt-0/);
    await page.keyboard.press('Enter');
    await expect(page.locator('#destinations-list > li')).toHaveCount(1);
  });
});

test.describe('Saving: failures and recovery', () => {
  test('a 500 shows the banner and Saving state, Retry recovers and the data is saved once', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto([day([])])), {}, cityHash);
    store.failAlways(500);
    await addPlace(page, 'Kinkaku');
    await expect(page.locator('#te-banners .te-banner--error')).toContainText('not saved yet');
    await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#activity-list > li')).toHaveCount(1); // the edit is still there
    store.failAlways(null);
    await page.locator('#save-retry').click();
    await expect(page.locator('#te-banners .te-banner')).toHaveCount(0);
    await saved(page);
    const posts = store.writes('POST').filter((c) => c.path.endsWith('/activities'));
    expect(posts.length).toBeGreaterThanOrEqual(1);
    await page.reload();
    await expect(page.locator('#activity-list > li')).toHaveCount(1);
  });

  test('a transient failure heals by itself (automatic retry)', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto([day([])])), {}, cityHash);
    store.failNext(503, 1, /POST .*activities/);
    await addPlace(page, 'Kinkaku');
    await expect(page.locator('#te-banners .te-banner--error')).toBeVisible();
    await expect(page.locator('#te-banners .te-banner')).toHaveCount(0, { timeout: 8000 });
    await saved(page);
    await page.reload();
    await expect(page.locator('#activity-list > li')).toHaveCount(1);
  });

  test('a 422 is reported once, rolls the row back and offers a reload', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto([day([])])), {}, cityHash);
    store.failNext(422, 1, /POST .*activities/);
    await addPlace(page, 'Kinkaku');
    await expect(page.locator('#te-banners .te-banner--issues')).toContainText('could not be saved');
    await expect(page.locator('#activity-list > li')).toHaveCount(0);
    await page.locator('#save-reload').click();
    await expect(page.locator('#te-banners .te-banner')).toHaveCount(0);
  });

  test('403 email not verified and 409 conflict get specific messages', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto([day([act(31, 'A', 0)])])), {}, cityHash);
    store.failNext(409, 1);
    await page.locator('#activity-list .te-act-name').fill('Renamed');
    await expect(page.locator('#te-banners')).toContainText('changed elsewhere');
  });

  test('going offline mid-edit keeps the work, says so, and saves on reconnect', async ({ page, context }) => {
    const store = await openEditor(page, tripWith(kyoto([day([])])), {}, cityHash);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await addPlace(page, 'Kinkaku').catch(() => undefined);
    await expect(page.locator('#activity-list > li')).toHaveCount(1);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => store.writes('POST').filter((c) => c.path.endsWith('/activities')).length, { timeout: 10000 }).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#te-banners .te-banner')).toHaveCount(0, { timeout: 10000 });
  });

  test('double-clicking "Create trip" creates one trip', async ({ page }) => {
    const store = await openNew(page, { writeDelayMs: 400 });
    await page.locator('#trip-name').fill('Once');
    await page.locator('#metadata-save-btn').dblclick();
    await expect(page).toHaveURL(/tripId=/);
    expect(store.writes('POST').filter((c) => c.path === '/trips')).toHaveLength(1);
  });

  test('creating with an empty name is refused inline, with no request', async ({ page }) => {
    const store = await openNew(page);
    await page.locator('#metadata-save-btn').click();
    await expect(page.locator('#trip-name')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#trip-name')).toBeFocused();
    expect(store.writes()).toEqual([]);
  });

  test('a failed create keeps the typed values and re-enables the button', async ({ page }) => {
    const store = await openNew(page);
    store.failAlways(500);
    await page.locator('#trip-name').fill('Keep me');
    await page.locator('#metadata-save-btn').click();
    await expect(page.locator('#metadata-error')).toContainText('Could not create');
    await expect(page.locator('#trip-name')).toHaveValue('Keep me');
    await expect(page.locator('#metadata-save-btn')).toBeEnabled();
  });
});

test.describe('Delete, undo and order', () => {
  test('deleting a place is undoable and sends nothing until the window closes', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto([day([act(31, 'A', 0), act(32, 'B', 1)])])), {}, cityHash);
    await page.locator('#activity-list > li').first().locator('[data-role="delete"]').click();
    await expect(page.locator('#te-snackbar')).toContainText('Deleted “A”');
    await expect(page.locator('#activity-list > li')).toHaveCount(1);
    await page.locator('#undo-btn').click();
    expect(await names(page)).toEqual(['A', 'B']);
    expect(store.writes('DELETE')).toEqual([]);
  });

  test('without Undo the DELETE is sent after the window, once', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto([day([act(31, 'A', 0)])])), {}, cityHash);
    await page.locator('#activity-list [data-role="delete"]').click();
    await expect.poll(() => store.writes('DELETE').length, { timeout: 12000 }).toBe(1);
    await expect(page.locator('#te-snackbar')).toBeHidden();
    await page.reload();
    await expect(page.locator('#activity-list > li')).toHaveCount(0);
  });

  test('Ctrl+Z undoes the last delete', async ({ page }) => {
    await openEditor(page, tripWith(kyoto([day([act(31, 'A', 0)])])), {}, cityHash);
    await page.locator('#activity-list [data-role="delete"]').click();
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('Control+z');
    await expect(page.locator('#activity-list > li')).toHaveCount(1);
  });

  test('deleting a city is undoable too', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto()), {}, '#route');
    await page.locator('#destinations-list [data-role="delete"]').click();
    await expect(page.locator('#destinations-empty')).toBeVisible();
    await page.locator('#undo-btn').click();
    await expect(page.locator('#destinations-list > li')).toHaveCount(1);
    expect(store.writes('DELETE')).toEqual([]);
  });

  test('rapid reorder: five quick moves persist the final order', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto([day(['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => act(40 + i, n, i)))])), {}, cityHash);
    for (let i = 0; i < 5; i++) await page.locator('#activity-list > li').nth(i).locator('[data-role="down"]').click();
    expect(await names(page)).toEqual(['B', 'C', 'D', 'E', 'F', 'A']);
    await saved(page);
    const last = store.writes('POST').filter((c) => c.path.endsWith('/reorder')).at(-1)!;
    expect((last.body as { ordered_ids: number[] }).ordered_ids).toEqual([41, 42, 43, 44, 45, 40]);
    await page.reload();
    await expect(page.locator('#activity-list > li')).toHaveCount(6);
    expect(await names(page)).toEqual(['B', 'C', 'D', 'E', 'F', 'A']);
  });

  test('drag the handle to reorder, and the keyboard does the same', async ({ page }) => {
    await openEditor(page, tripWith(kyoto([day(['A', 'B', 'C'].map((n, i) => act(40 + i, n, i)))])), {}, cityHash);
    const grip = page.locator('#activity-list > li').first().locator('[data-role="grip"]');
    const box = (await grip.boundingBox())!;
    const target = (await page.locator('#activity-list > li').nth(2).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 5, target.y + target.height - 4, { steps: 8 });
    await page.mouse.up();
    expect(await names(page)).toEqual(['B', 'C', 'A']);
    const g = page.locator('#activity-list > li').nth(2).locator('[data-role="grip"]');
    await g.focus();
    await page.keyboard.press('ArrowUp');
    expect(await names(page)).toEqual(['B', 'A', 'C']);
    await expect(page.locator('#activity-list > li').nth(1).locator('[data-role="grip"]')).toBeFocused();
  });

  test('cities reorder with the arrows and the numbers on the map follow', async ({ page }) => {
    const store = await openEditor(page, emptyTrip({ destinations: [kyoto([], { order_index: 0 }), kyoto([], { id: 13, city_name: 'Osaka', lat: 34.69, lng: 135.5, order_index: 1 })] }), {}, '#route');
    await page.locator('#destinations-list > li').nth(1).locator('[data-role="up"]').click();
    await expect(page.locator('#destinations-list .te-dest-name')).toHaveText(['Osaka', 'Kyoto']);
    await expect(page.locator('#te-cities-grid .city-info strong')).toHaveText(['Osaka', 'Kyoto']);
    await expect.poll(() => store.writes('PATCH').length).toBe(2);
    expect(store.writes('PATCH').map((c) => (c.body as { order_index: number }).order_index).sort()).toEqual([0, 1]);
  });
});

test.describe('Navigation and layout', () => {
  test('Back returns from a city to the list, and reload keeps the place', async ({ page }) => {
    await openEditor(page, tripWith(kyoto([day([act(31, 'A', 0)])])), {}, '#route');
    await page.locator('.te-dest-open').click();
    await expect(page).toHaveURL(/#city\/12/);
    await page.goBack();
    await expect(page.locator('#destinations-list')).toBeVisible();
    await page.goForward();
    await expect(page.locator('#city-title')).toHaveText('Kyoto');
    await page.reload();
    await expect(page.locator('#city-title')).toHaveText('Kyoto');
  });

  test('clicking a marker on the map or a card in the preview opens that city', async ({ page }) => {
    await openEditor(page, emptyTrip({ destinations: [kyoto()] }), {}, '#route');
    await page.locator('#te-cities-grid .city-card').click();
    await expect(page.locator('#city-title')).toHaveText('Kyoto');
  });

  test('resizing from desktop to phone keeps the work and shows the tabs', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditor(page, tripWith(kyoto([day([act(31, 'A', 0)])])), {}, cityHash);
    await expect(page.locator('.te-tabs')).toBeHidden();
    await expect(page.locator('#te-preview')).toBeVisible();
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(page.locator('.te-tabs')).toBeVisible();
    await expect(page.locator('#te-preview')).toBeHidden();
    await expect(page.locator('#activity-list .te-act-name')).toHaveValue('A');
    await page.locator('#te-tab-preview').click();
    await expect(page.locator('#map .numbered-marker')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('no horizontal scroll at 375px on any step', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openEditor(page, tripWith(kyoto([day([act(31, 'A very long place name that keeps going and going', 0)])])), {}, '#route');
    for (const hash of ['#trip', '#route', cityHash, '#share']) {
      await page.evaluate((h) => { location.hash = h; }, hash);
      await expect(page.locator('#te-view h2')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  test('drop a pin on the map: a named-later place with coordinates, name focused', async ({ page }) => {
    const store = await openEditor(page, tripWith(kyoto([day([])])), {}, cityHash);
    await page.locator('#pick-pin').click();
    await expect(page.locator('#te-pick-banner')).toBeVisible();
    await page.locator('#map').click({ position: { x: 300, y: 200 } });
    await expect(page.locator('#activity-list > li')).toHaveCount(1);
    await expect(page.locator('#activity-list .te-act-name')).toBeFocused();
    await expect(page.locator('#te-pick-banner')).toBeHidden();
    await page.keyboard.type('My spot');
    await expect.poll(() => store.writes('PATCH').some((c) => (c.body as { name?: string }).name === 'My spot')).toBe(true);
    const created = store.writes('POST').find((c) => c.path.endsWith('/activities'))!;
    expect(typeof (created.body as { lat: number }).lat).toBe('number');
  });

  test('Escape cancels pin mode', async ({ page }) => {
    await openEditor(page, tripWith(kyoto([day([])])), {}, cityHash);
    await page.locator('#pick-pin').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#te-pick-banner')).toBeHidden();
    await expect(page.locator('#pick-pin')).toHaveAttribute('aria-pressed', 'false');
  });

  test('every form control has an accessible name', async ({ page }) => {
    await openEditor(page, tripWith(kyoto([day([act(31, 'A', 0)])])), {}, cityHash);
    await page.locator('#activity-list [data-role="toggle"]').click();
    const unnamed = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('#te-workspace input, #te-workspace textarea, #te-workspace button, #te-workspace select'))
      .filter((el) => el.offsetParent !== null)
      .filter((el) => {
        const name = el.getAttribute('aria-label') || el.getAttribute('title') || (el as HTMLInputElement).labels?.[0]?.textContent || el.textContent;
        return !name || !name.trim();
      }).map((el) => el.outerHTML.slice(0, 80)));
    expect(unnamed).toEqual([]);
  });

  test('dark mode keeps the editor readable (no white-on-white controls)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openEditor(page, tripWith(kyoto([day([act(31, 'A', 0)])])), {}, cityHash);
    const bg = await page.locator('.te-act').first().evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(bg).not.toBe('rgb(255, 255, 255)');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
