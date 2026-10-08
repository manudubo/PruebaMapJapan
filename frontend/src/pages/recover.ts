import '@/styles/main.css';
import '@/components/Navbar';
import '@/components/SearchBar';

import { initTheme } from '@/modules/theme';
import { installGlobalErrorHandler } from '@/modules/toast';
import { mountRecover, takeEmailPrefill } from '@/pages/recoverView';

function init(): void {
  initTheme();
  installGlobalErrorHandler();
  const root = document.getElementById('recover-root');
  if (!root) return;
  mountRecover(root, { prefillEmail: takeEmailPrefill() });
  document.body.classList.add('ready');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
