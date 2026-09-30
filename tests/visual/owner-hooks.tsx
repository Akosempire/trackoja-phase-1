const params = new URLSearchParams(location.search);
export const useAuth = () => ({ profile: { currentStoreId: 'fixture-store', firstName: 'Ada' } });
export const useBusinessContext = () => ({ category: params.get('category') ?? 'general_retail' });
export const usePermissions = () => ({ loading: false, hasPermission: () => params.get('restricted') !== 'true' });
export const TrialStatus = () => null;
