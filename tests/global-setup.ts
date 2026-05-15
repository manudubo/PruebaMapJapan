import { chromium, FullConfig } from '@playwright/test';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8787';
const MAX_RETRIES = 30;
const RETRY_INTERVAL_MS = 1000;

async function waitForServer(url: string, name: string): Promise<void> {
  console.log(`Waiting for ${name} at ${url}...`);
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok || response.status < 500) {
        console.log(`${name} is ready (status ${response.status})`);
        return;
      }
    } catch {
      // Server not yet responding
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
  }
  throw new Error(`${name} did not become ready at ${url} after ${MAX_RETRIES} attempts`);
}

async function globalSetup(_config: FullConfig): Promise<() => Promise<void>> {
  // Only wait for servers when they are actually being started by the test runner.
  // In CI the servers are started before npx playwright test runs.
  // Locally tests can mock everything via page.route() so servers are optional.
  const shouldWaitForFrontend = process.env.WAIT_FOR_FRONTEND === 'true';
  const shouldWaitForBackend = process.env.WAIT_FOR_BACKEND === 'true';

  if (shouldWaitForFrontend) {
    await waitForServer(FRONTEND_URL, 'Frontend dev server');
  }

  if (shouldWaitForBackend) {
    await waitForServer(`${BACKEND_URL}/api/health`, 'Backend dev server');
  }

  // Return teardown function
  return async () => {
    // Nothing to clean up — servers were started externally
    console.log('Global teardown complete');
  };
}

export default globalSetup;
