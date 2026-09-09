import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const LAST_ACTIVITY_KEY = 'insuranceai_last_active';
const SESSION_EXPIRED_KEY = 'insuranceai_session_expired_msg';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem(SESSION_EXPIRED_KEY) || null;
    }
    return null;
  });

  function clearSessionExpiredMessage() {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(SESSION_EXPIRED_KEY);
    }
    setSessionExpiredMessage(null);
  }

  /* ── Fetch the profile (with role) from the profiles table ── */
  async function fetchProfile(userId, retries = 3) {
    for (let i = 0; i < retries; i++) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (data) return data;
      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching profile:', error.message);
      }
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    return null;
  }

  /* ── Bootstrap: get current session + listen for changes ── */
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Check if past inactivity timeout already expired
      if (typeof window !== 'undefined') {
        const lastActiveStr = sessionStorage.getItem(LAST_ACTIVITY_KEY);
        if (lastActiveStr) {
          const lastActive = parseInt(lastActiveStr, 10);
          if (!isNaN(lastActive) && Date.now() - lastActive >= INACTIVITY_TIMEOUT_MS) {
            sessionStorage.removeItem(LAST_ACTIVITY_KEY);
            const msg = 'Your session has expired due to 15 minutes of inactivity. Please sign in again.';
            sessionStorage.setItem(SESSION_EXPIRED_KEY, msg);
            setSessionExpiredMessage(msg);
            await supabase.auth.signOut();
            if (!cancelled) {
              setUser(null);
              setProfile(null);
              setLoading(false);
            }
            return;
          }
        }
      }

      const { data: { session } } = await supabase.auth.getSession();

      if (!cancelled) {
        if (session?.user) {
          if (typeof window !== 'undefined' && !sessionStorage.getItem(LAST_ACTIVITY_KEY)) {
            sessionStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
          }
          setUser(session.user);
          const p = await fetchProfile(session.user.id);
          setProfile(p);
        }
        setLoading(false);
      }
    }

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!cancelled) {
          if (session?.user) {
            if (typeof window !== 'undefined' && event === 'SIGNED_IN') {
              sessionStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
              clearSessionExpiredMessage();
            }
            setUser(session.user);
            const p = await fetchProfile(session.user.id);
            setProfile(p);
          } else {
            setUser(null);
            setProfile(null);
          }
          setLoading(false);
        }
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  /* ── Inactivity Tracking (15 minutes) ── */
  useEffect(() => {
    if (!user) return;

    let lastWrite = Date.now();

    function handleUserActivity() {
      const now = Date.now();
      // Throttle sessionStorage writes to once every 3 seconds
      if (now - lastWrite > 3000) {
        lastWrite = now;
        sessionStorage.setItem(LAST_ACTIVITY_KEY, now.toString());
      }
    }

    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach((evt) => {
      window.addEventListener(evt, handleUserActivity, { passive: true });
    });

    const checkInterval = setInterval(async () => {
      const lastActiveStr = sessionStorage.getItem(LAST_ACTIVITY_KEY);
      const lastActive = lastActiveStr ? parseInt(lastActiveStr, 10) : Date.now();

      if (Date.now() - lastActive >= INACTIVITY_TIMEOUT_MS) {
        sessionStorage.removeItem(LAST_ACTIVITY_KEY);
        const msg = 'Your session has expired due to 15 minutes of inactivity. Please sign in again.';
        sessionStorage.setItem(SESSION_EXPIRED_KEY, msg);
        setSessionExpiredMessage(msg);
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
      }
    }, 10000); // check every 10 seconds

    return () => {
      activityEvents.forEach((evt) => {
        window.removeEventListener(evt, handleUserActivity);
      });
      clearInterval(checkInterval);
    };
  }, [user]);

  /* ── Auth actions ── */
  async function signUp(email, password, fullName) {
    clearSessionExpiredMessage();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });
    if (!error && typeof window !== 'undefined') {
      sessionStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
    }
    return { data, error };
  }

  async function signIn(email, password) {
    clearSessionExpiredMessage();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (!error && typeof window !== 'undefined') {
      sessionStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
    }
    return { data, error };
  }

  async function signOut() {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(LAST_ACTIVITY_KEY);
    }
    const { error } = await supabase.auth.signOut();
    if (!error) {
      setUser(null);
      setProfile(null);
    }
    return { error };
  }

  const value = {
    user,
    profile,
    loading,
    sessionExpiredMessage,
    clearSessionExpiredMessage,
    signUp,
    signIn,
    signOut,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
