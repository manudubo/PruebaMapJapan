import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { mockApi } from './fixtures/mockApi';
import { mockKeycloakLoggedIn, mockKeycloakLoggedOut } from './fixtures/mockKeycloak';
import { mockAccountCredentials, mockAuthFlows, WEBAUTHN_SUPPORTED, WEBAUTHN_UNSUPPORTED } from './fixtures/mockAuthFlows';

/**
 * @qa-noauth: axe-core (wcag2a, wcag2aa, wcag21aa, wcag22aa) on the verify screen, the onboarding
 * dialogs and recover.html (all three steps), light and dark, phone and desktop widths.
 *
 * axe-core is not a dependency of tests/ (CI installs it for scripts/a11y-axe.mjs with
 * `npm i --no-save axe-core`); point AXE_CORE_PATH at an axe.min.js to run it elsewhere.
 * QA_SCREENSHOTS_DIR=<dir> also saves a screenshot of every audited state.
 *
 *   cd tests && SKIP_REAL_AUTH=1 npx playwright test registration-ui-a11y --project=chromium
 */

function loadAxe(): string | null {
  const candidates: string[] = [];
  if (process.env['AXE_CORE_PATH']) candidates.push(process.env['AXE_CORE_PATH']);
  try {
    candidates.push(require.resolve('axe-core/axe.min.js'));
  } catch {
    // not installed
  }
  for (const file of candidates) {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      // try the next
    }
  }
  return null;
}
const AXE = loadAxe();

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const CODE = '123456';

interface State {
  name: string;
  open: (page: Page) => Promise<void>;
}

async function app(page: Page, opts: { verified: boolean; asNew: boolean; webauthn?: 'supported' | 'unsupported'; passwords?: number }) {
  const verification = { verified: opts.verified };
  await page.addInitScript(opts.webauthn === 'unsupported' ? WEBAUTHN_UNSUPPORTED : WEBAUTHN_SUPPORTED);
  await mockKeycloakLoggedIn(page);
  await mockAccountCredentials(page, { passkeys: 0, passwords: opts.passwords ?? 1 });
  await mockApi(page, { trips: [], verification, me: { onboarding: { is_new: opts.asNew } } });
  await mockAuthFlows(page, { code: CODE, verification });
}

async function recoverBase(page: Page) {
  await mockKeycloakLoggedOut(page);
  await mockAuthFlows(page, { code: CODE });
  await page.goto('recover.html?email=ana%40example.com');
  await expect(page.locator('#recover-email')).toBeVisible();
}

const STATES: State[] = [
  {
    name: 'verify-email',
    open: async (page) => {
      await app(page, { verified: false, asNew: true });
      await page.goto('dashboard.html');
      await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
      // an error state is part of the audit: red text on the card
      await page.keyboard.type('000000');
      await expect(page.locator('#verify-email-error')).toContainText('Attempts left');
    },
  },
  {
    name: 'onboarding-passkey',
    open: async (page) => {
      await app(page, { verified: true, asNew: true });
      await page.goto('dashboard.html');
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  {
    name: 'onboarding-password',
    open: async (page) => {
      await app(page, { verified: true, asNew: true, webauthn: 'unsupported', passwords: 0 });
      await page.goto('dashboard.html');
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  {
    name: 'recover-email',
    open: async (page) => {
      await recoverBase(page);
    },
  },
  {
    name: 'recover-code',
    open: async (page) => {
      await recoverBase(page);
      await page.getByRole('button', { name: 'Send code' }).click();
      await expect(page.locator('#recover-sent')).toBeVisible();
      await page.getByLabel('New password', { exact: true }).fill('short');
      await page.locator('#recover-password').blur();
    },
  },
  {
    name: 'recover-done',
    open: async (page) => {
      await recoverBase(page);
      await page.getByRole('button', { name: 'Send code' }).click();
      await expect(page.locator('#recover-sent')).toBeVisible();
      await page.keyboard.type(CODE);
      await page.getByLabel('New password', { exact: true }).fill('correct horse battery');
      await page.getByLabel('Confirm new password').fill('correct horse battery');
      await page.getByRole('button', { name: 'Set new password' }).click();
      await expect(page.getByRole('heading', { name: 'Your password is set' })).toBeVisible();
    },
  },
];

test.describe('@qa-noauth registration UI accessibility (axe)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.fixme(!AXE, 'axe-core is not installed: `npm i --no-save axe-core` in tests/, or set AXE_CORE_PATH');

  for (const state of STATES) {
    for (const scheme of ['light', 'dark'] as const) {
      for (const width of [375, 1280] as const) {
        test(`${state.name} ${scheme} ${width}px: 0 violations`, async ({ page }) => {
          await page.setViewportSize({ width, height: width === 375 ? 740 : 800 });
          await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
          await state.open(page);

          await page.evaluate(AXE!);
          const violations = await page.evaluate(async (tags) => {
            const axe = (window as unknown as { axe: { run: (c: Document, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string; help: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
            const res = await axe.run(document, { runOnly: { type: 'tag', values: tags } });
            return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')) }));
          }, TAGS);
          expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);

          // No horizontal page scroll at phone width.
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow).toBeLessThanOrEqual(0);

          const dir = process.env['QA_SCREENSHOTS_DIR'];
          if (dir) await page.screenshot({ path: path.join(dir, `${state.name}-${scheme}-${width}.png`) });
        });
      }
    }
  }
});
