import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, FileBarChart2, FileText, TrendingUp, Users } from 'lucide-react';
import { toast } from 'sonner';
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
type Ordenacao = 'nome' | 'valor';

const PROF_COLORS: Record<string, string> = {
  enfermeiro: '#2B7FE8',
  tecnico_enfermagem: '#10B981',
  fonoaudiologo: '#8B72D8',
  assistente_social: '#F59E0B',
};

const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtData = (s: string) => s.split('-').reverse().join('/');

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
  const header = ['Data', 'Cooperado', 'Profissão', 'Tipo', 'Cliente', 'Setor', 'Horas', 'Repasse'];
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

function gerarPDFHeader(doc: jsPDF, titulo: string, periodoLabel: string, filtros: Record<string, string>) {
  const W = doc.internal.pageSize.getWidth();

  doc.setFillColor(31, 41, 99);
  doc.rect(0, 0, W, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('CADES Financeiro', 14, 11);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 200, 255);
  doc.text(titulo, 14, 18);

  doc.setFontSize(8);
  doc.text(`Emitido em: ${new Date().toLocaleDateString('pt-BR')}  |  Período: ${periodoLabel}`, W - 14, 18, { align: 'right' });

  const filtroTexto = [
    filtros.cooperado && `Cooperado: ${filtros.cooperado}`,
    filtros.hospital && `Cliente: ${filtros.hospital}`,
    filtros.setor && `Setor: ${filtros.setor}`,
  ].filter(Boolean).join('  ');
  doc.setFontSize(7);
  doc.setTextColor(160, 180, 240);
  doc.text(filtroTexto || ' ', 14, 25);
}

function gerarPDFFooter(doc: jsPDF) {
  const W = doc.internal.pageSize.getWidth();
  const totalPages = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages?.() ?? doc.getNumberOfPages();
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

// Agrupa os lançamentos por setor → cooperado, consolidando diurnos/noturnos/diaristas
function buildSetorCards(rows: LancRow[]) {
  const map = new Map<string, {
    nome: string;
    coops: Map<string, { nome: string; profissao: string; diurno: LancRow[]; noturno: LancRow[]; diarista: LancRow[] }>;
  }>();
  rows.forEach(r => {
    const sId = r.sectors?.id ?? '_sem_';
    const sNome = r.sectors?.nome ?? 'Sem setor';
    if (!map.has(sId)) map.set(sId, { nome: sNome, coops: new Map() });
    const s = map.get(sId)!;
    const cId = r.cooperados?.id ?? '_sem_coop_';
    if (!s.coops.has(cId)) s.coops.set(cId, { nome: r.cooperados?.nome ?? 'Sem cooperado', profissao: r.profissao, diurno: [], noturno: [], diarista: [] });
    const c = s.coops.get(cId)!;
    if (r.tipo_plantao === 'normal') c.diurno.push(r);
    else if (r.tipo_plantao === 'diarista') c.diarista.push(r);
    else c.noturno.push(r);
  });
  return [...map.entries()]
    .sort(([, a], [, b]) => a.nome.localeCompare(b.nome))
    .map(([, s]) => {
      const coops = [...s.coops.values()].sort((a, b) => a.nome.localeCompare(b.nome)).map(c => {
        const all = [...c.diurno, ...c.noturno, ...c.diarista];
        return {
          nome: c.nome, profissao: c.profissao,
          diurnos: c.diurno.length, noturnos: c.noturno.length, diaristas: c.diarista.length, total: all.length,
          totalHoras: all.reduce((sum, r) => sum + Number(r.total_horas), 0),
          valorCliente: all.reduce((sum, r) => sum + Number(r.valor_cobrado_cliente), 0),
          valorCooperado: all.reduce((sum, r) => sum + Number(r.valor_repasse_cooperado), 0),
        };
      });
      return {
        nome: s.nome, coops,
        subtotalDiurnos: coops.reduce((sum, c) => sum + c.diurnos, 0),
        subtotalNoturnos: coops.reduce((sum, c) => sum + c.noturnos, 0),
        subtotalDiaristas: coops.reduce((sum, c) => sum + c.diaristas, 0),
        subtotalTotal: coops.reduce((sum, c) => sum + c.total, 0),
        subtotalHoras: coops.reduce((sum, c) => sum + c.totalHoras, 0),
        subtotalValorCliente: coops.reduce((sum, c) => sum + c.valorCliente, 0),
        subtotalValorCooperado: coops.reduce((sum, c) => sum + c.valorCooperado, 0),
      };
    });
}

function gerarPDFConsolidado(
  rows: LancRow[],
  periodoLabel: string,
  filtros: Record<string, string>,
  isFaturamento: boolean,
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const titulo = isFaturamento ? 'Relatório de Faturamento' : 'Relatório de Repasse Cooperados';
  const valorLabel = isFaturamento ? 'Valor Faturado' : 'Valor a Receber';
  gerarPDFHeader(doc, titulo, periodoLabel, filtros);

  // KPIs
  const totalDiurnos = rows.filter(r => r.tipo_plantao === 'normal').length;
  const totalNoturnos = rows.filter(r => r.tipo_plantao === 'extra').length;
  const totalDiaristas = rows.filter(r => r.tipo_plantao === 'diarista').length;
  const totalValor = isFaturamento
    ? rows.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0)
    : rows.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0);
  const kpis = [
    { label: 'Diurnos', value: String(totalDiurnos) },
    { label: 'Noturnos', value: String(totalNoturnos) },
    { label: 'Diaristas', value: String(totalDiaristas) },
    { label: isFaturamento ? 'Total Faturado' : 'Total Repasse', value: fmtBRL(totalValor) },
  ];
  const kpiW = (W - 28) / kpis.length;
  kpis.forEach((k, i) => {
    const x = 14 + i * kpiW;
    doc.setFillColor(248, 249, 252);
    doc.roundedRect(x, 32, kpiW - 3, 16, 2, 2, 'F');
    doc.setTextColor(100, 110, 130); doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(k.label.toUpperCase(), x + 4, 37);
    doc.setTextColor(31, 41, 99); doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.text(k.value, x + 4, 44);
  });

  // Larguras fixas das colunas (landscape A4 = ~269mm útil, 8 colunas)
  const colStyles = {
    0: { cellWidth: 60 },                                    // Cooperado
    1: { cellWidth: 42 },                                    // Função
    2: { cellWidth: 42 },                                    // Setor
    3: { cellWidth: 20, halign: 'center' as const },         // Diurnos
    4: { cellWidth: 20, halign: 'center' as const },         // Noturnos
    5: { cellWidth: 18, halign: 'center' as const },         // Total
    6: { cellWidth: 23, halign: 'right' as const },          // Horas
    7: { cellWidth: 32, halign: 'right' as const },          // Valor
  };

  const setores = buildSetorCards(rows);
  let startY = 54;

  setores.forEach(setor => {
    const subtotalValor = isFaturamento ? setor.subtotalValorCliente : setor.subtotalValorCooperado;
    if (startY > doc.internal.pageSize.getHeight() - 45) { doc.addPage(); startY = 14; }

    // Cabeçalho do setor
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(31, 41, 99);
    doc.text(`Setor: ${setor.nome}`, 14, startY);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(80, 80, 80);
    doc.text(
      `${setor.subtotalTotal} plantão(ões)  ·  ${setor.subtotalDiurnos} diurno(s)  ·  ${setor.subtotalNoturnos} noturno(s)  ·  ${setor.subtotalHoras.toFixed(1)}h  ·  Total: ${fmtBRL(subtotalValor)}`,
      14, startY + 4,
    );
    startY += 9;

    autoTable(doc, {
      startY,
      head: [['Cooperado', 'Função', 'Setor', 'Diurnos', 'Noturnos', 'Total', 'Horas', valorLabel]],
      body: setor.coops.map(c => [
        c.nome,
        profissaoLabel[c.profissao] ?? c.profissao,
        setor.nome,
        String(c.diurnos),
        String(c.noturnos),
        String(c.total),
        c.totalHoras.toFixed(1) + 'h',
        fmtBRL(isFaturamento ? c.valorCliente : c.valorCooperado),
      ]),
      foot: [[
        { content: `Subtotal — ${setor.nome}`, colSpan: 3, styles: { halign: 'right' as const } },
        { content: String(setor.subtotalDiurnos), styles: { halign: 'center' as const } },
        { content: String(setor.subtotalNoturnos), styles: { halign: 'center' as const } },
        { content: String(setor.subtotalTotal), styles: { halign: 'center' as const } },
        { content: setor.subtotalHoras.toFixed(1) + 'h', styles: { halign: 'right' as const } },
        { content: fmtBRL(subtotalValor), styles: { halign: 'right' as const } },
      ]],
      styles: { fontSize: 7.5, cellPadding: 2.5 },
      headStyles: { fillColor: [31, 41, 99], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 242, 255], textColor: [31, 41, 99], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      columnStyles: colStyles,
      margin: { left: 14, right: 14 },
    });
    startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  });

  // Total geral
  if (startY > doc.internal.pageSize.getHeight() - 25) { doc.addPage(); startY = 14; }
  autoTable(doc, {
    startY,
    body: [[
      { content: 'TOTAL GERAL', colSpan: 3, styles: { fontStyle: 'bold', halign: 'left' as const } },
      { content: String(totalDiurnos), styles: { halign: 'center' as const, fontStyle: 'bold' } },
      { content: String(totalNoturnos), styles: { halign: 'center' as const, fontStyle: 'bold' } },
      { content: String(rows.length), styles: { halign: 'center' as const, fontStyle: 'bold' } },
      { content: rows.reduce((s, r) => s + Number(r.total_horas), 0).toFixed(1) + 'h', styles: { halign: 'right' as const, fontStyle: 'bold' } },
      { content: fmtBRL(totalValor), styles: { halign: 'right' as const, fontStyle: 'bold' } },
    ]],
    styles: { fontSize: 8.5, cellPadding: 3 },
    bodyStyles: { fillColor: [31, 41, 99], textColor: 255 },
    columnStyles: colStyles,
    margin: { left: 14, right: 14 },
  });

  // Resumo por setor
  startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  if (startY > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); startY = 14; }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(31, 41, 99);
  doc.text('Resumo por Setor', 14, startY);
  startY += 4;

  autoTable(doc, {
    startY,
    head: [['Setor', 'Plantões', 'Horas', valorLabel]],
    body: setores.map(s => {
      const val = isFaturamento ? s.subtotalValorCliente : s.subtotalValorCooperado;
      return [s.nome, String(s.subtotalTotal), s.subtotalHoras.toFixed(1) + 'h', fmtBRL(val)];
    }),
    foot: [[
      { content: 'Total', styles: { fontStyle: 'bold', halign: 'left' as const } },
      { content: String(setores.reduce((s, x) => s + x.subtotalTotal, 0)), styles: { fontStyle: 'bold' } },
      { content: setores.reduce((s, x) => s + x.subtotalHoras, 0).toFixed(1) + 'h', styles: { fontStyle: 'bold', halign: 'right' as const } },
      { content: fmtBRL(totalValor), styles: { fontStyle: 'bold', halign: 'right' as const } },
    ]],
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 99], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [31, 41, 99], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 249, 252] },
    columnStyles: {
      0: { cellWidth: 80 },
      1: { cellWidth: 30, halign: 'center' as const },
      2: { cellWidth: 30, halign: 'right' as const },
      3: { cellWidth: 50, halign: 'right' as const },
    },
    margin: { left: 14, right: 14 },
  });

  gerarPDFFooter(doc);
  doc.save(`${isFaturamento ? 'faturamento' : 'repasse'}_${periodoLabel.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
}

function gerarPDFFaturamento(rows: LancRow[], periodoLabel: string, filtros: Record<string, string>) {
  gerarPDFConsolidado(rows, periodoLabel, filtros, true);
}

function gerarPDFRepasse(rows: LancRow[], periodoLabel: string, filtros: Record<string, string>) {
  gerarPDFConsolidado(rows, periodoLabel, filtros, false);
}

export default function Relatorios() {
  const [rows, setRows] = useState<LancRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState<PeriodoState>(periodoInicial());
  const [tipoRelatorio, setTipoRelatorio] = useState<TipoRelatorio>('repasse');
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('nome');

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [cooperadosList, setCooperadosList] = useState<Cooperado[]>([]);

  const [filterHospital, setFilterHospital] = useState('all');
  const [filterSetor, setFilterSetor] = useState('all');
  const [filterCooperado, setFilterCooperado] = useState('all');
  const [filterProfissao, setFilterProfissao] = useState('all');

  const periodoCalc = useMemo(() => calcPeriodo(periodo), [periodo]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('lancamentos_plantoes')
      .select('id, data_plantao, total_horas, profissao, tipo_plantao, valor_cobrado_cliente, valor_repasse_cooperado, cooperados(id, nome), hospitals(id, nome), sectors(id, nome)')
      .gte('data_plantao', periodoCalc.inicio)
      .lte('data_plantao', periodoCalc.fim)
      .order('data_plantao', { ascending: true })
      .limit(5000);
    if (error) { toast.error('Erro ao carregar relatórios: ' + error.message); setLoading(false); return; }
    setRows((data ?? []) as unknown as LancRow[]);
    setLoading(false);
  }, [periodoCalc.inicio, periodoCalc.fim]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  useEffect(() => {
    supabase.from('hospitals').select('id, nome').order('nome').then(({ data }) => setHospitals(data ?? []));
    supabase.from('sectors').select('id, nome, hospital_id').order('nome').then(({ data }) => setSectors(data ?? []));
    supabase.from('cooperados').select('id, nome').order('nome').then(({ data }) => setCooperadosList(data ?? []));
  }, []);

  const setoresFiltrados = useMemo(
    () => filterHospital === 'all' ? sectors : sectors.filter(s => s.hospital_id === filterHospital),
    [sectors, filterHospital],
  );

  const filtered = useMemo(() => rows.filter(r => {
    if (filterHospital !== 'all' && r.hospitals?.id !== filterHospital) return false;
    if (filterSetor !== 'all' && r.sectors?.id !== filterSetor) return false;
    if (filterCooperado !== 'all' && r.cooperados?.id !== filterCooperado) return false;
    if (filterProfissao !== 'all' && r.profissao !== filterProfissao) return false;
    return true;
  }), [rows, filterHospital, filterSetor, filterCooperado, filterProfissao]);

  const totalCliente = filtered.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0);
  const totalCooperado = filtered.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0);
  const totalHoras = filtered.reduce((s, r) => s + Number(r.total_horas), 0);
  const clientesAtivos = new Set(filtered.map(r => r.hospitals?.id).filter(Boolean)).size;
  const cooperadosAtivos = new Set(filtered.map(r => r.cooperados?.id).filter(Boolean)).size;
  const totalDiurnos = filtered.filter(r => r.tipo_plantao === 'normal').length;
  const totalNoturnos = filtered.filter(r => r.tipo_plantao === 'extra').length;
  const totalDiaristas = filtered.filter(r => r.tipo_plantao === 'diarista').length;

  const setorCards = useMemo(() => {
    const map = new Map<string, {
      nome: string;
      coops: Map<string, { nome: string; profissao: string; diurno: LancRow[]; noturno: LancRow[]; diarista: LancRow[] }>;
    }>();

    filtered.forEach(r => {
      const sId = r.sectors?.id ?? '_sem_setor_';
      const sNome = r.sectors?.nome ?? 'Sem setor';
      if (!map.has(sId)) map.set(sId, { nome: sNome, coops: new Map() });
      const setor = map.get(sId)!;

      const cId = r.cooperados?.id ?? '_sem_coop_';
      if (!setor.coops.has(cId)) {
        setor.coops.set(cId, { nome: r.cooperados?.nome ?? 'Sem cooperado', profissao: r.profissao, diurno: [], noturno: [], diarista: [] });
      }
      const coop = setor.coops.get(cId)!;
      if (r.tipo_plantao === 'normal') coop.diurno.push(r);
      else if (r.tipo_plantao === 'diarista') coop.diarista.push(r);
      else coop.noturno.push(r);
    });

    return [...map.entries()].map(([sId, setor]) => {
      const cooperados = [...setor.coops.entries()].map(([cId, c]) => {
        const all = [...c.diurno, ...c.noturno, ...c.diarista];
        return {
          key: cId,
          nome: c.nome,
          profissao: c.profissao,
          diurnos: c.diurno.length,
          noturnos: c.noturno.length,
          diaristas: c.diarista.length,
          totalPlantoes: all.length,
          totalHoras: all.reduce((s, r) => s + Number(r.total_horas), 0),
          valorCliente: all.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0),
          valorCooperado: all.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0),
        };
      }).sort((a, b) => ordenacao === 'nome' ? a.nome.localeCompare(b.nome) : b.valorCooperado - a.valorCooperado);

      return {
        key: sId,
        nome: setor.nome,
        cooperados,
        subtotalDiurnos: cooperados.reduce((s, c) => s + c.diurnos, 0),
        subtotalNoturnos: cooperados.reduce((s, c) => s + c.noturnos, 0),
        subtotalDiaristas: cooperados.reduce((s, c) => s + c.diaristas, 0),
        subtotalPlantoes: cooperados.reduce((s, c) => s + c.totalPlantoes, 0),
        subtotalHoras: cooperados.reduce((s, c) => s + c.totalHoras, 0),
        subtotalValorCliente: cooperados.reduce((s, c) => s + c.valorCliente, 0),
        subtotalValorCooperado: cooperados.reduce((s, c) => s + c.valorCooperado, 0),
      };
    }).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [filtered, ordenacao]);

  const isFaturamento = tipoRelatorio === 'faturamento';
  const getFiltrosNomes = () => ({
    cooperado: cooperadosList.find(c => c.id === filterCooperado)?.nome ?? '',
    hospital: hospitals.find(h => h.id === filterHospital)?.nome ?? '',
    setor: sectors.find(s => s.id === filterSetor)?.nome ?? '',
  });

  const kpis = isFaturamento
    ? [
        { label: 'Diurnos', value: loading ? '—' : String(totalDiurnos) },
        { label: 'Noturnos', value: loading ? '—' : String(totalNoturnos) },
        { label: 'Total Plantões', value: loading ? '—' : String(filtered.length) },
        { label: 'Total faturado', value: loading ? '—' : formatCurrency(totalCliente), highlight: true },
      ]
    : [
        { label: 'Diurnos', value: loading ? '—' : String(totalDiurnos) },
        { label: 'Noturnos', value: loading ? '—' : String(totalNoturnos) },
        { label: 'Total Plantões', value: loading ? '—' : String(filtered.length) },
        { label: 'Total repasse', value: loading ? '—' : formatCurrency(totalCooperado), highlight: true },
      ];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
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

      {/* ── Seletor de tipo ── */}
      <div className="flex gap-3">
        {([
          { key: 'faturamento', label: 'Faturamento', Icon: TrendingUp },
          { key: 'repasse', label: 'Repasse Cooperados', Icon: Users },
        ] as const).map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setTipoRelatorio(key)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
              tipoRelatorio === key
                ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                : 'bg-card text-muted-foreground border-border hover:bg-muted/50'
            }`}>
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Filtros ── */}
      <Card>
        <CardContent className="p-4 md:p-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <div className="sm:col-span-2 lg:col-span-1">
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
            <div>
              <Label className="text-xs">Ordenar por</Label>
              <Select value={ordenacao} onValueChange={v => setOrdenacao(v as Ordenacao)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nome">Nome (A–Z)</SelectItem>
                  <SelectItem value="valor">Valor (maior)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            {loading ? 'Carregando…' : `${filtered.length} lançamento${filtered.length !== 1 ? 's' : ''}`}
          </div>
        </CardContent>
      </Card>

      {/* ── KPIs ── */}
      <div className="grid gap-4 sm:grid-cols-4">
        {kpis.map(k => (
          <Card key={k.label}>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{k.label}</p>
              <p className={`text-2xl font-bold tabular-nums mt-1 ${k.highlight ? 'text-primary' : 'text-foreground'}`}>
                {k.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Conteúdo — consolidado por setor ── */}
      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <FileBarChart2 className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum lançamento encontrado para o período e filtros selecionados.</p>
          </CardContent>
        </Card>
      ) : (
        /* ── Conteúdo consolidado por setor → cooperado ── */
        <div className="space-y-4">
          {setorCards.map(setor => (
            <Card key={setor.key} className="overflow-hidden">
              {/* cabeçalho do setor */}
              <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b">
                <div>
                  <p className="font-semibold text-[15px]">{setor.nome}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {setor.subtotalPlantoes} plantão{setor.subtotalPlantoes !== 1 ? 'ões' : ''}
                    {' · '}{setor.subtotalDiurnos} diurno{setor.subtotalDiurnos !== 1 ? 's' : ''}
                    {' · '}{setor.subtotalNoturnos} noturno{setor.subtotalNoturnos !== 1 ? 's' : ''}
                    {' · '}{setor.subtotalHoras.toFixed(1)}h
                  </p>
                </div>
                <span className="font-bold tabular-nums text-primary">
                  {formatCurrency(isFaturamento ? setor.subtotalValorCliente : setor.subtotalValorCooperado)}
                </span>
              </div>

              {/* tabela de cooperados do setor */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/20">
                    <tr>
                      <th className="text-left p-3 font-medium">Cooperado</th>
                      <th className="text-left p-3 font-medium">Função</th>
                      <th className="text-left p-3 font-medium">Setor</th>
                      <th className="text-center p-3 font-medium">Diurnos</th>
                      <th className="text-center p-3 font-medium">Noturnos</th>
                      <th className="text-center p-3 font-medium">Total</th>
                      <th className="text-right p-3 font-medium">Horas</th>
                      <th className="text-right p-3 font-medium">
                        {isFaturamento ? 'Valor Faturado' : 'Valor a Receber'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {setor.cooperados.map(c => (
                      <tr key={c.key} className="hover:bg-muted/20">
                        <td className="p-3 font-medium">
                          <span
                            className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
                            style={{ background: PROF_COLORS[c.profissao] ?? '#999' }}
                          />
                          {c.nome}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {profissaoLabel[c.profissao] ?? c.profissao}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{setor.nome}</td>
                        <td className="p-3 text-center tabular-nums font-medium">{c.diurnos}</td>
                        <td className="p-3 text-center tabular-nums font-medium">{c.noturnos}</td>
                        <td className="p-3 text-center tabular-nums font-semibold">{c.totalPlantoes}</td>
                        <td className="p-3 text-right tabular-nums text-muted-foreground">
                          {c.totalHoras.toFixed(1)}h
                        </td>
                        <td className="p-3 text-right tabular-nums font-bold text-primary">
                          {formatCurrency(isFaturamento ? c.valorCliente : c.valorCooperado)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 border-t font-semibold text-[13px]">
                      <td className="p-3 text-xs uppercase tracking-wider text-muted-foreground" colSpan={3}>
                        Subtotal — {setor.nome}
                      </td>
                      <td className="p-3 text-center tabular-nums">{setor.subtotalDiurnos}</td>
                      <td className="p-3 text-center tabular-nums">{setor.subtotalNoturnos}</td>
                      <td className="p-3 text-center tabular-nums">{setor.subtotalPlantoes}</td>
                      <td className="p-3 text-right tabular-nums">{setor.subtotalHoras.toFixed(1)}h</td>
                      <td className="p-3 text-right tabular-nums text-primary">
                        {formatCurrency(isFaturamento ? setor.subtotalValorCliente : setor.subtotalValorCooperado)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          ))}

          {/* Total geral */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-primary/5 px-5 py-4">
            <div className="flex flex-wrap items-center gap-5 text-sm font-semibold">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Total geral</span>
              <span>{totalDiurnos} diurno{totalDiurnos !== 1 ? 's' : ''}</span>
              <span>{totalNoturnos} noturno{totalNoturnos !== 1 ? 's' : ''}</span>
              <span className="text-muted-foreground">{filtered.length} plantão{filtered.length !== 1 ? 'ões' : ''}</span>
              <span className="text-muted-foreground tabular-nums">{totalHoras.toFixed(1)}h produzidas</span>
            </div>
            <span className="text-xl font-bold tabular-nums text-primary">
              {formatCurrency(isFaturamento ? totalCliente : totalCooperado)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
