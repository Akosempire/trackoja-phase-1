// hooks/usePermissions.ts
// Resolve the current user's permissions for the active store (Phase 1 RBAC),
// so inventory UI can gate product/category/stock actions per PHASE_2_INVENTORY.md.

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { RbacService } from '../services/rbac.service';
import type { Permission } from '../types';

export function usePermissions() {
  const { user, profile } = useAuth();
  const storeId = profile?.currentStoreId;
  const identity = user && storeId ? `${user.id}:${storeId}` : null;
  const [result, setResult] = useState<{
    identity: string | null;
    permissions: Permission[];
    roleName: string | null;
    loading: boolean;
  }>({ identity: null, permissions: [], roleName: null, loading: true });

  useEffect(() => {
    if (!user || !storeId || !identity) {
      setResult({ identity: null, permissions: [], roleName: null, loading: false });
      return;
    }

    let active = true;
    setResult({ identity, permissions: [], roleName: null, loading: true });
    RbacService.getUserPermissions(user.id, storeId)
      .then((result) => {
        if (active) setResult({ identity, permissions: result.permissions, roleName: result.role?.name ?? null, loading: false });
      })
      .catch((err) => {
        console.error('Load permissions error:', err);
        if (active) setResult({ identity, permissions: [], roleName: null, loading: false });
      });
    return () => { active = false; };
  }, [identity, storeId, user?.id]);

  // A store switch can render before the effect runs. Never expose the prior
  // store's role or links during that render.
  const current = result.identity === identity && !result.loading;
  const permissions = current ? result.permissions : [];
  const roleName = current ? result.roleName : null;
  const loading = Boolean(identity) && !current;

  const hasPermission = (name: string) => permissions.some((p) => p.name === name);

  return { permissions, hasPermission, roleName, loading };
}
