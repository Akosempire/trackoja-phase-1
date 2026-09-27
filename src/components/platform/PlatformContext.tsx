import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PlatformAdminService, type MyPlatformAccess, type PlatformSetting } from '../../services/platformAdmin.service';
import { ENVIRONMENT_SETTING_KEY, resolveEnvironment, type EnvironmentInfo } from '../../config/environment';

interface PlatformContextValue {
  access: MyPlatformAccess | null;
  settings: PlatformSetting[];
  environment: EnvironmentInfo;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** True when the signed-in operator holds this permission. Super admins hold everything. */
  can: (permission: string) => boolean;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

/**
 * One fetch of platform access and settings for the whole dashboard.
 *
 * Access drives which areas and actions are offered; the environment drives the
 * session-wide marker. Both are resolved once here so every screen agrees.
 */
export function PlatformProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<MyPlatformAccess | null>(null);
  const [settings, setSettings] = useState<PlatformSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Access is mandatory: without it there is nothing to render. Settings are
    // advisory (they carry the environment name), so a failure there must not
    // take down the dashboard.
    try {
      const accessResult = await PlatformAdminService.getMyAccess();
      setAccess(accessResult);
      try {
        setSettings(await PlatformAdminService.listSettings());
      } catch {
        setSettings([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load platform access.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const environment = useMemo(() => {
    const row = settings.find((setting) => setting.key === ENVIRONMENT_SETTING_KEY);
    return resolveEnvironment(row ? row.value : undefined);
  }, [settings]);

  const value = useMemo<PlatformContextValue>(() => {
    const permissions = access?.permissions ?? [];
    const isSuperAdmin = access?.isSuperAdmin ?? false;
    return {
      access,
      settings,
      environment,
      loading,
      error,
      reload: load,
      can: (permission: string) => isSuperAdmin || permissions.includes(permission),
    };
  }, [access, settings, environment, loading, error, load]);

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): PlatformContextValue {
  const value = useContext(PlatformContext);
  if (!value) throw new Error('usePlatform must be used inside a PlatformProvider');
  return value;
}
