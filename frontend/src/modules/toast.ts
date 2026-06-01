export type ToastType = 'error' | 'success' | 'info';

export function showToast(message: string, type: ToastType): void {
  const container = getOrCreateContainer();
  const card = buildCard(message, type);
  container.prepend(card);
  scheduleAutoDismiss(card);
}

export function installGlobalErrorHandler(): void {
  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    showToast('An unexpected error occurred', 'error');
  });
}

function getOrCreateContainer(): HTMLElement {
  const existing = document.getElementById('toast-container');
  if (existing) return existing;
  const container = document.createElement('div');
  container.id = 'toast-container';
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Notifications');
  container.setAttribute('aria-live', 'polite');
  document.body.appendChild(container);
  return container;
}

function buildCard(message: string, type: ToastType): HTMLElement {
  const card = document.createElement('div');
  card.className = `toast toast--${type}`;
  card.setAttribute('role', type === 'error' ? 'alert' : 'status');
  if (type === 'error') card.setAttribute('aria-live', 'assertive');

  const msg = document.createElement('span');
  msg.className = 'toast-msg';
  msg.textContent = message;

  const btn = document.createElement('button');
  btn.className = 'toast-close';
  btn.setAttribute('aria-label', 'Dismiss');
  btn.textContent = '×';

  card.appendChild(msg);
  card.appendChild(btn);

  btn.addEventListener('click', () => dismiss(card));

  return card;
}

function scheduleAutoDismiss(card: HTMLElement): void {
  setTimeout(() => dismiss(card), 4000);
}

function dismiss(card: HTMLElement): void {
  card.classList.add('toast--exiting');
  setTimeout(() => card.remove(), 200);
}
