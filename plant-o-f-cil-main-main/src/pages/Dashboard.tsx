import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, ListChecks, Wallet, HandCoins, Clock } from 'lucide-react';
import { formatCurrency, formatDate, profissaoLabel } from '@/lib/format';
import { StatusBadge } from '@/components/StatusBadge';
import { useAuth } from '@/hooks/useAuth';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';

// ── Interfaces ─────────────────────────────────────────────────────────────────

interface KPI { totalPlantoes: number; faturamento: number; repasse: number; pendentes: number; }
interface RecentRow {
  id: string; data_plantao: string; valor_cobrado_cliente: number; status: string;
  cooperados: { nome: string; profissao: string } | null;
  hospitals: { nome: string } | null;
  sectors: { nome: string } | null;
}
interface ChartRow {
  id: string; data_plantao: string;
  valor_cobrado_cliente: number; valor_repasse_cooperado: number;
  hospital_id: string | null; hospital_nome: string;
  sector_id: string | null; sector_nome: string;
}
interface Hospital { id: string; nome: string; }
interface Sector   { id: string; nome: string; hospital_id: string; }

// ── Cores dos gráficos ─────────────────────────────────────────────────────────

const NAVY   = '#1a2f5a';
const BLUE   = '#2563eb';
const GREEN  = '#16a34a';
const CORES_PIZZA = ['#1a2f5a','#2563eb','#16a34a','#d97706','#dc2626','#7c3aed','#0891b2','#be185d','#059669','#b45309'];

const fmtK = (v: number) =>
  v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : formatCurrency(v);

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// ── Componente ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { hasFinanceiroAccess } = useAuth();

  // ── Estado existente ──
  const [kpi, setKpi] = useState<KPI>({ totalPlantoes: 0, faturamento: 0, repasse: 0, pendentes: 0 });
  const [recents, setRecents] = useState<RecentRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Estado dos gráficos ──
  const [chartRows, setChartRows] = useState<ChartRow[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [sectors, setSectors]     = useState<Sector[]>([]);
  const [loadingChart, setLoadingChart] = useState(true);
  const [filtroHospital, setFiltroHospital] = useState('__todos__');
  const [filtroSetor, setFiltroSetor]       = useState('__todos__');

  // Período do gráfico — De/Até (YYYY-MM)
  const hoje = new Date();
  const mesAtual   = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const mes12atras = (() => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const [periodoInicio, setPeriodoInicio] = useState(mes12atras);
  const [periodoFim,    setPeriodoFim]    = useState(mesAtual);

  // ── Busca dados existentes do mês atual ────────────────────────────────────
  useEffect(() => {
    if (!hasFinanceiroAccess()) { setLoading(false); return; }
    (async () => {
      const today = new Date();
      const inicioMes = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
      const fimMes    = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

      const { data: lancs } = await supabase
        .from('lancamentos_plantoes')
        .select('valor_cobrado_cliente, valor_repasse_cooperado, status')
        .gte('data_plantao', inicioMes)
        .lte('data_plantao', fimMes);

      const totalPlantoes = lancs?.length ?? 0;
      const faturamento   = lancs?.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0) ?? 0;
      const repasse       = lancs?.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0) ?? 0;
      const pendentes     = lancs?.filter(r => r.status === 'lancado').length ?? 0;

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

  // ── Busca dados dos gráficos (período selecionado) ────────────────────────
  useEffect(() => {
    if (!hasFinanceiroAccess()) return;
    (async () => {
      setLoadingChart(true);
      const inicio = `${periodoInicio}-01`;
      const [anoFim, mesFimN] = periodoFim.split('-').map(Number);
      const fim = new Date(anoFim, mesFimN, 0).toISOString().slice(0, 10); // último dia do mês fim

      const [{ data: lancs }, { data: hosp }, { data: sects }] = await Promise.all([
        supabase
          .from('lancamentos_plantoes')
          .select('id, data_plantao, valor_cobrado_cliente, valor_repasse_cooperado, hospital_id, hospitals(id, nome), sectors(id, nome)')
          .gte('data_plantao', inicio)
          .lte('data_plantao', fim)
          .order('data_plantao', { ascending: true }),
        supabase.from('hospitals').select('id, nome').order('nome'),
        supabase.from('sectors').select('id, nome, hospital_id').order('nome'),
      ]);

      const rows: ChartRow[] = (lancs ?? []).map((r: any) => ({
        id: r.id,
        data_plantao: r.data_plantao,
        valor_cobrado_cliente: Number(r.valor_cobrado_cliente),
        valor_repasse_cooperado: Number(r.valor_repasse_cooperado),
        hospital_id: r.hospital_id,
        hospital_nome: r.hospitals?.nome ?? 'Sem cliente',
        sector_id: r.sectors?.id ?? null,
        sector_nome: r.sectors?.nome ?? 'Sem setor',
      }));

      setChartRows(rows);
      setHospitals(hosp ?? []);
      setSectors((sects ?? []) as Sector[]);
      setLoadingChart(false);
    })();
  }, [hasFinanceiroAccess, periodoInicio, periodoFim]);

  // ── Dados filtrados ────────────────────────────────────────────────────────
  const rowsFiltrados = useMemo(() => chartRows.filter(r => {
    if (filtroHospital !== '__todos__' && r.hospital_id !== filtroHospital) return false;
    if (filtroSetor    !== '__todos__' && r.sector_id    !== filtroSetor)    return false;
    return true;
  }), [chartRows, filtroHospital, filtroSetor]);

  const setoresFiltro = useMemo(() =>
    filtroHospital === '__todos__' ? sectors : sectors.filter(s => s.hospital_id === filtroHospital),
  [sectors, filtroHospital]);

  // helper — atalho de período
  const aplicarAtalho = (meses: number) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - (meses - 1), 1);
    setPeriodoInicio(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setPeriodoFim(mesAtual);
  };

  // ── Gráfico 1: Faturamento mensal (barras) ─────────────────────────────────
  const dadosMensais = useMemo(() => {
    const mapa: Record<string, { mes: string; faturamento: number; repasse: number }> = {};
    // gera todos os meses do período selecionado
    const [anoI, mesI] = periodoInicio.split('-').map(Number);
    const [anoF, mesF] = periodoFim.split('-').map(Number);
    let ano = anoI; let mes = mesI;
    while (ano < anoF || (ano === anoF && mes <= mesF)) {
      const key = `${ano}-${String(mes).padStart(2, '0')}`;
      mapa[key] = { mes: `${MESES[mes - 1]}/${String(ano).slice(2)}`, faturamento: 0, repasse: 0 };
      mes++; if (mes > 12) { mes = 1; ano++; }
    }
    rowsFiltrados.forEach(r => {
      const key = r.data_plantao.slice(0, 7);
      if (mapa[key]) {
        mapa[key].faturamento += r.valor_cobrado_cliente;
        mapa[key].repasse     += r.valor_repasse_cooperado;
      }
    });
    return Object.values(mapa);
  }, [rowsFiltrados, periodoInicio, periodoFim]);

  // ── Gráfico 2: Por cliente (pizza) ────────────────────────────────────────
  const dadosPorCliente = useMemo(() => {
    const mapa: Record<string, number> = {};
    rowsFiltrados.forEach(r => { mapa[r.hospital_nome] = (mapa[r.hospital_nome] ?? 0) + r.valor_cobrado_cliente; });
    return Object.entries(mapa).sort((a, b) => b[1] - a[1]).map(([nome, valor]) => ({ nome, valor }));
  }, [rowsFiltrados]);

  // ── Gráfico 3: Por setor (barras horizontais) ─────────────────────────────
  const dadosPorSetor = useMemo(() => {
    const mapa: Record<string, number> = {};
    rowsFiltrados.forEach(r => { mapa[r.sector_nome] = (mapa[r.sector_nome] ?? 0) + r.valor_cobrado_cliente; });
    return Object.entries(mapa).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([nome, valor]) => ({ nome, valor }));
  }, [rowsFiltrados]);

  // ── KPI cards (existentes) ─────────────────────────────────────────────────
  const cards = [
    { label: 'Plantões no mês',       value: kpi.totalPlantoes,          icon: ListChecks, color: 'text-primary', bg: 'bg-primary-soft' },
    { label: 'Faturamento previsto',   value: formatCurrency(kpi.faturamento), icon: Wallet,     color: 'text-accent',   bg: 'bg-accent-soft' },
    { label: 'Repasse aos cooperados', value: formatCurrency(kpi.repasse),    icon: HandCoins,  color: 'text-success',  bg: 'bg-success/10' },
    { label: 'Lançamentos pendentes',  value: kpi.pendentes,              icon: Clock,      color: 'text-warning',  bg: 'bg-warning/10' },
  ];

  const tooltipStyle = { backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 12 };

  return (
    <div className="space-y-6">
      {/* Cabeçalho existente */}
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
          {/* KPI cards existentes */}
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

          {/* ── SEÇÃO DE GRÁFICOS ── */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="text-lg font-bold">Faturamento — Análise Gráfica</h2>
              {/* Filtros dos gráficos */}
              <div className="flex flex-wrap gap-3 items-end">
                {/* Atalhos rápidos */}
                <div>
                  <Label className="text-xs block mb-1">Atalho</Label>
                  <div className="flex gap-1">
                    {[3, 6, 12].map(m => (
                      <Button key={m} size="sm" variant="outline" className="h-9 px-2.5 text-xs"
                        onClick={() => aplicarAtalho(m)}>
                        {m}m
                      </Button>
                    ))}
                  </div>
                </div>
                {/* De */}
                <div>
                  <Label className="text-xs">De</Label>
                  <input
                    type="month"
                    value={periodoInicio}
                    max={periodoFim}
                    onChange={e => setPeriodoInicio(e.target.value)}
                    className="flex h-9 w-36 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                {/* Até */}
                <div>
                  <Label className="text-xs">Até</Label>
                  <input
                    type="month"
                    value={periodoFim}
                    min={periodoInicio}
                    max={mesAtual}
                    onChange={e => setPeriodoFim(e.target.value)}
                    className="flex h-9 w-36 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                {/* Cliente */}
                <div className="min-w-[170px]">
                  <Label className="text-xs">Cliente</Label>
                  <Select value={filtroHospital} onValueChange={v => { setFiltroHospital(v); setFiltroSetor('__todos__'); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__todos__">Todos os clientes</SelectItem>
                      {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {/* Setor */}
                <div className="min-w-[170px]">
                  <Label className="text-xs">Setor</Label>
                  <Select value={filtroSetor} onValueChange={setFiltroSetor} disabled={setoresFiltro.length === 0}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__todos__">Todos os setores</SelectItem>
                      {setoresFiltro.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {loadingChart ? (
              <div className="p-10 text-center text-sm text-muted-foreground">Carregando gráficos…</div>
            ) : (
              <div className="space-y-5">

                {/* Gráfico 1 — Faturamento mensal (linha + barra) */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Faturamento Mensal</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={dadosMensais} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} width={70} />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v: number, name: string) => [formatCurrency(v), name]}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="faturamento" name="Faturamento Cliente" fill={NAVY} radius={[3,3,0,0]} />
                        <Bar dataKey="repasse"     name="Repasse Cooperado"  fill={GREEN} radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <div className="grid md:grid-cols-2 gap-5">

                  {/* Gráfico 2 — Por cliente (pizza) */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Faturamento por Cliente</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {dadosPorCliente.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-10">Sem dados no período.</p>
                      ) : (
                        <ResponsiveContainer width="100%" height={260}>
                          <PieChart>
                            <Pie
                              data={dadosPorCliente}
                              dataKey="valor"
                              nameKey="nome"
                              cx="50%"
                              cy="50%"
                              outerRadius={90}
                              label={({ nome, percent }) => `${nome.length > 14 ? nome.slice(0,13)+'…' : nome} ${(percent * 100).toFixed(0)}%`}
                              labelLine={true}
                            >
                              {dadosPorCliente.map((_, i) => (
                                <Cell key={i} fill={CORES_PIZZA[i % CORES_PIZZA.length]} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={tooltipStyle}
                              formatter={(v: number) => [formatCurrency(v), 'Faturamento']}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>

                  {/* Gráfico 3 — Por setor (barras horizontais) */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Faturamento por Setor (top 10)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {dadosPorSetor.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-10">Sem dados no período.</p>
                      ) : (
                        <ResponsiveContainer width="100%" height={260}>
                          <BarChart
                            data={dadosPorSetor}
                            layout="vertical"
                            margin={{ top: 4, right: 60, left: 4, bottom: 4 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                            <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 10 }} />
                            <YAxis
                              type="category"
                              dataKey="nome"
                              width={110}
                              tick={{ fontSize: 10 }}
                              tickFormatter={v => v.length > 16 ? v.slice(0, 15) + '…' : v}
                            />
                            <Tooltip
                              contentStyle={tooltipStyle}
                              formatter={(v: number) => [formatCurrency(v), 'Faturamento']}
                            />
                            <Bar dataKey="valor" name="Faturamento" fill={BLUE} radius={[0,3,3,0]}
                              label={{ position: 'right', formatter: (v: number) => fmtK(v), fontSize: 10 }}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Gráfico 4 — Evolução repasse (linha) */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Evolução Mensal — Faturamento vs Repasse</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={dadosMensais} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={fmtK} tick={{ fontSize: 11 }} width={70} />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v: number, name: string) => [formatCurrency(v), name]}
                        />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Line type="monotone" dataKey="faturamento" name="Faturamento" stroke={NAVY}  strokeWidth={2} dot={{ r: 4 }} />
                        <Line type="monotone" dataKey="repasse"     name="Repasse"     stroke={GREEN} strokeWidth={2} dot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

              </div>
            )}
          </div>

          {/* Tabela de lançamentos recentes — existente */}
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
