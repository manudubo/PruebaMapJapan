if (typeof PromiseRejectionEvent === 'undefined') {
  (globalThis as Record<string, unknown>).PromiseRejectionEvent = class PromiseRejectionEvent extends Event {
    readonly promise: Promise<unknown>;
    readonly reason: unknown;
    constructor(type: string, init: { promise: Promise<unknown>; reason: unknown; cancelable?: boolean }) {
      super(type, { cancelable: init.cancelable ?? false });
      this.promise = init.promise;
      this.reason = init.reason;
    }
  };
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
