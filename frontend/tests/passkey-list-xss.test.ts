import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  renderPasskeyList,
  renderPasskeyListError,
  buildPasskeyItem,
  EMPTY_PASSKEYS_MESSAGE,
  type PasskeyCredential,
} from '@/modules/passkeyList';

// SEC-09: passkey userLabel (typed by the user at registration, returned by
// the Keycloak Account API) must never be parsed as HTML on the profile page.

const PAYLOADS = [
  '<img src=x onerror="window.__pwned=1">',
  '<script>window.__pwned=1</script>',
  '<svg onload="window.__pwned=1"></svg>',
  '"><img src=x onerror=window.__pwned=1>',
  "'><iframe src=javascript:window.__pwned=1>",
  '<a href="javascript:window.__pwned=1">click</a>',
  '</span></div><button data-passkey-delete data-credential-id="victim">x</button>',
  'Tom & Jerry &amp; &lt;b&gt;',
  '<!-- comment --><b>bold</b>',
  '<math><mtext><table><mglyph><style><img src=x onerror=window.__pwned=1>',
];

function cred(overrides: Partial<PasskeyCredential> = {}): PasskeyCredential {
  return { id: 'cred-1', type: 'webauthn-passwordless', userLabel: 'My laptop', createdDate: Date.UTC(2026, 0, 15, 12), ...overrides };
}

let list: HTMLUListElement;

beforeEach(() => {
  list = document.createElement('ul');
  document.body.appendChild(list);
  (window as unknown as Record<string, unknown>)['__pwned'] = undefined;
});

afterEach(() => {
  list.remove();
});

describe('renderPasskeyList — XSS (SEC-09)', () => {
  it.each(PAYLOADS)('label %j is rendered as literal text only', async (payload) => {
    renderPasskeyList(list, [cred({ userLabel: payload })], vi.fn());
    const name = list.querySelector('.passkey-name')!;
    expect(name.textContent).toBe(payload);
    expect(name.children).toHaveLength(0); // no parsed elements
    expect(list.querySelectorAll('img, script, svg, iframe, a, b, math, style')).toHaveLength(0);
    // exactly one delete button — injected markup cannot add more
    expect(list.querySelectorAll('[data-passkey-delete]')).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0)); // let any onerror/onload fire
    expect((window as unknown as Record<string, unknown>)['__pwned']).toBeUndefined();
  });

  it('a malicious credential id cannot break out of the data attribute', () => {
    const id = '" onmouseover="window.__pwned=1" x="';
    const onDelete = vi.fn();
    renderPasskeyList(list, [cred({ id })], onDelete);
    const li = list.querySelector('li')!;
    expect(li.getAttribute('onmouseover')).toBeNull();
    expect(li.dataset.credentialId).toBe(id);
    list.querySelector<HTMLButtonElement>('[data-passkey-delete]')!.click();
    expect(onDelete).toHaveBeenCalledWith(id); // exact id round-trips
  });

  it('ampersands and entities are shown verbatim, not decoded', () => {
    renderPasskeyList(list, [cred({ userLabel: 'A &amp; B &lt;3' })], vi.fn());
    expect(list.querySelector('.passkey-name')!.textContent).toBe('A &amp; B &lt;3');
  });
});

describe('renderPasskeyList — behaviour', () => {
  it('renders one item per credential with delete wired to the right id', () => {
    const onDelete = vi.fn();
    renderPasskeyList(list, [cred({ id: 'a', userLabel: 'Phone' }), cred({ id: 'b', userLabel: 'Laptop' })], onDelete);
    const items = list.querySelectorAll('li.passkey-item');
    expect(items).toHaveLength(2);
    expect([...items].map((li) => li.querySelector('.passkey-name')!.textContent)).toEqual(['Phone', 'Laptop']);
    items[1]!.querySelector<HTMLButtonElement>('button')!.click();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('b');
  });

  it.each([undefined, '', '   '])('falls back to "Passkey" for label %j', (userLabel) => {
    renderPasskeyList(list, [cred({ userLabel })], vi.fn());
    expect(list.querySelector('.passkey-name')!.textContent).toBe('Passkey');
  });

  it('shows the registration date when present, omits it when absent/invalid', () => {
    renderPasskeyList(list, [cred(), cred({ id: 'x', createdDate: undefined }), cred({ id: 'y', createdDate: Number.NaN })], vi.fn());
    const metas = list.querySelectorAll('.passkey-meta');
    expect(metas).toHaveLength(1);
    expect(metas[0]!.textContent).toBe('Registered: Jan 15, 2026');
  });

  it('empty list shows the empty state', () => {
    renderPasskeyList(list, [], vi.fn());
    expect(list.children).toHaveLength(1);
    expect(list.textContent).toBe(EMPTY_PASSKEYS_MESSAGE);
  });

  it('re-rendering replaces previous items (no duplicates)', () => {
    renderPasskeyList(list, [cred()], vi.fn());
    renderPasskeyList(list, [cred({ id: 'z' })], vi.fn());
    expect(list.querySelectorAll('li')).toHaveLength(1);
  });

  it('error state replaces content with a text-only message', () => {
    renderPasskeyList(list, [cred()], vi.fn());
    renderPasskeyListError(list);
    expect(list.textContent).toBe('Could not load passkey list.');
    expect(list.querySelectorAll('button')).toHaveLength(0);
  });

  it('a 100 KB label is rendered intact as text', () => {
    const label = '<b>'.repeat(30_000);
    const li = buildPasskeyItem(cred({ userLabel: label }), vi.fn());
    expect(li.querySelector('.passkey-name')!.textContent).toBe(label);
    expect(li.querySelector('b')).toBeNull();
  });

  it('button with an empty id does not call onDelete', () => {
    const onDelete = vi.fn();
    buildPasskeyItem(cred({ id: '' }), onDelete).querySelector('button')!.click();
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('profile.ts source audit (SEC-09)', () => {
  const src = readFileSync(resolve(__dirname, '../src/pages/profile.ts'), 'utf8');

  it('never touches userLabel directly (rendering is delegated to passkeyList)', () => {
    expect(src).not.toMatch(/userLabel/);
  });

  it('has no innerHTML assignment built from a template with interpolation', () => {
    const assignments = src.match(/innerHTML\s*=\s*`[^`]*`/g) ?? [];
    for (const a of assignments) expect(a).not.toContain('${');
  });
});
