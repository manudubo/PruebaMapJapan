import { expect, test } from '@playwright/test';

async function mockAuthAndApi(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/realms/**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  await page.route('http://localhost:8787/api/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    });
  });
}

async function waitForAppStyles(page: import('@playwright/test').Page): Promise<void> {
  await expect.poll(
    () => page.evaluate(() => getComputedStyle(document.body).fontFamily),
    { timeout: 10000 },
  ).toContain('Inter');
}

test.describe('Flat demo style consistency', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthAndApi(page);
  });

  test('dashboard uses shared flat controls without rounded corners, gradients, or heavy shadows', async ({ page }) => {
    await page.goto('dashboard.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAppStyles(page);

    const newTripButton = page.locator('#new-trip-btn');
    await newTripButton.evaluate((el) => el.removeAttribute('hidden'));

    const buttonStyles = await newTripButton.evaluate((el) => {
      const styles = getComputedStyle(el);
      return {
        borderRadius: styles.borderRadius,
        fontFamily: styles.fontFamily,
      };
    });

    expect(buttonStyles.borderRadius).toBe('0px');
    expect(buttonStyles.fontFamily).toContain('Inter');

    await page.locator('#trips-grid').evaluate((el) => {
      el.innerHTML = `
        <a class="trip-card" href="#">
          <div class="trip-card-cover"></div>
          <div class="trip-card-body"><h2 class="trip-card-title">Test trip</h2></div>
        </a>
      `;
    });
    const card = page.locator('.trip-card').first();

    const cardStyles = await card.evaluate((el) => {
      const styles = getComputedStyle(el);
      const cover = el.querySelector('.trip-card-cover');
      const coverStyles = cover ? getComputedStyle(cover) : null;
      return {
        borderRadius: styles.borderRadius,
        boxShadow: styles.boxShadow,
        coverBackgroundImage: coverStyles?.backgroundImage ?? '',
      };
    });

    expect(cardStyles.borderRadius).toBe('0px');
    expect(cardStyles.boxShadow).toBe('none');
    expect(cardStyles.coverBackgroundImage).toBe('none');
  });

  test('home hero uses the demo screenshot background and unauthenticated nav hides session actions', async ({ page }) => {
    await page.route('**/src/auth/keycloak.ts*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          export const keycloak = { authenticated: false, token: null, tokenParsed: undefined };
          export async function initKeycloak() { return false; }
          export async function login() {}
          export async function logout() {}
          export async function getToken() { throw new Error('User is not authenticated'); }
          export async function refreshToken() { return false; }
          export function isAuthenticated() { return false; }
          export function getTokenParsed() { return undefined; }
          export function getUserInfo() { return null; }
        `,
      });
    });

    await page.goto('index.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAppStyles(page);

    const hero = page.locator('#landing-hero');
    await expect(hero).toBeVisible();

    const backgroundImage = await hero.evaluate((el) => getComputedStyle(el, '::before').backgroundImage);
    expect(backgroundImage).toContain('demo-hero');

    const heroImageStyles = await hero.evaluate((el) => {
      const styles = getComputedStyle(el, '::before');
      return {
        filter: styles.filter,
        opacity: Number(styles.opacity),
      };
    });
    expect(heroImageStyles.filter).toContain('blur');
    expect(heroImageStyles.opacity).toBeLessThan(0.35);

    await expect(page.locator('travel-nav .nav-brand')).toContainText('Home');
    await expect(page.locator('travel-nav .nav-link', { hasText: 'Home' })).toHaveCount(0);
    await expect(page.locator('travel-nav .nav-auth-logout')).toBeHidden();
    await expect(page.locator('travel-nav .nav-auth-user')).toBeHidden();
  });

  test('unauthenticated dashboard only exposes the sign-in prompt', async ({ page }) => {
    await page.route('**/src/auth/keycloak.ts*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          export const keycloak = { authenticated: false, token: null, tokenParsed: undefined };
          export async function initKeycloak() { return false; }
          export async function login() {}
          export async function logout() {}
          export async function getToken() { throw new Error('User is not authenticated'); }
          export async function refreshToken() { return false; }
          export function isAuthenticated() { return false; }
          export function getTokenParsed() { return undefined; }
          export function getUserInfo() { return null; }
        `,
      });
    });

    await page.goto('dashboard.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAppStyles(page);

    await expect(page.locator('#dashboard-login-prompt')).toBeVisible();
    await expect(page.locator('#auth-login-prompt-btn')).toBeVisible();
    await expect(page.locator('#new-trip-btn')).toBeHidden();
    await expect(page.locator('#trips-grid')).toBeHidden();
    await expect(page.getByText('Loading trips')).toHaveCount(0);
  });

  test('profile password control stays inside the app and uses a button', async ({ page, request }) => {
    await page.route('**/src/pages/profile.ts', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'document.body.classList.add("ready");',
      });
    });

    await page.goto('profile.html');
    await page.waitForLoadState('domcontentloaded');

    const passwordControl = page.locator('#btn-change-password');
    await expect(passwordControl).toHaveJSProperty('tagName', 'BUTTON');
    await expect(passwordControl).not.toHaveAttribute('href', /account\/password/);

    const profileSource = await request.get('src/pages/profile.ts');
    const sourceText = await profileSource.text();
    expect(sourceText).toMatch(/action:\s*['"]UPDATE_PASSWORD['"]/);
    expect(sourceText).not.toContain('/account/password');
  });

  test('trip destination tabs use the same square geometry as the demo style', async ({ page }) => {
    await page.route('**/src/pages/tripDetail.ts', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'import "/PruebaMapJapan/src/styles/main.css"; document.body.classList.add("ready");',
      });
    });

    await page.goto('trip.html');
    await page.waitForLoadState('domcontentloaded');
    await waitForAppStyles(page);

    await page.evaluate(() => {
      const tab = document.createElement('button');
      tab.className = 'dest-tab';
      tab.textContent = 'Tokyo';
      document.body.appendChild(tab);
    });

    const tabStyles = await page.locator('.dest-tab').first().evaluate((el) => {
      const styles = getComputedStyle(el);
      return {
        borderRadius: styles.borderRadius,
        fontFamily: styles.fontFamily,
      };
    });

    expect(tabStyles.borderRadius).toBe('0px');
    expect(tabStyles.fontFamily).toContain('Inter');
  });
});
