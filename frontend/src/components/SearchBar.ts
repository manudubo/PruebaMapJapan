import { search, searchEntries, buildSearchIndex, getTypeIcon, getSuggestions } from '@/modules/search';
import type { SearchResult } from '@/modules/search';
import { highlightMatch } from '@/modules/highlight';
import {
  currentTripIdFromLocation,
  pageKindFromPath,
  resolveSearchScope,
  scopeFallback,
  scopeLabels,
  type PageKind,
  type ScopeFallback,
  type SearchScope,
} from '@/modules/searchScope';
import {
  invalidateUserSearchIndex,
  isAbortError,
  UserIndexError,
  userSearchIndex,
  type UserIndexSnapshot,
} from '@/modules/userSearchIndex';
import { TRIPS_CHANGED_EVENT } from '@/modules/tripsChanged';
import { getAuthStatus, initKeycloak, login, onAuthStatusChange, retryAuth } from '@/auth/keycloak';
import { SEARCH_BAR_CSS } from './searchBarStyles';

const KEYBOARD_HINT_HTML = `
  <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
  <span><kbd>↵</kbd> select</span>
  <span><kbd>esc</kbd> close</span>
`;

const DEBOUNCE_MS = 150;
const SUGGESTION_LIMIT = 8;
const USER_RESULT_LIMIT = 10;

/**
 * Global Search Bar Component
 * Fixed position, always visible search with dropdown results
 *
 * What it searches depends on where it is (see searchScope.ts): the demo itinerary on the
 * landing and city pages, the signed-in user's own trips on dashboard / trip / profile pages.
 *
 * Usa CSS custom properties del documento principal que se heredan al Shadow DOM,
 * en lugar de :host-context() que no funciona en Safari/iOS
 */
class SearchBar extends HTMLElement {
  private shadow: ShadowRoot;
  private input: HTMLInputElement | null = null;
  private dropdown: HTMLElement | null = null;
  private container: HTMLElement | null = null;
  private isOpen = false;
  private selectedIndex = -1;
  private results: SearchResult[] = [];

  private pageKind: PageKind = 'demo';
  private scope: SearchScope = 'demo';
  private fallback: ScopeFallback | null = null;
  private currentTripId: string | null = null;
  private demoIndexBuilt = false;

  /** Identifies the latest run; an older run that finishes later sees a different value and drops its result. */
  private seq = 0;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The query whose result is on screen (or being loaded): what the highlight uses. */
  private shownQuery = '';
  /** The last run was cut off (closed mid-load), so reopening must run it again. */
  private interrupted = false;

  private cleanups: Array<() => void> = [];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.setupEventListeners();
    this.updateScope();
  }

  disconnectedCallback(): void {
    this.cancelPending();
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
  }

  // ---------------------------------------------------------------------
  // Scope
  // ---------------------------------------------------------------------

  /** Recompute scope from the page and the auth status. Returns true when the scope changed. */
  private updateScope(): boolean {
    const before = this.scope;
    this.pageKind = pageKindFromPath(window.location.pathname);
    const auth = getAuthStatus();
    this.scope = resolveSearchScope(this.pageKind, auth);
    this.fallback = scopeFallback(this.pageKind, auth);
    this.currentTripId = currentTripIdFromLocation(window.location.pathname, window.location.search);

    if (this.scope === 'demo' && !this.demoIndexBuilt) {
      buildSearchIndex();
      this.demoIndexBuilt = true;
    }

    const labels = scopeLabels(this.scope);
    this.input?.setAttribute('placeholder', labels.placeholder);
    this.input?.setAttribute('aria-label', labels.ariaLabel);
    this.container?.setAttribute('data-scope', this.scope);
    return before !== this.scope;
  }

  private onAuthChange(): void {
    const changed = this.updateScope();
    // Results on screen were for the old scope: redo them for the new one.
    if (changed && this.isOpen) void this.run(this.input?.value ?? '');
  }

  // ---------------------------------------------------------------------
  // Markup
  // ---------------------------------------------------------------------

  private render(): void {
    const labels = scopeLabels(this.scope);
    this.shadow.innerHTML = `
      <style>${SEARCH_BAR_CSS}</style>

      <div class="search-strip">
      <div class="search-container" role="search" data-scope="${this.scope}">
        <div class="search-input-wrapper">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text"
            class="search-input"
            placeholder="${labels.placeholder}"
            aria-label="${labels.ariaLabel}"
            aria-controls="search-dropdown"
            aria-autocomplete="list"
            autocomplete="off"
          >
          <button class="clear-btn" type="button" aria-label="Clear search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="search-dropdown" id="search-dropdown" role="listbox" aria-label="Search results">
          <ul class="search-results" role="presentation"></ul>
        </div>
        <div class="sr-only" role="status" aria-live="polite" id="search-live"></div>
      </div>
      </div>
    `;
  }

  private setupEventListeners(): void {
    this.input = this.shadow.querySelector('.search-input');
    this.dropdown = this.shadow.querySelector('.search-dropdown');
    this.container = this.shadow.querySelector('.search-container');
    const container = this.container;
    const clearBtn = this.shadow.querySelector('.clear-btn');

    if (!this.input || !this.dropdown || !container) return;
    const input = this.input;

    // Focus to expand
    input.addEventListener('focus', () => {
      container.classList.add('expanded');
      if (input.value) {
        this.openDropdown();
        if (this.interrupted) void this.run(input.value);
      } else {
        void this.run('');
      }
    });

    // Escape closes the list but keeps focus, so a click must be able to bring it back.
    input.addEventListener('click', () => {
      if (this.isOpen) return;
      container.classList.add('expanded');
      if (input.value) {
        this.openDropdown();
        if (this.interrupted) void this.run(input.value);
      } else {
        void this.run('');
      }
    });

    // Input changes
    input.addEventListener('input', (e) => {
      const query = (e.target as HTMLInputElement).value;
      container.classList.toggle('has-value', query.length > 0);
      this.scheduleRun(query);
    });

    // Keyboard navigation
    input.addEventListener('keydown', (e) => this.handleKeydown(e));

    // Clear button
    clearBtn?.addEventListener('click', () => {
      input.value = '';
      input.focus();
      container.classList.remove('has-value');
      this.scheduleRun('');
    });

    // Click outside to close
    this.listen(document, 'click', (e) => {
      if (!this.contains(e.target as Node)) {
        this.closeDropdown();
        container.classList.remove('expanded');
      }
    });

    // Keyboard shortcut (Cmd/Ctrl + K)
    this.listen(document, 'keydown', (e) => {
      const ke = e as KeyboardEvent;
      if ((ke.metaKey || ke.ctrlKey) && ke.key === 'k') {
        ke.preventDefault();
        input.focus();
      }

      if (ke.key === 'Escape' && this.isOpen) {
        this.closeDropdown();
        input.blur();
      }
    });

    // Sign-in state settles after load (or changes): re-evaluate the scope.
    this.cleanups.push(onAuthStatusChange(() => this.onAuthChange()));

    // A trip was created/edited/deleted: what we hold may be stale.
    this.listen(window, TRIPS_CHANGED_EVENT, () => {
      invalidateUserSearchIndex();
      if (this.isOpen && this.scope === 'user') void this.run(input.value);
      else this.interrupted = true;
    });
  }

  private listen(target: Document | Window, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.cleanups.push(() => target.removeEventListener(type, fn));
  }

  // ---------------------------------------------------------------------
  // Running a search
  // ---------------------------------------------------------------------

  /** Debounced entry point for typing. An empty query is immediate (suggestions). */
  private scheduleRun(query: string): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (query.length === 0) {
      void this.run('');
      return;
    }
    // Whatever was in flight answers an older query; closing before the timer fires must re-run on reopen.
    this.seq++;
    this.interrupted = true;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(query);
    }, DEBOUNCE_MS);
  }

  /** Stop everything pending: the debounce timer, the in-flight load, and any late answer. */
  private cancelPending(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.seq++;
    this.abort?.abort();
    this.abort = null;
  }

  private isCurrent(seq: number): boolean {
    return seq === this.seq;
  }

  /**
   * Run `query` ('' means suggestions) in the current scope and paint the outcome. Safe to
   * call at any time: a newer run, a close or a scope change makes an older one drop its result.
   */
  private async run(query: string, retry = false): Promise<void> {
    this.abort?.abort();
    const abort = (this.abort = new AbortController());
    const seq = ++this.seq;
    this.shownQuery = query;
    this.interrupted = true;
    this.openDropdown();

    // Account pages: wait (bounded) for the sign-in check so we know whose trips to search.
    if (this.pageKind === 'account' && getAuthStatus() === 'pending') {
      this.paintStatus({ kind: 'loading', title: 'Checking sign-in…' });
      await Promise.race([
        initKeycloak().catch(() => false),
        new Promise<void>((resolve) => abort.signal.addEventListener('abort', () => resolve(), { once: true })),
      ]);
      if (!this.isCurrent(seq)) return;
    }
    this.updateScope();

    if (this.scope === 'demo') {
      this.paintDemo(query);
      this.interrupted = false;
      return;
    }

    if (retry || userSearchIndex.needsNetwork()) {
      this.paintStatus({ kind: 'loading', title: 'Loading your trips…' });
    }

    let snapshot: UserIndexSnapshot;
    try {
      snapshot = await userSearchIndex.ensureLoaded({
        signal: abort.signal,
        priorityTripId: this.currentTripId,
        retry,
      });
    } catch (err) {
      if (isAbortError(err) || !this.isCurrent(seq)) return;
      this.interrupted = false;
      this.paintError(err);
      return;
    }
    if (!this.isCurrent(seq)) return;

    this.interrupted = false;
    this.paintUser(query, snapshot);
  }

  // ---------------------------------------------------------------------
  // Painting
  // ---------------------------------------------------------------------

  private paintDemo(query: string): void {
    if (query === '') {
      this.results = getSuggestions();
      this.paintResults({ suggestionsHeader: 'Cities' });
    } else {
      this.results = search(query);
      this.paintResults({});
    }
  }

  private paintUser(query: string, snapshot: UserIndexSnapshot): void {
    if (snapshot.tripCount === 0) {
      this.results = [];
      this.paintStatus({
        kind: 'empty-account',
        title: 'No trips yet',
        detail: 'Create a trip and you can search its cities, days and activities here.',
      });
      return;
    }

    const current = this.currentTripId;
    if (query === '') {
      const trips = snapshot.tripEntries.slice();
      if (current) trips.sort((a, b) => Number(b.tripId === current) - Number(a.tripId === current));
      this.results = trips.slice(0, SUGGESTION_LIMIT);
      this.paintResults({ suggestionsHeader: 'Your trips', partial: snapshot.partial });
      return;
    }

    this.results = searchEntries(snapshot.entries, query, { limit: USER_RESULT_LIMIT, currentTripId: current });
    this.paintResults({ groupByCurrentTrip: !!current, partial: snapshot.partial });
  }

  private paintError(err: unknown): void {
    const kind = err instanceof UserIndexError ? err.kind : 'network';
    const copy: Record<string, string> = {
      timeout: 'Your trips are taking too long to load.',
      unauthorized: 'Your session has expired.',
      'email-not-verified': 'Verify your email to search your trips.',
      network: "Couldn't load your trips.",
    };
    this.paintStatus({ kind: 'error', title: copy[kind] ?? copy['network']!, errorKind: kind });
  }

  /** The scope bar every state starts with: what is searched, and why if it fell back to the demo. */
  private buildScopeBar(): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'scope-bar';
    li.setAttribute('role', 'presentation');

    const chip = document.createElement('span');
    chip.className = 'scope-chip';
    chip.textContent = scopeLabels(this.scope).chip;
    li.appendChild(chip);

    if (this.fallback === 'signed-out') {
      li.append(
        this.note('Sign in to search your own trips.'),
        this.actionButton('Sign in', () => void login().catch(() => undefined)),
      );
    } else if (this.fallback === 'auth-unavailable') {
      li.append(
        this.note("Can't reach sign-in right now, so this is the demo."),
        this.actionButton('Retry', () => {
          void retryAuth()
            .catch(() => false)
            .then(() => {
              this.updateScope();
              void this.run(this.input?.value ?? '');
            });
        }),
      );
    }
    return li;
  }

  private note(text: string): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = 'scope-note';
    span.textContent = text;
    return span;
  }

  private actionButton(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-btn';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  private paintStatus(status: {
    kind: 'loading' | 'error' | 'empty-account';
    title: string;
    detail?: string;
    errorKind?: string;
  }): void {
    const list = this.shadow.querySelector('.search-results');
    if (!list) return;
    this.results = [];
    this.selectedIndex = -1;

    const li = document.createElement('li');
    li.className = `search-status ${status.kind}`;
    li.setAttribute('role', 'presentation');

    if (status.kind === 'loading') {
      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      spinner.setAttribute('aria-hidden', 'true');
      li.appendChild(spinner);
    }

    const title = document.createElement('div');
    title.className = 'status-title';
    title.textContent = status.title;
    li.appendChild(title);

    if (status.detail) {
      const detail = document.createElement('div');
      detail.textContent = status.detail;
      li.appendChild(detail);
    }

    if (status.kind === 'empty-account') {
      const link = document.createElement('a');
      link.className = 'link-btn';
      link.href = 'dashboard.html';
      link.textContent = 'Create your first trip';
      li.appendChild(link);
    } else if (status.kind === 'error') {
      if (status.errorKind === 'unauthorized') {
        li.appendChild(this.actionButton('Sign in', () => void login().catch(() => undefined)));
      } else if (status.errorKind !== 'email-not-verified') {
        li.appendChild(this.actionButton('Retry', () => this.retryLoad()));
      }
    }

    list.replaceChildren(this.buildScopeBar(), li);
    this.announce(status.title);
  }

  private retryLoad(): void {
    this.input?.focus();
    void this.run(this.input?.value ?? '', true);
  }

  private paintResults(options: {
    suggestionsHeader?: string;
    groupByCurrentTrip?: boolean;
    partial?: boolean;
  }): void {
    const list = this.shadow.querySelector('.search-results');
    if (!list) return;
    this.selectedIndex = -1;
    const isSuggestions = options.suggestionsHeader !== undefined;

    const frag = document.createDocumentFragment();
    frag.appendChild(this.buildScopeBar());

    if (this.results.length === 0) {
      // Static markup only: no data interpolated.
      const empty = document.createElement('li');
      empty.className = 'search-empty';
      empty.setAttribute('role', 'presentation');
      empty.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <div class="empty-text"></div>
      `;
      empty.querySelector('.empty-text')!.textContent =
        this.scope === 'user' ? 'No results found in your trips' : 'No results found';
      frag.appendChild(empty);
    } else {
      // SEC-10: build result items with DOM APIs — titles, subtitles and the
      // query-highlight are text nodes, never parsed HTML.
      let lastGroup: boolean | null = null;
      if (isSuggestions) frag.appendChild(this.sectionHeader(options.suggestionsHeader!));

      this.results.forEach((result, index) => {
        if (options.groupByCurrentTrip) {
          const inCurrent = result.tripId === this.currentTripId;
          if (inCurrent !== lastGroup) {
            frag.appendChild(this.sectionHeader(inCurrent ? 'This trip' : 'Other trips'));
            lastGroup = inCurrent;
          }
        }
        frag.appendChild(this.buildResultItem(result, index));
      });

      if (!isSuggestions) {
        const hint = document.createElement('li');
        hint.className = 'keyboard-hint';
        hint.setAttribute('role', 'presentation');
        // Static markup only — no data interpolated.
        hint.innerHTML = KEYBOARD_HINT_HTML;
        frag.appendChild(hint);
      }
    }

    if (options.partial) {
      const note = document.createElement('li');
      note.className = 'search-note';
      note.setAttribute('role', 'presentation');
      const text = document.createElement('span');
      text.textContent = 'Some trips could not be fully loaded.';
      note.append(text, this.actionButton('Retry', () => this.retryLoad()));
      frag.appendChild(note);
    }

    list.replaceChildren(frag);
    this.announce(
      this.results.length === 0
        ? 'No results'
        : `${this.results.length} ${this.results.length === 1 ? 'result' : 'results'}`,
    );
  }

  private sectionHeader(text: string): HTMLLIElement {
    const header = document.createElement('li');
    header.className = 'section-header';
    header.setAttribute('role', 'presentation');
    header.textContent = text;
    return header;
  }

  private announce(message: string): void {
    const live = this.shadow.querySelector('#search-live');
    if (live) live.textContent = message;
  }

  private buildResultItem(result: SearchResult, index: number): HTMLLIElement {
    const li = document.createElement('li');
    li.setAttribute('role', 'presentation');
    const a = document.createElement('a');
    a.href = result.url;
    a.className = `search-result${index === this.selectedIndex ? ' selected' : ''}`;
    a.setAttribute('role', 'option');
    a.setAttribute('aria-selected', String(index === this.selectedIndex));
    a.dataset.index = String(index);

    const icon = document.createElement('div');
    icon.className = result.color ? 'result-icon has-color' : 'result-icon';
    // CSSOM assignment: an invalid/hostile value is simply dropped.
    if (result.color) icon.style.background = result.color;
    icon.innerHTML = getTypeIcon(result.type); // static SVG from a fixed map

    const content = document.createElement('div');
    content.className = 'result-content';
    const title = document.createElement('div');
    title.className = 'result-title';
    title.appendChild(highlightMatch(result.title, this.shownQuery));
    const subtitle = document.createElement('div');
    subtitle.className = 'result-subtitle';
    subtitle.textContent = result.subtitle;
    content.append(title, subtitle);
    if (result.context) {
      const context = document.createElement('div');
      context.className = 'result-context';
      context.textContent = result.context;
      content.appendChild(context);
    }

    const badge = document.createElement('span');
    badge.className = 'result-badge';
    badge.textContent = result.type === 'activity' ? 'place' : result.type;

    a.append(icon, content, badge);
    a.addEventListener('click', (e) => {
      // Let the browser handle new-tab clicks; a plain click navigates below.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      this.handleResultClick(result);
      this.closeDropdown();
    });
    li.appendChild(a);
    return li;
  }

  private handleResultClick(result: SearchResult): void {
    // The URL is complete (page, trip, destination, day and activity parameters).
    window.location.href = result.url;
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (!this.isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.results.length - 1);
        this.updateSelection();
        break;

      case 'ArrowUp':
        e.preventDefault();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        this.updateSelection();
        break;

      case 'Enter':
        e.preventDefault();
        if (this.selectedIndex >= 0 && this.results[this.selectedIndex]) {
          this.handleResultClick(this.results[this.selectedIndex]!);
        }
        break;

      case 'Escape':
        this.closeDropdown();
        break;
    }
  }

  private updateSelection(): void {
    const items = this.shadow.querySelectorAll('.search-result');
    items.forEach((item, index) => {
      item.classList.toggle('selected', index === this.selectedIndex);
      item.setAttribute('aria-selected', String(index === this.selectedIndex));
    });

    // Scroll into view
    const selected = items[this.selectedIndex];
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }

  private openDropdown(): void {
    if (!this.dropdown || !this.input) return;
    this.isOpen = true;
    this.dropdown.classList.add('open');
  }

  private closeDropdown(): void {
    if (!this.dropdown || !this.input) return;
    this.cancelPending();
    this.isOpen = false;
    this.dropdown.classList.remove('open');
    this.selectedIndex = -1;
  }
}

customElements.define('search-bar', SearchBar);

export default SearchBar;
