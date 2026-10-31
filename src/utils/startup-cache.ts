/**
 * Instant start: the last signed-in person's user, profile and workspace entry,
 * kept on this device so a reload can draw the app straight away and refresh
 * from the server in the background.
 *
 * Safety rules:
 *  - One record only, tagged with the user id. It is used only when Supabase's
 *    own stored session on this device belongs to that same user, so another
 *    person's data is never shown (signing out removes Supabase's session).
 *  - Cleared on sign-out and whenever a different user signs in.
 *  - Never holds tokens: Supabase keeps those itself.
 *  - Older than MAX_AGE_MS → ignored (the splash shows and data loads fresh).
 */
import type { User } from '@supabase/supabase-js';
import type { User as AppUser } from '../types';
import type { EntryResolution } from '../services/entry.service';

export const STARTUP_KEY = 'trackoja:startup:v1';
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StartupSnapshot {
  userId: string;
  user: User;
  profile: AppUser;
  entry: EntryResolution;
  at: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const store = (): Store | null => { try { return window.localStorage; } catch { return null; } };

/** The user id in Supabase's own persisted session (sb-<ref>-auth-token), if any. */
export function storedSessionUserId(s: Store | null = store()): string | null {
  if (!s) return null;
  try {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
      const raw = s.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const id = parsed?.user?.id ?? parsed?.currentSession?.user?.id;
      if (typeof id === 'string' && id) return id;
    }
  } catch { /* unreadable storage */ }
  return null;
}

export function saveStartup(user: User, profile: AppUser, entry: EntryResolution, s: Store | null = store(), now = Date.now()): void {
  if (!s || !user?.id || profile?.id !== user.id) return;
  const snapshot: StartupSnapshot = { userId: user.id, user, profile, entry, at: now };
  try { s.setItem(STARTUP_KEY, JSON.stringify(snapshot)); } catch { /* full or blocked */ }
}

/** A usable snapshot for this device's signed-in user, or null. */
export function readStartup(s: Store | null = store(), now = Date.now(), sessionUserId: string | null = storedSessionUserId(s)): StartupSnapshot | null {
  if (!s || !sessionUserId) return null;
  try {
    const snap = JSON.parse(s.getItem(STARTUP_KEY) ?? 'null') as StartupSnapshot | null;
    if (!snap || snap.userId !== sessionUserId || snap.user?.id !== sessionUserId || snap.profile?.id !== sessionUserId) return null;
    if (!snap.entry || typeof snap.at !== 'number' || now - snap.at > MAX_AGE_MS || snap.at > now + 60_000) return null;
    return snap;
  } catch { return null; }
}

export function clearStartup(s: Store | null = store()): void {
  try { s?.removeItem(STARTUP_KEY); } catch { /* blocked */ }
}
