import ExcelJS from 'exceljs';
import { profissaoLabel, tipoPlantaoLabel } from '@/lib/format';

interface LancRow {
  id: string; data_plantao: string; total_horas: number;
  profissao: string; tipo_plantao: string;
  valor_cobrado_cliente: number; valor_repasse_cooperado: number;
  cooperados: { id: string; nome: string } | null;
  hospitals:  { id: string; nome: string } | null;
  sectors:    { id: string; nome: string } | null;
}

// ── Cores ─────────────────────────────────────────────────────────────────────
const NAVY        = 'FF1A2F5A';  // azul CADES — secoes, colunas, totais
const HEADER_GRAY = 'FFF0F0F0';  // cinza claro — fundo do cabecalho principal
const WHITE       = 'FFFFFFFF';
const BLUE_VAL    = 'FF0070C0';  // valores monetarios
const GRAY_BG     = 'FFF2F2F2';  // linhas alternadas
const BLACK       = 'FF000000';
const FONT        = 'Arial';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDiaMes(iso: string): string {
  const [yyyy, mm, dd] = iso.split('-');
  return `${dd}/${mm}/${yyyy}`;
}

function fmtBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

function cargaHoraria(tipo: string, horas: number): string {
  const h = Math.round(horas);
  if (tipo === 'normal') return `07:00h às 19:00h (${h}h)`;
  if (tipo === 'extra')  return `19:00h às 07:00h (${h}h)`;
  return tipoPlantaoLabel[tipo] ?? tipo;
}

// Aplica borda fina a uma célula
function bordaFina(cell: ExcelJS.Cell, cor = 'FFD0D0D0') {
  const s: ExcelJS.Border = { style: 'thin', color: { argb: cor } };
  cell.border = { top: s, bottom: s, left: s, right: s };
}

// Estilo linha navy (cabeçalho/totais)
function estiloNavy(row: ExcelJS.Row, fontSize = 10) {
  row.eachCell({ includeEmpty: true }, cell => {
    cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.font   = { bold: true, color: { argb: WHITE }, name: FONT, size: fontSize };
    cell.border = { top: { style: 'thin', color: { argb: WHITE } }, bottom: { style: 'thin', color: { argb: WHITE } }, left: { style: 'thin', color: { argb: WHITE } }, right: { style: 'thin', color: { argb: WHITE } } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
}

// Carrega logo como base64
async function carregarLogo(): Promise<string | null> {
  try {
    const resp = await fetch('/cades-logo.png');
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string>(res => {
      const reader = new FileReader();
      reader.onloadend = () => res((reader.result as string).split(',')[1]);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

// ── Função principal ──────────────────────────────────────────────────────────

export async function exportarRelatorioExcel(
  rows: LancRow[],
  aba: 'cobranca' | 'repasse',
  periodoLabel: string,
  grupoNome: string,
  profissaoFiltro?: string,
) {
  const valorKey = aba === 'cobranca' ? 'valor_cobrado_cliente' : 'valor_repasse_cooperado';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'CADES';
  wb.created = new Date();

  const logoBase64 = await carregarLogo();

  // Agrupa: hospital → setor
  const porHospital: Record<string, { nome: string; porSetor: Record<string, { nome: string; lancs: LancRow[] }> }> = {};
  rows.forEach(r => {
    const hKey  = r.hospitals?.id  ?? '__sem__';
    const hNome = r.hospitals?.nome ?? 'Sem cliente';
    const sKey  = r.sectors?.id    ?? '__sem__';
    const sNome = r.sectors?.nome  ?? 'Sem setor';
    if (!porHospital[hKey]) porHospital[hKey] = { nome: hNome, porSetor: {} };
    if (!porHospital[hKey].porSetor[sKey]) porHospital[hKey].porSetor[sKey] = { nome: sNome, lancs: [] };
    porHospital[hKey].porSetor[sKey].lancs.push(r);
  });

  const hospitais = Object.values(porHospital).sort((a, b) => a.nome.localeCompare(b.nome));

  const criarPlanilha = (wsNome: string, hospital: typeof hospitais[0]) => {
    const ws = wb.addWorksheet(wsNome, {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
    });

    // Larguras (A=cooperado, B=cargo, C=carga horária, D=quant, E=dias, F=plantão)
    ws.columns = [
      { key: 'A', width: 34 },
      { key: 'B', width: 20 },
      { key: 'C', width: 26 },
      { key: 'D', width: 14 },
      { key: 'E', width: 16 },
      { key: 'F', width: 18 },
    ];

    // ── Linha 1: Cabeçalho (logo + título) ──────────────────────────────────
    const logoH = 58; // altura em pontos (~px)
    const r1 = ws.addRow(['', '', '', '', '', 'Relatório de Fechamento']);
    r1.height = logoH;

    // Fundo cinza claro em todas as células do cabeçalho
    r1.eachCell({ includeEmpty: true }, cell => {
      cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_GRAY } };
      cell.border = { bottom: { style: 'medium', color: { argb: NAVY } } };
    });

    // Título "Relatório de Fechamento" em azul CADES, colunas D-F
    ws.mergeCells(`D1:F1`);
    const cTitulo = r1.getCell(6);
    cTitulo.value = 'Relatório de Fechamento';
    cTitulo.font  = { bold: true, size: 15, color: { argb: NAVY }, name: FONT };
    cTitulo.alignment = { vertical: 'middle', horizontal: 'center' };
    cTitulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_GRAY } };

    // Logo (sobre as colunas A-C)
    ws.mergeCells('A1:C1');
    if (logoBase64) {
      const logoId = wb.addImage({ base64: logoBase64, extension: 'png' });
      ws.addImage(logoId, {
        tl: { col: 0.15, row: 0.1 } as any,
        ext: { width: 200, height: 52 },
        editAs: 'oneCell',
      } as any);
    } else {
      const cCades = r1.getCell(1);
      cCades.value = 'CADES – Cooperativa Assistencial de Trabalho do Espírito Santo';
      cCades.font  = { bold: true, size: 12, color: { argb: NAVY }, name: FONT };
      cCades.alignment = { vertical: 'middle', horizontal: 'left' };
    }

    // ── Linha 2: em branco ───────────────────────────────────────────────────
    ws.addRow([]).height = 6;

    // ── Linhas 3-5: meta-informações ─────────────────────────────────────────
    const addMeta = (label: string, valor: string) => {
      const row = ws.addRow([label, valor]);
      row.height = 16;
      row.getCell(1).font = { bold: true, size: 10, name: FONT };
      row.getCell(2).font = { size: 10, name: FONT };
      ws.mergeCells(`B${row.number}:F${row.number}`);
    };

    addMeta('Empresa:', hospital.nome);
    addMeta('Período:', periodoLabel);
    const profNome = profissaoFiltro ? (profissaoLabel[profissaoFiltro] ?? profissaoFiltro) : 'Todos';
    addMeta('Atenção:', profNome.toUpperCase());

    // ── Linha em branco ──────────────────────────────────────────────────────
    ws.addRow([]).height = 8;

    // ── Setores ───────────────────────────────────────────────────────────────
    const setores = Object.values(hospital.porSetor).sort((a, b) => a.nome.localeCompare(b.nome));
    let totalGeral = 0;

    setores.forEach(setor => {
      // Cabeçalho do setor
      const sRow = ws.addRow([`Unidade ${setor.nome}`, '', '', '', '', '']);
      ws.mergeCells(`A${sRow.number}:F${sRow.number}`);
      sRow.height = 22;
      estiloNavy(sRow, 11);
      sRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };

      // Cabeçalhos das colunas
      const cRow = ws.addRow([
        'COOPERADO(A) / PRESTADOR',
        'CARGO',
        'CARGA HORÁRIA\nTRABALHADA',
        'QUANT. DE\nPLANTÃO',
        'DIAS\nTRABALHADOS',
        'PLANTÃO',
      ]);
      cRow.height = 32;
      estiloNavy(cRow, 10);

      // Ordenar: cooperado → data
      const lancs = [...setor.lancs].sort((a, b) =>
        (a.cooperados?.nome ?? '').localeCompare(b.cooperados?.nome ?? '') ||
        a.data_plantao.localeCompare(b.data_plantao)
      );

      // Agrupar por cooperado
      const porCoop: Record<string, LancRow[]> = {};
      lancs.forEach(l => {
        const k = l.cooperados?.id ?? '__sem__';
        if (!porCoop[k]) porCoop[k] = [];
        porCoop[k].push(l);
      });

      let blocoIdx = 0;
      let totalSetor = 0;

      Object.values(porCoop).forEach(coopLancs => {
        const bgFill = blocoIdx % 2 === 0 ? 'FFFFFFFF' : GRAY_BG;
        blocoIdx++;
        let sub = 0;

        coopLancs.forEach(l => {
          const valor = Number(l[valorKey as keyof LancRow] as number);
          sub += valor;
          totalSetor += valor;

          const dr = ws.addRow([
            l.cooperados?.nome ?? '—',
            profissaoLabel[l.profissao] ?? l.profissao,
            cargaHoraria(l.tipo_plantao, l.total_horas),
            1,
            fmtDiaMes(l.data_plantao),
            fmtBRL(valor),
          ]);
          dr.height = 17;

          dr.eachCell({ includeEmpty: true }, (cell, colIdx) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgFill } };
            cell.font = { size: 10, name: FONT, color: { argb: colIdx === 6 ? BLUE_VAL : BLACK } };
            cell.alignment = {
              vertical: 'middle',
              horizontal: colIdx === 1 || colIdx === 2 || colIdx === 3 ? 'left' : colIdx === 6 ? 'right' : 'center',
            };
            bordaFina(cell);
          });
        });

        // TOTAL do cooperado
        const tRow = ws.addRow(['', '', '', '', 'TOTAL', fmtBRL(sub)]);
        tRow.height = 18;
        estiloNavy(tRow, 10);
        tRow.getCell(5).alignment = { vertical: 'middle', horizontal: 'right' };
        tRow.getCell(6).alignment = { vertical: 'middle', horizontal: 'right' };
      });

      totalGeral += totalSetor;
      ws.addRow([]).height = 6; // espaço entre setores
    });

    // ── Total geral ───────────────────────────────────────────────────────────
    ws.addRow([]).height = 8;

    const gtRow = ws.addRow(['', '', '', '', 'R$', fmtBRL(totalGeral)]);
    gtRow.height = 24;
    (['E', 'F'] as const).forEach(col => {
      const cell = gtRow.getCell(col);
      cell.font   = { bold: true, size: 13, name: FONT };
      cell.border = { top: { style: 'medium', color: { argb: BLACK } }, bottom: { style: 'medium', color: { argb: BLACK } }, left: { style: 'medium', color: { argb: BLACK } }, right: { style: 'medium', color: { argb: BLACK } } };
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    });
  };

  if (hospitais.length === 1) {
    criarPlanilha(hospitais[0].nome.slice(0, 31), hospitais[0]);
  } else {
    hospitais.forEach(h => criarPlanilha(h.nome.slice(0, 31), h));
  }

  // ── Download ──────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  const slug   = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '_');
  a.download   = `fechamento_${aba}_${slug(periodoLabel)}${grupoNome ? '_' + slug(grupoNome) : ''}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
