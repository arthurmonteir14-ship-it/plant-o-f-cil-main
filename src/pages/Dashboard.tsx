import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, ListChecks, Wallet, HandCoins, Clock } from 'lucide-react';
import { formatCurrency, formatDate, profissaoLabel } from '@/lib/format';
import { StatusBadge } from '@/components/StatusBadge';
import { useAuth } from '@/hooks/useAuth';

interface KPI { totalPlantoes: number; faturamento: number; repasse: number; pendentes: number; }
interface RecentRow {
  id: string; data_plantao: string; valor_cobrado_cliente: number; status: string;
  cooperados: { nome: string; profissao: string } | null;
  hospitals: { nome: string } | null;
  sectors: { nome: string } | null;
}

export default function Dashboard() {
  const { hasFinanceiroAccess } = useAuth();
  const [kpi, setKpi] = useState<KPI>({ totalPlantoes: 0, faturamento: 0, repasse: 0, pendentes: 0 });
  const [recents, setRecents] = useState<RecentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasFinanceiroAccess()) { setLoading(false); return; }
    (async () => {
      const today = new Date();
      const inicioMes = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
      const fimMes = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

      const { data: lancs } = await supabase
        .from('lancamentos_plantoes')
        .select('valor_cobrado_cliente, valor_repasse_cooperado, status')
        .gte('data_plantao', inicioMes)
        .lte('data_plantao', fimMes);

      const totalPlantoes = lancs?.length ?? 0;
      const faturamento = lancs?.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0) ?? 0;
      const repasse = lancs?.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0) ?? 0;
      const pendentes = lancs?.filter(r => r.status === 'lancado').length ?? 0;

      const { data: rec } = await supabase
        .from('lancamentos_plantoes')
        .select('id, data_plantao, valor_cobrado_cliente, status, cooperados(nome, profissao), hospitals(nome), sectors(nome)')
        .order('created_at', { ascending: false })
        .limit(6);

      setKpi({ totalPlantoes, faturamento, repasse, pendentes });
      setRecents((rec ?? []) as unknown as RecentRow[]);
      setLoading(false);
    })();
  }, [hasFinanceiroAccess]);

  const cards = [
    { label: 'Plantões no mês', value: kpi.totalPlantoes, icon: ListChecks, color: 'text-primary', bg: 'bg-primary-soft' },
    { label: 'Faturamento previsto', value: formatCurrency(kpi.faturamento), icon: Wallet, color: 'text-accent', bg: 'bg-accent-soft' },
    { label: 'Repasse aos cooperados', value: formatCurrency(kpi.repasse), icon: HandCoins, color: 'text-success', bg: 'bg-success/10' },
    { label: 'Lançamentos pendentes', value: kpi.pendentes, icon: Clock, color: 'text-warning', bg: 'bg-warning/10' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Visão geral</h1>
          <p className="text-sm text-muted-foreground">Acompanhe os indicadores do mês corrente</p>
        </div>
        {hasFinanceiroAccess() && (
          <Button asChild className="gap-2">
            <Link to="/financeiro/lancamentos/novo"><Plus className="h-4 w-4" /> Novo lançamento</Link>
          </Button>
        )}
      </div>

      {!hasFinanceiroAccess() ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          Seu perfil não tem acesso ao módulo Financeiro.
        </CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {cards.map(c => (
              <Card key={c.label} className="shadow-card">
                <CardContent className="p-5">
                  <div className="flex items-center gap-4">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${c.bg} ${c.color}`}>
                      <c.icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</p>
                      <p className="text-2xl font-bold tabular-nums truncate">{loading ? '—' : c.value}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Lançamentos recentes</CardTitle>
              <Button asChild variant="ghost" size="sm"><Link to="/financeiro/lancamentos">Ver todos</Link></Button>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              ) : recents.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Nenhum lançamento ainda. Comece criando o primeiro.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b">
                      <tr>
                        <th className="text-left py-3 font-medium">Cooperado</th>
                        <th className="text-left py-3 font-medium">Hospital / Setor</th>
                        <th className="text-left py-3 font-medium">Data</th>
                        <th className="text-right py-3 font-medium">Valor cliente</th>
                        <th className="text-right py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {recents.map(r => (
                        <tr key={r.id} className="hover:bg-muted/40">
                          <td className="py-3">
                            <div className="font-medium">{r.cooperados?.nome ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{profissaoLabel[r.cooperados?.profissao ?? ''] ?? '—'}</div>
                          </td>
                          <td className="py-3">
                            <div>{r.hospitals?.nome ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{r.sectors?.nome ?? '—'}</div>
                          </td>
                          <td className="py-3 tabular-nums">{formatDate(r.data_plantao)}</td>
                          <td className="py-3 text-right tabular-nums font-medium">{formatCurrency(r.valor_cobrado_cliente)}</td>
                          <td className="py-3 text-right"><StatusBadge status={r.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
