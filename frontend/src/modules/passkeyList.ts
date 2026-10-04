/**
 * Passkey list rendering for the profile page (SEC-09).
 *
 * `userLabel` is typed by the user when registering a passkey and `id` comes
 * from the Keycloak Account API, so neither is ever parsed as HTML: every
 * value goes through textContent / dataset, never innerHTML.
 */

/** KC 26 Account API credential metadata (subset used here). */
export interface PasskeyCredential {
  id: string;
  type: string;
  userLabel?: string;
  createdDate?: number;
}

export const EMPTY_PASSKEYS_MESSAGE = "You don't have any passkeys registered yet.";

function formatCreated(createdDate: number | undefined): string {
  if (!createdDate) return '';
  const d = new Date(createdDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function emptyItem(message: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'passkey-empty';
  li.textContent = message;
  return li;
}

export function buildPasskeyItem(
  c: PasskeyCredential,
  onDelete: (credentialId: string) => void,
): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'passkey-item';
  li.dataset.credentialId = c.id;

  const info = document.createElement('div');
  info.className = 'passkey-info';

  const name = document.createElement('span');
  name.className = 'passkey-name';
  // Empty/whitespace labels fall back like a missing one.
  name.textContent = c.userLabel && c.userLabel.trim() !== '' ? c.userLabel : 'Passkey';
  info.appendChild(name);

  const created = formatCreated(c.createdDate);
  if (created) {
    const meta = document.createElement('span');
    meta.className = 'passkey-meta';
    meta.textContent = `Registered: ${created}`;
    info.appendChild(meta);
  }

  const btn = document.createElement('button');
  btn.className = 'btn btn-danger';
  btn.type = 'button';
  btn.dataset.credentialId = c.id;
  btn.setAttribute('data-passkey-delete', '');
  btn.textContent = 'Delete';
  btn.addEventListener('click', () => {
    if (c.id) onDelete(c.id);
  });

  li.append(info, btn);
  return li;
}

/** Replace the list contents with one item per credential (or an empty state). */
export function renderPasskeyList(
  list: HTMLElement,
  credentials: PasskeyCredential[],
  onDelete: (credentialId: string) => void,
): void {
  if (credentials.length === 0) {
    list.replaceChildren(emptyItem(EMPTY_PASSKEYS_MESSAGE));
    return;
  }
  list.replaceChildren(...credentials.map((c) => buildPasskeyItem(c, onDelete)));
}

export function renderPasskeyListError(list: HTMLElement): void {
  list.replaceChildren(emptyItem('Could not load passkey list.'));
}
