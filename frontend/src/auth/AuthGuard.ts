import { initKeycloak, isAuthenticated, login } from './keycloak';

// ---------------------------------------------------------------------------
// AuthGuard Web Component
//
// Wraps any content that requires authentication. While checking auth status
// the component shows a loading spinner. If the user is not authenticated they
// are redirected to Keycloak login. Once authenticated the slotted content is
// shown.
//
// Usage in HTML:
//   <auth-guard>
//     <div>Protected content here</div>
//   </auth-guard>
//
// The component renders its slot only after authentication is confirmed.
// ---------------------------------------------------------------------------

const LOADING_TEMPLATE = `
  <style>
    .auth-guard-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      flex-direction: column;
      gap: 12px;
      font-family: system-ui, sans-serif;
      color: #666;
    }
    .auth-guard-spinner {
      width: 36px;
      height: 36px;
      border: 3px solid #e0e0e0;
      border-top-color: #e63946;
      border-radius: 50%;
      animation: auth-guard-spin 0.7s linear infinite;
    }
    @keyframes auth-guard-spin {
      to { transform: rotate(360deg); }
    }
  </style>
  <div class="auth-guard-loading">
    <div class="auth-guard-spinner"></div>
    <span>Checking authentication&hellip;</span>
  </div>
`;

export class AuthGuard extends HTMLElement {
  private _shadow: ShadowRoot;
  constructor() {
    super();
    this._shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    // Show loading state immediately
    this._shadow.innerHTML = LOADING_TEMPLATE;
    // Run auth check asynchronously
    this._checkAuth().catch((err) => {
      console.error('AuthGuard: unexpected error during auth check', err);
      this._showError('An unexpected error occurred. Please reload the page.');
    });
  }

  private async _checkAuth(): Promise<void> {
    try {
      await initKeycloak();
    } catch (err) {
      console.error('AuthGuard: failed to initialise Keycloak', err);
      this._showError('Could not connect to the authentication server. Please try again later.');
      return;
    }

    if (isAuthenticated()) {
      this._showContent();
    } else {
      // Redirect to Keycloak login; current URL will be used as post-login redirect
      await login(window.location.href);
    }
  }

  private _showContent(): void {
    // Clear loading state and render slotted content
    this._shadow.innerHTML = `
      <style>
        :host { display: contents; }
      </style>
      <slot></slot>
    `;
  }

  private _showError(message: string): void {
    this._shadow.innerHTML = `
      <style>
        .auth-guard-error {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 200px;
          flex-direction: column;
          gap: 12px;
          font-family: system-ui, sans-serif;
          color: #c62828;
          padding: 24px;
          text-align: center;
        }
        .auth-guard-error-icon {
          font-size: 2rem;
        }
        .auth-guard-retry-btn {
          margin-top: 8px;
          padding: 8px 20px;
          background: #e63946;
          color: white;
          border: none;
          border-radius: 0;
          cursor: pointer;
          font-size: 0.9rem;
        }
        .auth-guard-retry-btn:hover {
          background: #c62828;
        }
      </style>
      <div class="auth-guard-error">
        <div class="auth-guard-error-icon">&#9888;</div>
        <div>${message}</div>
        <button class="auth-guard-retry-btn" id="retry-btn">Retry</button>
      </div>
    `;

    const retryBtn = this._shadow.getElementById('retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        this._shadow.innerHTML = LOADING_TEMPLATE;
        this._checkAuth().catch(console.error);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Register the custom element
// ---------------------------------------------------------------------------

if (!customElements.get('auth-guard')) {
  customElements.define('auth-guard', AuthGuard);
}
