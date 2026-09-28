import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const sql = readFileSync(join(root, 'supabase/migrations/20260928000098_onboarding_entry_resolution.sql'), 'utf8');
const adminWorkspaceSql = readFileSync(
  join(root, 'supabase/migrations/20260928000099_platform_admin_workspace_routing.sql'),
  'utf8'
);
const routes = readFileSync(join(root, 'src/routes/ProtectedRoute.tsx'), 'utf8');
const auth = readFileSync(join(root, 'src/contexts/AuthContext.tsx'), 'utf8');
const onboarding = readFileSync(join(root, 'src/pages/onboarding/OnboardingPage.tsx'), 'utf8');
const login = readFileSync(join(root, 'src/pages/auth/LoginPage.tsx'), 'utf8');
const callback = readFileSync(join(root, 'src/pages/auth/AuthCallbackPage.tsx'), 'utf8');
const verify = readFileSync(join(root, 'src/pages/auth/VerifyEmailPage.tsx'), 'utf8');
const workspace = readFileSync(join(root, 'src/pages/WorkspaceSelectionPage.tsx'), 'utf8');

describe('central post-authentication resolution', () => {
  it('waits for server resolution before selecting a destination', () => {
    expect(auth).toMatch(/EntryService\.resolve/);
    expect(routes).toMatch(/loading \|\| \(user && entryLoading\)/);
    expect(routes).not.toMatch(/useCommercialAccess/);
  });
  it('recognizes ownership, membership and legacy subscriptions', () => {
    expect(sql).toMatch(/o\.owner_id = v_user OR om\.user_id = v_user/);
    expect(sql).toMatch(/public\.subscriptions s WHERE s\.org_id = v_org/);
    expect(sql).toMatch(/o\.billing_status = 'active'/);
    expect(sql).toMatch(/'existing_user'/);
    expect(sql).toMatch(/'invited_user'/);
  });
  it('routes existing billing problems away from first-time onboarding', () => {
    expect(sql).toMatch(/'billing_action_required'/);
    expect(sql).toMatch(/'access_restricted'/);
    expect(routes).toMatch(/location\.pathname !== '\/billing'/);
  });
  it('supports explicit workspace selection without creating a business', () => {
    expect(sql).toMatch(/'workspace_selection_required'/);
    expect(sql).toMatch(/select_my_trackoja_workspace/);
    expect(routes).toMatch(/WorkspaceRoute/);
  });
  it('sends every authentication method through the central entry resolver', () => {
    for (const source of [login, callback, verify]) {
      expect(source).toMatch(/navigate\('\/auth\/continue'/);
      expect(source).not.toMatch(/navigate\('\/dashboard'/);
    }
    expect(routes).toMatch(/AuthEntryRedirect/);
  });
  it('keeps a platform admin default separate from their paid merchant workspace', () => {
    expect(adminWorkspaceSql).toMatch(/v_is_platform_admin/);
    expect(adminWorkspaceSql).toMatch(/'merchant_destination'/);
    expect(adminWorkspaceSql).toMatch(/v_has_access/);
    expect(routes).toMatch(/entry\.merchantDestination/);
    expect(workspace).toMatch(/result\.merchantDestination \?\? result\.destination/);
  });
});

describe('resumable new-user onboarding', () => {
  it('persists category and preserves a pending payment reference', () => {
    expect(sql).toMatch(/save_my_onboarding_category/);
    expect(onboarding).toMatch(/progress\.state === 'payment_pending'/);
    expect(onboarding).toMatch(/Check payment status/);
  });
  it('uses a concise completion transition', () => {
    expect(onboarding).toMatch(/ready to use TrackOja/);
    expect(onboarding).toMatch(/Enter TrackOja/);
  });
});
