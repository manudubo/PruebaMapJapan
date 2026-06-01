const { spawnSync, spawn } = require('child_process');
const { platform } = require('os');
const path = require('path');

const KEYCLOAK_DIR = path.resolve(__dirname, '..', 'keycloak');
const KC_HEALTH_URL = 'http://localhost:8080/realms/japan-trip';
const DOCKER_TIMEOUT_MS = 60_000;
const KC_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 3_000;

function isDockerRunning() {
  const result = spawnSync('docker', ['info'], { stdio: 'pipe' });
  return result.status === 0;
}

function openDockerDesktop() {
  const os = platform();
  if (os === 'darwin') {
    spawn('open', ['-a', 'Docker Desktop'], { detached: true, stdio: 'ignore' }).unref();
  } else if (os === 'win32') {
    spawn('cmd', ['/c', 'start', '', 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'],
      { detached: true, stdio: 'ignore', shell: true }).unref();
  } else {
    console.warn('[dev] Linux: start Docker manually, then re-run.');
  }
}

async function waitForDocker(timeoutMs = DOCKER_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isDockerRunning()) return;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Docker did not start within ${timeoutMs / 1000}s`);
}

async function waitForKeycloak(url = KC_HEALTH_URL, timeoutMs = KC_TIMEOUT_MS, intervalMs = POLL_INTERVAL_MS) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write('[dev] Waiting for Keycloak');
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        process.stdout.write(' ready.\n');
        return;
      }
    } catch { /* not ready yet */ }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`\nKeycloak did not become healthy within ${timeoutMs / 1000}s`);
}

async function main() {
  // 1. Ensure Docker is running
  if (!isDockerRunning()) {
    console.log('[dev] Docker not running — opening Docker Desktop...');
    openDockerDesktop();
    await waitForDocker();
    console.log('[dev] Docker is running.');
  }

  // 2. Start Compose (detached)
  console.log('[dev] Starting Compose services...');
  const compose = spawnSync('docker', ['compose', 'up', '-d'], {
    cwd: KEYCLOAK_DIR,
    stdio: 'inherit',
  });
  if (compose.status !== 0) {
    throw new Error('docker compose up failed');
  }

  // 3. Wait for Keycloak health
  await waitForKeycloak();

  // 4. Hand off to concurrently
  const { concurrently } = require('concurrently');
  const { result } = concurrently(
    [
      {
        command: 'docker compose logs -f keycloak',
        name: 'keycloak',
        prefixColor: 'cyan',
        cwd: KEYCLOAK_DIR,
      },
      {
        command: 'npm run dev --workspace=backend',
        name: 'backend',
        prefixColor: 'yellow',
      },
      {
        command: 'npm run dev --workspace=frontend',
        name: 'frontend',
        prefixColor: 'green',
      },
    ],
    {
      prefix: 'name',
      killOthersOn: ['failure'],
    }
  );

  result.catch(() => process.exit(1));
}

main().catch(err => {
  console.error('[dev] Fatal:', err.message);
  process.exit(1);
});
