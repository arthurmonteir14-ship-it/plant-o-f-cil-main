import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, ChevronUp, Download, FileBarChart2, FileText, TrendingUp, Users } from 'lucide-react';
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
  doc.setFontSize(8); doc.setTextColor(200, 210, 255);
  doc.text(filtroTexto || ' ', 14, 25);
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
  gerarPDFHeader(doc, 'Relatório de Faturamento', periodoLabel, filtros);

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
      head: [['Data', 'Cooperado', 'Profissão', 'Setor', 'Tipo', 'Horas', 'Valor Cliente']],
      body: lancs.sort((a, b) => a.data_plantao.localeCompare(b.data_plantao)).map(r => [
        fmtData(r.data_plantao), r.cooperados?.nome ?? '—',
        profissaoLabel[r.profissao] ?? r.profissao, r.sectors?.nome ?? '—',
        tipoPlantaoLabel[r.tipo_plantao] ?? r.tipo_plantao,
        Number(r.total_horas).toFixed(2) + 'h', fmtBRL(Number(r.valor_cobrado_cliente)),
      ]),
      foot: [[{ content: `Subtotal ${nome}`, colSpan: 6, styles: { halign: 'right' } }, fmtBRL(subC)]],
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: [31, 41, 99], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 242, 255], textColor: [31, 41, 99], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      margin: { left: 14, right: 14 },
    });
    startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  });

  // ── Extrato Financeiro ──
  const PH = doc.internal.pageSize.getHeight();
  if (startY > PH - 90) { doc.addPage(); startY = 14; } else { startY += 6; }

  doc.setFillColor(31, 41, 99);
  doc.rect(14, startY, W - 28, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text('EXTRATO FINANCEIRO', 17, startY + 5.5);
  doc.setFontSize(7); doc.setFont('helvetica', 'normal');
  doc.text('Demonstrativo financeiro da competência de faturamento', W - 15, startY + 5.5, { align: 'right' });
  startY += 12;

  const exVB = rows.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0);
  const exPIS = exVB * 0.0065;
  const exCOFINS = exVB * 0.03;
  const exRetido = exVB * 0.0365;
  const exLiquido = exVB - exRetido;
  const exRepasse = rows.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0);
  const repByCoop = new Map<string, number>();
  rows.forEach(r => { const id = r.cooperados?.id ?? '_'; repByCoop.set(id, (repByCoop.get(id) ?? 0) + Number(r.valor_repasse_cooperado)); });
  const exINSS = [...repByCoop.values()].reduce((s, v) => s + v * 0.20, 0);
  const exNCoop = repByCoop.size;
  const exCota = exNCoop * 80;

  const midX = W / 2 + 1;
  const extratoStartY = startY;

  autoTable(doc, {
    startY: extratoStartY,
    margin: { left: 14, right: W - midX + 2 },
    head: [['Demonstrativo da Nota Fiscal', 'Valor']],
    body: [
      ['Valor Bruto da Nota Fiscal', fmtBRL(exVB)],
      ['(−) PIS (0,65%)', fmtBRL(exPIS)],
      ['(−) COFINS (3,00%)', fmtBRL(exCOFINS)],
      ['(=) Total das Contribuições Sociais Retidas (3,65%)', fmtBRL(exRetido)],
    ],
    foot: [['(=) Valor Líquido a Receber', fmtBRL(exLiquido)]],
    styles: { fontSize: 7.5, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 99], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [224, 235, 255], textColor: [31, 41, 99], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 249, 252] },
    columnStyles: { 1: { halign: 'right' } },
  });
  const b1End = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  autoTable(doc, {
    startY: extratoStartY,
    margin: { left: midX, right: 14 },
    head: [['Resumo da Competência', 'Valor']],
    body: [
      ['Valor Total de Repasse aos Cooperados', fmtBRL(exRepasse)],
      ['Total do INSS Patronal (20%)', fmtBRL(exINSS)],
      [`Cota-Parte Arrecadada (${exNCoop} coop. × R$ 80,00)`, fmtBRL(exCota)],
    ],
    styles: { fontSize: 7.5, cellPadding: 2.5 },
    headStyles: { fillColor: [31, 41, 99], textColor: 255, fontStyle: 'bold' },
    bodyStyles: { fillColor: [224, 235, 255], textColor: [31, 41, 99], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' } },
  });
  const b2End = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  startY = Math.max(b1End, b2End);

  gerarPDFFooter(doc);
  doc.save(`faturamento_${periodoLabel.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
}

function gerarPDFRepasse(rows: LancRow[], periodoLabel: string, filtros: Record<string, string>) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  gerarPDFHeader(doc, 'Relatório de Repasse', periodoLabel, filtros);

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
    const diurnos = lancs.filter(r => r.tipo_plantao === 'normal');
    const noturnos = lancs.filter(r => r.tipo_plantao !== 'normal');
    doc.text(
      `${diurnos.length} diurno(s) · ${noturnos.length} noturno(s) · ${lancs.reduce((s, r) => s + Number(r.total_horas), 0).toFixed(1)}h · Repasse: ${fmtBRL(subCoop)}`,
      14, startY + 4,
    );
    startY += 8;
    autoTable(doc, {
      startY,
      head: [['Data', 'Cliente', 'Setor', 'Tipo', 'Horas', 'Repasse']],
      body: lancs.sort((a, b) => a.data_plantao.localeCompare(b.data_plantao)).map(r => [
        fmtData(r.data_plantao), r.hospitals?.nome ?? '—', r.sectors?.nome ?? '—',
        tipoPlantaoLabel[r.tipo_plantao] ?? r.tipo_plantao,
        Number(r.total_horas).toFixed(2) + 'h', fmtBRL(Number(r.valor_repasse_cooperado)),
      ]),
      foot: [[{ content: `Subtotal ${nome}`, colSpan: 5, styles: { halign: 'right' } }, fmtBRL(subCoop)]],
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: [31, 41, 99], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 242, 255], textColor: [31, 41, 99], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 249, 252] },
      margin: { left: 14, right: 14 },
    });
    startY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  });

  gerarPDFFooter(doc);
  doc.save(`repasse_${periodoLabel.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
}

export default function Relatorios() {
  const [rows, setRows] = useState<LancRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState<PeriodoState>(periodoInicial());
  const [tipoRelatorio, setTipoRelatorio] = useState<TipoRelatorio>('faturamento');
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('nome');

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [cooperadosList, setCooperadosList] = useState<Cooperado[]>([]);

  const [filterHospital, setFilterHospital] = useState('all');
  const [filterSetor, setFilterSetor] = useState('all');
  const [filterCooperado, setFilterCooperado] = useState('all');
  const [filterProfissao, setFilterProfissao] = useState('all');

  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

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

  const cooperadosCards = useMemo(() => {
    const map = new Map<string, { nome: string; profissao: string; diurno: LancRow[]; noturno: LancRow[] }>();
    filtered.forEach(r => {
      const key = r.cooperados?.id ?? '_sem_';
      if (!map.has(key)) map.set(key, { nome: r.cooperados?.nome ?? 'Sem cooperado', profissao: r.profissao, diurno: [], noturno: [] });
      const v = map.get(key)!;
      if (r.tipo_plantao === 'normal') v.diurno.push(r);
      else v.noturno.push(r);
    });
    return [...map.entries()].map(([key, v]) => {
      const all = [...v.diurno, ...v.noturno];
      return {
        key, nome: v.nome, profissao: v.profissao,
        diurno: [...v.diurno].sort((a, b) => a.data_plantao.localeCompare(b.data_plantao)),
        noturno: [...v.noturno].sort((a, b) => a.data_plantao.localeCompare(b.data_plantao)),
        totalPlantoes: all.length,
        totalHoras: all.reduce((s, r) => s + Number(r.total_horas), 0),
        totalRepasse: all.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0),
        diurnoHoras: v.diurno.reduce((s, r) => s + Number(r.total_horas), 0),
        diurnoRepasse: v.diurno.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0),
        noturnHoras: v.noturno.reduce((s, r) => s + Number(r.total_horas), 0),
        noturnRepasse: v.noturno.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0),
      };
    }).sort((a, b) => ordenacao === 'nome' ? a.nome.localeCompare(b.nome) : b.totalRepasse - a.totalRepasse);
  }, [filtered, ordenacao]);

  const clientesCards = useMemo(() => {
    const map = new Map<string, { nome: string; byProf: Map<string, { diurno: LancRow[]; noturno: LancRow[] }> }>();
    filtered.forEach(r => {
      const key = r.hospitals?.id ?? '_sem_';
      if (!map.has(key)) map.set(key, { nome: r.hospitals?.nome ?? 'Sem cliente', byProf: new Map() });
      const v = map.get(key)!;
      if (!v.byProf.has(r.profissao)) v.byProf.set(r.profissao, { diurno: [], noturno: [] });
      const pg = v.byProf.get(r.profissao)!;
      if (r.tipo_plantao === 'normal') pg.diurno.push(r);
      else pg.noturno.push(r);
    });
    return [...map.entries()].map(([key, v]) => {
      const allRows = [...v.byProf.values()].flatMap(pg => [...pg.diurno, ...pg.noturno]);
      const byProf = [...v.byProf.entries()].map(([prof, pg]) => {
        const all = [...pg.diurno, ...pg.noturno];
        return {
          prof, diurno: pg.diurno, noturno: pg.noturno,
          totalHoras: all.reduce((s, r) => s + Number(r.total_horas), 0),
          totalCliente: all.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0),
        };
      }).sort((a, b) => b.totalCliente - a.totalCliente);
      return {
        key, nome: v.nome, byProf,
        allRows: allRows.sort((a, b) => a.data_plantao.localeCompare(b.data_plantao)),
        totalPlantoes: allRows.length,
        totalHoras: allRows.reduce((s, r) => s + Number(r.total_horas), 0),
        totalCliente: allRows.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0),
      };
    }).sort((a, b) => ordenacao === 'nome' ? a.nome.localeCompare(b.nome) : b.totalCliente - a.totalCliente);
  }, [filtered, ordenacao]);

  const extratoValorBruto = totalCliente;
  const extratoPIS = extratoValorBruto * 0.0065;
  const extratoCOFINS = extratoValorBruto * 0.03;
  const extratoTotalRetido = extratoValorBruto * 0.0365;
  const extratoValorLiquido = extratoValorBruto - extratoTotalRetido;
  const extratoRepasseTotal = totalCooperado;
  const extratoINSSPatronal = cooperadosCards.reduce((s, c) => s + c.totalRepasse * 0.20, 0);
  const extratoCotaParte = cooperadosAtivos * 80;

  const toggleCard = (key: string) => setExpandedCards(prev => {
    const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s;
  });

  const isFaturamento = tipoRelatorio === 'faturamento';
  const getFiltrosNomes = () => ({
    cooperado: cooperadosList.find(c => c.id === filterCooperado)?.nome ?? '',
    hospital: hospitals.find(h => h.id === filterHospital)?.nome ?? '',
    setor: sectors.find(s => s.id === filterSetor)?.nome ?? '',
  });

  const kpis = isFaturamento
    ? [
        { label: 'Clientes', value: loading ? '—' : String(clientesAtivos) },
        { label: 'Plantões', value: loading ? '—' : String(filtered.length) },
        { label: 'Total de horas', value: loading ? '—' : `${totalHoras.toFixed(1)}h` },
        { label: 'Total faturado', value: loading ? '—' : formatCurrency(totalCliente), highlight: true },
      ]
    : [
        { label: 'Cooperados', value: loading ? '—' : String(cooperadosAtivos) },
        { label: 'Plantões', value: loading ? '—' : String(filtered.length) },
        { label: 'Total de horas', value: loading ? '—' : `${totalHoras.toFixed(1)}h` },
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

      {/* ── Conteúdo ── */}
      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <FileBarChart2 className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum lançamento encontrado para o período e filtros selecionados.</p>
          </CardContent>
        </Card>
      ) : isFaturamento ? (
        /* ── FATURAMENTO — agrupado por cliente ── */
        <div className="space-y-3">
          {clientesCards.map(cliente => {
            const expanded = expandedCards.has(cliente.key);
            return (
              <div key={cliente.key}
                style={{ borderLeft: '4px solid #2B7FE8' }}
                className="bg-card rounded-xl border border-border/60 shadow-card overflow-hidden">
                {/* cabeçalho clicável */}
                <button className="w-full text-left" onClick={() => toggleCard(cliente.key)}>
                  <div className="flex items-center justify-between gap-4 px-4 py-3.5 bg-[#F8FAFC] dark:bg-muted/20">
                    <div>
                      <p className="font-semibold text-[15px]">{cliente.nome}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {cliente.totalPlantoes} plantão{cliente.totalPlantoes !== 1 ? 'ões' : ''} · {cliente.totalHoras.toFixed(1)}h
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 ml-auto">
                      <span className="font-bold tabular-nums text-primary">{formatCurrency(cliente.totalCliente)}</span>
                      {expanded
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                    </div>
                  </div>
                </button>

                {/* breakdown por profissão */}
                {cliente.byProf.map(p => (
                  <div key={p.prof} className="px-4 py-2.5 border-t border-border/40 flex items-start gap-3">
                    <div className="mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0"
                      style={{ background: PROF_COLORS[p.prof] ?? '#999' }} />
                    <div>
                      <p className="text-[13px] font-medium leading-tight">{profissaoLabel[p.prof] ?? p.prof}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {p.diurno.length > 0 && `${p.diurno.length} diurno${p.diurno.length !== 1 ? 's' : ''}`}
                        {p.diurno.length > 0 && p.noturno.length > 0 && ' · '}
                        {p.noturno.length > 0 && `${p.noturno.length} noturno${p.noturno.length !== 1 ? 's' : ''}`}
                        {' · '}{p.totalHoras.toFixed(1)}h
                        {' · '}<span className="text-primary font-semibold">{formatCurrency(p.totalCliente)}</span>
                      </p>
                    </div>
                  </div>
                ))}

                {/* detalhe expandido */}
                {expanded && (
                  <div className="border-t overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="text-left p-3 font-medium">Data</th>
                          <th className="text-left p-3 font-medium">Cooperado</th>
                          <th className="text-left p-3 font-medium">Profissão</th>
                          <th className="text-left p-3 font-medium">Setor</th>
                          <th className="text-left p-3 font-medium">Tipo</th>
                          <th className="text-right p-3 font-medium">Horas</th>
                          <th className="text-right p-3 font-medium">Valor</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {cliente.allRows.map(r => (
                          <tr key={r.id} className="hover:bg-muted/20">
                            <td className="p-3 tabular-nums text-xs">{fmtData(r.data_plantao)}</td>
                            <td className="p-3 text-[13px]">{r.cooperados?.nome ?? '—'}</td>
                            <td className="p-3 text-xs text-muted-foreground">{profissaoLabel[r.profissao]}</td>
                            <td className="p-3 text-xs text-muted-foreground">{r.sectors?.nome ?? '—'}</td>
                            <td className="p-3 text-xs">{tipoPlantaoLabel[r.tipo_plantao]}</td>
                            <td className="p-3 text-right tabular-nums text-xs">{Number(r.total_horas).toFixed(2)}h</td>
                            <td className="p-3 text-right tabular-nums font-semibold text-primary">{formatCurrency(r.valor_cobrado_cliente)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* rodapé total */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-[#EFF6FF] dark:bg-primary/10 border-t">
                  <span className="text-xs font-semibold text-primary uppercase tracking-wide">Total {cliente.nome}</span>
                  <span className="font-bold text-primary tabular-nums">{formatCurrency(cliente.totalCliente)}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── REPASSE — agrupado por cooperado ── */
        <div className="space-y-3">
          {cooperadosCards.map(cooperado => {
            const expanded = expandedCards.has(cooperado.key);
            const borderColor = PROF_COLORS[cooperado.profissao] ?? '#999';
            const allRows = [...cooperado.diurno, ...cooperado.noturno];
            return (
              <div key={cooperado.key}
                style={{ borderLeft: `4px solid ${borderColor}` }}
                className="bg-card rounded-xl border border-border/60 shadow-card overflow-hidden">
                {/* cabeçalho clicável */}
                <button className="w-full text-left" onClick={() => toggleCard(cooperado.key)}>
                  <div className="flex items-center justify-between gap-4 px-4 py-3.5 bg-[#F8FAFC] dark:bg-muted/20">
                    <div>
                      <p className="font-semibold text-[15px]">{cooperado.nome}</p>
                      <p className="text-xs text-muted-foreground mt-0.5" style={{ color: borderColor }}>
                        {profissaoLabel[cooperado.profissao] ?? cooperado.profissao}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5 ml-auto">
                      <div className="text-right">
                        <p className="font-bold tabular-nums text-primary">{formatCurrency(cooperado.totalRepasse)}</p>
                        <p className="text-xs text-muted-foreground">
                          {cooperado.totalPlantoes} plantão{cooperado.totalPlantoes !== 1 ? 'ões' : ''} · {cooperado.totalHoras.toFixed(1)}h
                        </p>
                      </div>
                      {expanded
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                    </div>
                  </div>
                </button>

                {/* seção diurnos */}
                {cooperado.diurno.length > 0 && (
                  <div className="px-4 py-2.5 border-t border-border/40">
                    <p className="text-[13px] font-medium text-muted-foreground">● Plantões Diurnos</p>
                    <p className="text-xs text-muted-foreground pl-4 mt-0.5">
                      {cooperado.diurno.length} plantão{cooperado.diurno.length !== 1 ? 'ões' : ''}
                      {' · '}{cooperado.diurnoHoras.toFixed(1)}h
                      {' · '}<span className="text-primary font-semibold">{formatCurrency(cooperado.diurnoRepasse)}</span>
                    </p>
                  </div>
                )}

                {/* seção noturnos */}
                {cooperado.noturno.length > 0 && (
                  <div className="px-4 py-2.5 border-t border-border/40">
                    <p className="text-[13px] font-medium text-muted-foreground">● Plantões Noturnos</p>
                    <p className="text-xs text-muted-foreground pl-4 mt-0.5">
                      {cooperado.noturno.length} plantão{cooperado.noturno.length !== 1 ? 'ões' : ''}
                      {' · '}{cooperado.noturnHoras.toFixed(1)}h
                      {' · '}<span className="text-primary font-semibold">{formatCurrency(cooperado.noturnRepasse)}</span>
                    </p>
                  </div>
                )}

                {/* detalhe expandido */}
                {expanded && (
                  <div className="border-t overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                        <tr>
                          <th className="text-left p-3 font-medium">Data</th>
                          <th className="text-left p-3 font-medium">Cliente</th>
                          <th className="text-left p-3 font-medium">Setor</th>
                          <th className="text-left p-3 font-medium">Tipo</th>
                          <th className="text-right p-3 font-medium">Horas</th>
                          <th className="text-right p-3 font-medium">Repasse</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {allRows.map(r => (
                          <tr key={r.id} className="hover:bg-muted/20">
                            <td className="p-3 tabular-nums text-xs">{fmtData(r.data_plantao)}</td>
                            <td className="p-3 text-[13px]">{r.hospitals?.nome ?? '—'}</td>
                            <td className="p-3 text-xs text-muted-foreground">{r.sectors?.nome ?? '—'}</td>
                            <td className="p-3 text-xs">{tipoPlantaoLabel[r.tipo_plantao]}</td>
                            <td className="p-3 text-right tabular-nums text-xs">{Number(r.total_horas).toFixed(2)}h</td>
                            <td className="p-3 text-right tabular-nums font-semibold text-primary">{formatCurrency(r.valor_repasse_cooperado)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* rodapé total */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-[#EFF6FF] dark:bg-primary/10 border-t">
                  <span className="text-xs font-semibold text-primary uppercase tracking-wide">
                    Total {cooperado.nome.split(' ')[0]}
                  </span>
                  <span className="font-bold text-primary tabular-nums">{formatCurrency(cooperado.totalRepasse)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Extrato Financeiro ── */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-border/50">
          <div>
            <h2 className="text-lg font-bold">Extrato Financeiro</h2>
            <p className="text-sm text-muted-foreground">Demonstrativo financeiro da competência de faturamento</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardContent className="p-0">
                <div className="px-4 py-3 bg-[#F8FAFC] dark:bg-muted/20 border-b">
                  <p className="text-[13px] font-semibold">Demonstrativo da Nota Fiscal</p>
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    <tr>
                      <td className="px-4 py-2.5 text-muted-foreground text-[13px]">Valor Bruto da Nota Fiscal</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{fmtBRL(extratoValorBruto)}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 text-muted-foreground text-[13px]">(−) PIS (0,65%)</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-red-500">{fmtBRL(extratoPIS)}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 text-muted-foreground text-[13px]">(−) COFINS (3,00%)</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-red-500">{fmtBRL(extratoCOFINS)}</td>
                    </tr>
                    <tr className="bg-red-50 dark:bg-red-950/20">
                      <td className="px-4 py-2.5 text-[13px] font-medium">(=) Total das Contribuições Sociais Retidas (3,65%)</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-red-600">{fmtBRL(extratoTotalRetido)}</td>
                    </tr>
                    <tr className="bg-[#EFF6FF] dark:bg-primary/10">
                      <td className="px-4 py-3 text-[13px] font-bold text-primary">(=) Valor Líquido a Receber</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-primary text-[15px]">{fmtBRL(extratoValorLiquido)}</td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-0">
                <div className="px-4 py-3 bg-[#F8FAFC] dark:bg-muted/20 border-b">
                  <p className="text-[13px] font-semibold">Resumo da Competência</p>
                </div>
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    <tr className="bg-[#EFF6FF] dark:bg-primary/10">
                      <td className="px-4 py-3 text-[13px] font-bold text-primary">Valor Total de Repasse aos Cooperados</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-primary text-[15px]">{fmtBRL(extratoRepasseTotal)}</td>
                    </tr>
                    <tr className="bg-[#EFF6FF] dark:bg-primary/10">
                      <td className="px-4 py-3 text-[13px] font-bold text-primary">Total do INSS Patronal (20%)</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-primary text-[15px]">{fmtBRL(extratoINSSPatronal)}</td>
                    </tr>
                    <tr className="bg-[#EFF6FF] dark:bg-primary/10">
                      <td className="px-4 py-3 text-[13px] font-bold text-primary">
                        Valor Total da Cota-Parte Arrecadada
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          ({cooperadosAtivos} cooperado{cooperadosAtivos !== 1 ? 's' : ''} × R$ 80,00)
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-primary text-[15px]">{fmtBRL(extratoCotaParte)}</td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
