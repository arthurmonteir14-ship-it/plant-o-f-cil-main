import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface Props {
  children: React.ReactNode;
  requireFinanceiro?: boolean;
}

export function ProtectedRoute({ children, requireFinanceiro }: Props) {
  const { user, loading, hasFinanceiroAccess } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (requireFinanceiro && !hasFinanceiroAccess()) return <Navigate to="/" replace />;

  return <>{children}</>;
}
