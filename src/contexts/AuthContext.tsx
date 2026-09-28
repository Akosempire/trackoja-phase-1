import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import type { User as AppUser } from '../types';
import { AuthService } from '../services/auth.service';
import { MemberService } from '../services/member.service';
import { EntryService, type EntryResolution } from '../services/entry.service';

interface AuthContextValue {
  user: User | null;
  profile: AppUser | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  entry: EntryResolution | null;
  entryLoading: boolean;
  entryError: string | null;
  refreshEntry: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState<EntryResolution | null>(null);
  const [entryLoading, setEntryLoading] = useState(true);
  const [entryError, setEntryError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadProfile = useCallback(async (nextUser: User | null) => {
    const sequence = ++requestSequence.current;
    if (!nextUser) {
      setProfile(null);
      setEntry(null);
      setEntryError(null);
      setEntryLoading(false);
      return;
    }
    setEntryLoading(true);
    // Link up any pending staff invitations for this user's email before
    // loading their profile, so a newly-accepted membership's org/store is
    // reflected immediately (skips onboarding for invited staff).
    try {
      await MemberService.acceptPendingInvitations();
    } catch (err) {
      console.error('Accept pending invitations error:', err);
    }
    let userProfile = await AuthService.getUserProfile(nextUser.id);
    try {
      const resolution = await EntryService.resolve();
      if (resolution.currentOrgId !== userProfile?.currentOrgId || resolution.currentStoreId !== userProfile?.currentStoreId) {
        userProfile = await AuthService.getUserProfile(nextUser.id);
      }
      if (sequence === requestSequence.current) {
        setProfile(userProfile);
        setEntry(resolution);
        setEntryError(null);
      }
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setProfile(userProfile);
        setEntry(null);
        setEntryError(cause instanceof Error ? cause.message : 'Account access could not be resolved.');
      }
    } finally {
      if (sequence === requestSequence.current) setEntryLoading(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile(user);
  }, [loadProfile, user]);

  const refreshEntry = refreshProfile;

  useEffect(() => {
    AuthService.getSession().then(async (session) => {
      setUser(session?.user ?? null);
      await loadProfile(session?.user ?? null);
      setLoading(false);
    });

    const { data } = AuthService.onAuthStateChange((nextUser) => {
      setUser(nextUser);
      loadProfile(nextUser).then(() => setLoading(false));
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [loadProfile]);

  return (
    <AuthContext.Provider value={{ user, profile, loading, refreshProfile, entry, entryLoading, entryError, refreshEntry }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
