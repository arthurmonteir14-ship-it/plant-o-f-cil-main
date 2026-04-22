import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, FileBarChart2, FileText, TrendingUp, Users } from 'lucide-react';
import { formatCurrency, profissaoLabel, tipoPlantaoLabel } from '@/lib/format';
import { PeriodoPicker } from '@/components/PeriodoPicker';
import { calcPeriodo, periodoInicial, PeriodoState } from '@/lib/periodo';
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

type TipoRelatorio = 'faturamento' | 'repasse';

const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function downloadCSVFaturamento(rows: LancRow[]) {
  const header = ['Data', 'Cooperado', 'Profissão', 'Tipo', 'Cliente', 'Setor', 'Horas', 'Valor Cliente'];
  const lines = rows.map(r => [
    r.data_plantao, r.cooperados?.nome ?? '', profissaoLabel[r.profissao] ?? r.profissao,
    tipoPlantaoLabel[r.tipo_plantao] ?? r.tipo_plantao, r.hospitals?.nome ?? '', r.sectors?.nome ?? '',
    Number(r.total_horas).toFixed(2), Number(r.valor_cobrado_cliente).toFixed(2),
  ].map(v => `"${v}"`).join(';'));
  const csv = [header.join(';'), ...lines].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'relatorio_faturamento.csv'; a.click();
  URL.revokeObjectURL(url);
}

function downloadCSVRepasse(rows: LancRow[]) {
  const header = ['Data', 'Cooperado', 'Profissão', 'Tipo', 'Cliente', 'Setor', 'Horas', 'Repasse Cooperado'];
  const lines = rows.map(r => [
    r.data_plantao, r.cooperados?.nome ?? '', profissaoLabel[r.profissao] ?? r.profissao,
    tipoPlantaoLabel[r.tipo_plantao] ?? r.tipo_plantao, r.hospitals?.nome ?? '', r.sectors?.nome ?? '',
    Number(r.total_horas).toFixed(2), Number(r.valor_repasse_cooperado).toFixed(2),
  ].map(v => `"${v}"`).join(';'));
  const csv = [header.join(';'), ...lines].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'relatorio_repasse.csv'; a.click();
  URL.revokeObjectURL(url);
}

function gerarPDFHeader(doc: jsPDF, titulo: string, subtitulo: string, periodoLabel: string, filtros: Record<string, string>) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(31, 41, 99);
  doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text('CADES Financeiro', 14, 12);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(titulo, 14, 19);
  doc.text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}`, W - 14, 12, { align: 'right' });
  doc.text(`Período: ${periodoLabel}`, W - 14, 19, { align: 'right' });
  const filtroTexto = [
    filtros.cooperado && `Cooperado: ${filtros.cooperado}`,
    filtros.hospital && `Cliente: ${filtros.hospital}`,
    filtros.setor && `Setor: ${filtros.setor}`,
  ].filter(Boolean).join('  ');
  if (filtroTexto) {
    doc.setFontSize(8); doc.setTextColor(200, 210, 255);
    doc.text(filtroTexto, 14, 25);
  }
  doc.setFontSize(8); doc.setTextColor(200, 210, 255);
  if (!filtroTexto) doc.text(subtitulo, 14, 25);
}

function gerarPDFFooter(doc: jsPDF) {
  const W = doc.internal.pageSize.getWidth();
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const H = doc.internal.pageSize.getHeight();
    doc.setFillColor(31, 41, 99);
    doc.rect(0, H - 10, W, 10, 'F');
    doc.setTextColor(200, 210, 255); doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text('Documento gerado automaticamente pelo sistema CADES Financeiro — Confidencial', 14, H - 3.5);
    doc.text(`Página ${i} de ${totalPages}`, W - 14, H - 3.5, { align: 'right' });
  }
}

function gerarPDFFaturamento(rows: LancRow[], periodoLabel: string, filtros: Record<string, string>) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  gerarPDFHeader(doc, 'Relatório de Faturamento', 'Valores cobrados ao cliente', periodoLabel, filtros);

  const totalHoras = rows.reduce((s, r) => s + Number(r.total_horas), 0);
  const totalCliente = rows.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0);

  const kpis = [
    { label: 'Total Plantões', value: String(rows.length) },
    { label: 'Total Horas', value: `${totalHoras.toFixed(1)}h` },
    { label: 'Total Faturado', value: fmtBRL(totalCliente) },
  ];
  const kpiW = (W - 28) / kpis.length;
  kpis.forEach((k, i) => {
    const x = 14 + i * kpiW;
    doc.setFillColor(248, 249, 252);
    doc.roundedRect(x, 32, kpiW - 3, 18, 2, 2, 'F');
    doc.setTextColor(100, 110, 130); doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(k.label.toUpperCase(), x + 4, 38);
    doc.setTextColor(31, 41, 99); doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.text(k.value, x + 4, 46);
  });

  const byHospital: Record<string, LancRow[]> = {};
  rows.forEach(r => {
    const k = r.hospitals?.nome ?? 'Sem cliente';
    if (!byHospital[k]) byHospital[k] = [];
    byHospital[k].push(r);
  });

  let startY = 56;
  Object.entries(byHospital).sort((a, b) => a[0].localeCompare(b[0])).forEach(([nome, lancs]) => {
    const subC = lancs.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0);
    if (startY > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); startY = 14; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(31, 41, 99);
    doc.text(nome, 14, startY);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100);
    doc.text(`${lancs.length} plantões | ${lancs.reduce((s, r) => s + Number(r.total_horas), 0).toFixed(1)}h | Total: ${fmtBRL(subC)}`, 14, startY + 4);
    startY += 8;
    autoTable(doc, {
      startY,
      head: [['Data', 'Cooperado', 'Profissão', 'Setor', 'Horas', 'Tipo', 'Valor Cliente']],
      body: lancs.map(r => [
        r.data_plantao.split('-').reverse().join('/'),
        r.cooperados?.nome ?? '—', profissaoLabel[r.profissao] ?? r.profissao,
        r.sectors?.nome ?? '—', Number(r.total_horas).toFixed(2) + 'h',
        tipoPlantaoLabel[r.tipo_plantao] ?? r.tipo_plantao,
        fmtBRL(Number(r.valor_cobrado_cliente)),
      ]),
      foot: [[{ content: `Subtotal ${nome}`, colSpan: 6, styles: { halign: 'right' } }, fmtBRL(subC)]],
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: [31, 41, 99], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 242, 255], textColor: [31, 41, 99], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      margin: { left: 14, right: 14 },
    });
    startY = (doc as any).lastAutoTable.finalY + 8;
  });

  gerarPDFFooter(doc);
  doc.save(`faturamento_${periodoLabel.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
}

function gerarPDFRepasse(rows: LancRow[], periodoLabel: string, filtros: Record<string, string>) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  gerarPDFHeader(doc, 'Relatório de Repasse', 'Valores repassados aos cooperados', periodoLabel, filtros);

  const totalHoras = rows.reduce((s, r) => s + Number(r.total_horas), 0);
  const totalCoop = rows.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0);

  const kpis = [
    { label: 'Total Plantões', value: String(rows.length) },
    { label: 'Total Horas', value: `${totalHoras.toFixed(1)}h` },
    { label: 'Total Repasse', value: fmtBRL(totalCoop) },
  ];
  const kpiW = (W - 28) / kpis.length;
  kpis.forEach((k, i) => {
    const x = 14 + i * kpiW;
    doc.setFillColor(248, 249, 252);
    doc.roundedRect(x, 32, kpiW - 3, 18, 2, 2, 'F');
    doc.setTextColor(100, 110, 130); doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(k.label.toUpperCase(), x + 4, 38);
    doc.setTextColor(31, 41, 99); doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.text(k.value, x + 4, 46);
  });

  const byCooperado: Record<string, LancRow[]> = {};
  rows.forEach(r => {
    const k = r.cooperados?.nome ?? 'Sem cooperado';
    if (!byCooperado[k]) byCooperado[k] = [];
    byCooperado[k].push(r);
  });

  let startY = 56;
  Object.entries(byCooperado).sort((a, b) => a[0].localeCompare(b[0])).forEach(([nome, lancs]) => {
    const subCoop = lancs.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0);
    if (startY > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); startY = 14; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(31, 41, 99);
    doc.text(`${nome} — ${profissaoLabel[lancs[0]?.profissao] ?? ''}`, 14, startY);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100);
    doc.text(`${lancs.length} plantões | ${lancs.reduce((s, r) => s + Number(r.total_horas), 0).toFixed(1)}h | Repasse: ${fmtBRL(subCoop)}`, 14, startY + 4);
    startY += 8;
    autoTable(doc, {
      startY,
      head: [['Data', 'Cliente', 'Setor', 'Horas', 'Tipo', 'Repasse']],
      body: lancs.map(r => [
        r.data_plantao.split('-').reverse().join('/'),
        r.hospitals?.nome ?? '—', r.sectors?.nome ?? '—',
        Number(r.total_horas).toFixed(2) + 'h',
        tipoPlantaoLabel[r.tipo_plantao] ?? r.tipo_plantao,
        fmtBRL(Number(r.valor_repasse_cooperado)),
      ]),
      foot: [[{ content: `Subtotal ${nome}`, colSpan: 5, styles: { halign: 'right' } }, fmtBRL(subCoop)]],
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: [31, 41, 99], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 242, 255], textColor: [31, 41, 99], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      margin: { left: 14, right: 14 },
    });
    startY = (doc as any).lastAutoTable.finalY + 8;
  });

  gerarPDFFooter(doc);
  doc.save(`repasse_${periodoLabel.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
}

export default function Relatorios() {
  const [rows, setRows] = useState<LancRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState<PeriodoState>(periodoInicial());
  const [tipoRelatorio, setTipoRelatorio] = useState<TipoRelatorio>('faturamento');

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [cooperadosList, setCooperadosList] = useState<Cooperado[]>([]);

  const [filterHospital, setFilterHospital] = useState('all');
  const [filterSetor, setFilterSetor] = useState('all');
  const [filterCooperado, setFilterCooperado] = useState('all');
  const [filterProfissao, setFilterProfissao] = useState('all');

  const periodoCalc = calcPeriodo(periodo);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('lancamentos_plantoes')
      .select('id, data_plantao, total_horas, profissao, tipo_plantao, valor_cobrado_cliente, valor_repasse_cooperado, cooperados(id, nome), hospitals(id, nome), sectors(id, nome)')
      .gte('data_plantao', periodoCalc.inicio)
      .lte('data_plantao', periodoCalc.fim)
      .order('data_plantao', { ascending: true });
    setRows((data ?? []) as unknown as LancRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [periodoCalc.inicio, periodoCalc.fim]);

  useEffect(() => {
    supabase.from('hospitals').select('id, nome').order('nome').then(({ data }) => setHospitals(data ?? []));
    supabase.from('sectors').select('id, nome, hospital_id').order('nome').then(({ data }) => setSectors(data ?? []));
    supabase.from('cooperados').select('id, nome').order('nome').then(({ data }) => setCooperadosList(data ?? []));
  }, []);

  const setoresFiltrados = useMemo(
    () => filterHospital === 'all' ? sectors : sectors.filter(s => s.hospital_id === filterHospital),
    [sectors, filterHospital]
  );

  const filtered = useMemo(() => rows.filter(r => {
    if (filterHospital !== 'all' && r.hospitals?.id !== filterHospital) return false;
    if (filterSetor !== 'all' && r.sectors?.id !== filterSetor) return false;
    if (filterCooperado !== 'all' && r.cooperados?.id !== filterCooperado) return false;
    if (filterProfissao !== 'all' && r.profissao !== filterProfissao) return false;
    return true;
  }), [rows, filterHospital, filterSetor, filterCooperado, filterProfissao]);

  const porHospital = useMemo(() => {
    const map: Record<string, { plantoes: number; horas: number; cliente: number }> = {};
    filtered.forEach(r => {
      const k = r.hospitals?.nome ?? 'Desconhecido';
      if (!map[k]) map[k] = { plantoes: 0, horas: 0, cliente: 0 };
      map[k].plantoes++; map[k].horas += Number(r.total_horas);
      map[k].cliente += Number(r.valor_cobrado_cliente);
    });
    return Object.entries(map).sort((a, b) => b[1].cliente - a[1].cliente);
  }, [filtered]);

  const porCooperado = useMemo(() => {
    const map: Record<string, { plantoes: number; horas: number; cooperado: number; profissao: string }> = {};
    filtered.forEach(r => {
      const k = r.cooperados?.nome ?? 'Desconhecido';
      if (!map[k]) map[k] = { plantoes: 0, horas: 0, cooperado: 0, profissao: r.profissao };
      map[k].plantoes++; map[k].horas += Number(r.total_horas);
      map[k].cooperado += Number(r.valor_repasse_cooperado);
    });
    return Object.entries(map).sort((a, b) => b[1].cooperado - a[1].cooperado);
  }, [filtered]);

  const porProfissaoFat = useMemo(() => {
    const map: Record<string, { plantoes: number; horas: number; cliente: number }> = {};
    filtered.forEach(r => {
      const k = r.profissao;
      if (!map[k]) map[k] = { plantoes: 0, horas: 0, cliente: 0 };
      map[k].plantoes++; map[k].horas += Number(r.total_horas);
      map[k].cliente += Number(r.valor_cobrado_cliente);
    });
    return Object.entries(map).sort((a, b) => b[1].cliente - a[1].cliente);
  }, [filtered]);

  const porProfissaoRep = useMemo(() => {
    const map: Record<string, { plantoes: number; horas: number; cooperado: number }> = {};
    filtered.forEach(r => {
      const k = r.profissao;
      if (!map[k]) map[k] = { plantoes: 0, horas: 0, cooperado: 0 };
      map[k].plantoes++; map[k].horas += Number(r.total_horas);
      map[k].cooperado += Number(r.valor_repasse_cooperado);
    });
    return Object.entries(map).sort((a, b) => b[1].cooperado - a[1].cooperado);
  }, [filtered]);

  const totalCliente = filtered.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0);
  const totalCooperado = filtered.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0);
  const totalHoras = filtered.reduce((s, r) => s + Number(r.total_horas), 0);

  const th = 'text-left p-3 font-medium text-xs uppercase tracking-wider text-muted-foreground';
  const thR = th + ' text-right';

  const getFiltrosNomes = () => ({
    cooperado: cooperadosList.find(c => c.id === filterCooperado)?.nome ?? '',
    hospital: hospitals.find(h => h.id === filterHospital)?.nome ?? '',
    setor: sectors.find(s => s.id === filterSetor)?.nome ?? '',
  });

  const isFaturamento = tipoRelatorio === 'faturamento';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Análise dos plantões por período</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2"
            onClick={() => isFaturamento
              ? gerarPDFFaturamento(filtered, periodoCalc.label, getFiltrosNomes())
              : gerarPDFRepasse(filtered, periodoCalc.label, getFiltrosNomes())}
            disabled={filtered.length === 0}>
            <FileText className="h-4 w-4" /> PDF
          </Button>
          <Button variant="outline" className="gap-2"
            onClick={() => isFaturamento ? downloadCSVFaturamento(filtered) : downloadCSVRepasse(filtered)}
            disabled={filtered.length === 0}>
            <Download className="h-4 w-4" /> CSV
          </Button>
        </div>
      </div>

      {/* Seletor de tipo de relatório */}
      <div className="flex gap-3">
        <button
          onClick={() => setTipoRelatorio('faturamento')}
          className={`flex items-center gap-2 px-5 py-3 rounded-lg border text-sm font-medium transition-colors ${
            isFaturamento
              ? 'bg-primary text-primary-foreground border-primary shadow-sm'
              : 'bg-background text-muted-foreground border-border hover:bg-muted/50'
          }`}>
          <TrendingUp className="h-4 w-4" />
          Relatório de Faturamento
        </button>
        <button
          onClick={() => setTipoRelatorio('repasse')}
          className={`flex items-center gap-2 px-5 py-3 rounded-lg border text-sm font-medium transition-colors ${
            !isFaturamento
              ? 'bg-primary text-primary-foreground border-primary shadow-sm'
              : 'bg-background text-muted-foreground border-border hover:bg-muted/50'
          }`}>
          <Users className="h-4 w-4" />
          Relatório de Repasse
        </button>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 md:p-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            <div>
              <PeriodoPicker value={periodo} onChange={setPeriodo} />
            </div>
            <div>
              <Label className="text-xs">Cooperado</Label>
              <Select value={filterCooperado} onValueChange={setFilterCooperado}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {cooperadosList.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cliente</Label>
              <Select value={filterHospital} onValueChange={v => { setFilterHospital(v); setFilterSetor('all'); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Setor</Label>
              <Select value={filterSetor} onValueChange={setFilterSetor}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {setoresFiltrados.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Profissão</Label>
              <Select value={filterProfissao} onValueChange={setFilterProfissao}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {Object.entries(profissaoLabel).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="ml-auto text-sm text-muted-foreground text-right">
            {loading ? 'Carregando…' : `${filtered.length} lançamento${filtered.length !== 1 ? 's' : ''} encontrado${filtered.length !== 1 ? 's' : ''}`}
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      {isFaturamento ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Plantões', value: loading ? '—' : String(filtered.length), color: 'text-primary' },
            { label: 'Total de horas', value: loading ? '—' : `${totalHoras.toFixed(1)}h`, color: 'text-foreground' },
            { label: 'Total faturado (cliente)', value: loading ? '—' : formatCurrency(totalCliente), color: 'text-success' },
          ].map(c => (
            <Card key={c.label} className="shadow-card">
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</p>
                <p className={`text-2xl font-bold tabular-nums mt-1 ${c.color}`}>{c.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Plantões', value: loading ? '—' : String(filtered.length), color: 'text-primary' },
            { label: 'Total de horas', value: loading ? '—' : `${totalHoras.toFixed(1)}h`, color: 'text-foreground' },
            { label: 'Total repasse (cooperados)', value: loading ? '—' : formatCurrency(totalCooperado), color: 'text-accent' },
          ].map(c => (
            <Card key={c.label} className="shadow-card">
              <CardContent className="p-5">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</p>
                <p className={`text-2xl font-bold tabular-nums mt-1 ${c.color}`}>{c.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-12 text-center">
          <FileBarChart2 className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum lançamento encontrado para o período e filtros selecionados.</p>
        </CardContent></Card>
      ) : isFaturamento ? (
        /* ── FATURAMENTO ── */
        <Tabs defaultValue="hospital">
          <TabsList>
            <TabsTrigger value="hospital">Por Cliente</TabsTrigger>
            <TabsTrigger value="profissao">Por Profissão</TabsTrigger>
            <TabsTrigger value="detalhado">Detalhado</TabsTrigger>
          </TabsList>

          <TabsContent value="hospital">
            <Card>
              <CardHeader><CardTitle className="text-base">Faturamento por cliente</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40"><tr>
                      <th className={th}>Cliente</th>
                      <th className={thR}>Plantões</th>
                      <th className={thR}>Horas</th>
                      <th className={thR}>Valor Cliente</th>
                    </tr></thead>
                    <tbody className="divide-y">
                      {porHospital.map(([nome, v]) => (
                        <tr key={nome} className="hover:bg-muted/30">
                          <td className="p-3 font-medium">{nome}</td>
                          <td className="p-3 text-right tabular-nums">{v.plantoes}</td>
                          <td className="p-3 text-right tabular-nums">{v.horas.toFixed(1)}h</td>
                          <td className="p-3 text-right tabular-nums font-semibold text-success">{formatCurrency(v.cliente)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 font-semibold"><tr>
                      <td className="p-3">Total</td>
                      <td className="p-3 text-right tabular-nums">{filtered.length}</td>
                      <td className="p-3 text-right tabular-nums">{totalHoras.toFixed(1)}h</td>
                      <td className="p-3 text-right tabular-nums text-success">{formatCurrency(totalCliente)}</td>
                    </tr></tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profissao">
            <Card>
              <CardHeader><CardTitle className="text-base">Faturamento por profissão</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40"><tr>
                      <th className={th}>Profissão</th>
                      <th className={thR}>Plantões</th>
                      <th className={thR}>Horas</th>
                      <th className={thR}>Valor Cliente</th>
                      <th className={thR}>% do total</th>
                    </tr></thead>
                    <tbody className="divide-y">
                      {porProfissaoFat.map(([prof, v]) => {
                        const pct = totalCliente > 0 ? (v.cliente / totalCliente) * 100 : 0;
                        return (
                          <tr key={prof} className="hover:bg-muted/30">
                            <td className="p-3 font-medium">{profissaoLabel[prof] ?? prof}</td>
                            <td className="p-3 text-right tabular-nums">{v.plantoes}</td>
                            <td className="p-3 text-right tabular-nums">{v.horas.toFixed(1)}h</td>
                            <td className="p-3 text-right tabular-nums font-semibold text-success">{formatCurrency(v.cliente)}</td>
                            <td className="p-3 text-right tabular-nums text-muted-foreground">{pct.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-muted/30 font-semibold"><tr>
                      <td className="p-3">Total</td>
                      <td className="p-3 text-right tabular-nums">{filtered.length}</td>
                      <td className="p-3 text-right tabular-nums">{totalHoras.toFixed(1)}h</td>
                      <td className="p-3 text-right tabular-nums text-success">{formatCurrency(totalCliente)}</td>
                      <td className="p-3 text-right tabular-nums">100%</td>
                    </tr></tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="detalhado">
            <Card>
              <CardHeader><CardTitle className="text-base">Faturamento detalhado — {filtered.length} lançamentos</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40"><tr>
                      <th className={th}>Data</th>
                      <th className={th}>Cooperado</th>
                      <th className={th}>Cliente / Setor</th>
                      <th className={th}>Tipo</th>
                      <th className={thR}>Horas</th>
                      <th className={thR}>Valor Cliente</th>
                    </tr></thead>
                    <tbody className="divide-y">
                      {filtered.map(r => (
                        <tr key={r.id} className="hover:bg-muted/30">
                          <td className="p-3 tabular-nums">{r.data_plantao.split('-').reverse().join('/')}</td>
                          <td className="p-3">
                            <div className="font-medium">{r.cooperados?.nome ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{profissaoLabel[r.profissao]}</div>
                          </td>
                          <td className="p-3">
                            <div>{r.hospitals?.nome ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{r.sectors?.nome ?? '—'}</div>
                          </td>
                          <td className="p-3 text-sm">{tipoPlantaoLabel[r.tipo_plantao]}</td>
                          <td className="p-3 text-right tabular-nums">{Number(r.total_horas).toFixed(2)}h</td>
                          <td className="p-3 text-right tabular-nums font-semibold text-success">{formatCurrency(r.valor_cobrado_cliente)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 font-semibold"><tr>
                      <td colSpan={4} className="p-3 text-right text-xs uppercase tracking-wider text-muted-foreground">Totais</td>
                      <td className="p-3 text-right tabular-nums">{totalHoras.toFixed(1)}h</td>
                      <td className="p-3 text-right tabular-nums text-success">{formatCurrency(totalCliente)}</td>
                    </tr></tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : (
        /* ── REPASSE ── */
        <Tabs defaultValue="cooperado">
          <TabsList>
            <TabsTrigger value="cooperado">Por Cooperado</TabsTrigger>
            <TabsTrigger value="profissao">Por Profissão</TabsTrigger>
            <TabsTrigger value="detalhado">Detalhado</TabsTrigger>
          </TabsList>

          <TabsContent value="cooperado">
            <Card>
              <CardHeader><CardTitle className="text-base">Repasse por cooperado</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40"><tr>
                      <th className={th}>Cooperado</th>
                      <th className={th}>Profissão</th>
                      <th className={thR}>Plantões</th>
                      <th className={thR}>Horas</th>
                      <th className={thR}>Repasse</th>
                    </tr></thead>
                    <tbody className="divide-y">
                      {porCooperado.map(([nome, v]) => (
                        <tr key={nome} className="hover:bg-muted/30">
                          <td className="p-3 font-medium">{nome}</td>
                          <td className="p-3 text-muted-foreground">{profissaoLabel[v.profissao] ?? v.profissao}</td>
                          <td className="p-3 text-right tabular-nums">{v.plantoes}</td>
                          <td className="p-3 text-right tabular-nums">{v.horas.toFixed(1)}h</td>
                          <td className="p-3 text-right tabular-nums font-semibold text-accent">{formatCurrency(v.cooperado)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 font-semibold"><tr>
                      <td colSpan={2} className="p-3">Total</td>
                      <td className="p-3 text-right tabular-nums">{filtered.length}</td>
                      <td className="p-3 text-right tabular-nums">{totalHoras.toFixed(1)}h</td>
                      <td className="p-3 text-right tabular-nums text-accent">{formatCurrency(totalCooperado)}</td>
                    </tr></tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profissao">
            <Card>
              <CardHeader><CardTitle className="text-base">Repasse por profissão</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40"><tr>
                      <th className={th}>Profissão</th>
                      <th className={thR}>Plantões</th>
                      <th className={thR}>Horas</th>
                      <th className={thR}>Repasse</th>
                      <th className={thR}>% do total</th>
                    </tr></thead>
                    <tbody className="divide-y">
                      {porProfissaoRep.map(([prof, v]) => {
                        const pct = totalCooperado > 0 ? (v.cooperado / totalCooperado) * 100 : 0;
                        return (
                          <tr key={prof} className="hover:bg-muted/30">
                            <td className="p-3 font-medium">{profissaoLabel[prof] ?? prof}</td>
                            <td className="p-3 text-right tabular-nums">{v.plantoes}</td>
                            <td className="p-3 text-right tabular-nums">{v.horas.toFixed(1)}h</td>
                            <td className="p-3 text-right tabular-nums font-semibold text-accent">{formatCurrency(v.cooperado)}</td>
                            <td className="p-3 text-right tabular-nums text-muted-foreground">{pct.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-muted/30 font-semibold"><tr>
                      <td className="p-3">Total</td>
                      <td className="p-3 text-right tabular-nums">{filtered.length}</td>
                      <td className="p-3 text-right tabular-nums">{totalHoras.toFixed(1)}h</td>
                      <td className="p-3 text-right tabular-nums text-accent">{formatCurrency(totalCooperado)}</td>
                      <td className="p-3 text-right tabular-nums">100%</td>
                    </tr></tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="detalhado">
            <Card>
              <CardHeader><CardTitle className="text-base">Repasse detalhado — {filtered.length} lançamentos</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40"><tr>
                      <th className={th}>Data</th>
                      <th className={th}>Cooperado</th>
                      <th className={th}>Cliente / Setor</th>
                      <th className={th}>Tipo</th>
                      <th className={thR}>Horas</th>
                      <th className={thR}>Repasse</th>
                    </tr></thead>
                    <tbody className="divide-y">
                      {filtered.map(r => (
                        <tr key={r.id} className="hover:bg-muted/30">
                          <td className="p-3 tabular-nums">{r.data_plantao.split('-').reverse().join('/')}</td>
                          <td className="p-3">
                            <div className="font-medium">{r.cooperados?.nome ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{profissaoLabel[r.profissao]}</div>
                          </td>
                          <td className="p-3">
                            <div>{r.hospitals?.nome ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{r.sectors?.nome ?? '—'}</div>
                          </td>
                          <td className="p-3 text-sm">{tipoPlantaoLabel[r.tipo_plantao]}</td>
                          <td className="p-3 text-right tabular-nums">{Number(r.total_horas).toFixed(2)}h</td>
                          <td className="p-3 text-right tabular-nums font-semibold text-accent">{formatCurrency(r.valor_repasse_cooperado)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/30 font-semibold"><tr>
                      <td colSpan={4} className="p-3 text-right text-xs uppercase tracking-wider text-muted-foreground">Totais</td>
                      <td className="p-3 text-right tabular-nums">{totalHoras.toFixed(1)}h</td>
                      <td className="p-3 text-right tabular-nums text-accent">{formatCurrency(totalCooperado)}</td>
                    </tr></tfoot>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
