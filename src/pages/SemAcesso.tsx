import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export default function SemAcesso() {
  const { signOut, roles } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/10 text-warning">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold mb-2">Acesso restrito</h1>
        <p className="text-muted-foreground mb-6">
          Sua conta {roles.length ? `(${roles.join(', ')})` : ''} ainda não possui permissão para acessar este módulo.
          Solicite ao Admin Master a liberação.
        </p>
        <div className="flex gap-2 justify-center">
          <Button asChild variant="outline"><Link to="/">Voltar</Link></Button>
          <Button onClick={signOut}>Sair</Button>
        </div>
      </div>
    </div>
  );
}
