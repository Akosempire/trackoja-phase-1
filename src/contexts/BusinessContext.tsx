import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../config/supabase';
import { useAuth } from './AuthContext';
import {
  getCategoryConfig,
  DEFAULT_CATEGORY,
  type BusinessCategory,
  type CategoryConfig,
} from '../config/businessModules';

interface BusinessContextValue {
  category: BusinessCategory;
  modules: string[];
  config: CategoryConfig;
  hasModule: (module: string) => boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const BusinessContext = createContext<BusinessContextValue | undefined>(undefined);

export function BusinessProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [category, setCategory] = useState<BusinessCategory>(DEFAULT_CATEGORY);
  const [modules, setModules] = useState<string[]>(['inventory', 'sales', 'customers']);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (orgId: string) => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('organizations')
        .select('business_category, enabled_modules')
        .eq('id', orgId)
        .single();

      if (data) {
        setCategory((data.business_category as BusinessCategory) ?? DEFAULT_CATEGORY);
        setModules(data.enabled_modules ?? ['inventory', 'sales', 'customers']);
      }
    } catch {
      // keep defaults on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profile?.currentOrgId) {
      load(profile.currentOrgId);
    } else {
      setLoading(false);
    }
  }, [profile?.currentOrgId, load]);

  const refresh = useCallback(async () => {
    if (profile?.currentOrgId) await load(profile.currentOrgId);
  }, [profile?.currentOrgId, load]);

  const hasModule = useCallback((module: string) => modules.includes(module), [modules]);
  const config = getCategoryConfig(category);

  return (
    <BusinessContext.Provider value={{ category, modules, config, hasModule, loading, refresh }}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusinessContext(): BusinessContextValue {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error('useBusinessContext must be used within BusinessProvider');
  return ctx;
}
