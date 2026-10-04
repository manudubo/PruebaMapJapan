// Review M1/M2/N2: deploy gating and supply-chain pins in the GitHub Actions
// workflows. Parses the real YAML (not regexes over text) and, for the
// deploy-backend configuration gate, executes the step's shell script with
// every secret combination.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { parse } from 'yaml';

const WF_DIR = resolve(__dirname, '../../.github/workflows');

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  if?: string;
  env?: Record<string, string>;
  steps: Step[];
  permissions?: unknown;
}
interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

function load(name: string): Workflow {
  return parse(readFileSync(join(WF_DIR, name), 'utf8')) as Workflow;
}

const ALL = readdirSync(WF_DIR).filter((f) => f.endsWith('.yml'));
const DEPLOYS = ['deploy-frontend.yml', 'deploy-backend.yml'];

/** Split a `&&`-only condition into normalised clauses; fail on `||` or `!`. */
function andClauses(cond: string | undefined): string[] {
  expect(cond, 'job must have an if: condition').toBeTruthy();
  const c = cond!.replace(/^\$\{\{|\}\}$/g, '').replace(/\s+/g, ' ').trim();
  expect(c).not.toMatch(/\|\||!(?!=)/);
  return c.split('&&').map((s) => s.trim());
}

describe('workflow inventory', () => {
  it('finds the four workflows', () => {
    expect(ALL.sort()).toEqual(['ci.yml', 'deploy-backend.yml', 'deploy-frontend.yml', 'security.yml']);
  });
});

describe.each(DEPLOYS)('%s: only same-repo pushes to main deploy (M2)', (file) => {
  const wf = load(file);

  it('is triggered by a completed CI run on main', () => {
    expect(wf.on).toEqual({ workflow_run: { workflows: ['CI'], branches: ['main'], types: ['completed'] } });
  });

  it.each(Object.keys(wf.jobs))('job %s requires success, push event, main branch and the same repository', (job) => {
    const clauses = andClauses(wf.jobs[job]!.if);
    expect(clauses).toEqual(
      expect.arrayContaining([
        "github.event.workflow_run.conclusion == 'success'",
        "github.event.workflow_run.event == 'push'",
        "github.event.workflow_run.head_branch == 'main'",
        'github.event.workflow_run.head_repository.full_name == github.repository',
      ]),
    );
  });

  it('checks out exactly the CI-tested commit without persisting the token', () => {
    const checkout = Object.values(wf.jobs).flatMap((j) => j.steps).find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['ref']).toBe('${{ github.event.workflow_run.head_sha }}');
    expect(checkout?.with?.['persist-credentials']).toBe(false);
  });
});

describe('deploy-frontend: demo-only CSP opt-out (N6)', () => {
  it('sets CSP_ALLOW_MISSING_ORIGINS only when both origin secrets are empty', () => {
    const build = load('deploy-frontend.yml').jobs['build-and-deploy']!.steps.find(
      (s) => s.run === 'npm run build --workspace=frontend',
    )!;
    expect(build.env?.['CSP_ALLOW_MISSING_ORIGINS']).toBe(
      "${{ secrets.VITE_API_URL == '' && secrets.VITE_KEYCLOAK_URL == '' }}",
    );
  });

  it.each(['ci.yml', 'security.yml'])('%s builds with both origins set and no opt-out', (file) => {
    const steps = Object.values(load(file).jobs).flatMap((j) => j.steps);
    const builds = steps.filter((s) => /npm run build(:frontend| --workspace=frontend)/.test(s.run ?? ''));
    expect(builds.length).toBeGreaterThan(0);
    for (const b of builds) {
      expect(b.env?.['VITE_API_URL']).toMatch(/^https?:\/\//);
      expect(b.env?.['VITE_KEYCLOAK_URL']).toMatch(/^https?:\/\//);
      expect(b.env?.['CSP_ALLOW_MISSING_ORIGINS']).toBeUndefined();
    }
  });
});

describe('least-privilege permissions (N2)', () => {
  it.each(ALL)('%s declares top-level permissions', (file) => {
    expect(load(file).permissions).toBeDefined();
  });

  it.each(['ci.yml', 'security.yml', 'deploy-backend.yml'])('%s only reads contents', (file) => {
    expect(load(file).permissions).toEqual({ contents: 'read' });
  });

  it('deploy-frontend has only what Pages needs', () => {
    expect(load('deploy-frontend.yml').permissions).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' });
  });
});

describe('pinned actions and tools (N2)', () => {
  const uses = ALL.flatMap((file) =>
    Object.values(load(file).jobs).flatMap((j) => j.steps.filter((s) => s.uses).map((s) => [file, s.uses!] as const)),
  );

  it('finds action references', () => {
    expect(uses.length).toBeGreaterThan(10);
  });

  it.each(uses)('%s: %s is pinned to a full commit SHA', (_file, ref) => {
    expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  const security = load('security.yml');
  const runs = Object.values(security.jobs).flatMap((j) => j.steps);

  it('gitleaks download is verified with sha256sum before extraction', () => {
    const step = runs.find((s) => s.name === 'Install gitleaks')!;
    expect(step.env?.['GITLEAKS_SHA256']).toMatch(/^[0-9a-f]{64}$/);
    const lines = step.run!.trim().split('\n');
    const verify = lines.findIndex((l) => l.includes('sha256sum -c'));
    const extract = lines.findIndex((l) => l.includes('tar x'));
    expect(verify).toBeGreaterThanOrEqual(0);
    expect(extract).toBeGreaterThan(verify);
    expect(step.run).not.toMatch(/\|\s*tar/);
  });

  it('npm/npx tools carry exact versions', () => {
    const all = runs.map((s) => s.run ?? '').join('\n');
    expect(all).toMatch(/axe-core@\d+\.\d+\.\d+\b/);
    expect(all).toMatch(/wait-on@\d+\.\d+\.\d+\b/);
    for (const m of all.matchAll(/npx --yes (\S+)/g)) expect(m[1]).toMatch(/@\d+\.\d+\.\d+$/);
  });
});

describe('deploy-backend: migrate before deploy, gated on configuration (M1)', () => {
  const wf = load('deploy-backend.yml');
  const job = wf.jobs['deploy']!;
  const steps = job.steps;
  const idx = (pred: (s: Step) => boolean) => steps.findIndex(pred);

  const configIdx = idx((s) => s.id === 'config');
  const preflightIdx = idx((s) => (s.run ?? '').includes('db:preflight'));
  const migrateIdx = idx((s) => (s.run ?? '').includes('db:migrate'));
  const deployIdx = idx((s) => /npm run deploy|wrangler deploy/.test(s.run ?? ''));

  it('runs config check -> preflight -> db:migrate -> deploy, in that order', () => {
    expect(configIdx).toBe(0);
    expect(preflightIdx).toBeGreaterThan(configIdx);
    expect(migrateIdx).toBeGreaterThan(preflightIdx);
    expect(deployIdx).toBeGreaterThan(migrateIdx);
  });

  it('uses the repo scripts, not drizzle-kit push', () => {
    expect(steps[migrateIdx]!.run).toBe('npm run db:migrate --workspace=backend');
    expect(steps[preflightIdx]!.run).toBe('npm run db:preflight --workspace=backend');
    expect(JSON.stringify(wf)).not.toMatch(/drizzle-kit push|db:push/);
  });

  it('preflight and migrate read DATABASE_URL from the MIGRATION_DATABASE_URL secret', () => {
    for (const i of [preflightIdx, migrateIdx]) {
      expect(steps[i]!.env).toEqual({ DATABASE_URL: '${{ secrets.MIGRATION_DATABASE_URL }}' });
    }
  });

  it('every step after the config check only runs when deploy is configured', () => {
    for (const s of steps.slice(configIdx + 1)) {
      expect(s.if, s.name ?? s.uses).toBe("steps.config.outputs.deploy == 'true'");
    }
  });

  it('nothing uses continue-on-error (a failed migration must stop the deploy)', () => {
    expect(JSON.stringify(job)).not.toContain('continue-on-error');
  });

  it('job env exposes only booleans about the secrets, never their values', () => {
    expect(job.env).toEqual({
      HAS_CLOUDFLARE_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN != '' }}",
      HAS_MIGRATION_DATABASE_URL: "${{ secrets.MIGRATION_DATABASE_URL != '' }}",
    });
  });

  describe('config gate script', () => {
    const script = steps[configIdx]!.run!;

    function runGate(env: Record<string, string>) {
      const dir = mkdtempSync(join(tmpdir(), 'gate-'));
      const out = join(dir, 'out');
      try {
        const r = spawnSync('bash', ['-e', '-c', script], {
          env: { PATH: process.env['PATH'] ?? '', GITHUB_OUTPUT: out, ...env },
          encoding: 'utf8',
        });
        let output = '';
        try {
          output = readFileSync(out, 'utf8');
        } catch {
          /* no output written */
        }
        return { code: r.status, stdout: r.stdout, output };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it('no Cloudflare token (demo only): exits 0 with a notice and deploy=false', () => {
      for (const mig of ['true', 'false']) {
        const r = runGate({ HAS_CLOUDFLARE_TOKEN: 'false', HAS_MIGRATION_DATABASE_URL: mig });
        expect(r.code).toBe(0);
        expect(r.output.trim()).toBe('deploy=false');
        expect(r.stdout).toMatch(/^::notice /m);
      }
    });

    it('Cloudflare token but no migration secret: FAILS with an error annotation', () => {
      const r = runGate({ HAS_CLOUDFLARE_TOKEN: 'true', HAS_MIGRATION_DATABASE_URL: 'false' });
      expect(r.code).toBe(1);
      expect(r.output).not.toContain('deploy=true');
      expect(r.stdout).toMatch(/^::error .*MIGRATION_DATABASE_URL/m);
    });

    it('both configured: deploy=true', () => {
      const r = runGate({ HAS_CLOUDFLARE_TOKEN: 'true', HAS_MIGRATION_DATABASE_URL: 'true' });
      expect(r.code).toBe(0);
      expect(r.output.trim()).toBe('deploy=true');
    });

    it('unset variables behave like missing secrets (fail closed when deploy is configured)', () => {
      expect(runGate({}).output.trim()).toBe('deploy=false');
      expect(runGate({ HAS_CLOUDFLARE_TOKEN: 'true' }).code).toBe(1);
    });
  });
});
