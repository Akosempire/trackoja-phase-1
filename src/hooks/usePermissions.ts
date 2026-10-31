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
type Cached = { permissions: Permission[]; roleName: string | null; acting: { user_id: string; name: string } | null };
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<Cached>>();
function loadPermissions(userId: string, storeId: string, identity: string): Promise<Cached> {
  const running = inflight.get(identity);
  if (running) return running;
  const p = RbacService.getUserPermissions(userId, storeId)
    .then((r) => { const v = { permissions: r.permissions, roleName: r.role?.name ?? null, acting: r.acting ?? null }; cache.set(identity, v); return v; })
    .finally(() => { inflight.delete(identity); });
  inflight.set(identity, p);
  return p;
}
/** For sign-out and role changes: forget cached permissions. */
export function clearPermissionsCache(): void { cache.clear(); }

// A cashier switch (PIN) changes what this account may do: every mounted
// screen reloads its permissions straight away.
let version = 0;
const listeners = new Set<() => void>();
export function refreshPermissions(): void {
  cache.clear();
  inflight.clear();
  version += 1;
  listeners.forEach((l) => l());
}

export function usePermissions() {
  const { user, profile } = useAuth();
  const storeId = profile?.currentStoreId;
  const identity = user && storeId ? `${user.id}:${storeId}` : null;
  const [seen, setSeen] = useState(version);
  useEffect(() => {
    const l = () => setSeen(version);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  const [result, setResult] = useState<{
    identity: string | null;
    permissions: Permission[];
    roleName: string | null;
    acting: Cached['acting'];
    loading: boolean;
  }>(() => {
    const hit = identity ? cache.get(identity) : undefined;
    return hit ? { identity, ...hit, loading: false } : { identity: null, permissions: [], roleName: null, acting: null, loading: true };
  });

  useEffect(() => {
    if (!user || !storeId || !identity) {
      setResult({ identity: null, permissions: [], roleName: null, acting: null, loading: false });
      return;
    }

    let active = true;
    const hit = cache.get(identity);
    // after a switch the previous answer stays on screen until the new one
    // arrives (the server enforces the new one immediately either way)
    setResult((prev) => hit ? { identity, ...hit, loading: false } : prev.identity === identity ? prev : { identity, permissions: [], roleName: null, acting: null, loading: true });
    loadPermissions(user.id, storeId, identity)
      .then((v) => {
        if (active) setResult({ identity, ...v, loading: false });
      })
      .catch((err) => {
        console.error('Load permissions error:', err);
        if (active) setResult({ identity, permissions: [], roleName: null, acting: null, loading: false });
      });
    return () => { active = false; };
  }, [identity, storeId, user?.id, seen]);

  // A store switch can render before the effect runs. Never expose the prior
  // store's role or links during that render.
  const current = result.identity === identity && !result.loading;
  const permissions = current ? result.permissions : [];
  const roleName = current ? result.roleName : null;
  const acting = current ? result.acting : null;
  const loading = Boolean(identity) && !current;

  const hasPermission = (name: string) => permissions.some((p) => p.name === name);

  return { permissions, hasPermission, roleName, acting, loading };
}
