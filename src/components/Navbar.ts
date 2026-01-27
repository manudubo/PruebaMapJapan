import { toggleTheme, getTheme } from '@/modules/theme';

class TravelNav extends HTMLElement {
  private shadow: ShadowRoot;
  private themeBtn: HTMLButtonElement | null = null;

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
    
    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          --accent: #0071e3;
          --bg-primary: #fff;
          --bg-glass: rgba(255,255,255,0.85);
          --text-primary: #1d1d1f;
          --text-secondary: #6e6e73;
          --border-color: rgba(0,0,0,0.1);
        }
        
        :host-context([data-theme="dark"]) {
          --bg-primary: #1c1c1e;
          --bg-glass: rgba(28,28,30,0.9);
          --text-primary: #f5f5f7;
          --text-secondary: #a1a1a6;
          --border-color: rgba(255,255,255,0.1);
          --accent: #0a84ff;
        }
        
        nav {
          background: var(--bg-glass);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid var(--border-color);
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
          height: 56px;
          gap: 8px;
        }
        
        .nav-brand {
          font-weight: 600;
          font-size: 15px;
          color: var(--text-primary);
          text-decoration: none;
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
          padding-right: 8px;
        }
        
        .nav-brand:hover {
          color: var(--accent);
        }
        
        .nav-brand span {
          display: none;
        }
        
        @media (min-width: 768px) {
          .nav-brand span {
            display: inline;
          }
        }
        
        .nav-scroll {
          flex: 1;
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin;
          scrollbar-color: var(--text-secondary) transparent;
          margin: 0 4px;
        }
        
        /* Always visible scrollbar */
        .nav-scroll::-webkit-scrollbar {
          height: 4px;
          display: block;
        }
        
        .nav-scroll::-webkit-scrollbar-track {
          background: rgba(128, 128, 128, 0.1);
          border-radius: 2px;
        }
        
        .nav-scroll::-webkit-scrollbar-thumb {
          background: var(--text-secondary);
          border-radius: 2px;
          min-width: 30px;
        }
        
        .nav-scroll::-webkit-scrollbar-thumb:hover {
          background: var(--text-primary);
        }
        
        .top-nav {
          display: flex;
          gap: 2px;
          padding: 4px 0;
          min-width: max-content;
        }
        
        .nav-link {
          padding: 8px 12px;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary);
          text-decoration: none;
          white-space: nowrap;
          border-radius: 6px;
          transition: all 0.2s ease;
        }
        
        .nav-link:hover {
          color: var(--text-primary);
          background: var(--border-color);
        }
        
        .nav-link.is-active {
          color: var(--accent);
          background: rgba(0,113,227,0.1);
        }
        
        :host-context([data-theme="dark"]) .nav-link.is-active {
          background: rgba(10,132,255,0.15);
        }
        
        .theme-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-secondary);
          background: transparent;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
          flex-shrink: 0;
          font-family: inherit;
        }
        
        .theme-toggle:hover {
          color: var(--text-primary);
          border-color: var(--text-secondary);
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
            🇯🇵 <span>Japón 2026</span>
          </a>
          <div class="nav-scroll">
            <div class="top-nav" role="tablist" aria-label="Ciudades del itinerario">
              ${this.renderNavLinks(currentPage)}
            </div>
          </div>
          <button class="theme-toggle" type="button" aria-label="Cambiar tema" id="theme-btn">
            ${this.getThemeIcon(theme)}
            <span>${theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </nav>
    `;
    
    // Store reference to button after render
    this.themeBtn = this.shadow.querySelector('#theme-btn');
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
      { key: 'tokyo2', label: 'Tokyo 2', href: 'tokyo2.html' }  // Changed from Tokyo ② to Tokyo 2
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
      // Sun icon for switching to light
      return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="5"/>
        <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
      </svg>`;
    }
    // Moon icon for switching to dark
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
    </svg>`;
  }

  private updateThemeButton(): void {
    if (!this.themeBtn) return;
    
    const theme = getTheme();
    this.themeBtn.innerHTML = `
      ${this.getThemeIcon(theme)}
      <span>${theme === 'dark' ? 'Light' : 'Dark'}</span>
    `;
  }

  private setupEventListeners(): void {
    // Use event delegation and update only the button, not full re-render
    this.shadow.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const themeBtn = target.closest('.theme-toggle');
      
      if (themeBtn) {
        toggleTheme();
        this.updateThemeButton();
      }
    });
  }
}

customElements.define('travel-nav', TravelNav);
export default TravelNav;
