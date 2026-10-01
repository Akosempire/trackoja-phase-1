import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import type { User as AppUser } from '../types';
import { AuthService } from '../services/auth.service';
import { MemberService } from '../services/member.service';
import { EntryService, type EntryResolution } from '../services/entry.service';
import { clearRestoration, withTimeout } from '../utils/session-continuity';
export type AuthStatus = 'initializing' | 'authenticated' | 'unauthenticated' | 'recoverable_error';
interface AuthContextValue {
  user: User | null; profile: AppUser | null; loading: boolean; status: AuthStatus;
  refreshProfile: () => Promise<void>; entry: EntryResolution | null;
  entryLoading: boolean; entryError: string | null; refreshEntry: () => Promise<void>;
}
const AuthContext = createContext<AuthContextValue | undefined>(undefined);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('initializing');
  const [entry, setEntry] = useState<EntryResolution | null>(null);
  const [entryLoading, setEntryLoading] = useState(true);
  const [entryError, setEntryError] = useState<string | null>(null);
  const sequence = useRef(0);
  const currentUser = useRef<User | null>(null);
  const resolved = useRef(false);
  const loadProfile = useCallback(async (next: User) => {
    const request = ++sequence.current;
    if (currentUser.current?.id !== next.id) {
      resolved.current = false; setProfile(null); setEntry(null);
      if (currentUser.current) clearRestoration();
    }
    currentUser.current = next; setUser(next);
    if (!resolved.current) { setEntryLoading(true); setStatus('initializing'); }
    setEntryError(null);
    try {
      const result = await withTimeout((async () => {
        if (!resolved.current) await withTimeout(MemberService.acceptPendingInvitations(), 3000).catch(() => undefined);
        let nextProfile = await AuthService.getUserProfile(next.id);
        if (!nextProfile) throw new Error('Profile unavailable');
        const resolution = await EntryService.resolve();
        if (resolution.currentOrgId !== nextProfile.currentOrgId || resolution.currentStoreId !== nextProfile.currentStoreId) nextProfile = await AuthService.getUserProfile(next.id);
        if (!nextProfile) throw new Error('Workspace unavailable');
        return { nextProfile, resolution };
      })());
      if (request !== sequence.current) return;
      setProfile(result.nextProfile); setEntry(result.resolution); resolved.current = true;
      setStatus('authenticated');
    } catch {
      if (request !== sequence.current) return;
      setEntryError('We could not reconnect to your workspace. Check your connection and try again.');
      setStatus('recoverable_error');
    } finally { if (request === sequence.current) setEntryLoading(false); }
  }, []);
  const restoreSession = useCallback(async () => {
    const request = ++sequence.current;
    if (!resolved.current) { setStatus('initializing'); setEntryLoading(true); }
    setEntryError(null);
    try {
      const session = await withTimeout(AuthService.getSession());
      if (request !== sequence.current) return;
      if (session?.user) await loadProfile(session.user);
      else { currentUser.current = null; resolved.current = false; setUser(null); setProfile(null); setEntry(null); setStatus('unauthenticated'); setEntryLoading(false); }
    } catch {
      if (request !== sequence.current) return;
      setStatus('recoverable_error'); setEntryLoading(false);
      setEntryError('We could not check your session. Check your connection and try again.');
    }
  }, [loadProfile]);
  const refreshProfile = useCallback(async () => {
    if (currentUser.current) await loadProfile(currentUser.current); else await restoreSession();
  }, [loadProfile, restoreSession]);
  useEffect(() => {
    let active = true;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    void restoreSession();
    const { data } = AuthService.onAuthStateChange((next, event) => {
      if (!active || event === 'INITIAL_SESSION') return;
      if (event === 'SIGNED_OUT') {
        timers.forEach(clearTimeout); timers.clear();
        ++sequence.current; currentUser.current = null; resolved.current = false;
        clearRestoration(); setUser(null); setProfile(null); setEntry(null); setEntryError(null);
        setEntryLoading(false); setStatus('unauthenticated'); return;
      }
      // SIGNED_IN also fires on focus. Token refresh is not a new login.
      if (!next || currentUser.current?.id === next.id) return;
      timers.forEach(clearTimeout); timers.clear();
      // Leave Supabase's auth callback lock before starting any requests.
      const timer = setTimeout(() => { timers.delete(timer); if (active) void loadProfile(next); }, 0);
      timers.add(timer);
    });
    return () => { active = false; ++sequence.current; timers.forEach(clearTimeout); data.subscription.unsubscribe(); };
  }, [loadProfile, restoreSession]);
  return <AuthContext.Provider value={{ user, profile, status, loading: status === 'initializing', entry, entryLoading, entryError, refreshProfile, refreshEntry: refreshProfile }}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within an AuthProvider');
  return value;
}
