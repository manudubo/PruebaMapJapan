// Review M2/N2: deploy gating and supply-chain pins in the GitHub Actions
// workflows. Parses the real YAML (not regexes over text).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
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
