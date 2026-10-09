import { expect, type Page } from '@playwright/test';
import { mockTripStore, emptyTrip, type TripStore, type StoreOptions } from './mockTripStore';
import { mockKeycloakLoggedIn } from './mockKeycloak';
import { stubMapThirdParty } from './mockThirdParty';

export async function openEditor(
  page: Page,
  trip: unknown = emptyTrip(),
  options: StoreOptions = {},
  hash = '',
): Promise<TripStore> {
  await mockKeycloakLoggedIn(page);
  await stubMapThirdParty(page);
  const store = await mockTripStore(page, { trips: trip ? [trip] : [], ...options });
  await page.goto(`trip-edit.html?tripId=1${hash}`);
  await expect(page.locator('#te-workspace')).toBeVisible();
  return store;
}

export async function openNew(page: Page, options: StoreOptions = {}): Promise<TripStore> {
  await mockKeycloakLoggedIn(page);
  await stubMapThirdParty(page);
  const store = await mockTripStore(page, options);
  await page.goto('trip-edit.html?new=1');
  await expect(page.locator('#metadata-form')).toBeVisible();
  return store;
}

export async function addCity(page: Page, query: string, pick = 0): Promise<void> {
  await page.locator('#dest-search').fill(query);
  const opt = page.locator('#dest-search-list .place-option:not(.place-option--free)').nth(pick);
  await expect(opt).toBeVisible();
  await opt.click();
}

export async function addPlace(page: Page, query: string): Promise<void> {
  await page.locator('#act-search').fill(query);
  const opt = page.locator('#act-search-list .place-option:not(.place-option--free)').first();
  await expect(opt).toBeVisible();
  await opt.click();
}

export const saved = (page: Page) => expect(page.locator('#save-status')).toHaveAttribute('data-state', 'saved');

