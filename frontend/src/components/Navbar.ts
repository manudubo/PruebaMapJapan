import { toggleTheme, getTheme } from '@/modules/theme';
import { initKeycloak, isAuthenticated, getUserInfo, login, logout } from '@/auth/keycloak';

export interface NavDestination {
  id: string | number;
  label: string; // city_name
  tripId: string | number;
  index?: number;
}

class TravelNav extends HTMLElement {
  private shadow: ShadowRoot;
  private destinations: NavDestination[] = [];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    // Parse destinations from attribute if provided
    const attr = this.getAttribute('destinations');
    if (attr) {
      try {
        this.destinations = JSON.parse(attr) as NavDestination[];
      } catch {
        this.destinations = [];
      }
    }

    this.render();
    this.setupEventListeners();

    // Silently check auth state and update nav auth UI
    initKeycloak()
      .then(() => {
        this.updateAuthUI();
      })
      .catch(() => {
        this.updateAuthUI();
      });
  }

  /**
   * Set the destination list dynamically (called after trip loads).
   */
  public setDestinations(destinations: NavDestination[]): void {
    this.destinations = destinations;
    this.render();
    this.setupEventListeners();
    // Re-run auth UI update after re-render
    this.updateAuthUI();
  }

  private updateAuthUI(): void {
    const authed = isAuthenticated();
    const loginBtn = this.shadow.querySelector<HTMLButtonElement>('.nav-auth-login');
    const logoutBtn = this.shadow.querySelector<HTMLButtonElement>('.nav-auth-logout');
    const userLabel = this.shadow.querySelector<HTMLElement>('.nav-auth-user');

    if (loginBtn) {
      loginBtn.hidden = authed;
    }
    if (logoutBtn) {
      logoutBtn.hidden = !authed;
    }
    if (userLabel) {
      if (authed) {
        const info = getUserInfo();
        const name = info?.name?.split(' ')[0] ?? info?.preferredUsername ?? '';
        userLabel.textContent = name;
        userLabel.hidden = !name;
      } else {
        userLabel.hidden = true;
      }
    }
  }

  private render(): void {
    const currentPage = this.getCurrentPage();
    const theme = getTheme();

    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
        }

        nav {
          background: var(--bg-glass, rgba(255,255,255,0.8));
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .nav-inner {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          height: 56px;
        }

        .nav-brand {
          font-weight: 600;
          font-size: 15px;
          color: var(--text-primary, #1d1d1f);
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          padding: 8px 12px;
          transition: all 0.2s ease;
        }

        .nav-brand:hover {
          color: var(--accent, #0071e3);
          background: var(--accent-subtle, rgba(0, 113, 227, 0.08));
        }

        .nav-brand svg {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
        }

        .nav-brand span {
          display: none;
        }

        @media (min-width: 640px) {
          .nav-brand span {
            display: inline;
          }
        }

        .top-nav {
          display: flex;
          gap: 4px;
          overflow-x: auto;
          scrollbar-width: thin;
          scrollbar-color: var(--text-tertiary, #86868b) transparent;
          -ms-overflow-style: auto;
          padding: 4px;
          flex: 1;
        }

        .top-nav::-webkit-scrollbar {
          height: 8px;
          display: block;
        }

        .top-nav::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.05);
        }

        .top-nav::-webkit-scrollbar-thumb {
          background: var(--text-tertiary, #86868b);
        }

        .top-nav::-webkit-scrollbar-thumb:hover {
          background: var(--text-primary, #1d1d1f);
        }

        .nav-link {
          padding: 8px 12px;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary, #515154);
          text-decoration: none;
          white-space: nowrap;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .nav-link:hover {
          color: var(--text-primary, #1d1d1f);
          background: var(--border-color, rgba(0,0,0,0.1));
        }

        .nav-link.is-active {
          color: var(--accent, #0071e3);
          background: var(--accent-subtle, rgba(0,113,227,0.1));
        }

        .nav-auth {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .nav-auth-user {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary, #515154);
          padding: 0 4px;
        }

        .nav-auth-btn {
          display: inline-flex;
          align-items: center;
          padding: 6px 14px;
          font-size: 13px;
          font-weight: 500;
          font-family: inherit;
          border-radius: 0;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .nav-auth-login {
          background: var(--accent, #0071e3);
          color: #fff;
          border: 1px solid var(--accent, #0071e3);
        }

        .nav-auth-login:hover {
          background: var(--accent-hover, #0077ed);
          border-color: var(--accent-hover, #0077ed);
        }

        .nav-auth-logout {
          background: transparent;
          color: var(--text-secondary, #515154);
          border: 1px solid var(--border-color, rgba(0,0,0,0.1));
        }

        .nav-auth-logout:hover {
          color: var(--text-primary, #1d1d1f);
          border-color: var(--text-secondary, #515154);
        }

        .theme-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary, #515154);
          background: transparent;
          border: 1px solid var(--border-color, rgba(0,0,0,0.1));
          cursor: pointer;
          transition: all 0.2s ease;
          flex-shrink: 0;
          font-family: inherit;
        }

        .theme-toggle:hover {
          color: var(--text-primary, #1d1d1f);
          border-color: var(--text-secondary, #515154);
        }

        .theme-toggle svg {
          width: 16px;
          height: 16px;
        }

        .theme-toggle span {
          display: none;
        }

        @media (min-width: 480px) {
          .theme-toggle span {
            display: inline;
          }
        }
      </style>
      <nav role="navigation" aria-label="Navegación principal">
        <div class="nav-inner">
          <a href="index.html" class="nav-brand" aria-label="Ir al inicio">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <span>Home</span>
          </a>
          <div class="top-nav" role="tablist" aria-label="Navegación">${this.renderNavLinks(currentPage)}</div>
          <div class="nav-auth">
            <span class="nav-auth-user" hidden></span>
            <button type="button" class="nav-auth-btn nav-auth-login" hidden>Iniciar sesión</button>
            <button type="button" class="nav-auth-btn nav-auth-logout" hidden>Cerrar sesión</button>
          </div>
          <button class="theme-toggle" type="button" aria-label="Cambiar tema">${this.getThemeIcon(theme)}<span>${theme === 'dark' ? 'Light' : 'Dark'}</span></button>
        </div>
      </nav>`;
  }

  private renderNavLinks(currentPage: string): string {
    // Default links always present
    const indexActive = currentPage === 'index' || currentPage === '';
    const dashboardActive = currentPage === 'dashboard';

    let links = `<a href="index.html" class="nav-link${indexActive ? ' is-active' : ''}" ${indexActive ? 'aria-current="page"' : ''} role="tab" aria-selected="${indexActive}">Inicio</a>`;
    links += `<a href="dashboard.html" class="nav-link${dashboardActive ? ' is-active' : ''}" ${dashboardActive ? 'aria-current="page"' : ''} role="tab" aria-selected="${dashboardActive}">Mis viajes</a>`;

    // Dynamic destination links
    if (this.destinations.length > 0) {
      const params = new URLSearchParams(window.location.search);
      const currentTripId = params.get('tripId');
      const currentDestIndex = parseInt(params.get('destIndex') ?? '-1', 10);

      for (let i = 0; i < this.destinations.length; i++) {
        const dest = this.destinations[i]!;
        const idx = dest.index !== undefined ? dest.index : i;
        const href = `trip.html?tripId=${dest.tripId}&destIndex=${idx}`;
        const isActive =
          currentPage === 'trip' &&
          currentTripId === String(dest.tripId) &&
          currentDestIndex === idx;
        links += `<a href="${href}" class="nav-link${isActive ? ' is-active' : ''}" ${isActive ? 'aria-current="page"' : ''} role="tab" aria-selected="${isActive}">${dest.label}</a>`;
      }
    }

    return links;
  }

  private getCurrentPage(): string {
    const path = window.location.pathname;
    const filename = path.split('/').pop() ?? '';
    return filename.replace('.html', '') || 'index';
  }

  private getThemeIcon(theme: string): string {
    if (theme === 'dark') {
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`;
  }

  private setupEventListeners(): void {
    const themeBtn = this.shadow.querySelector('.theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        toggleTheme();
        const currentTheme = getTheme();
        themeBtn.innerHTML = `${this.getThemeIcon(currentTheme)}<span>${currentTheme === 'dark' ? 'Light' : 'Dark'}</span>`;
      });
    }

    const loginBtn = this.shadow.querySelector<HTMLButtonElement>('.nav-auth-login');
    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        login(window.location.origin + '/dashboard.html');
      });
    }

    const logoutBtn = this.shadow.querySelector<HTMLButtonElement>('.nav-auth-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        logout(window.location.origin + '/index.html');
      });
    }
  }
}

customElements.define('travel-nav', TravelNav);
export default TravelNav;
