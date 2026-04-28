import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, FileText } from 'lucide-react';
import { formatCurrency, profissaoLabel, tipoPlantaoLabel } from '@/lib/format';
import { PeriodoPicker } from '@/components/PeriodoPicker';
import { calcPeriodo, periodoInicial, PeriodoState } from '@/lib/periodo';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface LancRow {
  id: string; data_plantao: string; total_horas: number;
  profissao: string; tipo_plantao: string;
  valor_cobrado_cliente: number; valor_repasse_cooperado: number;
  cooperados: { id: string; nome: string } | null;
  hospitals: { id: string; nome: string } | null;
  sectors: { id: string; nome: string } | null;
}
interface Hospital { id: string; nome: string; }
interface Sector { id: string; nome: string; hospital_id: string; }
interface Cooperado { id: string; nome: string; }

const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtDate = (s: string) => s.split('-').reverse().join('/');

function gerarPDFFechamento(rows: LancRow[], periodoLabel: string, aba: 'cobranca' | 'repasse', grupoNome: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const titulo = aba === 'cobranca' ? 'Cobrança ao Cliente' : 'Repasse ao Cooperado';
  const valorKey = aba === 'cobranca' ? 'valor_cobrado_cliente' : 'valor_repasse_cooperado';

  doc.setFillColor(31, 41, 99);
  doc.rect(0, 0, W, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('CADES Financeiro', 14, 11);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(`${titulo} — ${periodoLabel}`, 14, 18);
  if (grupoNome) doc.text(grupoNome, 14, 23.5);
  doc.text(new Date().toLocaleDateString('pt-BR'), W - 14, 18, { align: 'right' });

  const totalHoras = rows.reduce((s, r) => s + Number(r.total_horas), 0);
  const totalValor = rows.reduce((s, r) => s + Number(r[valorKey as keyof LancRow] as number), 0);

  const kpis = [
    { label: 'Plantões', value: String(rows.length) },
    { label: 'Total horas', value: `${totalHoras.toFixed(1)}h` },
    { label: aba === 'cobranca' ? 'Total a cobrar' : 'Total a repassar', value: fmt(totalValor) },
  ];
  const kpiW = (W - 28) / kpis.length;
  kpis.forEach((k, i) => {
    const x = 14 + i * kpiW;
    doc.setFillColor(248, 249, 252);
    doc.roundedRect(x, 30, kpiW - 3, 16, 2, 2, 'F');
    doc.setTextColor(100, 110, 130); doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(k.label.toUpperCase(), x + 4, 36);
    doc.setTextColor(31, 41, 99); doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.text(k.value, x + 4, 43);
  });

  const byGroup: Record<string, LancRow[]> = {};
  rows.forEach(r => {
    const k = aba === 'cobranca'
      ? (r.cooperados?.nome ?? 'Sem cooperado')
      : (r.hospitals?.nome ?? 'Sem hospital');
    if (!byGroup[k]) byGroup[k] = [];
    byGroup[k].push(r);
  });

  let startY = 52;
  Object.entries(byGroup).sort((a, b) => a[0].localeCompare(b[0])).forEach(([nome, lancs]) => {
    const sub = lancs.reduce((s, r) => s + Number(r[valorKey as keyof LancRow] as number), 0);
    const horas = lancs.reduce((s, r) => s + Number(r.total_horas), 0);
    if (startY > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); startY = 14; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(31, 41, 99);
    doc.text(nome, 14, startY);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100);
    doc.text(`${lancs.length} plantões | ${horas.toFixed(1)}h | ${fmt(sub)}`, 14, startY + 4);
    startY += 8;

    autoTable(doc, {
      startY,
      head: [['Data', 'Setor', 'Tipo', 'Horas', aba === 'cobranca' ? 'Valor Cliente' : 'Valor Cooperado']],
      body: lancs.map(r => [
        fmtDate(r.data_plantao),
        r.sectors?.nome ?? '—',
        tipoPlantaoLabel[r.tipo_plantao] ?? r.tipo_plantao,
        Number(r.total_horas).toFixed(2) + 'h',
        fmt(Number(r[valorKey as keyof LancRow] as number)),
      ]),
      foot: [[{ content: `Subtotal ${nome}`, colSpan: 4, styles: { halign: 'right' } }, fmt(sub)]],
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [31, 41, 99], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 242, 255], textColor: [31, 41, 99], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      margin: { left: 14, right: 14 },
    });
    startY = (doc as any).lastAutoTable.finalY + 8;
  });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const H = doc.internal.pageSize.getHeight();
    doc.setFillColor(31, 41, 99);
    doc.rect(0, H - 9, W, 9, 'F');
    doc.setTextColor(200, 210, 255); doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text('CADES Financeiro — Confidencial', 14, H - 3);
    doc.text(`Página ${i} de ${totalPages}`, W - 14, H - 3, { align: 'right' });
  }

  doc.save(`fechamento_${aba}_${periodoLabel.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
}

function exportCSV(rows: LancRow[], aba: 'cobranca' | 'repasse', periodoLabel: string) {
  const valorKey = aba === 'cobranca' ? 'valor_cobrado_cliente' : 'valor_repasse_cooperado';
  const header = ['Data', 'Cooperado', 'Hospital', 'Setor', 'Horas', 'Tipo', aba === 'cobranca' ? 'Valor Cliente' : 'Valor Cooperado'];
  const lines = rows.map(r => [
    fmtDate(r.data_plantao), r.cooperados?.nome ?? '', r.hospitals?.nome ?? '', r.sectors?.nome ?? '',
    Number(r.total_horas).toFixed(2), tipoPlantaoLabel[r.tipo_plantao] ?? r.tipo_plantao,
    Number(r[valorKey as keyof LancRow] as number).toFixed(2),
  ].map(v => `"${v}"`).join(';'));
  const csv = [header.join(';'), ...lines].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `fechamento_${aba}_${periodoLabel.replace(/[^a-zA-Z0-9]/g, '_')}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast.success('CSV exportado');
}

// ─── Componente de tabela por grupo ───────────────────────────────────────────
function TabelaGrupos({
  grupos,
  valorKey,
  grupoLabel,
  subGrupoLabel,
}: {
  grupos: [string, LancRow[]][];
  valorKey: 'valor_cobrado_cliente' | 'valor_repasse_cooperado';
  grupoLabel: string;
  subGrupoLabel: (r: LancRow) => string;
}) {
  const totalGeral = grupos.reduce((s, [, rs]) => s + rs.reduce((ss, r) => ss + Number(r[valorKey]), 0), 0);
  const horasGeral = grupos.reduce((s, [, rs]) => s + rs.reduce((ss, r) => ss + Number(r.total_horas), 0), 0);
  const qtdGeral = grupos.reduce((s, [, rs]) => s + rs.length, 0);

  return (
    <div className="space-y-6">
      {grupos.map(([nome, lancs]) => {
        const subtotal = lancs.reduce((s, r) => s + Number(r[valorKey]), 0);
        const horas = lancs.reduce((s, r) => s + Number(r.total_horas), 0);
        return (
          <div key={nome} className="rounded-lg border">
            <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
              <div>
                <span className="font-semibold text-sm">{nome}</span>
                <span className="ml-3 text-xs text-muted-foreground">{lancs.length} plantão{lancs.length !== 1 ? 'ões' : ''} · {horas.toFixed(1)}h</span>
              </div>
              <span className="font-semibold tabular-nums text-sm">{formatCurrency(subtotal)}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase tracking-wider bg-muted/10">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Data</th>
                  <th className="text-left px-4 py-2.5 font-medium">{grupoLabel}</th>
                  <th className="text-left px-4 py-2.5 font-medium">Setor</th>
                  <th className="text-right px-4 py-2.5 font-medium">Horas</th>
                  <th className="text-right px-4 py-2.5 font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {lancs.map((r, i) => (
                  <tr key={r.id} className={i % 2 === 0 ? 'bg-white' : 'bg-muted/10'}>
                    <td className="px-4 py-3 tabular-nums">{fmtDate(r.data_plantao)}</td>
                    <td className="px-4 py-3">{subGrupoLabel(r)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.sectors?.nome ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Number(r.total_horas).toFixed(2)}h</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(Number(r[valorKey]))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-primary/20 bg-primary/5">
                  <td colSpan={3} className="px-4 py-2.5 text-right text-xs font-semibold text-primary uppercase tracking-wider">Subtotal</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs font-semibold text-primary">{horas.toFixed(1)}h</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-primary">{formatCurrency(subtotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}

      {/* Total geral */}
      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between">
        <div className="font-bold text-primary">
          Total geral
          <span className="ml-2 text-sm font-normal text-primary/70">{qtdGeral} plantões · {horasGeral.toFixed(1)}h</span>
        </div>
        <span className="text-xl font-bold tabular-nums text-primary">{formatCurrency(totalGeral)}</span>
      </div>
    </div>
  );
}

// ─── Aba Cobrança ─────────────────────────────────────────────────────────────
function AbaCobranca({ rows, hospitals, sectors, cooperados, periodoLabel }: {
  rows: LancRow[]; hospitals: Hospital[]; sectors: Sector[]; cooperados: Cooperado[]; periodoLabel: string;
}) {
  const [filterHospital, setFilterHospital] = useState('all');
  const [filterCooperado, setFilterCooperado] = useState('all');
  const [filterSetor, setFilterSetor] = useState('all');

  const setoresFiltrados = filterHospital === 'all' ? sectors : sectors.filter(s => s.hospital_id === filterHospital);

  const filtered = useMemo(() => rows.filter(r => {
    if (filterHospital !== 'all' && r.hospitals?.id !== filterHospital) return false;
    if (filterCooperado !== 'all' && r.cooperados?.id !== filterCooperado) return false;
    if (filterSetor !== 'all' && r.sectors?.id !== filterSetor) return false;
    return true;
  }), [rows, filterHospital, filterCooperado, filterSetor]);

  // Agrupamento inteligente: se filtra por hospital → agrupa por cooperado; senão → agrupa por hospital
  const grupos = useMemo(() => {
    const map: Record<string, LancRow[]> = {};
    filtered.forEach(r => {
      const k = filterHospital !== 'all'
        ? (r.cooperados?.nome ?? 'Sem cooperado')
        : (r.hospitals?.nome ?? 'Sem hospital');
      if (!map[k]) map[k] = [];
      map[k].push(r);
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, filterHospital]);

  const grupoNome = filterHospital !== 'all' ? hospitals.find(h => h.id === filterHospital)?.nome ?? '' : '';

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <Card>
        <CardContent className="p-4 grid gap-3 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Cliente</Label>
            <Select value={filterHospital} onValueChange={v => { setFilterHospital(v); setFilterSetor('all'); }}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os clientes</SelectItem>
                {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Cooperado</Label>
            <Select value={filterCooperado} onValueChange={setFilterCooperado}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os cooperados</SelectItem>
                {cooperados.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Setor</Label>
            <Select value={filterSetor} onValueChange={setFilterSetor}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os setores</SelectItem>
                {setoresFiltrados.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Plantões', value: filtered.length },
          { label: 'Total horas', value: `${filtered.reduce((s, r) => s + Number(r.total_horas), 0).toFixed(1)}h` },
          { label: 'Total a cobrar', value: formatCurrency(filtered.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0)) },
        ].map(c => (
          <Card key={c.label}><CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</p>
            <p className="text-lg font-bold tabular-nums mt-0.5">{c.value}</p>
          </CardContent></Card>
        ))}
      </div>

      {/* Botões de exportação */}
      {filtered.length > 0 && (
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" className="gap-2"
            onClick={() => gerarPDFFechamento(filtered, periodoLabel, 'cobranca', grupoNome)}>
            <FileText className="h-4 w-4" /> PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-2"
            onClick={() => exportCSV(filtered, 'cobranca', periodoLabel)}>
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      )}

      {/* Tabela */}
      {filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
          Nenhum lançamento para os filtros selecionados.
        </CardContent></Card>
      ) : (
        <TabelaGrupos
          grupos={grupos}
          valorKey="valor_cobrado_cliente"
          grupoLabel={filterHospital !== 'all' ? 'Cooperado' : 'Hospital'}
          subGrupoLabel={r => filterHospital !== 'all' ? (r.cooperados?.nome ?? '—') : (r.hospitals?.nome ?? '—')}
        />
      )}
    </div>
  );
}

// ─── Aba Repasse ──────────────────────────────────────────────────────────────
function AbaRepasse({ rows, sectors, cooperados, periodoLabel }: {
  rows: LancRow[]; sectors: Sector[]; cooperados: Cooperado[]; periodoLabel: string;
}) {
  const [filterCooperado, setFilterCooperado] = useState('all');
  const [filterSetor, setFilterSetor] = useState('all');

  const filtered = useMemo(() => rows.filter(r => {
    if (filterCooperado !== 'all' && r.cooperados?.id !== filterCooperado) return false;
    if (filterSetor !== 'all' && r.sectors?.id !== filterSetor) return false;
    return true;
  }), [rows, filterCooperado, filterSetor]);

  // Agrupa por cooperado → dentro, por hospital
  const grupos = useMemo(() => {
    if (filterCooperado !== 'all') {
      // cooperado específico → agrupar por hospital
      const map: Record<string, LancRow[]> = {};
      filtered.forEach(r => {
        const k = r.hospitals?.nome ?? 'Sem hospital';
        if (!map[k]) map[k] = [];
        map[k].push(r);
      });
      return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
    }
    // todos → agrupar por cooperado
    const map: Record<string, LancRow[]> = {};
    filtered.forEach(r => {
      const k = r.cooperados?.nome ?? 'Sem cooperado';
      if (!map[k]) map[k] = [];
      map[k].push(r);
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, filterCooperado]);

  const coopNome = cooperados.find(c => c.id === filterCooperado)?.nome ?? '';

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-4 grid gap-3 sm:grid-cols-3">
          <div>
            <Label className="text-xs">Cooperado</Label>
            <Select value={filterCooperado} onValueChange={setFilterCooperado}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os cooperados</SelectItem>
                {cooperados.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Setor</Label>
            <Select value={filterSetor} onValueChange={setFilterSetor}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os setores</SelectItem>
                {sectors.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <div className="text-sm text-muted-foreground self-end pb-1">
              {filtered.length} lançamento{filtered.length !== 1 ? 's' : ''}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Plantões', value: filtered.length },
          { label: 'Total horas', value: `${filtered.reduce((s, r) => s + Number(r.total_horas), 0).toFixed(1)}h` },
          { label: 'Total a repassar', value: formatCurrency(filtered.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0)) },
        ].map(c => (
          <Card key={c.label}><CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</p>
            <p className="text-lg font-bold tabular-nums text-accent mt-0.5">{c.value}</p>
          </CardContent></Card>
        ))}
      </div>

      {filtered.length > 0 && (
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" className="gap-2"
            onClick={() => gerarPDFFechamento(filtered, periodoLabel, 'repasse', coopNome)}>
            <FileText className="h-4 w-4" /> PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-2"
            onClick={() => exportCSV(filtered, 'repasse', periodoLabel)}>
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">
          Nenhum lançamento para os filtros selecionados.
        </CardContent></Card>
      ) : (
        <TabelaGrupos
          grupos={grupos}
          valorKey="valor_repasse_cooperado"
          grupoLabel={filterCooperado !== 'all' ? 'Hospital' : 'Cooperado'}
          subGrupoLabel={r => filterCooperado !== 'all' ? (r.hospitals?.nome ?? '—') : (r.cooperados?.nome ?? '—')}
        />
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function Fechamento() {
  const [periodo, setPeriodo] = useState<PeriodoState>(periodoInicial());
  const [rows, setRows] = useState<LancRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [cooperados, setCooperados] = useState<Cooperado[]>([]);

  const periodoCalc = calcPeriodo(periodo);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('lancamentos_plantoes')
      .select('id, data_plantao, total_horas, profissao, tipo_plantao, valor_cobrado_cliente, valor_repasse_cooperado, cooperados(id, nome), hospitals(id, nome), sectors(id, nome)')
      .gte('data_plantao', periodoCalc.inicio)
      .lte('data_plantao', periodoCalc.fim)
      .order('data_plantao', { ascending: true })
      .limit(5000);
    setRows((data ?? []) as unknown as LancRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [periodoCalc.inicio, periodoCalc.fim]);

  useEffect(() => {
    supabase.from('hospitals').select('id, nome').order('nome').then(({ data }) => setHospitals(data ?? []));
    supabase.from('sectors').select('id, nome, hospital_id').order('nome').then(({ data }) => setSectors(data ?? []));
    supabase.from('cooperados').select('id, nome').order('nome').then(({ data }) => setCooperados(data ?? []));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Fechamento Mensal</h1>
          <p className="text-sm text-muted-foreground">Cobrança ao cliente e repasse aos cooperados</p>
        </div>
        <div className="w-64">
          <PeriodoPicker value={periodo} onChange={setPeriodo} />
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <Tabs defaultValue="cobranca">
          <TabsList>
            <TabsTrigger value="cobranca">Cobrança ao Cliente</TabsTrigger>
            <TabsTrigger value="repasse">Repasse ao Cooperado</TabsTrigger>
          </TabsList>
          <TabsContent value="cobranca" className="mt-4">
            <AbaCobranca rows={rows} hospitals={hospitals} sectors={sectors} cooperados={cooperados} periodoLabel={periodoCalc.label} />
          </TabsContent>
          <TabsContent value="repasse" className="mt-4">
            <AbaRepasse rows={rows} sectors={sectors} cooperados={cooperados} periodoLabel={periodoCalc.label} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
