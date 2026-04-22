interface Props {
  children: React.ReactNode;
  requireFinanceiro?: boolean;
}

export function ProtectedRoute({ children }: Props) {
  return <>{children}</>;
}
