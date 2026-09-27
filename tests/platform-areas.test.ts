// Platform console information-architecture rules.
//
// The important test here mirrors the merchant one: a sidebar entry must point
// at a route that actually exists in App.tsx. A console that offers a
// destination which dead-ends is the failure a visual review misses, and it is
// exactly what happens when an area is renamed but its route is not.
//
// The honesty rules are asserted too: an area that admits it has no backend must
// say what is missing, so a thin screen can never be mistaken for a complete one.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PLATFORM_AREAS,
  PLATFORM_GROUPS,
  PLATFORM_BASE_PATH,
  canSeeArea,
  findPlatformArea,
  platformAreaPath,
  visiblePlatformAreas,
  type PlatformArea,
} from '../src/config/platformAreas';
import { resolveEnvironment } from '../src/config/environment';

const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
const ROUTE_PATHS = new Set(Array.from(appSource.matchAll(/path="([^"]+)"/g)).map((match) => match[1]));
const HAS_INDEX_ROUTE = /<Route\s+index\s/.test(appSource);

/** The ten areas the console must cover, as required by the brief. */
const REQUIRED_AREA_IDS = [
  'overview',
  'businesses',
  'billing',
  'activation',
  'support',
  'integrations',
  'health',
  'developer',
  'audit',
  'settings',
];

describe('Platform console structure', () => {
  it('covers exactly the ten required areas', () => {
    expect(PLATFORM_AREAS.map((area) => area.id).sort()).toEqual([...REQUIRED_AREA_IDS].sort());
    expect(PLATFORM_AREAS).toHaveLength(10);
  });

  it('gives every area a unique id and a unique route', () => {
    const ids = PLATFORM_AREAS.map((area) => area.id);
    const paths = PLATFORM_AREAS.map((area) => area.path);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('nests every area under the platform base path', () => {
    for (const area of PLATFORM_AREAS) {
      const full = platformAreaPath(area);
      expect(full.startsWith(PLATFORM_BASE_PATH)).toBe(true);
      if (area.path) expect(full).toBe(`${PLATFORM_BASE_PATH}/${area.path}`);
      else expect(full).toBe(PLATFORM_BASE_PATH);
    }
  });

  it('points every sidebar entry at a route that exists in App.tsx', () => {
    for (const area of PLATFORM_AREAS) {
      if (area.path === '') {
        expect(HAS_INDEX_ROUTE, 'the overview needs an index route under /platform').toBe(true);
        continue;
      }
      // Nested routes are declared relative to /platform, but a detail route may
      // be declared with its full sub-path (e.g. "businesses/:orgId").
      const declared = [...ROUTE_PATHS].some(
        (path) => path === area.path || path.startsWith(`${area.path}/`),
      );
      expect(declared, `no route declared for the ${area.id} area (${area.path})`).toBe(true);
    }
  });

  it('groups every grouped area into a declared group', () => {
    const groupIds = new Set(PLATFORM_GROUPS.map((group) => group.id));
    for (const area of PLATFORM_AREAS) {
      if (area.group !== null) {
        expect(groupIds.has(area.group), `${area.id} names an unknown group`).toBe(true);
      }
    }
  });

  it('keeps the overview ungrouped so it leads the sidebar', () => {
    const overview = PLATFORM_AREAS.find((area) => area.id === 'overview')!;
    expect(overview.group).toBeNull();
    expect(PLATFORM_AREAS[0].id).toBe('overview');
  });

  it('requires a permission or an explicit developer gate for every area', () => {
    for (const area of PLATFORM_AREAS) {
      const isGated = area.permissions.length > 0 || area.developerOnly === true;
      expect(isGated, `${area.id} has no permission and no developer gate`).toBe(true);
    }
  });

  it('names only permission keys the database actually defines', () => {
    // The twelve original keys plus the six added by the hardening migration.
    const known = new Set([
      'platform:view',
      'platform:manage_products',
      'platform:manage_businesses',
      'platform:manage_users',
      'platform:manage_plans',
      'platform:manage_payments',
      'platform:manage_activation',
      'platform:support',
      'platform:manage_settings',
      'platform:impersonate',
      'developer:access',
      'developer:manage',
      'platform:view_payments',
      'platform:manage_subscriptions',
      'platform:manage_integrations',
      'platform:view_health',
      'platform:view_audit',
      'platform:manage_tickets',
    ]);
    for (const area of PLATFORM_AREAS) {
      for (const permission of area.permissions) {
        expect(known.has(permission), `${area.id} names an unknown permission: ${permission}`).toBe(true);
      }
    }
  });
});

describe('Platform console honesty rules', () => {
  const incomplete = PLATFORM_AREAS.filter((area) => area.capability !== 'live');

  it('states what is missing wherever the backend is incomplete', () => {
    // A screen that looks complete while several of its endpoints do not exist is
    // the most misleading thing an admin console can do.
    expect(incomplete.length).toBeGreaterThan(0);
    for (const area of incomplete) {
      expect(area.gaps && area.gaps.length > 0, `${area.id} is incomplete but lists no gap`).toBe(true);
    }
  });

  it('gives every gap a specific, non-placeholder description', () => {
    for (const area of PLATFORM_AREAS) {
      for (const gap of area.gaps ?? []) {
        expect(gap.length).toBeGreaterThan(24);
        expect(gap.toLowerCase()).not.toBe('todo');
      }
    }
  });

  it('does not claim the missing areas are live', () => {
    const byId = (id: string) => PLATFORM_AREAS.find((area) => area.id === id)!;
    // Support has no ticket table at all, and integrations has no registry.
    expect(byId('support').capability).toBe('specified');
    expect(byId('integrations').capability).toBe('specified');
  });
});

describe('Platform area visibility', () => {
  const superAdmin = { isSuperAdmin: true, developerMode: false, permissions: [] as string[] };

  it('shows a platform owner every area', () => {
    expect(visiblePlatformAreas(superAdmin)).toHaveLength(PLATFORM_AREAS.length);
  });

  it('hides the developer area from an admin without a developer grant', () => {
    const admin = { isSuperAdmin: false, developerMode: false, permissions: ['platform:view', 'platform:manage_businesses'] };
    const visible = visiblePlatformAreas(admin);
    expect(visible.some((area) => area.id === 'developer')).toBe(false);
    expect(visible.some((area) => area.id === 'overview')).toBe(true);
    expect(visible.some((area) => area.id === 'businesses')).toBe(true);
  });

  it('reveals the developer area once a grant is active', () => {
    const developer = { isSuperAdmin: false, developerMode: true, permissions: ['developer:access'] };
    expect(visiblePlatformAreas(developer).some((area) => area.id === 'developer')).toBe(true);
  });

  it('gives a support agent only the areas their permissions cover', () => {
    const agent = { isSuperAdmin: false, developerMode: false, permissions: ['platform:view', 'platform:support'] };
    const ids = visiblePlatformAreas(agent).map((area) => area.id);
    expect(ids).toContain('support');
    expect(ids).not.toContain('settings');
    expect(ids).not.toContain('activation');
    expect(ids).not.toContain('developer');
  });

  it('treats a finance operator as holding payments and plans only', () => {
    const finance = {
      isSuperAdmin: false,
      developerMode: false,
      permissions: ['platform:view_payments', 'platform:manage_subscriptions', 'platform:view'],
    };
    const ids = visiblePlatformAreas(finance).map((area) => area.id);
    expect(ids).toContain('billing');
    expect(ids).not.toContain('settings');
    expect(ids).not.toContain('support');
  });

  it('lets an area be reached by any one of its permissions', () => {
    const area: PlatformArea = PLATFORM_AREAS.find((candidate) => candidate.id === 'billing')!;
    for (const permission of area.permissions) {
      expect(
        canSeeArea(area, { isSuperAdmin: false, developerMode: false, permissions: [permission] }),
        `${permission} alone should reveal the billing area`,
      ).toBe(true);
    }
  });

  it('does not reveal an area to a user holding nothing', () => {
    const none = { isSuperAdmin: false, developerMode: false, permissions: [] };
    // The overview requires platform:view, so a user with no platform permissions
    // must not see it.
    expect(visiblePlatformAreas(none)).toHaveLength(0);
  });
});

describe('Resolving the current area', () => {
  it('resolves the base path to the overview', () => {
    expect(findPlatformArea('/platform')?.id).toBe('overview');
  });

  it('resolves a nested path to its own area, not the overview', () => {
    expect(findPlatformArea('/platform/settings')?.id).toBe('settings');
    expect(findPlatformArea('/platform/activation')?.id).toBe('activation');
  });

  it('prefers the longest match so a detail route stays in its area', () => {
    // /platform/businesses/<id> must stay in Businesses, not fall back on a
    // shorter prefix.
    expect(findPlatformArea('/platform/businesses/5f1c')?.id).toBe('businesses');
  });
});

describe('Environment reporting', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back to an explicitly declared platform setting', () => {
    const resolved = resolveEnvironment('staging');
    expect(resolved.name).toBe('staging');
    expect(resolved.source).toBe('setting');
  });

  it('normalises common spellings of the environment', () => {
    expect(resolveEnvironment('LIVE').name).toBe('production');
    expect(resolveEnvironment('prod').name).toBe('production');
    expect(resolveEnvironment('dev').name).toBe('development');
  });

  it('reads a name out of an object-valued setting', () => {
    expect(resolveEnvironment({ name: 'production' }).name).toBe('production');
  });

  it('admits when the environment is unknown rather than guessing', () => {
    const resolved = resolveEnvironment({ unexpected: true });
    // The test environment is not production, so it must not silently claim to be.
    expect(['unknown', 'development']).toContain(resolved.name);
    if (resolved.name === 'unknown') {
      expect(resolved.detail).toContain('VITE_ENVIRONMENT');
    }
  });

  it('trusts the deployment declaration over the shared database setting', () => {
    // The same database serves the live site and local development, so the
    // deployment is the only source that can tell them apart.
    vi.stubEnv('VITE_ENVIRONMENT', 'development');
    const resolved = resolveEnvironment('production');
    expect(resolved.name).toBe('development');
    expect(resolved.source).toBe('build');
  });

  it('reports a disagreement instead of resolving it silently', () => {
    vi.stubEnv('VITE_ENVIRONMENT', 'development');
    const resolved = resolveEnvironment('production');
    expect(resolved.mismatch).toBeDefined();
    expect(resolved.mismatch?.databaseName).toBe('production');
    expect(resolved.mismatch?.note).toContain('database');
  });

  it('reports no disagreement when the two sources agree', () => {
    vi.stubEnv('VITE_ENVIRONMENT', 'production');
    expect(resolveEnvironment('production').mismatch).toBeUndefined();
  });

  it('reports no disagreement when only one source is known', () => {
    vi.stubEnv('VITE_ENVIRONMENT', 'production');
    expect(resolveEnvironment(undefined).mismatch).toBeUndefined();
  });
});
