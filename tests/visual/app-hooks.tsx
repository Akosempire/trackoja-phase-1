// Identity stand-ins for the screen preview harness (tests/visual/app.html).
import type { ReactNode } from 'react';
import { getCategoryConfig, type BusinessCategory } from '../../src/config/businessModules';
import { getBusinessExperience } from '../../src/config/businessExperience';
const params = new URLSearchParams(location.search);
const category = (params.get('category') ?? 'supermarket') as BusinessCategory;
const fixtureUser = { id: 'fixture-user', email: 'ada@example.com' };
const profile = { id: 'fixture-user', currentStoreId: 'fixture-store', currentOrgId: 'fixture-org', firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com', isPlatformAdmin: false, emailVerified: true };
export const useAuth = () => ({ user: fixtureUser, profile, loading: false, status: 'authenticated', refreshProfile: async () => {}, entry: { kind: 'existing_user', destination: '/dashboard', hasAccess: true, currentOrgId: 'fixture-org', currentStoreId: 'fixture-store', organizationCount: 1, role: 'owner', isInvitedUser: false, onboardingState: 'complete', entitlementStatus: 'active' }, entryLoading: false, entryError: null, refreshEntry: async () => {} });
export const AuthProvider = ({ children }: { children: ReactNode }) => children;
export const useBusinessContext = () => {
  const modules = getBusinessExperience(category).defaultModules;
  return { category, modules, config: getCategoryConfig(category), hasModule: (m: string) => modules.includes(m), loading: false, refresh: async () => {} };
};
export const usePermissions = () => ({ loading: false, permissions: [], roleName: params.get('role') ?? 'owner', hasPermission: (p: string) => params.get('restricted') !== 'true' && (!params.get('perms') || params.get('perms')!.split(',').includes(p)), acting: params.get('acting') ? { user_id: 'fixture-acting', name: params.get('acting')! } : null, hasAnyPermission: () => true });
export const TrialStatus = () => null;
export const BusinessProvider = ({ children }: { children: ReactNode }) => children;

// the real usePermissions module also exports this (used on logout)
export function clearPermissionsCache(): void {}
export function refreshPermissions(): void {}
