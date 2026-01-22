// Components Module - Web Component for Navbar
import { toggleTheme, updateThemeButton } from '../modules/theme.js';

class TravelNavbar extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.render();
    this.addEventListeners();
    // Ensure the icon reflects the current theme immediately after render
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    updateThemeButton(currentTheme);
  }

  render() {
    // Get current filename from URL (e.g., 'tokyo.html') or default to 'index.html'
    const path = window.location.pathname;
    const currentPage = path.split('/').pop() || 'index.html';

    const links = [
      { href: 'index.html', text: 'General' },
      { href: 'tokyo.html', text: 'Tokyo' },
      { href: 'nagoya.html', text: 'Nagoya' },
      { href: 'takayama.html', text: 'Takayama' },
      { href: 'kyoto.html', text: 'Kyoto' },
      { href: 'osaka.html', text: 'Osaka' },
      { href: 'naoshima.html', text: 'Naoshima' },
      { href: 'hakone.html', text: 'Hakone' },
      { href: 'tokyo2.html', text: 'Tokyo 2' }
    ];

    const navItems = links.map(link => {
      const isActive = currentPage === link.href ? 'class="is-active"' : '';
      return `<a href="${link.href}" ${isActive}>${link.text}</a>`;
    }).join('');

    this.innerHTML = `
      <nav class="top-nav">
        ${navItems}
        <button class="theme-toggle" type="button" aria-label="Toggle Theme">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
          <span>Dark</span>
        </button>
      </nav>
    `;
  }

  addEventListeners() {
    const btn = this.querySelector('.theme-toggle');
    if (btn) {
      btn.addEventListener('click', () => {
        toggleTheme();
        // Dispatch event so main.js can update the map tiles
        window.dispatchEvent(new Event('theme-changed'));
      });
    }
  }
}

// Define the custom element
customElements.define('travel-nav', TravelNavbar);