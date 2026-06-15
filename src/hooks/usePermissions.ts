// hooks/usePermissions.ts
// Resolve the current user's permissions for the active store (Phase 1 RBAC),
// so inventory UI can gate product/category/stock actions per PHASE_2_INVENTORY.md.

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { RbacService } from '../services/rbac.service';
import type { Permission } from '../types';

export function usePermissions() {
  const { user, profile } = useAuth();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [roleName, setRoleName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !profile?.currentStoreId) {
      setPermissions([]);
      setRoleName(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    RbacService.getUserPermissions(user.id, profile.currentStoreId)
      .then((result) => {
        setPermissions(result.permissions);
        setRoleName(result.role?.name ?? null);
      })
      .catch((err) => {
        console.error('Load permissions error:', err);
        setPermissions([]);
        setRoleName(null);
      })
      .finally(() => setLoading(false));
  }, [user, profile?.currentStoreId]);

  const hasPermission = (name: string) => permissions.some((p) => p.name === name);

  return { permissions, hasPermission, roleName, loading };
}
