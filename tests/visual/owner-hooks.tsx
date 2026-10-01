import type { ReactNode } from 'react';
﻿const params = new URLSearchParams(location.search);
const fixtureUser = { id: 'fixture-user' };
export const useAuth = () => ({ user: fixtureUser, profile: { currentStoreId: 'fixture-store', firstName: 'Ada' } });
export const useBusinessContext = () => ({ category: params.get('category') ?? 'general_retail' });
export const usePermissions = () => ({ loading: false, hasPermission: () => params.get('restricted') !== 'true' });
export const TrialStatus = () => null;

export const BusinessProvider = ({ children }: { children: ReactNode }) => children;
