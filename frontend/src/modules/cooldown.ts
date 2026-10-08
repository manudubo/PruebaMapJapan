/**
 * A "wait N seconds" timer that survives a reload and is shared by every tab (localStorage),
 * e.g. the "Resend code" button: reloading the page or opening a second tab must not let the
 * user (or the page itself) request another code before the server allows it.
 *
 * Storage can be blocked (private mode, policies): every access is guarded and the timer
 * then lives in memory for this page only.
 */

const PREFIX = 'travelmap.cooldown.';
/** No server asks for more than this; a larger stored value is corrupt or tampered with. */
export const MAX_COOLDOWN_SECONDS = 60 * 60;

export interface Cooldown {
  /** Whole seconds left (0 when free). */
  remaining(): number;
  start(seconds: number): void;
  clear(): void;
}

export function createCooldown(name: string, now: () => number = () => Date.now()): Cooldown {
  const key = PREFIX + name;
  let memory = 0;

  /** Storage is the truth when it works (another tab may have cleared it); memory otherwise. */
  const read = (): number => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? 0 : Number(raw) || 0;
    } catch {
      return memory;
    }
  };

  return {
    remaining() {
      const left = Math.ceil((read() - now()) / 1000);
      if (left <= 0 || left > MAX_COOLDOWN_SECONDS) return 0;
      return left;
    },
    start(seconds: number) {
      const s = Math.min(Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0)), MAX_COOLDOWN_SECONDS);
      memory = now() + s * 1000;
      try {
        window.localStorage.setItem(key, String(memory));
      } catch {
        // blocked: memory only
      }
    },
    clear() {
      memory = 0;
      try {
        window.localStorage.removeItem(key);
      } catch {
        // blocked
      }
    },
  };
}
