// hooks/usePermissions.ts
// Resolve the current user's permissions for the active store (Phase 1 RBAC),
// so inventory UI can gate product/category/stock actions per PHASE_2_INVENTORY.md.

import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { RbacService } from '../services/rbac.service';
import type { Permission } from '../types';

// Permissions per user + store, shared by every screen: the first screen loads
// them, the rest reuse them at once (and refresh quietly in the background), so
// moving between pages doesn't flash a loader or hide menu links.
type Cached = { permissions: Permission[]; roleName: string | null };
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<Cached>>();
function loadPermissions(userId: string, storeId: string, identity: string): Promise<Cached> {
  const running = inflight.get(identity);
  if (running) return running;
  const p = RbacService.getUserPermissions(userId, storeId)
    .then((r) => { const v = { permissions: r.permissions, roleName: r.role?.name ?? null }; cache.set(identity, v); return v; })
    .finally(() => { inflight.delete(identity); });
  inflight.set(identity, p);
  return p;
}
/** For sign-out and role changes: forget cached permissions. */
export function clearPermissionsCache(): void { cache.clear(); }

export function usePermissions() {
  const { user, profile } = useAuth();
  const storeId = profile?.currentStoreId;
  const identity = user && storeId ? `${user.id}:${storeId}` : null;
  const [result, setResult] = useState<{
    identity: string | null;
    permissions: Permission[];
    roleName: string | null;
    loading: boolean;
  }>(() => {
    const hit = identity ? cache.get(identity) : undefined;
    return hit ? { identity, permissions: hit.permissions, roleName: hit.roleName, loading: false } : { identity: null, permissions: [], roleName: null, loading: true };
  });

  useEffect(() => {
    if (!user || !storeId || !identity) {
      setResult({ identity: null, permissions: [], roleName: null, loading: false });
      return;
    }

    let active = true;
    const hit = cache.get(identity);
    setResult(hit ? { identity, permissions: hit.permissions, roleName: hit.roleName, loading: false } : { identity, permissions: [], roleName: null, loading: true });
    loadPermissions(user.id, storeId, identity)
      .then((v) => {
        if (active) setResult({ identity, permissions: v.permissions, roleName: v.roleName, loading: false });
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
