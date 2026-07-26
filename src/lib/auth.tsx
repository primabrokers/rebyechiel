import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { api } from './api';
import { demoProfile, demoRole, exitDemo, isDemo } from './demo';
import type { Profile } from '../types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  /** Authed but no rabbi_profiles row yet — the email+password signup path finishes with bootstrap. */
  needsBootstrap: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  loading: true, session: null, profile: null, needsBootstrap: false,
  refreshProfile: async () => {}, signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const res = await api<{ profile: Profile | null }>('me');
      setProfile(res.profile);
      setNeedsBootstrap(false);
    } catch (err) {
      if (err instanceof Error && err.message === 'no_profile') {
        setProfile(null);
        setNeedsBootstrap(true);
      } else {
        setProfile(null);
      }
    }
  }, []);

  useEffect(() => {
    // Preview mode is signed in as a sample person and never talks to Supabase auth.
    if (isDemo()) {
      setProfile(demoProfile(demoRole()!));
      setSession({ user: { id: 'demo-user' } } as unknown as Session);
      setLoading(false);
      return;
    }
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (data.session) await loadProfile();
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      setSession(next);
      if (next) await loadProfile();
      else { setProfile(null); setNeedsBootstrap(false); }
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    // In preview, "sign out" just leaves preview mode.
    if (isDemo()) { exitDemo(); return; }
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{ loading, session, profile, needsBootstrap, refreshProfile: loadProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
