import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

const DOMAIN = '@cades.com';

const loginSchema = z.object({
  login: z.string().trim().min(2, 'Login inválido').max(80).regex(/^[a-zA-Z0-9._-]+$/, 'Login inválido'),
  password: z.string().min(6, 'Senha mínima de 6 caracteres').max(72),
});

export default function Auth() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ login: '', password: '' });

  useEffect(() => { if (user) navigate('/', { replace: true }); }, [user, navigate]);

  const toEmail = (login: string) => `${login.trim().toLowerCase()}${DOMAIN}`;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: toEmail(parsed.data.login),
      password: parsed.data.password,
    });
    setLoading(false);
    if (error) { toast.error('Login ou senha inválidos.'); return; }
    toast.success('Bem-vindo de volta!');
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-accent/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-[360px]">
        <div className="mb-8 flex flex-col items-center gap-3">
          <img src="/logo-cades.svg" alt="CADES" className="h-11 w-11" />
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight text-foreground">CADES Financeiro</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Gestão de plantões e repasses</p>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-card">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login-input" className="text-[13px]">Login</Label>
              <Input
                id="login-input"
                type="text"
                autoComplete="username"
                placeholder="seu.login"
                required
                value={form.login}
                onChange={e => setForm(f => ({ ...f, login: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password-login" className="text-[13px]">Senha</Label>
              <Input
                id="password-login"
                type="password"
                autoComplete="current-password"
                required
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
            </div>
            <Button type="submit" className="w-full mt-1" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Entrar
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground/50">
          © {new Date().getFullYear()} CADES · Cooperativa Assistencial de Trabalho do Espírito Santo
        </p>
      </div>
    </div>
  );
}
