import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Loader2, FlaskConical } from 'lucide-react';

const TEST_CREDENTIALS = { email: 'teste@cades.com', password: 'teste123' };

const loginSchema = z.object({
  email: z.string().trim().email('E-mail inválido').max(255),
  password: z.string().min(6, 'Senha mínima de 6 caracteres').max(72),
});
const signupSchema = loginSchema.extend({
  nome: z.string().trim().min(2, 'Informe seu nome').max(120),
});

export default function Auth() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ nome: '', email: '', password: '' });

  useEffect(() => { if (user) navigate('/', { replace: true }); }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Bem-vindo de volta!');
    navigate('/', { replace: true });
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signupSchema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email, password: parsed.data.password,
      options: { emailRedirectTo: `${window.location.origin}/`, data: { nome: parsed.data.nome } },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Conta criada! Você já pode entrar.');
    setTab('login');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Fundo decorativo suave */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-accent/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-[360px]">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <img src="/logo-cades.svg" alt="CADES" className="h-11 w-11" />
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-tight text-foreground">CADES Financeiro</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Gestão de plantões e repasses</p>
          </div>
        </div>

        {/* Card do form */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-card">
          <Tabs value={tab} onValueChange={v => setTab(v as 'login' | 'signup')}>
            <TabsList className="grid w-full grid-cols-2 mb-5">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email-login" className="text-[13px]">E-mail</Label>
                  <Input id="email-login" type="email" autoComplete="email" required
                    value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password-login" className="text-[13px]">Senha</Label>
                  <Input id="password-login" type="password" autoComplete="current-password" required
                    value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                </div>
                <Button type="submit" className="w-full mt-1" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Entrar
                </Button>

                {import.meta.env.DEV && (
                  <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3 space-y-2">
                    <p className="text-[11px] font-semibold text-amber-700 flex items-center gap-1.5">
                      <FlaskConical className="h-3.5 w-3.5" /> Ambiente de teste
                    </p>
                    <p className="text-[11px] text-amber-600">
                      <span className="font-mono">{TEST_CREDENTIALS.email}</span>
                      {' / '}
                      <span className="font-mono">{TEST_CREDENTIALS.password}</span>
                    </p>
                    <Button type="button" variant="outline" size="sm"
                      className="w-full text-[11px] border-amber-200 text-amber-700 hover:bg-amber-50"
                      onClick={() => setForm(f => ({ ...f, email: TEST_CREDENTIALS.email, password: TEST_CREDENTIALS.password }))}>
                      Preencher credenciais
                    </Button>
                  </div>
                )}
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="nome-signup" className="text-[13px]">Nome completo</Label>
                  <Input id="nome-signup" type="text" required
                    value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email-signup" className="text-[13px]">E-mail</Label>
                  <Input id="email-signup" type="email" autoComplete="email" required
                    value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password-signup" className="text-[13px]">Senha</Label>
                  <Input id="password-signup" type="password" autoComplete="new-password" required
                    value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
                </div>
                <Button type="submit" className="w-full mt-1" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Criar conta
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  O primeiro usuário cadastrado se torna Admin Master.
                </p>
              </form>
            </TabsContent>
          </Tabs>
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground/50">
          © {new Date().getFullYear()} CADES · Cooperativa Assistencial de Trabalho do Espírito Santo
        </p>
      </div>
    </div>
  );
}
