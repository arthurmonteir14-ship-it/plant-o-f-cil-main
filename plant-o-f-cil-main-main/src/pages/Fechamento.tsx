import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  Download, FileText, Eye, Send, CheckCircle, AlertCircle, Clock, RefreshCw, SendHorizonal, X,
} from 'lucide-react';
import { formatCurrency, profissaoLabel, tipoPlantaoLabel } from '@/lib/format';
import { exportarRelatorioExcel } from '@/lib/exportExcel';
import { PeriodoPicker } from '@/components/PeriodoPicker';
import { calcPeriodo, periodoInicial, PeriodoState } from '@/lib/periodo';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── Interfaces ───────────────────────────────────────────────────────────────

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
interface Cooperado {
  id: string;
  nome: string;
  cpf?: string | null;
  email?: string | null;
  profissao?: string;
  rg?: string | null;
  pis_inss?: string | null;
}

type StatusRPA = 'pendente' | 'enviado' | 'erro';

// ─── Constantes RPA ───────────────────────────────────────────────────────────

const PERCENTUAL_INSS = 0.20;
const DESCONTO_COTA_PARTE = 80;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtDate = (s: string) => s.split('-').reverse().join('/');

function formatarCPF(cpf: string | null | undefined): string {
  if (!cpf) return 'Não informado';
  const digits = cpf.replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  return cpf;
}

// ─── PDF Fechamento (existente) ───────────────────────────────────────────────

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

// ─── CSV Export (existente) ───────────────────────────────────────────────────

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

// ─── PDF RPA Individual ───────────────────────────────────────────────────────

async function gerarPDFRPA(cooperado: Cooperado, lancamentos: LancRow[], periodoLabel: string, download = true): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const ML = 14; const MR = 14; const CW = W - ML - MR;

  const valorBruto = lancamentos.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0);
  const descontoINSS = valorBruto * PERCENTUAL_INSS;
  const totalDescontos = descontoINSS + DESCONTO_COTA_PARTE;
  const valorLiquido = valorBruto - totalDescontos;
  const totalHoras = lancamentos.reduce((s, r) => s + Number(r.total_horas), 0);
  const valorHoraMedio = totalHoras > 0 ? valorBruto / totalHoras : 0;
  const slug = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '_');

  // ── Carregar logo ──
  let logoDataUrl: string | null = null;
  try {
    const resp = await fetch('/cades-logo.png');
    const blob = await resp.blob();
    logoDataUrl = await new Promise<string>(res => {
      const reader = new FileReader();
      reader.onloadend = () => res(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch { /* logo opcional */ }

  // ── Header ──
  const headerH = logoDataUrl ? 36 : 30;
  doc.setFillColor(232, 242, 252);
  doc.rect(0, 0, W, headerH, 'F');
  doc.setFillColor(26, 47, 90);
  doc.rect(0, headerH - 2, W, 2, 'F');
  if (logoDataUrl) {
    const logoH = 20; const logoW = 60;
    doc.addImage(logoDataUrl, 'PNG', ML, (headerH - logoH) / 2, logoW, logoH);
  } else {
    doc.setTextColor(26, 47, 90);
    doc.setFontSize(18); doc.setFont('helvetica', 'bold');
    doc.text('CADES', ML, 14);
    doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text('Cooperativa Assistencial de Trabalho do Espírito Santo', ML, 20);
  }
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(122, 122, 122);
  doc.text('COMPETÊNCIA', W - MR, headerH / 2 - 1, { align: 'right' });
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 47, 90);
  doc.text(periodoLabel, W - MR, headerH / 2 + 6, { align: 'right' });

  // ── Title block ──
  let y = headerH + 8;
  doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 47, 90);
  doc.text('Recibo de Pagamento Autônomo', ML, y);
  y += 6;
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(74, 74, 74);
  doc.text(`Competência ${periodoLabel}  ·  Pagamento de serviços de plantão prestados por cooperado(a)`, ML, y);
  y += 4;
  doc.setDrawColor(229, 229, 229); doc.line(ML, y, W - MR, y);
  y += 8;

  const drawSection = (num: string, title: string, meta?: string) => {
    doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 47, 90);
    doc.text(num, ML, y);
    doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 26, 26);
    doc.text(title, ML + 6, y);
    if (meta) { doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(122, 122, 122); doc.text(meta, W - MR, y, { align: 'right' }); }
    y += 3; doc.setDrawColor(229, 229, 229); doc.line(ML, y, W - MR, y); y += 3;
  };

  const drawDefGrid = (cells: Array<{ label: string; value: string; span?: number }>, startY: number) => {
    const colW = CW / 4; const rowH = 12;
    let col = 0; let row = 0;
    cells.forEach(cell => {
      const span = cell.span ?? 1;
      const x = ML + col * colW; const cellW = colW * span;
      doc.setDrawColor(229, 229, 229); doc.rect(x, startY + row * rowH, cellW, rowH);
      doc.setFontSize(6); doc.setFont('helvetica', 'normal'); doc.setTextColor(122, 122, 122);
      doc.text(cell.label.toUpperCase(), x + 3, startY + row * rowH + 4);
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(26, 26, 26);
      doc.text(cell.value || '—', x + 3, startY + row * rowH + 9.5);
      col += span; if (col >= 4) { col = 0; row++; }
    });
    return startY + (row + (col > 0 ? 1 : 0)) * rowH;
  };

  // ── §1 Emitente ──
  drawSection('01', 'EMITENTE');
  y = drawDefGrid([
    { label: 'Razão Social', value: 'CADES — Cooperativa Assistencial de Trabalho do Espírito Santo', span: 2 },
    { label: 'CNPJ', value: '50.181.159/0001-28' },
    { label: 'Endereço', value: 'R. Mario Aguirre, 45 — Jucutuquara, Vitória/ES' },
  ], y) + 6;

  // ── §2 Cooperado ──
  drawSection('02', 'COOPERADO(A)');
  y = drawDefGrid([
    { label: 'Nome Completo', value: cooperado.nome.toUpperCase(), span: 3 },
    { label: 'Categoria', value: profissaoLabel[cooperado.profissao ?? ''] ?? cooperado.profissao ?? '—' },
    { label: 'CPF', value: formatarCPF(cooperado.cpf) },
    { label: 'RG', value: cooperado.rg ?? '—' },
    { label: 'PIS / INSS', value: cooperado.pis_inss ?? '—' },
    { label: 'E-mail', value: cooperado.email ?? '—' },
  ], y) + 6;

  // ── §3 Plantões ──
  drawSection('03', 'ESPECIFICAÇÃO DOS SERVIÇOS', `${lancamentos.length} plantão${lancamentos.length !== 1 ? 'ões' : ''}`);
  autoTable(doc, {
    startY: y,
    head: [['Data', 'Setor', 'Hospital', 'Turno', 'Horas', 'Valor']],
    body: lancamentos.map(r => [
      fmtDate(r.data_plantao), r.sectors?.nome ?? '—', r.hospitals?.nome ?? '—',
      tipoPlantaoLabel[r.tipo_plantao] ?? r.tipo_plantao,
      Number(r.total_horas).toFixed(2) + 'h', fmt(Number(r.valor_repasse_cooperado)),
    ]),
    foot: [[
      { content: `${lancamentos.length} plantões`, styles: { halign: 'left' } }, '', '', '',
      { content: `${totalHoras.toFixed(2)}h`, styles: { halign: 'right' } },
      { content: fmt(valorBruto), styles: { halign: 'right' } },
    ]],
    styles: { fontSize: 7.5, cellPadding: 2.2, textColor: [26, 26, 26] },
    headStyles: { fillColor: [250, 250, 250], textColor: [122, 122, 122], fontStyle: 'bold', fontSize: 6.5, lineColor: [229, 229, 229], lineWidth: 0.2 },
    footStyles: { fillColor: [250, 250, 250], textColor: [26, 26, 26], fontStyle: 'bold', lineColor: [26, 26, 26], lineWidth: 0.3 },
    alternateRowStyles: { fillColor: [255, 255, 255] },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' } },
    margin: { left: ML, right: MR },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // ── §4 Apuração ──
  drawSection('04', 'APURAÇÃO DE VALORES');
  const halfW = CW / 2; const lRowH = 10;
  const ledgerRows = [
    { label: 'Valor Bruto dos Serviços', value: fmt(valorBruto), col: 0, subtotal: true },
    { label: 'Total de Descontos', value: `− ${fmt(totalDescontos)}`, col: 1, subtotal: true, negative: true },
    { label: 'Honorários líquidos antes de cota', value: fmt(valorBruto), col: 0 },
    { label: `INSS (${(PERCENTUAL_INSS * 100).toFixed(0)}%)`, value: `− ${fmt(descontoINSS)}`, col: 1, negative: true },
    { label: 'Quantidade de plantões', value: String(lancamentos.length).padStart(2, '0'), col: 0 },
    { label: 'Cota-parte cooperativa', value: `− ${fmt(DESCONTO_COTA_PARTE)}`, col: 1, negative: true },
    { label: 'Valor-hora médio apurado', value: `${fmt(valorHoraMedio)} / h`, col: 0 },
    { label: 'IRRF', value: fmt(0), col: 1, zero: true },
  ];
  ledgerRows.forEach((lr, i) => {
    const row = Math.floor(i / 2); const x = ML + lr.col * halfW; const ly = y + row * lRowH;
    if (lr.subtotal) { doc.setFillColor(250, 250, 250); doc.rect(x, ly, halfW, lRowH, 'F'); }
    doc.setDrawColor(229, 229, 229); doc.rect(x, ly, halfW, lRowH);
    doc.setFontSize(7.5); doc.setFont('helvetica', lr.subtotal ? 'bold' : 'normal'); doc.setTextColor(74, 74, 74);
    doc.text(lr.label, x + 3, ly + 6.5);
    const valColor: [number, number, number] = lr.negative ? [220, 38, 38] : lr.zero ? [122, 122, 122] : [26, 26, 26];
    doc.setTextColor(...valColor); doc.setFont('helvetica', lr.subtotal ? 'bold' : 'normal');
    doc.text(lr.value, x + halfW - 3, ly + 6.5, { align: 'right' });
  });
  y += Math.ceil(ledgerRows.length / 2) * lRowH + 6;

  // ── Net block ──
  const netH = 20;
  doc.setFillColor(26, 47, 90); doc.rect(ML, y, CW, netH, 'F');
  doc.setFillColor(47, 106, 208); doc.rect(ML, y, 3, netH / 3, 'F');
  doc.setFillColor(255, 255, 255); doc.rect(ML, y + netH / 3, 3, netH / 3, 'F');
  doc.setFillColor(232, 154, 168); doc.rect(ML, y + (2 * netH) / 3, 3, netH / 3, 'F');
  doc.setTextColor(255, 255, 255); doc.setFontSize(7.5); doc.setFont('helvetica', 'bold');
  doc.text('VALOR LÍQUIDO A RECEBER', ML + 8, y + 7);
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(220, 220, 220);
  doc.text(`Referente aos serviços prestados na competência ${periodoLabel}`, ML + 8, y + 13);
  doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text(fmt(valorLiquido), W - MR, y + 14, { align: 'right' });
  y += netH + 10;

  // ── §5 Assinaturas ──
  drawSection('05', 'ASSINATURAS');
  y += 8;
  const sigW = (CW - 16) / 2;
  doc.setDrawColor(26, 26, 26); doc.setLineWidth(0.3);
  doc.line(ML, y, ML + sigW, y);
  doc.line(ML + sigW + 16, y, W - MR, y);
  doc.setLineWidth(0.2);
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 26, 26);
  doc.text(cooperado.nome.toUpperCase(), ML + sigW / 2, y + 5, { align: 'center' });
  doc.text('CADES — REPRESENTANTE LEGAL', ML + sigW + 16 + sigW / 2, y + 5, { align: 'center' });
  doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(122, 122, 122);
  doc.text('Cooperado(a)', ML + sigW / 2, y + 9, { align: 'center' });
  doc.text('Cooperativa Assistencial de Trabalho do Espírito Santo', ML + sigW + 16 + sigW / 2, y + 9, { align: 'center' });
  y += 20;

  // ── Faixa de emissão ──
  doc.setDrawColor(229, 229, 229); doc.line(ML, y, W - MR, y); y += 5;
  doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(122, 122, 122);
  doc.text('LOCALIDADE', ML, y);
  doc.text('DATA DE EMISSÃO', ML + CW / 3, y);
  doc.text('DOCUMENTO', ML + (CW * 2) / 3, y);
  y += 3.5;
  doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 26, 26);
  doc.text('Vitória / ES', ML, y);
  doc.text(new Date().toLocaleDateString('pt-BR'), ML + CW / 3, y);
  doc.text('RPA', ML + (CW * 2) / 3, y);

  // ── Rodapé ──
  doc.setFillColor(26, 47, 90); doc.rect(0, H - 10, W, 2, 'F');
  doc.setTextColor(26, 47, 90); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  doc.text('CADES', ML, H - 4);
  doc.setTextColor(122, 122, 122); doc.setFontSize(6.5); doc.setFont('helvetica', 'normal');
  doc.text(`RPA  ·  ${periodoLabel}  ·  ${cooperado.nome}`, W - MR, H - 4, { align: 'right' });

  if (download) doc.save(`RPA_${slug(cooperado.nome)}_${slug(periodoLabel)}.pdf`);
  return doc;
}

// ─── Envio de e-mail via Edge Function ────────────────────────────────────────

async function enviarRPAEmail(cooperado: Cooperado, lancamentos: LancRow[], periodoLabel: string): Promise<{ success: boolean; error?: string }> {
  if (!cooperado.email) return { success: false, error: 'E-mail não cadastrado para este cooperado.' };
  try {
    const doc = await gerarPDFRPA(cooperado, lancamentos, periodoLabel, false);
    const slug = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '_');
    const pdfName = `RPA_${slug(cooperado.nome)}_${slug(periodoLabel)}.pdf`;
    const pdfBase64 = doc.output('datauristring').split(',')[1];
    const { error } = await supabase.functions.invoke('enviar-rpa', {
      body: { to: cooperado.email, cooperadoNome: cooperado.nome, periodoLabel, pdfBase64, pdfName },
    });
    if (error) throw new Error(error.message);
    return { success: true };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : 'Erro ao enviar e-mail.' };
  }
}

// ─── Modal de Visualização da RPA ─────────────────────────────────────────────

function ModalVisualizarRPA({ open, onClose, cooperado, lancamentos, periodoLabel }: {
  open: boolean; onClose: () => void;
  cooperado: Cooperado; lancamentos: LancRow[]; periodoLabel: string;
}) {
  const valorBruto = lancamentos.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0);
  const descontoINSS = valorBruto * PERCENTUAL_INSS;
  const totalDescontos = descontoINSS + DESCONTO_COTA_PARTE;
  const valorLiquido = valorBruto - totalDescontos;
  const totalHoras = lancamentos.reduce((s, r) => s + Number(r.total_horas), 0);
  const valorHoraMedio = totalHoras > 0 ? valorBruto / totalHoras : 0;

  const navy = '#1a2f5a';
  const lineColor = '#e5e5e5';
  const inkLighter = '#7a7a7a';
  const inkLight = '#4a4a4a';

  const DefCell = ({ label, value, span = 1, mono = false }: { label: string; value: string; span?: number; mono?: boolean }) => (
    <div style={{ gridColumn: `span ${span}`, padding: '10px 14px', borderRight: `1px solid ${lineColor}`, borderBottom: `1px solid ${lineColor}`, display: 'flex', flexDirection: 'column', gap: 3, minHeight: 48 }}>
      <span style={{ fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: inkLighter }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 500, color: '#1a1a1a', fontFamily: mono ? 'monospace' : undefined }}>{value || '—'}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-5 pb-2">
          <DialogTitle className="text-base">Visualizar RPA — {cooperado.nome}</DialogTitle>
        </DialogHeader>

        {/* Document sheet */}
        <div className="mx-5 mb-4 border border-[#e5e5e5] overflow-hidden" style={{ fontFamily: "'IBM Plex Sans', -apple-system, sans-serif" }}>

          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 24, padding: '16px 24px', background: 'linear-gradient(180deg, #e8f2fc 0%, #d4e5f7 100%)', borderBottom: `2px solid ${navy}` }}>
            <img src="/cades-logo.png" alt="CADES" style={{ height: 56, width: 'auto', display: 'block', objectFit: 'contain' }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: inkLighter, marginBottom: 2 }}>Competência</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: navy, fontFamily: 'monospace' }}>{periodoLabel}</div>
            </div>
          </div>

          <div style={{ padding: '22px 24px 0' }}>
            {/* Title block */}
            <div style={{ paddingBottom: 14, borderBottom: `1px solid ${lineColor}`, marginBottom: 22 }}>
              <div style={{ fontSize: 20, fontWeight: 600, color: navy, letterSpacing: '-0.02em' }}>Recibo de Pagamento Autônomo</div>
              <div style={{ fontSize: 12, color: inkLight, marginTop: 6 }}>
                Competência <strong style={{ fontFamily: 'monospace', color: navy }}>{periodoLabel}</strong> · Pagamento de serviços de plantão prestados por cooperado(a)
              </div>
            </div>

            {/* §1 Emitente */}
            <div style={{ marginTop: 22, marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, paddingBottom: 8, borderBottom: `1px solid ${lineColor}`, marginBottom: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: navy, fontFamily: 'monospace' }}>01</span>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Emitente</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderTop: `1px solid ${lineColor}`, borderLeft: `1px solid ${lineColor}` }}>
                <DefCell label="Razão Social" value="CADES — Cooperativa Assistencial de Trabalho do Espírito Santo" span={2} />
                <DefCell label="CNPJ" value="50.181.159/0001-28" mono />
                <DefCell label="Endereço" value="R. Mario Aguirre, 45 — Jucutuquara, Vitória/ES" />
              </div>
            </div>

            {/* §2 Cooperado */}
            <div style={{ marginTop: 22 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, paddingBottom: 8, borderBottom: `1px solid ${lineColor}`, marginBottom: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: navy, fontFamily: 'monospace' }}>02</span>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Cooperado(a)</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', borderTop: `1px solid ${lineColor}`, borderLeft: `1px solid ${lineColor}` }}>
                <DefCell label="Nome Completo" value={cooperado.nome.toUpperCase()} span={3} />
                <DefCell label="Categoria" value={profissaoLabel[cooperado.profissao ?? ''] ?? cooperado.profissao ?? '—'} />
                <DefCell label="CPF" value={formatarCPF(cooperado.cpf)} mono />
                <DefCell label="RG" value={cooperado.rg ?? '—'} mono />
                <DefCell label="PIS / INSS" value={cooperado.pis_inss ?? '—'} mono />
                <DefCell label="E-mail" value={cooperado.email ?? '—'} />
              </div>
            </div>

            {/* §3 Plantões */}
            <div style={{ marginTop: 22 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, paddingBottom: 8, borderBottom: `1px solid ${lineColor}`, marginBottom: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: navy, fontFamily: 'monospace' }}>03</span>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Especificação dos Serviços</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: inkLighter, fontFamily: 'monospace' }}>{lancamentos.length} plantão{lancamentos.length !== 1 ? 'ões' : ''}</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', borderTop: `1px solid ${lineColor}`, borderBottom: `1px solid #1a1a1a`, fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    {['Data', 'Setor', 'Hospital', 'Turno', 'Horas', 'Valor'].map((h, i) => (
                      <th key={h} style={{ padding: '9px 12px', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: inkLighter, textAlign: i >= 4 ? 'right' : 'left', borderBottom: `1px solid ${lineColor}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lancamentos.map(r => (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${lineColor}` }}>
                      <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontWeight: 500 }}>{fmtDate(r.data_plantao)}</td>
                      <td style={{ padding: '9px 12px', color: inkLight }}>{r.sectors?.nome ?? '—'}</td>
                      <td style={{ padding: '9px 12px' }}>{r.hospitals?.nome ?? '—'}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'center', fontFamily: 'monospace', fontSize: 10, color: inkLight }}>{tipoPlantaoLabel[r.tipo_plantao] ?? r.tipo_plantao}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 500 }}>{Number(r.total_horas).toFixed(2)}h</td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 500 }}>{fmt(Number(r.valor_repasse_cooperado))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#fafafa', borderTop: `1px solid #1a1a1a` }}>
                    <td style={{ padding: '11px 12px', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: inkLight }}>{lancamentos.length} plantões</td>
                    <td colSpan={3} />
                    <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{totalHoras.toFixed(2)}h</td>
                    <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{fmt(valorBruto)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* §4 Apuração */}
            <div style={{ marginTop: 22 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, paddingBottom: 8, borderBottom: `1px solid ${lineColor}`, marginBottom: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: navy, fontFamily: 'monospace' }}>04</span>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Apuração de Valores</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `1px solid ${lineColor}`, borderLeft: `1px solid ${lineColor}` }}>
                {[
                  { label: 'Valor Bruto dos Serviços', value: fmt(valorBruto), subtotal: true },
                  { label: 'Total de Descontos', value: `− ${fmt(totalDescontos)}`, subtotal: true, negative: true },
                  { label: 'Honorários líquidos antes de cota', value: fmt(valorBruto), subtotal: false },
                  { label: `INSS (${(PERCENTUAL_INSS * 100).toFixed(0)}%)`, value: `− ${fmt(descontoINSS)}`, subtotal: false, negative: true },
                  { label: 'Quantidade de plantões', value: String(lancamentos.length).padStart(2, '0'), subtotal: false },
                  { label: 'Cota-parte cooperativa', value: `− ${fmt(DESCONTO_COTA_PARTE)}`, subtotal: false, negative: true },
                  { label: 'Valor-hora médio apurado', value: `${fmt(valorHoraMedio)} / h`, subtotal: false },
                  { label: 'IRRF', value: fmt(0), subtotal: false, zero: true },
                ].map((lr, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'baseline', padding: '10px 14px', borderRight: `1px solid ${lineColor}`, borderBottom: `1px solid ${lineColor}`, gap: 16, background: lr.subtotal ? '#fafafa' : undefined, borderTop: lr.subtotal ? `1px solid #1a1a1a` : undefined }}>
                    <span style={{ fontSize: 11, color: inkLight, fontWeight: lr.subtotal ? 600 : 400, textTransform: lr.subtotal ? 'uppercase' : undefined, letterSpacing: lr.subtotal ? '0.08em' : undefined }}>{lr.label}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 12.5, fontWeight: lr.subtotal ? 600 : 500, color: (lr as any).negative ? '#dc2626' : (lr as any).zero ? inkLighter : '#1a1a1a', whiteSpace: 'nowrap' }}>{lr.value}</span>
                  </div>
                ))}
              </div>

              {/* Net block */}
              <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 24, padding: '18px 22px', background: navy, color: '#fff', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: 'linear-gradient(180deg, #2f6ad0 0%, #2f6ad0 33%, #fff 33%, #fff 66%, #e89aa8 66%, #e89aa8 100%)' }} />
                <div style={{ paddingLeft: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.7)', marginBottom: 3 }}>Valor Líquido a Receber</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>Referente aos serviços prestados na competência {periodoLabel}</div>
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.6)', marginRight: 4 }}>R$</span>
                  {valorLiquido.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {/* §5 Assinaturas */}
            <div style={{ marginTop: 36 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, paddingBottom: 8, borderBottom: `1px solid ${lineColor}`, marginBottom: 0 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: navy, fontFamily: 'monospace' }}>05</span>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Assinaturas</span>
              </div>
              <div style={{ marginTop: 36, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
                {[
                  { name: cooperado.nome.toUpperCase(), role: 'Cooperado(a)' },
                  { name: 'CADES — REPRESENTANTE LEGAL', role: 'Cooperativa Assistencial de Trabalho do Espírito Santo' },
                ].map((sig, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ borderBottom: '1px solid #1a1a1a', height: 56 }} />
                    <div style={{ marginTop: 6, fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>{sig.name}</div>
                    <div style={{ marginTop: 2, fontSize: 10, color: inkLighter, textAlign: 'center', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{sig.role}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 14, borderTop: `1px solid ${lineColor}` }}>
                {[['Localidade', 'Vitória / ES — ES'], ['Data de Emissão', new Date().toLocaleDateString('pt-BR')], ['Documento', 'RPA']].map(([lbl, val]) => (
                  <div key={lbl} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: inkLighter, fontSize: 9.5, fontWeight: 500 }}>{lbl}</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 500, fontSize: 11, color: '#1a1a1a' }}>{val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sheet footer */}
          <div style={{ marginTop: 28, borderTop: `2px solid ${navy}`, padding: '12px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, letterSpacing: '0.18em', fontSize: 11, color: navy }}>CADES</span>
            <span style={{ fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 9.5, color: inkLighter }}>RPA · {periodoLabel} · {cooperado.nome}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={() => { void gerarPDFRPA(cooperado, lancamentos, periodoLabel, true); }}>
            <Download className="h-4 w-4 mr-2" /> Baixar PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Card de Cooperado para RPA ───────────────────────────────────────────────

function CardCooperadoRPA({ cooperado, lancamentos, periodoLabel, status, onStatusChange }: {
  cooperado: Cooperado; lancamentos: LancRow[]; periodoLabel: string;
  status: StatusRPA; onStatusChange: (s: StatusRPA) => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const [sending, setSending] = useState(false);

  const valorBruto = lancamentos.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0);
  const descontoINSS = valorBruto * PERCENTUAL_INSS;
  const valorLiquido = valorBruto - descontoINSS - DESCONTO_COTA_PARTE;

  const handleEnviar = async () => {
    setSending(true);
    const result = await enviarRPAEmail(cooperado, lancamentos, periodoLabel);
    setSending(false);
    if (result.success) { onStatusChange('enviado'); toast.success(`RPA enviada para ${cooperado.email}`); }
    else { onStatusChange('erro'); toast.error(result.error ?? 'Erro ao enviar RPA'); }
  };

  const statusMap: Record<StatusRPA, { label: string; variant: 'secondary' | 'default' | 'destructive'; Icon: typeof Clock }> = {
    pendente: { label: 'Pendente', variant: 'secondary', Icon: Clock },
    enviado: { label: 'Enviado', variant: 'default', Icon: CheckCircle },
    erro: { label: 'Erro', variant: 'destructive', Icon: AlertCircle },
  };
  const { label: statusLabel, variant: statusVariant, Icon: StatusIcon } = statusMap[status];

  return (
    <>
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{cooperado.nome}</p>
              <p className="text-xs text-muted-foreground">{profissaoLabel[cooperado.profissao ?? ''] ?? cooperado.profissao ?? '—'}</p>
              {cooperado.cpf && <p className="text-xs text-muted-foreground">CPF: {formatarCPF(cooperado.cpf)}</p>}
            </div>
            <Badge variant={statusVariant} className={`ml-2 shrink-0 flex items-center gap-1 ${status === 'enviado' ? 'bg-green-600 hover:bg-green-700' : ''}`}>
              <StatusIcon className="h-3 w-3" />{statusLabel}
            </Badge>
          </div>
          <div className="bg-muted/40 rounded-md p-3 mb-3 space-y-1.5">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">Valor Bruto</span><span className="tabular-nums">{fmt(valorBruto)}</span></div>
            <div className="flex justify-between text-xs text-red-600"><span>(-) INSS 20%</span><span className="tabular-nums">({fmt(descontoINSS)})</span></div>
            <div className="flex justify-between text-xs text-red-600"><span>(-) Cota Parte</span><span className="tabular-nums">({fmt(DESCONTO_COTA_PARTE)})</span></div>
            <div className="border-t border-border/60 pt-1.5 flex justify-between">
              <span className="text-sm font-bold text-primary">Valor Líquido</span>
              <span className="text-sm font-bold text-primary tabular-nums">{fmt(valorLiquido)}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            {lancamentos.length} plantão{lancamentos.length !== 1 ? 'ões' : ''}
            {cooperado.email ? <span className="ml-1 truncate block">✉ {cooperado.email}</span> : <span className="ml-1 text-amber-600"> · Sem e-mail</span>}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            <Button variant="outline" size="sm" className="gap-1 text-xs px-2" onClick={() => setShowModal(true)}>
              <Eye className="h-3.5 w-3.5" /><span className="hidden sm:inline">Visualizar</span><span className="sm:hidden">Ver</span>
            </Button>
            <Button variant="outline" size="sm" className="gap-1 text-xs px-2" onClick={() => { void gerarPDFRPA(cooperado, lancamentos, periodoLabel, true); }}>
              <FileText className="h-3.5 w-3.5" /><span>PDF</span>
            </Button>
            <Button size="sm" className={`gap-1 text-xs px-2 ${status === 'enviado' ? 'bg-green-600 hover:bg-green-700' : ''}`}
              disabled={sending || !cooperado.email} onClick={handleEnviar}
              title={!cooperado.email ? 'E-mail não cadastrado' : status === 'enviado' ? 'Reenviar RPA' : 'Enviar RPA'}>
              {sending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              <span>{sending ? '…' : status === 'enviado' ? 'Reenviar' : 'Enviar'}</span>
            </Button>
          </div>
        </CardContent>
      </Card>
      {showModal && <ModalVisualizarRPA open={showModal} onClose={() => setShowModal(false)} cooperado={cooperado} lancamentos={lancamentos} periodoLabel={periodoLabel} />}
    </>
  );
}

// ─── Aba RPA ──────────────────────────────────────────────────────────────────

function AbaRPA({ rows, hospitals, cooperados, periodoLabel }: { rows: LancRow[]; hospitals: Hospital[]; cooperados: Cooperado[]; periodoLabel: string; }) {
  const [rpaStatus, setRpaStatus] = useState<Record<string, StatusRPA>>({});
  const [filterHospital, setFilterHospital] = useState('all');
  const [filterCooperado, setFilterCooperado] = useState('all');

  // ── Envio em massa ──
  type ProgressoEnvio = { total: number; atual: number; enviados: number; erros: number; nomAtual: string; concluido: boolean };
  const [enviandoTodos, setEnviandoTodos] = useState(false);
  const [progresso, setProgresso] = useState<ProgressoEnvio | null>(null);
  const abortRef = useState({ cancelado: false })[0];

  const enviarTodos = async () => {
    const comEmail = filtered.filter(g => g.cooperado.email);
    if (comEmail.length === 0) { toast.error('Nenhum cooperado com e-mail cadastrado.'); return; }
    abortRef.cancelado = false;
    setEnviandoTodos(true);
    const prog: ProgressoEnvio = { total: comEmail.length, atual: 0, enviados: 0, erros: 0, nomAtual: '', concluido: false };
    setProgresso({ ...prog });

    for (const { cooperado, lancamentos } of comEmail) {
      if (abortRef.cancelado) break;
      prog.atual++;
      prog.nomAtual = cooperado.nome;
      setProgresso({ ...prog });

      const result = await enviarRPAEmail(cooperado, lancamentos, periodoLabel);
      if (result.success) {
        prog.enviados++;
        setRpaStatus(prev => ({ ...prev, [cooperado.id]: 'enviado' }));
      } else {
        prog.erros++;
        setRpaStatus(prev => ({ ...prev, [cooperado.id]: 'erro' }));
      }
      setProgresso({ ...prog });

      // pausa de 400ms entre envios para não sobrecarregar o Brevo
      if (!abortRef.cancelado) await new Promise(r => setTimeout(r, 400));
    }

    prog.concluido = true;
    setProgresso({ ...prog });
    setEnviandoTodos(false);
    toast.success(`Envio concluído: ${prog.enviados} enviados${prog.erros > 0 ? `, ${prog.erros} com erro` : ''}.`);
  };

  const cancelarEnvio = () => { abortRef.cancelado = true; };

  const rowsFiltrados = useMemo(() =>
    filterHospital === 'all' ? rows : rows.filter(r => r.hospitals?.id === filterHospital),
    [rows, filterHospital],
  );

  const gruposPorCooperado = useMemo(() => {
    const map: Record<string, { cooperado: Cooperado; lancamentos: LancRow[] }> = {};
    rowsFiltrados.forEach(r => {
      const cid = r.cooperados?.id; if (!cid) return;
      if (!map[cid]) {
        const coopExtra = cooperados.find(c => c.id === cid);
        map[cid] = {
          cooperado: {
            id: cid,
            nome: r.cooperados?.nome ?? 'Sem nome',
            cpf: coopExtra?.cpf,
            email: coopExtra?.email,
            profissao: coopExtra?.profissao ?? r.profissao,
          },
          lancamentos: [],
        };
      }
      map[cid].lancamentos.push(r);
    });
    return Object.values(map).sort((a, b) => a.cooperado.nome.localeCompare(b.cooperado.nome));
  }, [rowsFiltrados, cooperados]);

  const filtered = useMemo(() => filterCooperado === 'all' ? gruposPorCooperado : gruposPorCooperado.filter(g => g.cooperado.id === filterCooperado), [gruposPorCooperado, filterCooperado]);

  const totais = useMemo(() => {
    let bruto = 0, liquido = 0;
    filtered.forEach(({ lancamentos }) => { const b = lancamentos.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0); bruto += b; liquido += b - b * PERCENTUAL_INSS - DESCONTO_COTA_PARTE; });
    return { bruto, inss: bruto * PERCENTUAL_INSS, liquido };
  }, [filtered]);

  const statusCounts = useMemo(() => {
    const c = { pendente: 0, enviado: 0, erro: 0 };
    filtered.forEach(({ cooperado }) => { c[rpaStatus[cooperado.id] ?? 'pendente']++; });
    return c;
  }, [filtered, rpaStatus]);

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3 items-end">
          <div className="min-w-[200px]">
            <Label className="text-xs">Cliente</Label>
            <Select value={filterHospital} onValueChange={v => { setFilterHospital(v); setFilterCooperado('all'); }}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os clientes</SelectItem>
                {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[200px]">
            <Label className="text-xs">Cooperado</Label>
            <Select value={filterCooperado} onValueChange={setFilterCooperado}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os cooperados</SelectItem>
                {gruposPorCooperado.map(({ cooperado: c }) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 flex-wrap pb-0.5">
            <Badge variant="secondary" className="gap-1.5"><Clock className="h-3 w-3" /> Pendente: {statusCounts.pendente}</Badge>
            <Badge className="gap-1.5 bg-green-600 hover:bg-green-700"><CheckCircle className="h-3 w-3" /> Enviado: {statusCounts.enviado}</Badge>
            {statusCounts.erro > 0 && <Badge variant="destructive" className="gap-1.5"><AlertCircle className="h-3 w-3" /> Erro: {statusCounts.erro}</Badge>}
          </div>
          <div className="ml-auto pb-0.5">
            <Button
              size="sm"
              className="gap-2 bg-blue-700 hover:bg-blue-800"
              onClick={enviarTodos}
              disabled={enviandoTodos || filtered.length === 0}
            >
              {enviandoTodos
                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                : <SendHorizonal className="h-3.5 w-3.5" />}
              Enviar todos ({filtered.filter(g => g.cooperado.email).length} com e-mail)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Painel de progresso do envio em massa */}
      {progresso && (
        <Card className={`border-2 ${progresso.concluido ? (progresso.erros === 0 ? 'border-green-500' : 'border-amber-500') : 'border-blue-500'}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">
                {progresso.concluido ? 'Envio concluído' : `Enviando… ${progresso.atual} de ${progresso.total}`}
              </p>
              <div className="flex items-center gap-2">
                {!progresso.concluido && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive" onClick={cancelarEnvio}>
                    <X className="h-3.5 w-3.5" /> Cancelar
                  </Button>
                )}
                {progresso.concluido && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setProgresso(null)}>
                    <X className="h-3.5 w-3.5" /> Fechar
                  </Button>
                )}
              </div>
            </div>
            {/* Barra de progresso */}
            <div className="w-full bg-muted rounded-full h-2 mb-2">
              <div
                className={`h-2 rounded-full transition-all duration-300 ${progresso.concluido && progresso.erros === 0 ? 'bg-green-500' : progresso.erros > 0 ? 'bg-amber-500' : 'bg-blue-600'}`}
                style={{ width: `${progresso.total > 0 ? (progresso.atual / progresso.total) * 100 : 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {!progresso.concluido && progresso.nomAtual && <>Enviando para: <strong>{progresso.nomAtual}</strong></>}
                {progresso.concluido && 'Processo finalizado.'}
              </span>
              <span className="flex gap-3">
                <span className="text-green-600 font-medium">✓ {progresso.enviados} enviados</span>
                {progresso.erros > 0 && <span className="text-red-500 font-medium">✗ {progresso.erros} erros</span>}
                <span className="text-muted-foreground">{progresso.total - progresso.atual} restantes</span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-3 gap-3">
        {[{ label: 'Total Bruto', value: fmt(totais.bruto) }, { label: 'INSS Total (20%)', value: fmt(totais.inss) }, { label: 'Total Líquido', value: fmt(totais.liquido) }].map(c => (
          <Card key={c.label}><CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</p>
            <p className="text-lg font-bold tabular-nums text-accent mt-0.5">{c.value}</p>
          </CardContent></Card>
        ))}
      </div>
      {filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">Nenhum cooperado com lançamentos no período selecionado.</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(({ cooperado, lancamentos }) => (
            <CardCooperadoRPA key={cooperado.id} cooperado={cooperado} lancamentos={lancamentos} periodoLabel={periodoLabel}
              status={rpaStatus[cooperado.id] ?? 'pendente'} onStatusChange={s => setRpaStatus(prev => ({ ...prev, [cooperado.id]: s }))} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tabela por Grupo ─────────────────────────────────────────────────────────

function TabelaGrupos({ grupos, valorKey, grupoLabel, subGrupoLabel }: {
  grupos: [string, LancRow[]][]; valorKey: 'valor_cobrado_cliente' | 'valor_repasse_cooperado';
  grupoLabel: string; subGrupoLabel: (r: LancRow) => string;
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
              <div><span className="font-semibold text-sm">{nome}</span><span className="ml-3 text-xs text-muted-foreground">{lancs.length} plantão{lancs.length !== 1 ? 'ões' : ''} · {horas.toFixed(1)}h</span></div>
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
      <div className="rounded-lg border-2 border-primary/30 bg-primary/5 px-4 py-3 flex items-center justify-between">
        <div className="font-bold text-primary">Total geral<span className="ml-2 text-sm font-normal text-primary/70">{qtdGeral} plantões · {horasGeral.toFixed(1)}h</span></div>
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
  const grupos = useMemo(() => {
    const map: Record<string, LancRow[]> = {};
    filtered.forEach(r => { const k = filterHospital !== 'all' ? (r.cooperados?.nome ?? 'Sem cooperado') : (r.hospitals?.nome ?? 'Sem hospital'); if (!map[k]) map[k] = []; map[k].push(r); });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, filterHospital]);
  const grupoNome = filterHospital !== 'all' ? hospitals.find(h => h.id === filterHospital)?.nome ?? '' : '';

  return (
    <div className="space-y-5">
      <Card><CardContent className="p-4 grid gap-3 sm:grid-cols-3">
        <div><Label className="text-xs">Cliente</Label>
          <Select value={filterHospital} onValueChange={v => { setFilterHospital(v); setFilterSetor('all'); }}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos os clientes</SelectItem>{hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.nome}</SelectItem>)}</SelectContent>
          </Select></div>
        <div><Label className="text-xs">Cooperado</Label>
          <Select value={filterCooperado} onValueChange={setFilterCooperado}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos os cooperados</SelectItem>{cooperados.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
          </Select></div>
        <div><Label className="text-xs">Setor</Label>
          <Select value={filterSetor} onValueChange={setFilterSetor}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos os setores</SelectItem>{setoresFiltrados.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}</SelectContent>
          </Select></div>
      </CardContent></Card>
      <div className="grid grid-cols-3 gap-3">
        {[{ label: 'Plantões', value: filtered.length }, { label: 'Total horas', value: `${filtered.reduce((s, r) => s + Number(r.total_horas), 0).toFixed(1)}h` }, { label: 'Total a cobrar', value: formatCurrency(filtered.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0)) }].map(c => (
          <Card key={c.label}><CardContent className="p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</p><p className="text-lg font-bold tabular-nums mt-0.5">{c.value}</p></CardContent></Card>
        ))}
      </div>
      {filtered.length > 0 && <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" className="gap-2" onClick={() => gerarPDFFechamento(filtered, periodoLabel, 'cobranca', grupoNome)}><FileText className="h-4 w-4" /> PDF</Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => exportarRelatorioExcel(filtered as any, 'cobranca', periodoLabel, grupoNome, filterCooperado !== 'all' ? filterCooperado : undefined)}><Download className="h-4 w-4" /> Excel</Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => exportCSV(filtered, 'cobranca', periodoLabel)}><Download className="h-4 w-4" /> CSV</Button>
      </div>}
      {filtered.length === 0 ? <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">Nenhum lançamento para os filtros selecionados.</CardContent></Card>
        : <TabelaGrupos grupos={grupos} valorKey="valor_cobrado_cliente" grupoLabel={filterHospital !== 'all' ? 'Cooperado' : 'Hospital'} subGrupoLabel={r => filterHospital !== 'all' ? (r.cooperados?.nome ?? '—') : (r.hospitals?.nome ?? '—')} />}
    </div>
  );
}

// ─── Aba Repasse ──────────────────────────────────────────────────────────────

function AbaRepasse({ rows, hospitals, sectors, cooperados, periodoLabel }: {
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

  const grupos = useMemo(() => {
    if (filterCooperado !== 'all') {
      const map: Record<string, LancRow[]> = {};
      filtered.forEach(r => { const k = r.hospitals?.nome ?? 'Sem hospital'; if (!map[k]) map[k] = []; map[k].push(r); });
      return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
    }
    const map: Record<string, LancRow[]> = {};
    filtered.forEach(r => { const k = r.cooperados?.nome ?? 'Sem cooperado'; if (!map[k]) map[k] = []; map[k].push(r); });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, filterCooperado]);

  const coopNome = cooperados.find(c => c.id === filterCooperado)?.nome ?? '';

  return (
    <div className="space-y-5">
      <Card><CardContent className="p-4 grid gap-3 sm:grid-cols-4">
        <div><Label className="text-xs">Cliente</Label>
          <Select value={filterHospital} onValueChange={v => { setFilterHospital(v); setFilterSetor('all'); }}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos os clientes</SelectItem>{hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.nome}</SelectItem>)}</SelectContent>
          </Select></div>
        <div><Label className="text-xs">Cooperado</Label>
          <Select value={filterCooperado} onValueChange={setFilterCooperado}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos os cooperados</SelectItem>{cooperados.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
          </Select></div>
        <div><Label className="text-xs">Setor</Label>
          <Select value={filterSetor} onValueChange={setFilterSetor}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos os setores</SelectItem>{setoresFiltrados.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="flex items-end"><div className="text-sm text-muted-foreground self-end pb-1">{filtered.length} lançamento{filtered.length !== 1 ? 's' : ''}</div></div>
      </CardContent></Card>
      <div className="grid grid-cols-3 gap-3">
        {[{ label: 'Plantões', value: filtered.length }, { label: 'Total horas', value: `${filtered.reduce((s, r) => s + Number(r.total_horas), 0).toFixed(1)}h` }, { label: 'Total a repassar', value: formatCurrency(filtered.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0)) }].map(c => (
          <Card key={c.label}><CardContent className="p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">{c.label}</p><p className="text-lg font-bold tabular-nums text-accent mt-0.5">{c.value}</p></CardContent></Card>
        ))}
      </div>
      {filtered.length > 0 && <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" className="gap-2" onClick={() => gerarPDFFechamento(filtered, periodoLabel, 'repasse', coopNome)}><FileText className="h-4 w-4" /> PDF</Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => exportarRelatorioExcel(filtered as any, 'repasse', periodoLabel, coopNome, filterCooperado !== 'all' ? filterCooperado : undefined)}><Download className="h-4 w-4" /> Excel</Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => exportCSV(filtered, 'repasse', periodoLabel)}><Download className="h-4 w-4" /> CSV</Button>
      </div>}
      {filtered.length === 0 ? <Card><CardContent className="p-10 text-center text-sm text-muted-foreground">Nenhum lançamento para os filtros selecionados.</CardContent></Card>
        : <TabelaGrupos grupos={grupos} valorKey="valor_repasse_cooperado" grupoLabel={filterCooperado !== 'all' ? 'Hospital' : 'Cooperado'} subGrupoLabel={r => filterCooperado !== 'all' ? (r.hospitals?.nome ?? '—') : (r.cooperados?.nome ?? '—')} />}
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
    const PAGE = 1000;
    let allRows: LancRow[] = [];
    let from = 0;

    while (true) {
      const { data } = await supabase
        .from('lancamentos_plantoes')
        .select('id, data_plantao, total_horas, profissao, tipo_plantao, valor_cobrado_cliente, valor_repasse_cooperado, cooperados(id, nome), hospitals(id, nome), sectors(id, nome)')
        .gte('data_plantao', periodoCalc.inicio)
        .lte('data_plantao', periodoCalc.fim)
        .order('data_plantao', { ascending: true })
        .range(from, from + PAGE - 1);

      const page = (data ?? []) as unknown as LancRow[];
      allRows = [...allRows, ...page];
      if (page.length < PAGE) break;
      from += PAGE;
    }

    setRows(allRows);
    setLoading(false);
  };

  useEffect(() => { load(); }, [periodoCalc.inicio, periodoCalc.fim]);

  useEffect(() => {
    supabase.from('hospitals').select('id, nome').order('nome').then(({ data }) => setHospitals(data ?? []));
    supabase.from('sectors').select('id, nome, hospital_id').order('nome').then(({ data }) => setSectors(data ?? []));
    supabase.from('cooperados').select('id, nome, cpf, email, profissao, rg, pis_inss').order('nome')
      .then(({ data }) => setCooperados((data ?? []) as Cooperado[]));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Fechamento Mensal</h1>
          <p className="text-sm text-muted-foreground">Cobrança ao cliente, repasse e RPAs dos cooperados</p>
        </div>
        <div className="w-64"><PeriodoPicker value={periodo} onChange={setPeriodo} /></div>
      </div>
      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <Tabs defaultValue="cobranca">
          <TabsList>
            <TabsTrigger value="cobranca">Cobrança ao Cliente</TabsTrigger>
            <TabsTrigger value="repasse">Repasse ao Cooperado</TabsTrigger>
            <TabsTrigger value="rpa">RPA dos Cooperados</TabsTrigger>
          </TabsList>
          <TabsContent value="cobranca" className="mt-4">
            <AbaCobranca rows={rows} hospitals={hospitals} sectors={sectors} cooperados={cooperados} periodoLabel={periodoCalc.label} />
          </TabsContent>
          <TabsContent value="repasse" className="mt-4">
            <AbaRepasse rows={rows} hospitals={hospitals} sectors={sectors} cooperados={cooperados} periodoLabel={periodoCalc.label} />
          </TabsContent>
          <TabsContent value="rpa" className="mt-4">
            <AbaRPA rows={rows} hospitals={hospitals} cooperados={cooperados} periodoLabel={periodoCalc.label} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
