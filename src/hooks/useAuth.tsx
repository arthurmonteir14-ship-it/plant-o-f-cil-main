import { createContext, useContext, ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';

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

const MOCK_USER = { id: 'mock-user', email: 'admin@cades.com' } as unknown as User;
const MOCK_ROLES: AppRole[] = ['admin_master'];

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={{
      user: MOCK_USER,
      session: null as Session | null,
      roles: MOCK_ROLES,
      loading: false,
      signOut: async () => {},
      hasRole: (role: AppRole) => MOCK_ROLES.includes(role),
      hasFinanceiroAccess: () => true,
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
