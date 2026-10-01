import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useAuth } from '../contexts/AuthContext';

/** Opt-in only: non-sensitive filters and stock draft fields, scoped to this tab/account/branch. */
export function useWorkspaceState<T>(name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const { user, profile } = useAuth();
  const id = user?.id ?? profile?.id;
  const key = id && profile?.currentStoreId ? `trackoja:resume:draft:${id}:${profile.currentOrgId}:${profile.currentStoreId}:${name}` : null;
  const read = (): T => {
    try {
      const saved = key ? JSON.parse(sessionStorage.getItem(key) ?? 'null') : null;
      return saved && Date.now() - saved.at < 86400000 && typeof saved.value === typeof initial ? saved.value : initial;
    } catch { return initial; }
  };
  const [state, setState] = useState(() => ({ key, value: read() }));
  const value = state.key === key ? state.value : read();
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    const next = typeof update === 'function' ? (update as (previous: T) => T)(value) : update;
    setState({ key, value: next });
    try { if (key) sessionStorage.setItem(key, JSON.stringify({ value: next, at: Date.now() })); } catch { /* Storage is optional. */ }
  }, [key, value]);
  return [value, setValue];
}
