import { toggleTheme, getTheme } from '@/modules/theme';

class TravelNav extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.setupEventListeners();
  }

  private render(): void {
    const currentPage = this.getCurrentPage();
    const theme = getTheme();
    
    // Usamos CSS custom properties del documento que SÍ se heredan al Shadow DOM
    // en lugar de :host-context() que no funciona en Safari/iOS
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
          <div class="top-nav" role="tablist" aria-label="Ciudades del itinerario">${this.renderNavLinks(currentPage)}</div>
          <button class="theme-toggle" type="button" aria-label="Cambiar tema">${this.getThemeIcon(theme)}<span>${theme === 'dark' ? 'Light' : 'Dark'}</span></button>
        </div>
      </nav>`;
  }

  private renderNavLinks(currentPage: string): string {
    const cities = [
      { key: 'tokyo', label: 'Tokyo', href: 'tokyo.html' },
      { key: 'nagoya', label: 'Nagoya', href: 'nagoya.html' },
      { key: 'takayama', label: 'Takayama', href: 'takayama.html' },
      { key: 'kyoto', label: 'Kyoto', href: 'kyoto.html' },
      { key: 'osaka', label: 'Osaka', href: 'osaka.html' },
      { key: 'naoshima', label: 'Naoshima', href: 'naoshima.html' },
      { key: 'hakone', label: 'Hakone', href: 'hakone.html' },
      { key: 'tokyo2', label: 'Tokyo 2', href: 'tokyo2.html' }
    ];
    return cities.map(city => {
      const isActive = currentPage === city.key;
      return `<a href="${city.href}" class="nav-link${isActive ? ' is-active' : ''}" ${isActive ? 'aria-current="page"' : ''} role="tab" aria-selected="${isActive}">${city.label}</a>`;
    }).join('');
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
    if (!themeBtn) return;
    
    themeBtn.addEventListener('click', () => {
      toggleTheme();
      const currentTheme = getTheme();
      themeBtn.innerHTML = `${this.getThemeIcon(currentTheme)}<span>${currentTheme === 'dark' ? 'Light' : 'Dark'}</span>`;
    });
  }
}

customElements.define('travel-nav', TravelNav);
export default TravelNav;
