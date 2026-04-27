import { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'admin_master' | 'coordenadora' | 'administrativo' | 'nac';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  signOut: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  hasFinanceiroAccess: () => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const roleFromMeta = session?.user?.user_metadata?.role as AppRole | undefined;
  const roles: AppRole[] = roleFromMeta ? [roleFromMeta] : session ? ['admin_master'] : [];

  return (
    <AuthContext.Provider value={{
      user: session?.user ?? null,
      session,
      roles,
      loading,
      signOut: async () => { await supabase.auth.signOut(); },
      hasRole: (role) => roles.includes(role),
      hasFinanceiroAccess: () =>
        roles.includes('admin_master') || roles.includes('coordenadora') || roles.includes('administrativo'),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
