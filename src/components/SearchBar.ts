import { search, buildSearchIndex, getTypeIcon, getSuggestions } from '@/modules/search';
import type { SearchResult } from '@/modules/search';
import { debounce } from '@/modules/utils';

/**
 * Global Search Bar Component
 * Fixed position, always visible search with dropdown results
 * 
 * Usa CSS custom properties del documento principal que se heredan al Shadow DOM,
 * en lugar de :host-context() que no funciona en Safari/iOS
 */
class SearchBar extends HTMLElement {
  private shadow: ShadowRoot;
  private input: HTMLInputElement | null = null;
  private dropdown: HTMLElement | null = null;
  private isOpen = false;
  private selectedIndex = -1;
  private results: SearchResult[] = [];

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    buildSearchIndex();
    this.render();
    this.setupEventListeners();
  }

  private render(): void {
    this.shadow.innerHTML = `
      <style>
        :host {
          position: fixed;
          top: 68px;
          right: 16px;
          z-index: 1000;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif;
        }
        
        .search-container {
          position: relative;
          width: 44px;
          transition: width 0.2s ease;
        }
        
        .search-container.expanded {
          width: 320px;
        }
        
        @media (max-width: 480px) {
          .search-container.expanded {
            width: calc(100vw - 32px);
            position: fixed;
            right: 16px;
          }
        }
        
        .search-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          background: var(--bg-secondary, #fff);
          border: 1px solid var(--border-strong, #d1d1d6);
          overflow: hidden;
          transition: all 0.2s ease;
        }
        
        .search-container.expanded .search-input-wrapper {
          box-shadow: var(--shadow-lg, 0 4px 24px rgba(0,0,0,0.12));
        }
        
        .search-icon {
          position: absolute;
          left: 12px;
          width: 18px;
          height: 18px;
          color: var(--text-tertiary, #86868b);
          pointer-events: none;
          flex-shrink: 0;
        }
        
        .search-input {
          width: 100%;
          height: 44px;
          padding: 0 12px 0 42px;
          border: none;
          background: transparent;
          font-size: 14px;
          color: var(--text-primary, #1d1d1f);
          outline: none;
        }
        
        .search-input::placeholder {
          color: var(--text-tertiary, #86868b);
        }
        
        .search-container:not(.expanded) .search-input {
          cursor: pointer;
        }
        
        .clear-btn {
          position: absolute;
          right: 8px;
          width: 28px;
          height: 28px;
          padding: 0;
          border: none;
          background: var(--bg-glass-subtle, #f5f5f7);
          cursor: pointer;
          display: none;
          align-items: center;
          justify-content: center;
          color: var(--text-tertiary, #86868b);
          transition: all 0.15s ease;
        }
        
        .clear-btn:hover {
          background: var(--border-color, #d1d1d6);
          color: var(--text-primary, #1d1d1f);
        }
        
        .search-container.has-value .clear-btn {
          display: flex;
        }
        
        .clear-btn svg {
          width: 14px;
          height: 14px;
        }
        
        /* Dropdown */
        .search-dropdown {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          background: var(--bg-secondary, #fff);
          border: 1px solid var(--border-strong, #d1d1d6);
          box-shadow: var(--shadow-lg, 0 4px 24px rgba(0,0,0,0.12));
          max-height: 400px;
          overflow-y: auto;
          display: none;
          scrollbar-width: thin;
        }
        
        .search-dropdown.open {
          display: block;
        }
        
        .search-dropdown::-webkit-scrollbar {
          width: 6px;
        }
        
        .search-dropdown::-webkit-scrollbar-thumb {
          background: var(--border-strong, #d1d1d6);
        }
        
        /* Results */
        .search-results {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        
        .search-result {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          cursor: pointer;
          transition: background 0.1s ease;
          text-decoration: none;
          color: inherit;
          border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.06));
        }
        
        .search-result:last-child {
          border-bottom: none;
        }
        
        .search-result:hover,
        .search-result.selected {
          background: var(--bg-glass-subtle, #f5f5f7);
        }
        
        .search-result:focus {
          outline: 2px solid var(--accent, #0071e3);
          outline-offset: -2px;
        }
        
        .result-icon {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-glass-subtle, #f5f5f7);
          flex-shrink: 0;
          color: var(--text-tertiary, #86868b);
        }
        
        .result-icon svg {
          width: 16px;
          height: 16px;
        }
        
        .result-icon.has-color {
          color: white;
        }
        
        .result-content {
          flex: 1;
          min-width: 0;
        }
        
        .result-title {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary, #1d1d1f);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .result-subtitle {
          font-size: 12px;
          color: var(--text-tertiary, #86868b);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-top: 2px;
        }
        
        .result-badge {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 2px 6px;
          background: var(--bg-glass-subtle, #f5f5f7);
          color: var(--text-tertiary, #86868b);
          flex-shrink: 0;
        }
        
        /* Empty state */
        .search-empty {
          padding: 24px 16px;
          text-align: center;
          color: var(--text-tertiary, #86868b);
          font-size: 13px;
        }
        
        .search-empty svg {
          width: 32px;
          height: 32px;
          margin-bottom: 8px;
          opacity: 0.5;
        }
        
        /* Section headers */
        .section-header {
          padding: 8px 16px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-tertiary, #86868b);
          background: var(--bg-glass-subtle, #f5f5f7);
          border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.06));
        }
        
        /* Keyboard hint */
        .keyboard-hint {
          padding: 8px 16px;
          font-size: 11px;
          color: var(--text-tertiary, #86868b);
          background: var(--bg-glass-subtle, #f5f5f7);
          border-top: 1px solid var(--border-color, rgba(0,0,0,0.06));
          display: flex;
          gap: 16px;
        }
        
        .keyboard-hint kbd {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 20px;
          height: 18px;
          padding: 0 4px;
          font-family: inherit;
          font-size: 10px;
          background: var(--bg-secondary, #fff);
          border: 1px solid var(--border-color, rgba(0,0,0,0.06));
          border-radius: 2px;
          margin-right: 4px;
        }
        
        /* Responsive */
        @media (max-width: 768px) {
          :host {
            top: 64px;
            right: 12px;
          }
        }
        
        /* Screen reader only */
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          border: 0;
        }
      </style>
      
      <div class="search-container" role="search">
        <div class="search-input-wrapper">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <input 
            type="text" 
            class="search-input" 
            placeholder="Buscar..."
            aria-label="Buscar actividades, lugares, días"
            aria-expanded="false"
            aria-controls="search-dropdown"
            aria-autocomplete="list"
            autocomplete="off"
          >
          <button class="clear-btn" type="button" aria-label="Limpiar búsqueda">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        
        <div class="search-dropdown" id="search-dropdown" role="listbox" aria-label="Resultados de búsqueda">
          <ul class="search-results"></ul>
        </div>
      </div>
    `;
  }

  private setupEventListeners(): void {
    this.input = this.shadow.querySelector('.search-input');
    this.dropdown = this.shadow.querySelector('.search-dropdown');
    const container = this.shadow.querySelector('.search-container');
    const clearBtn = this.shadow.querySelector('.clear-btn');
    
    if (!this.input || !this.dropdown || !container) return;
    
    // Debounced search
    const debouncedSearch = debounce((query: unknown) => {
      this.performSearch(query as string);
    }, 150);
    
    // Focus to expand
    this.input.addEventListener('focus', () => {
      container.classList.add('expanded');
      if (this.input!.value) {
        this.openDropdown();
      } else {
        this.showSuggestions();
      }
    });
    
    // Input changes
    this.input.addEventListener('input', (e) => {
      const query = (e.target as HTMLInputElement).value;
      container.classList.toggle('has-value', query.length > 0);
      
      if (query.length > 0) {
        debouncedSearch(query);
      } else {
        this.showSuggestions();
      }
    });
    
    // Keyboard navigation
    this.input.addEventListener('keydown', (e) => this.handleKeydown(e));
    
    // Clear button
    clearBtn?.addEventListener('click', () => {
      if (this.input) {
        this.input.value = '';
        this.input.focus();
        container.classList.remove('has-value');
        this.showSuggestions();
      }
    });
    
    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!this.contains(e.target as Node)) {
        this.closeDropdown();
        container.classList.remove('expanded');
      }
    });
    
    // Keyboard shortcut (Cmd/Ctrl + K)
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        this.input?.focus();
      }
      
      if (e.key === 'Escape' && this.isOpen) {
        this.closeDropdown();
        this.input?.blur();
      }
    });
  }

  private performSearch(query: string): void {
    this.results = search(query);
    this.selectedIndex = -1;
    this.renderResults();
    this.openDropdown();
  }

  private showSuggestions(): void {
    this.results = getSuggestions();
    this.selectedIndex = -1;
    this.renderResults(true);
    this.openDropdown();
  }

  private renderResults(isSuggestions = false): void {
    const list = this.shadow.querySelector('.search-results');
    if (!list) return;
    
    if (this.results.length === 0) {
      list.innerHTML = `
        <li class="search-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <div>No se encontraron resultados</div>
        </li>
      `;
      return;
    }
    
    let html = '';
    
    if (isSuggestions) {
      html += '<li class="section-header">Ciudades</li>';
    }
    
    html += this.results.map((result, index) => {
      const iconHtml = getTypeIcon(result.type);
      const iconStyle = result.color ? `background:${result.color}` : '';
      const iconClass = result.color ? 'result-icon has-color' : 'result-icon';
      
      return `
        <li>
          <a href="#" 
             class="search-result${index === this.selectedIndex ? ' selected' : ''}"
             role="option"
             aria-selected="${index === this.selectedIndex}"
             data-index="${index}">
            <div class="${iconClass}" style="${iconStyle}">${iconHtml}</div>
            <div class="result-content">
              <div class="result-title">${this.highlightMatch(result.title)}</div>
              <div class="result-subtitle">${result.subtitle}</div>
            </div>
            <span class="result-badge">${result.type === 'activity' ? 'lugar' : result.type === 'day' ? 'día' : result.type}</span>
          </a>
        </li>
      `;
    }).join('');
    
    if (!isSuggestions) {
      html += `
        <li class="keyboard-hint">
          <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
          <span><kbd>↵</kbd> seleccionar</span>
          <span><kbd>esc</kbd> cerrar</span>
        </li>
      `;
    }
    
    list.innerHTML = html;
    
    // Add click handlers to results
    list.querySelectorAll('.search-result').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const index = parseInt((item as HTMLElement).dataset.index || '0');
        this.handleResultClick(this.results[index]);
        this.closeDropdown();
      });
    });
  }

  private handleResultClick(result: SearchResult): void {
    // Build URL with parameters for map focus and day selection
    let url = result.url;
    
    // For activities, add parameters to focus on the map and select the day
    if (result.type === 'activity' && result.date) {
      const params = new URLSearchParams({
        day: result.date,
        activity: result.title
      });
      url = `${result.url}?${params.toString()}`;
    }
    
    window.location.href = url;
  }

  private highlightMatch(text: string): string {
    if (!this.input?.value) return text;
    
    const query = this.input.value.toLowerCase();
    const index = text.toLowerCase().indexOf(query);
    
    if (index === -1) return text;
    
    return text.substring(0, index) +
           '<mark style="background:var(--accent);color:white;padding:0 2px;">' +
           text.substring(index, index + query.length) +
           '</mark>' +
           text.substring(index + query.length);
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
          this.handleResultClick(this.results[this.selectedIndex]);
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
    this.input.setAttribute('aria-expanded', 'true');
  }

  private closeDropdown(): void {
    if (!this.dropdown || !this.input) return;
    this.isOpen = false;
    this.dropdown.classList.remove('open');
    this.input.setAttribute('aria-expanded', 'false');
    this.selectedIndex = -1;
  }
}

customElements.define('search-bar', SearchBar);

export default SearchBar;
