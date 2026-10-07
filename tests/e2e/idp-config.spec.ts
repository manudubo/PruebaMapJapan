import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static checks on the Keycloak Terraform + theme sources (Phase 26: KC-01, SEC-11,
 * SEC-13, SEC-19, SEC-25). No browser or Keycloak needed — these guard the config
 * that idp-flow.spec.ts exercises live, so a regression shows up even in CI runs
 * where Keycloak is not available.
 */

const ROOT = path.resolve(__dirname, '../..');
const TF_DIR = path.join(ROOT, 'terraform/keycloak');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

interface TfBlock {
  type: string;
  name: string;
  body: string;
}

/** Top-level `resource "TYPE" "NAME" { ... }` blocks (closing brace at column 0). */
function resources(hcl: string): TfBlock[] {
  const re = /^resource "([^"]+)" "([^"]+)" \{\n([\s\S]*?)^\}/gm;
  return [...hcl.matchAll(re)].map((m) => ({ type: m[1], name: m[2], body: m[3] }));
}

function attr(body: string, key: string): string | undefined {
  const m = body.match(new RegExp(`^\\s*${key}\\s*=\\s*("([^"]*)"|[^\\s#]+)`, 'm'));
  return m ? (m[2] ?? m[1]) : undefined;
}

interface FlowNode {
  kind: 'subflow' | 'execution';
  id: string; // alias for subflows, authenticator for executions
  requirement: string;
  parent: string; // parent flow alias
}

/** Resolve flows.tf into a parent-alias → children map. */
function flowTree(hcl: string): { roots: string[]; nodes: FlowNode[] } {
  const blocks = resources(hcl);
  const aliasOf = new Map<string, string>();
  for (const b of blocks) {
    if (b.type === 'keycloak_authentication_flow' || b.type === 'keycloak_authentication_subflow') {
      aliasOf.set(`${b.type}.${b.name}`, attr(b.body, 'alias')!);
    }
  }
  const parentAlias = (body: string) => {
    const ref = attr(body, 'parent_flow_alias')!;
    const key = ref.replace(/\.alias$/, '');
    const alias = aliasOf.get(key);
    if (!alias) throw new Error(`unresolved parent_flow_alias ${ref}`);
    return alias;
  };
  const nodes: FlowNode[] = [];
  for (const b of blocks) {
    if (b.type === 'keycloak_authentication_subflow') {
      nodes.push({ kind: 'subflow', id: attr(b.body, 'alias')!, requirement: attr(b.body, 'requirement')!, parent: parentAlias(b.body) });
    } else if (b.type === 'keycloak_authentication_execution') {
      nodes.push({ kind: 'execution', id: attr(b.body, 'authenticator')!, requirement: attr(b.body, 'requirement')!, parent: parentAlias(b.body) });
    }
  }
  const roots = blocks.filter((b) => b.type === 'keycloak_authentication_flow').map((b) => attr(b.body, 'alias')!);
  return { roots, nodes };
}

const isCondition = (n: FlowNode) => n.kind === 'execution' && n.id.startsWith('conditional-');

// Pure file checks: they run once, in the chromium project (firefox/webkit ignore this
// file in tests/playwright.config.ts) instead of being skipped per browser at runtime.
test.describe('Keycloak config invariants (static)', () => {
  const flows = () => flowTree(fs.readFileSync(path.join(TF_DIR, 'flows.tf'), 'utf-8'));

  test('KC-01: no flow level mixes REQUIRED/CONDITIONAL with ALTERNATIVE', () => {
    const { nodes } = flows();
    const parents = new Set(nodes.map((n) => n.parent));
    for (const parent of parents) {
      const kids = nodes.filter((n) => n.parent === parent && !isCondition(n));
      const hasRequired = kids.some((n) => n.requirement === 'REQUIRED' || n.requirement === 'CONDITIONAL');
      const hasAlternative = kids.some((n) => n.requirement === 'ALTERNATIVE');
      // Keycloak silently drops the ALTERNATIVEs in this case — that is what let a bare
      // username authenticate before Phase 26.
      expect(hasRequired && hasAlternative, `flow "${parent}" mixes REQUIRED and ALTERNATIVE`).toBe(false);
    }
  });

  test('KC-01: username form is always followed by a REQUIRED credential subflow', () => {
    const { nodes } = flows();
    const usernameForms = nodes.filter((n) => n.id === 'auth-username-form');
    expect(usernameForms.length).toBeGreaterThan(0);
    for (const uf of usernameForms) {
      const siblings = nodes.filter((n) => n.parent === uf.parent && n !== uf);
      const credential = siblings.find((n) => n.kind === 'subflow' && n.requirement === 'REQUIRED');
      expect(credential, `"${uf.parent}" has no REQUIRED credential subflow after the username`).toBeTruthy();
      const credentialKids = nodes.filter((n) => n.parent === credential!.id);
      expect(credentialKids.map((n) => n.id)).toContain('auth-password-form');
      expect(credentialKids.every((n) => n.requirement === 'ALTERNATIVE')).toBe(true);
    }
  });

  test('KC-01: REQUIRED WebAuthn only inside a conditional-user-configured subflow', () => {
    const { nodes } = flows();
    const webauthn = nodes.filter((n) => n.id.startsWith('webauthn-authenticator'));
    expect(webauthn.length).toBeGreaterThan(0);
    for (const w of webauthn.filter((n) => n.requirement === 'REQUIRED')) {
      const parent = nodes.find((n) => n.kind === 'subflow' && n.id === w.parent);
      expect(parent?.requirement, `webauthn parent "${w.parent}" must be CONDITIONAL`).toBe('CONDITIONAL');
      const conditions = nodes.filter((n) => n.parent === w.parent && n.id === 'conditional-user-configured');
      expect(conditions, `"${w.parent}" needs conditional-user-configured`).toHaveLength(1);
    }
  });

  test('SEC-13: browser flow is bound only by keycloak_authentication_bindings', () => {
    const all = fs.readdirSync(TF_DIR).filter((f) => f.endsWith('.tf')).map((f) => fs.readFileSync(path.join(TF_DIR, f), 'utf-8')).join('\n');
    const realm = resources(all).find((b) => b.type === 'keycloak_realm')!;
    expect(attr(realm.body, 'browser_flow')).toBeUndefined();
    const bindings = resources(all).filter((b) => b.type === 'keycloak_authentication_bindings');
    expect(bindings).toHaveLength(1);
    expect(attr(bindings[0].body, 'browser_flow')).toBe('keycloak_authentication_flow.browser_passkey.alias');
    // No other artifact may set the realm's flow.
    expect(fs.existsSync(path.join(ROOT, 'keycloak/apply-local-settings.sh'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'keycloak/realm-export.json'))).toBe(false);
  });

  test('SEC-19: test-user password variables have no defaults', () => {
    const vars = resources(read('terraform/keycloak/variables.tf').replace(/^variable /gm, 'resource "variable" '));
    const passwords = vars.filter((v) => v.name.endsWith('_password'));
    expect(passwords.length).toBeGreaterThanOrEqual(6);
    for (const v of passwords) {
      expect(attr(v.body, 'default'), `variable ${v.name} must not have a default`).toBeUndefined();
      expect(attr(v.body, 'sensitive')).toBe('true');
    }
  });

  test('SEC-25: user-editable attributes stay out of the access token', () => {
    const mappers = resources(read('terraform/keycloak/mappers.tf'));
    for (const name of ['avatar_url', 'preferences']) {
      const m = mappers.find((b) => b.name === name);
      expect(m, `mapper ${name}`).toBeTruthy();
      expect(attr(m!.body, 'add_to_access_token')).toBe('false');
    }
  });

  test('SEC-11: every ?no_esc in the theme goes through kcSanitize()', () => {
    const themeDir = path.join(ROOT, 'keycloak/themes');
    const ftl: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ftl')) ftl.push(p);
      }
    };
    walk(themeDir);
    expect(ftl.length).toBeGreaterThan(0);
    for (const file of ftl) {
      for (const m of fs.readFileSync(file, 'utf-8').matchAll(/\$\{([^}]*)\?no_esc\}/g)) {
        expect(m[1].trim(), `${path.relative(ROOT, file)}: ${m[0]}`).toMatch(/^kcSanitize\(/);
      }
    }
  });
});
