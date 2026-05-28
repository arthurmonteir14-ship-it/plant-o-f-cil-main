import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/format';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { Printer, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const NAVY  = '#1a2f5a';
const GREEN = '#16a34a';
const BLUE  = '#2563eb';
const CORES = ['#1a2f5a','#2563eb','#16a34a','#d97706','#dc2626','#7c3aed','#0891b2','#be185d','#059669','#b45309'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

interface KpiData    { total_plantoes: number; faturamento: number; repasse: number; }
interface ClienteRow { hospital_id: string; nome: string; faturamento: number; repasse: number; }

const fmtK = (v: number) => v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : formatCurrency(v);

function labelPeriodo(inicio: string, fim: string) {
  const [anoI, mesI] = inicio.split('-').map(Number);
  const [anoF, mesF] = fim.split('-').map(Number);
  if (inicio === fim) return `${MESES[mesI - 1]} de ${anoI}`;
  if (anoI === anoF)  return `${MESES[mesI - 1]} a ${MESES[mesF - 1]} de ${anoI}`;
  return `${MESES[mesI - 1]}/${anoI} a ${MESES[mesF - 1]}/${anoF}`;
}

export default function RelatorioFaturamento() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

  const [inicio, setInicio] = useState(searchParams.get('inicio') ?? mesAtual);
  const [fim,    setFim]    = useState(searchParams.get('fim')    ?? mesAtual);

  const [kpi,      setKpi]      = useState<KpiData | null>(null);
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const inicioDate = `${inicio}-01`;
      const [anoF, mesF] = fim.split('-').map(Number);
      const fimDate = new Date(anoF, mesF, 0).toISOString().slice(0, 10);

      const [{ data: kpiData }, { data: clienteData }] = await Promise.all([
        supabase.rpc('dashboard_kpi',        { p_inicio: inicioDate, p_fim: fimDate }),
        supabase.rpc('relatorio_por_cliente', { p_inicio: inicioDate, p_fim: fimDate }),
      ]);

      const k = kpiData?.[0];
      setKpi(k ? {
        total_plantoes: Number(k.total_plantoes),
        faturamento:    Number(k.faturamento),
        repasse:        Number(k.repasse),
      } : null);
      setClientes((clienteData ?? []).map((c: any) => ({
        hospital_id: c.hospital_id,
        nome:        c.nome,
        faturamento: Number(c.faturamento),
        repasse:     Number(c.repasse),
      })));
      setLoading(false);
    })();
  }, [inicio, fim]);

  const margem     = (kpi?.faturamento ?? 0) - (kpi?.repasse ?? 0);
  const pctRepasse = kpi?.faturamento ? (kpi.repasse / kpi.faturamento) * 100 : 0;

  const clientesComMargem = useMemo(() =>
    clientes.map(c => ({
      ...c,
      margem:     c.faturamento - c.repasse,
      pctRepasse: c.faturamento > 0 ? (c.repasse / c.faturamento) * 100 : 0,
    })),
  [clientes]);

  const analise = useMemo(() => {
    if (!kpi || clientes.length === 0) return [];
    const sorted     = [...clientesComMargem].sort((a, b) => b.faturamento - a.faturamento);
    const maiorFat   = sorted[0];
    const maiorMarg  = [...clientesComMargem].sort((a, b) => b.margem - a.margem)[0];
    const maiorPct   = [...clientesComMargem].sort((a, b) => b.pctRepasse - a.pctRepasse)[0];
    const alertas    = clientesComMargem.filter(c => c.pctRepasse > 80);

    const frases: string[] = [
      `No período analisado, o faturamento total foi de ${formatCurrency(kpi.faturamento)}, com repasse de ${formatCurrency(kpi.repasse)} aos cooperados, resultando em margem operacional de ${formatCurrency(margem)} (${pctRepasse.toFixed(1)}% de repasse sobre o faturamento).`,
    ];
    if (maiorFat)  frases.push(`O cliente com maior volume foi ${maiorFat.nome}, representando ${kpi.faturamento > 0 ? ((maiorFat.faturamento / kpi.faturamento) * 100).toFixed(1) : 0}% do faturamento total (${formatCurrency(maiorFat.faturamento)}).`);
    if (maiorMarg) frases.push(`A maior margem operacional foi registrada em ${maiorMarg.nome}, com ${formatCurrency(maiorMarg.margem)} de diferença entre faturado e repassado.`);
    if (maiorPct)  frases.push(`O maior percentual de repasse foi de ${maiorPct.pctRepasse.toFixed(1)}%, referente ao cliente ${maiorPct.nome}.`);
    return frases;
  }, [kpi, clientes, clientesComMargem, margem, pctRepasse]);

  const periodo  = labelPeriodo(inicio, fim);
  const dataGer  = hoje.toLocaleDateString('pt-BR');

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @page { margin: 12mm; size: A4; }
          .break-avoid { break-inside: avoid; }
        }
      `}</style>

      {/* Barra de controles — oculta na impressão */}
      <div className="no-print sticky top-0 z-10 bg-slate-50 border-b px-6 py-3 flex flex-wrap items-center gap-4 shadow-sm">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <div className="flex items-center gap-2">
          <Label className="text-xs">De</Label>
          <input type="month" value={inicio} max={fim}
            onChange={e => setInicio(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-3 text-sm shadow-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Até</Label>
          <input type="month" value={fim} min={inicio} max={mesAtual}
            onChange={e => setFim(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-3 text-sm shadow-sm" />
        </div>
        <Button size="sm" className="gap-1.5 ml-auto" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Imprimir
        </Button>
      </div>

      {/* Corpo do relatório */}
      <div className="max-w-5xl mx-auto px-8 py-8 bg-white min-h-screen">

        {/* Cabeçalho */}
        <div className="flex items-center justify-between pb-6 mb-8 border-b-2" style={{ borderColor: NAVY }}>
          <img src="/cades-logo.png" alt="CADES" className="h-20 object-contain" />
          <div className="text-right">
            <h2 className="text-xl font-bold" style={{ color: NAVY }}>Análise de Faturamento</h2>
            <p className="text-sm text-gray-600 mt-1">Período: <strong>{periodo}</strong></p>
            <p className="text-xs text-gray-400 mt-0.5">Gerado em: {dataGer}</p>
          </div>
        </div>

        {loading ? (
          <div className="no-print py-24 text-center text-gray-400">Carregando dados…</div>
        ) : (
          <>
            {/* Seção 1 — KPIs */}
            <section className="mb-10 break-avoid">
              <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: NAVY }}>
                Indicadores Gerais
              </h3>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'Total Faturado',      value: formatCurrency(kpi?.faturamento ?? 0), color: NAVY  },
                  { label: 'Total Repassado',     value: formatCurrency(kpi?.repasse     ?? 0), color: GREEN },
                  { label: 'Margem Operacional',  value: formatCurrency(margem),                color: BLUE  },
                  { label: '% de Repasse',        value: `${pctRepasse.toFixed(1)}%`,           color: '#d97706' },
                ].map(card => (
                  <div key={card.label} className="rounded-xl border p-4" style={{ borderColor: '#e5e7eb' }}>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{card.label}</p>
                    <p className="text-xl font-bold tabular-nums mt-1" style={{ color: card.color }}>{card.value}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Total de plantões lançados no período: <strong>{kpi?.total_plantoes ?? 0}</strong>
              </p>
            </section>

            {/* Seção 2 — Tabela por cliente */}
            <section className="mb-10 break-avoid">
              <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: NAVY }}>
                Faturamento por Cliente
              </h3>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr style={{ backgroundColor: NAVY, color: 'white' }}>
                    <th className="text-left px-4 py-2.5 font-semibold">Cliente</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Valor Faturado</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Valor Repassado</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Margem</th>
                    <th className="text-right px-4 py-2.5 font-semibold">% Repasse</th>
                  </tr>
                </thead>
                <tbody>
                  {clientesComMargem.map((c, i) => (
                    <tr key={c.hospital_id} style={{ backgroundColor: i % 2 === 0 ? '#f8f9fc' : 'white' }}>
                      <td className="px-4 py-2.5 font-medium">{c.nome}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(c.faturamento)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: GREEN }}>{formatCurrency(c.repasse)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: BLUE }}>{formatCurrency(c.margem)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold"
                        style={{ color: c.pctRepasse > 80 ? '#dc2626' : '#374151' }}>
                        {c.pctRepasse.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                  <tr style={{ backgroundColor: NAVY, color: 'white', fontWeight: 700 }}>
                    <td className="px-4 py-2.5">TOTAL GERAL</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(kpi?.faturamento ?? 0)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(kpi?.repasse ?? 0)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(margem)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{pctRepasse.toFixed(1)}%</td>
                  </tr>
                </tbody>
              </table>
            </section>

            {/* Seção 3 — Gráficos */}
            {clientesComMargem.length > 0 && (
              <section className="mb-10 break-avoid">
                <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: NAVY }}>
                  Análise Gráfica
                </h3>
                <div className="grid grid-cols-2 gap-8">
                  {/* Barras */}
                  <div>
                    <p className="text-xs text-gray-500 font-semibold mb-3">Faturado vs Repassado por Cliente</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={clientesComMargem} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="nome" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                        <YAxis tickFormatter={fmtK} tick={{ fontSize: 9 }} width={65} />
                        <Tooltip
                          formatter={(v: number, n: string) => [formatCurrency(v), n]}
                          contentStyle={{ fontSize: 11, borderRadius: 6 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="faturamento" name="Faturado"   fill={NAVY}  radius={[3,3,0,0]} />
                        <Bar dataKey="repasse"      name="Repassado" fill={GREEN} radius={[3,3,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Pizza */}
                  <div>
                    <p className="text-xs text-gray-500 font-semibold mb-3">Distribuição do Faturamento (%)</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={clientesComMargem}
                          dataKey="faturamento"
                          nameKey="nome"
                          cx="50%" cy="45%"
                          outerRadius={80} innerRadius={35}
                          label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {clientesComMargem.map((_, i) => (
                            <Cell key={i} fill={CORES[i % CORES.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v: number) => [formatCurrency(v), 'Faturamento']}
                          contentStyle={{ fontSize: 11, borderRadius: 6 }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: 10 }}
                          formatter={v => v.length > 22 ? v.slice(0, 21) + '…' : v}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </section>
            )}

            {/* Seção 4 — Análise automática */}
            <section className="break-avoid">
              <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: NAVY }}>
                Análise e Observações
              </h3>
              <div className="rounded-xl p-5 text-sm leading-relaxed space-y-3"
                style={{ backgroundColor: '#f8f9fc', borderLeft: `4px solid ${NAVY}` }}>
                {analise.map((texto, i) => (
                  <p key={i} style={{ color: '#374151' }}>
                    {texto}
                  </p>
                ))}
                {analise.length === 0 && (
                  <p className="text-gray-400 italic">Sem dados suficientes para análise.</p>
                )}
              </div>
              <p className="text-[10px] text-gray-400 mt-6 text-center">
                Documento gerado automaticamente pelo sistema CADES Financeiro — Confidencial
              </p>
            </section>
          </>
        )}
      </div>
    </>
  );
}
