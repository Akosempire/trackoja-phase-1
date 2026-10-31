import type { ReactNode } from 'react';
﻿const params = new URLSearchParams(location.search);
const fixtureUser = { id: 'fixture-user' };
export const useAuth = () => ({ user: fixtureUser, profile: { currentStoreId: 'fixture-store', firstName: 'Ada' } });
export const useBusinessContext = () => ({ category: params.get('category') ?? 'general_retail' });
export const usePermissions = () => ({ loading: false, hasPermission: (p: string) => params.get('restricted') !== 'true' && (!params.get('perms') || params.get('perms')!.split(',').includes(p)), acting: params.get('acting') ? { user_id: 'fixture-acting', name: params.get('acting')! } : null });
export const TrialStatus = () => null;

export const BusinessProvider = ({ children }: { children: ReactNode }) => children;

// the real usePermissions module also exports this (used on logout)
export function clearPermissionsCache(): void {}
export function refreshPermissions(): void {}
