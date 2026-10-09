/** Shadow-DOM styles of <search-bar>. Colours come from the page's --jp-* tokens (light/dark). */
export const SEARCH_BAR_CSS = `
        /*
         * In-flow by default: a row between the navbar and the page, aligned to the
         * inline end (right in LTR, left in RTL). A fixed overlay covered page
         * content (headers, activity action buttons) on every viewport narrower than
         * the 1200px container plus its gutter.
         */
        :host {
          display: block;
          position: relative;
          z-index: 1000;
          font-family: var(--jp-font, 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif);
        }
        
        /* Box styles live here, not on :host: the page's universal reset overrides :host padding. */
        .search-strip {
          display: flex;
          justify-content: flex-end;
          padding: 4px 16px;
          /* Reads as a toolbar strip attached under the navbar */
          background: var(--jp-surface, #fff);
          border-bottom: 1px solid var(--jp-border, rgba(0,0,0,0.06));
        }
        
        .search-container {
          position: relative;
          /* 44px input + 2px border: the tap target itself stays >= 44x44 */
          width: 46px;
          max-width: 100%;
          transition: width 0.2s ease;
        }
        
        .search-container.expanded {
          width: min(100%, 420px);
        }
        
        /*
         * Wide screens only: float in the empty gutter beside the 1200px container.
         * 1320px leaves room for the 44px button, its offset and a scrollbar
         * without touching the page card (needs viewport >= ~1290px).
         */
        @media (min-width: 1320px) {
          :host {
            position: fixed;
            top: 68px;
            inset-inline-end: max(16px, env(safe-area-inset-right, 0px));
          }
        
          .search-strip {
            padding: 0;
            background: none;
            border: 0;
          }
        
          .search-container.expanded {
            width: 320px;
          }
        }
        
        .search-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          background: var(--jp-surface, #fff);
          border: 1px solid var(--jp-border-strong, #d1d1d6);
          overflow: hidden;
          transition: all 0.2s ease;
        }
        
        .search-container.expanded .search-input-wrapper {
          box-shadow: none;
        }
        
        .search-icon {
          position: absolute;
          inset-inline-start: 12px;
          width: 18px;
          height: 18px;
          color: var(--jp-text-tertiary, #86868b);
          pointer-events: none;
          flex-shrink: 0;
        }
        
        .search-input {
          width: 100%;
          height: 44px;
          padding-block: 0;
          padding-inline: 42px 12px;
          border: none;
          background: transparent;
          font-size: 16px;
          color: var(--jp-text, #1d1d1f);
          outline: none;
        }
        
        .search-input::placeholder {
          color: var(--jp-text-tertiary, #86868b);
        }
        
        .search-container:not(.expanded) .search-input {
          cursor: pointer;
        }
        
        .clear-btn {
          position: absolute;
          inset-inline-end: 8px;
          width: 28px;
          height: 28px;
          padding: 0;
          border: none;
          background: var(--jp-surface-subtle, #f5f5f7);
          cursor: pointer;
          display: none;
          align-items: center;
          justify-content: center;
          color: var(--jp-text-tertiary, #86868b);
          transition: all 0.15s ease;
        }
        
        .clear-btn:hover {
          background: var(--jp-border, #d1d1d6);
          color: var(--jp-text, #1d1d1f);
        }
        
        .search-container.has-value .clear-btn {
          display: flex;
        }

        /* Touch: the 28px clear button becomes a full 44px target flush with the field's edge. */
        @media (pointer: coarse) {
          .clear-btn {
            inset-inline-end: 0;
            width: 44px;
            height: 44px;
            background: transparent;
          }
          .search-container.has-value .search-input {
            padding-inline-end: 44px;
          }
        }
        
        .clear-btn svg {
          width: 14px;
          height: 14px;
        }
        
        /* Dropdown */
        .search-dropdown {
          position: absolute;
          top: calc(100% + 4px);
          inset-inline: 0;
          background: var(--jp-surface, #fff);
          border: 1px solid var(--jp-border-strong, #d1d1d6);
          box-shadow: none;
          max-height: min(400px, 70vh);
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
          background: var(--jp-border-strong, #d1d1d6);
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
          border-bottom: 1px solid var(--jp-border, rgba(0,0,0,0.06));
        }
        
        .search-result:last-child {
          border-bottom: none;
        }
        
        .search-result:hover,
        .search-result.selected {
          background: var(--jp-surface-subtle, #f5f5f7);
        }
        
        .search-result:focus {
          outline: 2px solid var(--jp-accent, #0071e3);
          outline-offset: -2px;
        }
        
        .result-icon {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--jp-surface-subtle, #f5f5f7);
          flex-shrink: 0;
          color: var(--jp-text-tertiary, #86868b);
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
          color: var(--jp-text, #1d1d1f);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .result-subtitle {
          font-size: 12px;
          color: var(--jp-text-tertiary, #86868b);
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
          background: var(--jp-surface-subtle, #f5f5f7);
          color: var(--jp-text-tertiary, #86868b);
          flex-shrink: 0;
        }
        
        /* Empty state */
        .search-empty {
          padding: 24px 16px;
          text-align: center;
          color: var(--jp-text-tertiary, #86868b);
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
          color: var(--jp-text-tertiary, #86868b);
          background: var(--jp-surface-subtle, #f5f5f7);
          border-bottom: 1px solid var(--jp-border, rgba(0,0,0,0.06));
        }
        
        /* Keyboard hint */
        .keyboard-hint {
          padding: 8px 16px;
          font-size: 11px;
          color: var(--jp-text-tertiary, #86868b);
          background: var(--jp-surface-subtle, #f5f5f7);
          border-top: 1px solid var(--jp-border, rgba(0,0,0,0.06));
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px 16px;
        }

        .keyboard-hint span {
          display: inline-flex;
          align-items: center;
          white-space: nowrap;
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
          background: var(--jp-surface, #fff);
          border: 1px solid var(--jp-border, rgba(0,0,0,0.06));
          margin-right: 4px;
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

        /* Scope bar: what is being searched, plus an optional action (sign in / retry) */
        .scope-bar {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 16px;
          font-size: 12px;
          color: var(--jp-text-secondary, #515154);
          border-bottom: 1px solid var(--jp-border, rgba(0,0,0,0.06));
        }

        .scope-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 2px 8px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.3px;
          color: var(--jp-accent-text, #0066cc);
          background: var(--jp-accent-subtle, rgba(0,113,227,0.1));
          border: 1px solid var(--jp-accent-border, transparent);
        }

        .scope-note {
          flex: 1 1 140px;
          min-width: 0;
        }

        .link-btn {
          padding: 4px 8px;
          min-height: 28px;
          font: inherit;
          font-weight: 600;
          color: var(--jp-accent-text, #0066cc);
          background: transparent;
          border: 1px solid var(--jp-border-strong, #d1d1d6);
          cursor: pointer;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
        }

        .link-btn:hover {
          background: var(--jp-surface-subtle, #f5f5f7);
        }

        .link-btn:focus-visible {
          outline: 2px solid var(--jp-accent, #0071e3);
          outline-offset: 1px;
        }

        /* Loading / error / empty-account rows */
        .search-status {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 24px 16px;
          text-align: center;
          font-size: 13px;
          color: var(--jp-text-secondary, #515154);
        }

        .search-status.error {
          color: var(--jp-danger, #c4251c);
        }

        .search-status .status-title {
          font-weight: 600;
          color: var(--jp-text, #1d1d1f);
        }

        .spinner {
          width: 20px;
          height: 20px;
          border: 2px solid var(--jp-border-strong, #d1d1d6);
          border-top-color: var(--jp-accent, #0071e3);
          border-radius: 50%;
          animation: search-spin 0.8s linear infinite;
        }

        @keyframes search-spin {
          to { transform: rotate(360deg); }
        }

        @media (prefers-reduced-motion: reduce) {
          .spinner { animation: none; }
          .search-container, .search-input-wrapper { transition: none; }
        }

        .result-context {
          font-size: 11px;
          color: var(--jp-text-tertiary, #86868b);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-top: 1px;
        }

        .search-note {
          padding: 8px 16px;
          font-size: 12px;
          color: var(--jp-text-secondary, #515154);
          background: var(--jp-surface-subtle, #f5f5f7);
          border-top: 1px solid var(--jp-border, rgba(0,0,0,0.06));
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
`;
