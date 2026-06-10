import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Search, Trash2, ChevronDown, ChevronUp, RefreshCw, Lock, CheckSquare, Pencil, FileSpreadsheet, Upload, Download, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency, formatDate, profissaoLabel, tipoPlantaoLabel, calcularHoras, tipoPlantaoOptions } from '@/lib/format';
import { PeriodoPicker } from '@/components/PeriodoPicker';
import { calcPeriodo, periodoInicial, PeriodoState } from '@/lib/periodo';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

interface Row {
  id: string; data_plantao: string; horario_inicio: string; horario_fim: string;
  total_horas: number; profissao: string; tipo_plantao: string;
  valor_cobrado_cliente: number; valor_repasse_cooperado: number;
  cooperados: { id: string; nome: string } | null;
  hospitals: { id: string; nome: string } | null;
  sectors: { id: string; nome: string } | null;
}
interface Cooperado { id: string; nome: string; profissao?: string; }
interface Hospital { id: string; nome: string; }
interface Sector { id: string; nome: string; hospital_id: string; }
interface CompetenciaFechada { id: string; setor_id: string; periodo_inicio: string; periodo_fim: string; }

interface ImportRow {
  linha: number;
  cooperado_nome: string; hospital_nome: string; setor_nome: string;
  data_str: string; horario_inicio_str: string; horario_fim_str: string;
  tipo_str: string; profissao_str: string;
  cooperado_id?: string; hospital_id?: string; setor_id?: string;
  profissao?: string; tipo_plantao?: string; data_plantao?: string;
  horario_inicio?: string; horario_fim?: string;
  total_horas?: number; valor_hora_cliente?: number; valor_cobrado_cliente?: number;
  valor_repasse_cooperado?: number; percentual_repasse?: number;
  erros: string[];
  avisos?: string[];
}

const TIPO_IMPORT: Record<string, string> = {
  diurno: 'normal', normal: 'normal',
  noturno: 'extra', extra: 'extra',
  diarista: 'diarista', sobreaviso: 'sobreaviso',
};

function normStr(s: string) {
  return String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function parseExcelDate(raw: any): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
  }
  if (typeof raw === 'number' && raw > 1) {
    const info = XLSX.SSF.parse_date_code(raw);
    if (info && info.y > 1900)
      return `${info.y}-${String(info.m).padStart(2, '0')}-${String(info.d).padStart(2, '0')}`;
    return null;
  }
  const s = String(raw).trim();
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m1) {
    const y = m1[3].length === 2 ? `20${m1[3]}` : m1[3];
    return `${y}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function parseExcelTime(raw: any): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date) {
    return `${String(raw.getHours()).padStart(2, '0')}:${String(raw.getMinutes()).padStart(2, '0')}`;
  }
  if (typeof raw === 'number' && raw >= 0 && raw < 1) {
    const totalMin = Math.round(raw * 24 * 60);
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return null;
}

// Meses abreviados em PT-BR
const MES_ABREV: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

// Converte "02/Jun" + ano → "2026-06-02"
function parseDiaAbrev(diaStr: any, ano: number): string | null {
  if (!diaStr && diaStr !== 0) return null;
  const s = String(diaStr).trim();
  const m = s.match(/^(\d{1,2})[\/\-]([A-Za-záéíóúâêîôûãõàçu]+)$/i);
  if (m) {
    const dia = parseInt(m[1]);
    const mesKey = normStr(m[2]).slice(0, 3);
    const mes = MES_ABREV[mesKey];
    if (mes && !isNaN(dia))
      return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  return parseExcelDate(diaStr);
}

// Detecta se é o formato CADES (título nas linhas 1-2, cabeçalhos na linha 3)
function isCadesFormat(data: any[][]): boolean {
  if (data.length < 4) return false;
  const row2 = (data[2] ?? []).map((c: any) => normStr(String(c ?? '')));
  return row2.some(c => c === 'nome') && (row2.some(c => c === 'dia') || row2.some(c => c.includes('turno')));
}

// Extrai o ano do título (ex: "JUNHO/2026")
function extractAno(data: any[][]): number {
  for (let i = 0; i < Math.min(3, data.length); i++) {
    const rowStr = (data[i] ?? []).map((c: any) => String(c ?? '')).join(' ');
    const m = rowStr.match(/\b(20\d{2})\b/);
    if (m) return parseInt(m[1]);
  }
  return new Date().getFullYear();
}

function LancRow({ r, fechado, canDelete, onDelete, onEdit, checked, onCheck }: {
  r: Row; fechado: boolean; canDelete: boolean; onDelete: () => void; onEdit: () => void;
  checked: boolean; onCheck: (v: boolean) => void;
}) {
  return (
    <tr className={`${fechado ? 'bg-red-50/30 hover:bg-red-50/50' : checked ? 'bg-blue-50/40' : 'hover:bg-muted/20'}`}>
      {canDelete && (
        <td className="p-3 w-10">
          {!fechado && (
            <Checkbox checked={checked} onCheckedChange={onCheck} aria-label="Selecionar" />
          )}
        </td>
      )}
      <td className="p-3 tabular-nums">
        {fechado && <Lock className="inline h-3 w-3 mr-1 text-red-400" title="Competência fechada" />}
        {formatDate(r.data_plantao)}
      </td>
      <td className="p-3">
        <div>{r.hospitals?.nome ?? '—'}</div>
        <div className="text-xs text-muted-foreground">{r.sectors?.nome ?? '—'}</div>
      </td>
      <td className="p-3 tabular-nums text-xs">{r.horario_inicio?.slice(0,5)}–{r.horario_fim?.slice(0,5)}</td>
      <td className="p-3 text-right tabular-nums">{Number(r.total_horas).toFixed(2)}h</td>
      <td className="p-3 text-xs">{tipoPlantaoLabel[r.tipo_plantao]}</td>
      <td className="p-3 text-right tabular-nums font-medium">{formatCurrency(r.valor_cobrado_cliente)}</td>
      <td className="p-3 text-right tabular-nums text-accent">{formatCurrency(r.valor_repasse_cooperado)}</td>
      <td className="p-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
            disabled={fechado} title={fechado ? 'Competência fechada' : 'Editar'} onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost"
            className={`h-7 w-7 p-0 ${fechado ? 'text-muted-foreground cursor-not-allowed' : 'text-destructive hover:text-destructive'}`}
            disabled={fechado} title={fechado ? 'Competência fechada' : 'Excluir'} onClick={onDelete}>
            {fechado ? <Lock className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </td>
    </tr>
  );
}

export default function Lancamentos() {
  const { hasRole } = useAuth();
  const canDelete = hasRole('admin_master') || hasRole('coordenadora') || hasRole('administrativo');

  const [rows, setRows] = useState<Row[]>([]);
  const [cooperados, setCooperados] = useState<Cooperado[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);

  const [periodo, setPeriodo] = useState<PeriodoState>(periodoInicial());
  const [search, setSearch] = useState('');
  const [filterCooperado, setFilterCooperado] = useState('all');
  const [filterHospital, setFilterHospital] = useState('all');
  const [filterSetor, setFilterSetor] = useState('all');
  const [filterTipo, setFilterTipo] = useState('all');

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [competenciasFechadas, setCompetenciasFechadas] = useState<CompetenciaFechada[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [editTarget, setEditTarget] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState({ hospital_id: '', setor_id: '', data_plantao: '', horario_inicio: '', horario_fim: '', tipo_plantao: '' });
  const [saving, setSaving] = useState(false);

  const [importOpen, setImportOpen]       = useState(false);
  const [importRows, setImportRows]       = useState<ImportRow[]>([]);
  const [importando, setImportando]       = useState(false);
  const [importHospitalId, setImportHospitalId] = useState('');
  const importFileRef = useRef<HTMLInputElement>(null);

  const { inicio, fim } = useMemo(() => calcPeriodo(periodo), [periodo]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const PAGE = 1000;
    let all: Row[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('lancamentos_plantoes')
        .select('id, data_plantao, horario_inicio, horario_fim, total_horas, profissao, tipo_plantao, valor_cobrado_cliente, valor_repasse_cooperado, cooperados(id, nome), hospitals(id, nome), sectors(id, nome)')
        .gte('data_plantao', inicio)
        .lte('data_plantao', fim)
        .order('data_plantao', { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) { toast.error('Erro ao carregar lançamentos: ' + error.message); break; }
      all = [...all, ...((data ?? []) as unknown as Row[])];
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    setRows(all);
    setLoading(false);
  }, [inicio, fim]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  useEffect(() => {
    supabase.from('cooperados').select('id, nome, profissao').eq('ativo', true).order('nome').then(({ data }) => setCooperados(data ?? []));
    supabase.from('hospitals').select('id, nome').eq('ativo', true).order('nome').then(({ data }) => setHospitals(data ?? []));
    supabase.from('sectors').select('id, nome, hospital_id').eq('ativo', true).order('nome').then(({ data }) => setSectors(data ?? []));
    supabase.from('competencias_fechadas').select('id, setor_id, periodo_inicio, periodo_fim')
      .then(({ data }) => setCompetenciasFechadas((data ?? []) as CompetenciaFechada[]));
  }, []);

  const isSetorFechado = (setorId: string | undefined, dataPlantao: string) => {
    if (!setorId) return false;
    return competenciasFechadas.some(c =>
      c.setor_id === setorId &&
      dataPlantao >= c.periodo_inicio &&
      dataPlantao <= c.periodo_fim
    );
  };

  const setoresFiltrados = useMemo(
    () => filterHospital === 'all' ? sectors : sectors.filter(s => s.hospital_id === filterHospital),
    [sectors, filterHospital]
  );

  const filtered = useMemo(() => rows.filter(r => {
    if (filterCooperado !== 'all' && r.cooperados?.id !== filterCooperado) return false;
    if (filterHospital !== 'all' && r.hospitals?.id !== filterHospital) return false;
    if (filterSetor !== 'all' && r.sectors?.id !== filterSetor) return false;
    if (filterTipo !== 'all' && r.tipo_plantao !== filterTipo) return false;
    if (search) {
      const q = search.toLowerCase();
      const blob = `${r.cooperados?.nome ?? ''} ${r.hospitals?.nome ?? ''} ${r.sectors?.nome ?? ''}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  }), [rows, filterCooperado, filterHospital, filterSetor, filterTipo, search]);

  const grouped = useMemo(() => {
    const map: Record<string, { label: string; sub: string; rows: Row[] }> = {};
    filtered.forEach(r => {
      const key = r.cooperados?.id ?? 'sem';
      if (!map[key]) map[key] = {
        label: r.cooperados?.nome ?? 'Sem cooperado',
        sub: profissaoLabel[r.profissao] ?? r.profissao,
        rows: [],
      };
      map[key].rows.push(r);
    });
    return Object.entries(map).sort((a, b) => a[1].label.localeCompare(b[1].label));
  }, [filtered]);

  const toggleGroup = (key: string) => setExpandedGroups(prev => {
    const s = new Set(prev);
    s.has(key) ? s.delete(key) : s.add(key);
    return s;
  });

  const limpar = () => {
    setSearch(''); setFilterCooperado('all'); setFilterHospital('all');
    setFilterSetor('all'); setFilterTipo('all');
  };

  const confirmarDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('lancamentos_plantoes').delete().eq('id', deleteTarget.id);
    setDeleting(false);
    if (error) return toast.error(error.message);
    toast.success('Lançamento excluído');
    setDeleteTarget(null);
    fetchRows();
  };

  const confirmarBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setDeletingBulk(true);
    const ids = [...selectedIds];
    const { error } = await supabase.from('lancamentos_plantoes').delete().in('id', ids);
    setDeletingBulk(false);
    if (error) { toast.error('Erro ao excluir: ' + error.message); return; }
    toast.success(`${ids.length} lançamento${ids.length !== 1 ? 's' : ''} excluído${ids.length !== 1 ? 's' : ''}`);
    setSelectedIds(new Set());
    setConfirmBulk(false);
    fetchRows();
  };

  const abrirEdicao = (r: Row) => {
    setEditTarget(r);
    setEditForm({
      hospital_id: r.hospitals?.id ?? '',
      setor_id: r.sectors?.id ?? '',
      data_plantao: r.data_plantao,
      horario_inicio: r.horario_inicio?.slice(0, 5) ?? '',
      horario_fim: r.horario_fim?.slice(0, 5) ?? '',
      tipo_plantao: r.tipo_plantao,
    });
  };

  const salvarEdicao = async () => {
    if (!editTarget) return;
    const { hospital_id, setor_id, data_plantao, horario_inicio, horario_fim, tipo_plantao } = editForm;
    if (!hospital_id || !setor_id || !data_plantao || !horario_inicio || !horario_fim || !tipo_plantao)
      return toast.error('Preencha todos os campos');
    const total_horas = calcularHoras(horario_inicio, horario_fim);
    if (total_horas <= 0) return toast.error('Horário inválido');

    setSaving(true);
    // Buscar valores da tabela se hospital ou tipo mudou
    let valor_cobrado_cliente = Number(editTarget.valor_cobrado_cliente);
    let valor_repasse_cooperado = Number(editTarget.valor_repasse_cooperado);
    let percentual_repasse = 0;

    if (hospital_id !== editTarget.hospitals?.id || tipo_plantao !== editTarget.tipo_plantao) {
      const { data: tv } = await supabase
        .from('tabela_valores')
        .select('valor_hora_cliente, percentual_repasse')
        .eq('hospital_id', hospital_id)
        .eq('profissao', editTarget.profissao)
        .eq('tipo_plantao', tipo_plantao)
        .eq('ativo', true)
        .limit(1)
        .maybeSingle();
      if (tv) {
        valor_cobrado_cliente = Number(tv.valor_hora_cliente) * total_horas;
        percentual_repasse = Number(tv.percentual_repasse);
        valor_repasse_cooperado = valor_cobrado_cliente * (percentual_repasse / 100);
      }
    } else {
      valor_cobrado_cliente = (valor_cobrado_cliente / Number(editTarget.total_horas)) * total_horas;
      valor_repasse_cooperado = (valor_repasse_cooperado / Number(editTarget.total_horas)) * total_horas;
      percentual_repasse = Number(editTarget.valor_repasse_cooperado) / Number(editTarget.valor_cobrado_cliente) * 100;
    }

    const { error } = await supabase.from('lancamentos_plantoes').update({
      hospital_id, setor_id, data_plantao, horario_inicio, horario_fim,
      tipo_plantao, total_horas,
      valor_cobrado_cliente: Math.round(valor_cobrado_cliente * 100) / 100,
      valor_repasse_cooperado: Math.round(valor_repasse_cooperado * 100) / 100,
      percentual_repasse: Math.round(percentual_repasse * 100) / 100,
    } as never).eq('id', editTarget.id);

    setSaving(false);
    if (error) { toast.error('Erro ao salvar: ' + error.message); return; }
    toast.success('Lançamento atualizado');
    setEditTarget(null);
    fetchRows();
  };

  const editSetores = useMemo(() =>
    editForm.hospital_id ? sectors.filter(s => s.hospital_id === editForm.hospital_id) : sectors,
  [sectors, editForm.hospital_id]);

  const toggleSelect = (id: string, v: boolean) =>
    setSelectedIds(prev => { const s = new Set(prev); v ? s.add(id) : s.delete(id); return s; });

  const selectableIds = (groupRows: Row[]) =>
    groupRows.filter(r => !isSetorFechado(r.sectors?.id, r.data_plantao)).map(r => r.id);

  const toggleGroupSelect = (groupRows: Row[], allSelected: boolean) => {
    const ids = selectableIds(groupRows);
    setSelectedIds(prev => {
      const s = new Set(prev);
      ids.forEach(id => allSelected ? s.delete(id) : s.add(id));
      return s;
    });
  };

  const totalCliente = filtered.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0);
  const totalCooperado = filtered.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0);

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const headers = ['Cooperado', 'Cliente', 'Setor', 'Data (dd/mm/aaaa)', 'Início (HH:MM)', 'Fim (HH:MM)', 'Tipo', 'Profissão'];
    const ex1 = ['João da Silva',  'Hospital Exemplo', 'UTI',             '01/06/2026', '07:00', '19:00', 'Diurno',  'Enfermeiro(a)'];
    const ex2 = ['Maria Santos',   'Hospital Exemplo', 'Bloco Cirúrgico', '01/06/2026', '19:00', '07:00', 'Noturno', 'Técnico(a) de Enfermagem'];
    const ws = XLSX.utils.aoa_to_sheet([headers, ex1, ex2]);
    ws['!cols'] = headers.map(() => ({ wch: 24 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Lançamentos');
    const info = [
      ['Tipos aceitos:'], ['Diurno  →  padronizado 07:00 – 19:00'], ['Noturno →  padronizado 19:00 – 07:00'], ['Diarista'],
      [''], ['Profissões aceitas:'],
      ...Object.values(profissaoLabel).map(v => [v]),
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(info);
    wsInfo['!cols'] = [{ wch: 38 }];
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Referência');
    XLSX.writeFile(wb, 'modelo_lancamentos.xlsx');
  };

  // Calcula similaridade por palavras em comum (ignora palavras curtas)
  const similaridade = (a: string, b: string): number => {
    const na = normStr(a); const nb = normStr(b);
    if (na === nb) return 1;
    if (na.includes(nb) || nb.includes(na)) return 0.9;
    const wa = na.split(/\s+/).filter(w => w.length > 2);
    const wb2 = nb.split(/\s+/).filter(w => w.length > 2);
    if (wa.length === 0 || wb2.length === 0) return 0;
    const comuns = wa.filter(w => wb2.includes(w)).length;
    return comuns / Math.max(wa.length, wb2.length);
  };

  const melhorCooperado = (nome: string) => {
    let best: typeof cooperados[0] | undefined;
    let bestScore = 0;
    for (const c of cooperados) {
      const s = similaridade(String(nome), c.nome);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return { cooperado: bestScore >= 0.5 ? best : undefined, score: bestScore, sugestao: best };
  };

  const processarPlanilha = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });

    const { data: tvData } = await supabase
      .from('tabela_valores')
      .select('hospital_id, profissao, tipo_plantao, valor_hora_cliente, percentual_repasse, valor_hora_cooperado')
      .eq('ativo', true);
    const tv = tvData ?? [];

    const profMap = new Map<string, string>();
    Object.entries(profissaoLabel).forEach(([k, v]) => {
      profMap.set(normStr(v), k); profMap.set(normStr(k), k);
    });

    const calcVals = (hospitalId: string, coopProfissao: string | undefined, tipo: string | undefined, horas: number | undefined, erros: string[], label: string) => {
      if (!hospitalId || !coopProfissao || !tipo || !horas) return {};
      const candidatos = tv.filter((t: any) => t.profissao === coopProfissao && t.tipo_plantao === tipo);
      const t = candidatos.find((t: any) => t.hospital_id === hospitalId) ?? candidatos.find((t: any) => t.hospital_id === null);
      if (!t) { erros.push(`Sem tabela de valores: ${hospitals.find(h => h.id === hospitalId)?.nome ?? ''} / ${label}`); return {}; }
      const valor_hora_cliente    = Number(t.valor_hora_cliente);
      const valor_cobrado_cliente = Math.round(valor_hora_cliente * horas * 100) / 100;
      const valorHoraCooperado    = t.valor_hora_cooperado != null
        ? Number(t.valor_hora_cooperado)
        : +(valor_hora_cliente * Number(t.percentual_repasse) / 100).toFixed(2);
      const percentual_repasse      = valor_hora_cliente > 0 ? (valorHoraCooperado / valor_hora_cliente) * 100 : Number(t.percentual_repasse);
      const valor_repasse_cooperado = Math.round(horas * valorHoraCooperado * 100) / 100;
      return { valor_hora_cliente, valor_cobrado_cliente, valor_repasse_cooperado, percentual_repasse };
    };

    const linhas = data.slice(1).filter(row => row.some((c: any) => c !== '' && c !== null && c !== undefined));
    if (linhas.length === 0) { toast.error('Planilha sem dados. Verifique a aba "Lançamentos".'); return; }

    const processed: ImportRow[] = linhas.map((row, i) => {
      const erros: string[] = []; const avisos: string[] = [];
      const [coop_raw, hosp_raw, set_raw, data_raw, , , tipo_raw, prof_raw] = row;
      // Início e Fim da planilha são IGNORADOS — usamos horários padronizados pelo Tipo

      const { cooperado, score, sugestao } = melhorCooperado(String(coop_raw));
      if (!cooperado) erros.push(`Cooperado "${coop_raw}" não encontrado${sugestao ? ` (mais próximo: "${sugestao.nome}")` : ''}`);
      else if (score < 1) avisos.push(`Nome "${coop_raw}" identificado como "${cooperado.nome}"`);

      const hospital = hospitals.find(h => normStr(h.nome) === normStr(String(hosp_raw)) || normStr(h.nome).includes(normStr(String(hosp_raw))));
      if (!hospital) erros.push(`Cliente "${hosp_raw}" não encontrado`);

      const setor = sectors.find(s =>
        (normStr(s.nome) === normStr(String(set_raw)) || normStr(s.nome).includes(normStr(String(set_raw)))) &&
        (!hospital || s.hospital_id === hospital.id)
      );
      if (!setor) erros.push(`Setor "${set_raw}" não encontrado${hospital ? ` em ${hosp_raw}` : ''}`);

      const data_plantao = parseExcelDate(data_raw);
      if (!data_plantao) erros.push(`Data inválida: "${data_raw}". Use dd/mm/aaaa`);

      // Tipo determina os horários padronizados
      const tipo_plantao = TIPO_IMPORT[normStr(String(tipo_raw))];
      if (!tipo_plantao) erros.push(`Tipo inválido: "${tipo_raw}". Use Diurno, Noturno ou Diarista`);

      const horario_inicio = tipo_plantao === 'normal' ? '07:00' : tipo_plantao === 'extra' ? '19:00' : tipo_plantao === 'diarista' ? '07:00' : undefined;
      const horario_fim    = tipo_plantao === 'normal' ? '19:00' : tipo_plantao === 'extra' ? '07:00' : tipo_plantao === 'diarista' ? '19:00' : undefined;

      const profissao = profMap.get(normStr(String(prof_raw ?? '')));
      if (!profissao) erros.push(`Profissão inválida: "${prof_raw}"`);

      const total_horas = horario_inicio && horario_fim ? calcularHoras(horario_inicio, horario_fim) : undefined;

      const tipoLabel = tipo_plantao === 'normal' ? 'Diurno' : tipo_plantao === 'extra' ? 'Noturno' : tipo_plantao === 'diarista' ? 'Diarista' : (tipo_plantao ?? String(tipo_raw));
      if (tipo_plantao === 'diarista') avisos.push('Plantão Diarista — verifique se o valor está correto antes de importar');
      const coopProfissao = cooperado?.profissao;
      const vals = calcVals(hospital?.id ?? '', coopProfissao, tipo_plantao, total_horas, erros, `${coopProfissao ?? prof_raw} / ${tipoLabel}`);

      return {
        linha: i + 2, cooperado_nome: cooperado ? cooperado.nome : String(coop_raw),
        hospital_nome: String(hosp_raw), setor_nome: String(set_raw), data_str: String(data_raw),
        horario_inicio_str: horario_inicio ?? '', horario_fim_str: horario_fim ?? '',
        tipo_str: tipoLabel, profissao_str: String(prof_raw ?? ''),
        cooperado_id: cooperado?.id, hospital_id: hospital?.id, setor_id: setor?.id,
        profissao: coopProfissao ?? profissao, tipo_plantao, data_plantao: data_plantao ?? undefined,
        horario_inicio, horario_fim, total_horas, ...vals, erros, avisos,
      };
    });

    if (processed.length === 0) { toast.error('Planilha sem dados.'); return; }

    // ── 1. Duplicatas dentro da própria planilha ──
    const intraKeys = new Map<string, number>();
    const step1 = processed.map(r => {
      if (!r.cooperado_id || !r.data_plantao || !r.tipo_plantao) return r;
      const k = `${r.cooperado_id}|${r.data_plantao}|${r.tipo_plantao}`;
      if (intraKeys.has(k)) {
        const lbl = r.tipo_plantao === 'normal' ? 'Diurno' : 'Noturno';
        return { ...r, erros: [...r.erros, `Duplicado na planilha: ${lbl} de ${r.cooperado_nome} em ${formatDate(r.data_plantao)} já aparece na linha ${intraKeys.get(k)}`] };
      }
      intraKeys.set(k, r.linha);
      return r;
    });

    // ── 2. Duplicatas no banco de dados ──
    const candidatas = step1.filter(r => r.erros.length === 0 && r.cooperado_id && r.data_plantao && r.tipo_plantao);
    if (candidatas.length > 0) {
      const coopIds = [...new Set(candidatas.map(r => r.cooperado_id!))];
      const datas   = candidatas.map(r => r.data_plantao!);
      const minData = datas.reduce((a, b) => a < b ? a : b);
      const maxData = datas.reduce((a, b) => a > b ? a : b);
      const { data: existentes } = await supabase
        .from('lancamentos_plantoes')
        .select('cooperado_id, data_plantao, tipo_plantao')
        .in('cooperado_id', coopIds)
        .gte('data_plantao', minData)
        .lte('data_plantao', maxData);
      if (existentes && existentes.length > 0) {
        const existSet = new Set(existentes.map(e => `${e.cooperado_id}|${e.data_plantao}|${e.tipo_plantao}`));
        const step2 = step1.map(r => {
          if (!r.cooperado_id || !r.data_plantao || !r.tipo_plantao || r.erros.length > 0) return r;
          if (existSet.has(`${r.cooperado_id}|${r.data_plantao}|${r.tipo_plantao}`)) {
            const lbl = r.tipo_plantao === 'normal' ? 'Diurno' : 'Noturno';
            return { ...r, erros: [...r.erros, `Já lançado: ${lbl} de ${r.cooperado_nome} em ${formatDate(r.data_plantao)}`] };
          }
          return r;
        });
        setImportRows(step2);
        return;
      }
    }

    setImportRows(step1);
  };

  const importarLinhas = async () => {
    const validas = importRows.filter(r => r.erros.length === 0);
    if (validas.length === 0) return;
    setImportando(true);
    const payload = validas.map(r => ({
      cooperado_id: r.cooperado_id!, hospital_id: r.hospital_id!, setor_id: r.setor_id!,
      profissao: r.profissao!, tipo_plantao: r.tipo_plantao!, data_plantao: r.data_plantao!,
      horario_inicio: r.horario_inicio!, horario_fim: r.horario_fim!,
      total_horas: r.total_horas!,
      valor_hora_cliente: r.valor_hora_cliente!,
      valor_cobrado_cliente: r.valor_cobrado_cliente!,
      valor_repasse_cooperado: r.valor_repasse_cooperado!,
      percentual_repasse: r.percentual_repasse!,
      status: 'lancado',
    }));
    const { error } = await supabase.from('lancamentos_plantoes').insert(payload as never);
    setImportando(false);
    if (error) { toast.error('Erro ao importar: ' + error.message); return; }
    toast.success(`${validas.length} lançamento${validas.length !== 1 ? 's' : ''} importado${validas.length !== 1 ? 's' : ''} com sucesso!`);
    setImportOpen(false); setImportRows([]);
    if (importFileRef.current) importFileRef.current.value = '';
    fetchRows();
  };

  const fecharImport = () => {
    setImportOpen(false); setImportRows([]);
    if (importFileRef.current) importFileRef.current.value = '';
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Lançamento de plantões</h1>
          <p className="text-sm text-muted-foreground">Registre e acompanhe os plantões realizados</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={fetchRows} disabled={loading} title="Recarregar">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setImportOpen(true)}>
            <FileSpreadsheet className="h-4 w-4" /> Importar planilha
          </Button>
          <Button asChild className="gap-2">
            <Link to="/financeiro/lancamentos/novo"><Plus className="h-4 w-4" /> Novo lançamento</Link>
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="p-4 md:p-5 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            <div className="sm:col-span-2 md:col-span-1">
              <PeriodoPicker value={periodo} onChange={setPeriodo} />
            </div>
            <div>
              <Label className="text-xs">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Nome, hospital…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Cooperado</Label>
              <Select value={filterCooperado} onValueChange={setFilterCooperado}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {cooperados.map(c => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cliente</Label>
              <Select value={filterHospital} onValueChange={v => { setFilterHospital(v); setFilterSetor('all'); }}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Setor</Label>
              <Select value={filterSetor} onValueChange={setFilterSetor}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {setoresFiltrados.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={filterTipo} onValueChange={setFilterTipo}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="normal">Diurno</SelectItem>
                  <SelectItem value="extra">Noturno</SelectItem>
                  <SelectItem value="diarista">Diarista</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="sm" onClick={limpar} className="self-end text-muted-foreground">
              Limpar filtros
            </Button>
            <div className="ml-auto self-end text-sm text-muted-foreground">
              {loading ? 'Carregando…' : `${filtered.length} lançamento${filtered.length !== 1 ? 's' : ''}`}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Totais */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card><CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Total cliente</p>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(totalCliente)}</p>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Total cooperado</p>
            <p className="text-lg font-bold tabular-nums text-accent">{formatCurrency(totalCooperado)}</p>
          </CardContent></Card>
        </div>
      )}

      {/* Barra de ações em massa */}
      {canDelete && selectedIds.size > 0 && (
        <div className="sticky top-4 z-20 flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 shadow-lg">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <CheckSquare className="h-4 w-4" />
            {selectedIds.size} lançamento{selectedIds.size !== 1 ? 's' : ''} selecionado{selectedIds.size !== 1 ? 's' : ''}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setSelectedIds(new Set())}>Cancelar seleção</Button>
            <Button size="sm" variant="destructive" className="gap-1.5" onClick={() => setConfirmBulk(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Excluir selecionados
            </Button>
          </div>
        </div>
      )}

      {/* Lista agrupada */}
      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
      ) : grouped.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">
          Nenhum lançamento encontrado para os filtros aplicados.
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {grouped.map(([key, group]) => {
            const expanded = expandedGroups.has(key);
            const gCliente = group.rows.reduce((s, r) => s + Number(r.valor_cobrado_cliente), 0);
            const gCoop = group.rows.reduce((s, r) => s + Number(r.valor_repasse_cooperado), 0);
            const gHoras = group.rows.reduce((s, r) => s + Number(r.total_horas), 0);
            return (
              <Card key={key}>
                <button className="w-full text-left" onClick={() => toggleGroup(key)}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        {expanded
                          ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                        <div>
                          <div className="font-semibold">{group.label}</div>
                          <div className="text-xs text-muted-foreground">{group.sub}</div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <span>{group.rows.length} plantão{group.rows.length !== 1 ? 'ões' : ''}</span>
                        <span className="tabular-nums">{gHoras.toFixed(1)}h</span>
                        <span className="tabular-nums font-medium text-foreground">{formatCurrency(gCliente)}</span>
                        <span className="tabular-nums text-accent font-medium">{formatCurrency(gCoop)}</span>
                      </div>
                    </div>
                  </CardContent>
                </button>

                {expanded && (
                  <div className="border-t">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/30">
                          <tr>
                            {canDelete && (
                              <th className="p-3 w-10">
                                <Checkbox
                                  checked={selectableIds(group.rows).length > 0 && selectableIds(group.rows).every(id => selectedIds.has(id))}
                                  onCheckedChange={v => toggleGroupSelect(group.rows, !!v && selectableIds(group.rows).every(id => selectedIds.has(id)))}
                                  aria-label="Selecionar todos"
                                />
                              </th>
                            )}
                            <th className="text-left p-3 font-medium">Data</th>
                            <th className="text-left p-3 font-medium">Hospital / Setor</th>
                            <th className="text-left p-3 font-medium">Horário</th>
                            <th className="text-right p-3 font-medium">Horas</th>
                            <th className="text-left p-3 font-medium">Tipo</th>
                            <th className="text-right p-3 font-medium">Cliente</th>
                            <th className="text-right p-3 font-medium">Cooperado</th>
                            <th className="p-3 w-10" />
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {group.rows.map(r => (
                            <LancRow
                              key={r.id}
                              r={r}
                              fechado={isSetorFechado(r.sectors?.id, r.data_plantao)}
                              canDelete={canDelete}
                              onDelete={() => setDeleteTarget(r)}
                              onEdit={() => abrirEdicao(r)}
                              checked={selectedIds.has(r.id)}
                              onCheck={v => toggleSelect(r.id, !!v)}
                            />
                          ))}
                        </tbody>
                        <tfoot className="bg-muted/20 font-medium">
                          <tr>
                            <td colSpan={canDelete ? 6 : 5} className="p-3 text-right text-xs uppercase tracking-wider text-muted-foreground">
                              Total
                            </td>
                            <td className="p-3 text-right tabular-nums">{formatCurrency(gCliente)}</td>
                            <td className="p-3 text-right tabular-nums text-accent">{formatCurrency(gCoop)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal de edição */}
      <Dialog open={!!editTarget} onOpenChange={o => !o && setEditTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar lançamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Data do plantão</Label>
              <Input type="date" value={editForm.data_plantao}
                onChange={e => setEditForm(p => ({ ...p, data_plantao: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Horário início</Label>
                <Input type="time" value={editForm.horario_inicio}
                  onChange={e => setEditForm(p => ({ ...p, horario_inicio: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Horário fim</Label>
                <Input type="time" value={editForm.horario_fim}
                  onChange={e => setEditForm(p => ({ ...p, horario_fim: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Tipo de plantão</Label>
              <Select value={editForm.tipo_plantao} onValueChange={v => setEditForm(p => ({ ...p, tipo_plantao: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {tipoPlantaoOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cliente</Label>
              <Select value={editForm.hospital_id} onValueChange={v => setEditForm(p => ({ ...p, hospital_id: v, setor_id: '' }))}>
                <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                <SelectContent>
                  {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Setor</Label>
              <Select value={editForm.setor_id} onValueChange={v => setEditForm(p => ({ ...p, setor_id: v }))} disabled={editSetores.length === 0}>
                <SelectTrigger><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
                <SelectContent>
                  {editSetores.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {editForm.horario_inicio && editForm.horario_fim && (
              <p className="text-xs text-muted-foreground">
                Total calculado: <strong>{calcularHoras(editForm.horario_inicio, editForm.horario_fim).toFixed(2)}h</strong>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancelar</Button>
            <Button onClick={salvarEdicao} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar alterações'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de importação via planilha */}
      <Dialog open={importOpen} onOpenChange={o => !o && fecharImport()}>
        <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" /> Importar lançamentos via planilha Excel
            </DialogTitle>
          </DialogHeader>

          {importRows.length === 0 ? (
            /* Fase 1 — Upload */
            <div className="space-y-5 py-1">
              <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-3">
                <p className="font-medium">Colunas obrigatórias (nesta ordem):</p>
                <div className="grid grid-cols-2 gap-y-1.5 gap-x-4 text-xs text-muted-foreground">
                  {[
                    ['1', 'Cooperado', 'Nome como cadastrado no sistema'],
                    ['2', 'Cliente',   'Nome do hospital/cliente'],
                    ['3', 'Setor',     'Nome do setor'],
                    ['4', 'Data',      'dd/mm/aaaa'],
                    ['5', 'Início',    'HH:MM (informativo — horário será padronizado)'],
                    ['6', 'Fim',       'HH:MM (informativo — horário será padronizado)'],
                    ['7', 'Tipo',      'Diurno, Noturno ou Diarista'],
                    ['8', 'Profissão', 'Conforme aba Referência do modelo'],
                  ].map(([n, col, desc]) => (
                    <span key={n} className="flex items-baseline gap-1.5">
                      <span className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded shrink-0">{n}</span>
                      <strong>{col}</strong>
                      <span className="text-[11px]">— {desc}</span>
                    </span>
                  ))}
                </div>
                <div className="flex gap-4 text-xs pt-1 border-t">
                  <span className="flex items-center gap-1.5 text-blue-700">
                    <span className="font-mono bg-blue-100 px-1.5 py-0.5 rounded font-bold">Diurno</span>
                    padronizado 07:00–19:00
                  </span>
                  <span className="flex items-center gap-1.5 text-indigo-700">
                    <span className="font-mono bg-indigo-100 px-1.5 py-0.5 rounded font-bold">Noturno</span>
                    padronizado 19:00–07:00
                  </span>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="gap-2 flex-1" onClick={downloadTemplate}>
                  <Download className="h-4 w-4" /> Baixar modelo Excel
                </Button>
                <label className="flex-1 cursor-pointer">
                  <div className="flex items-center justify-center gap-2 h-10 px-4 rounded-md border-2 border-dashed border-primary/40 bg-primary/5 text-sm font-medium hover:bg-primary/10 transition-colors text-primary">
                    <Upload className="h-4 w-4" /> Selecionar planilha (.xlsx)
                  </div>
                  <input
                    ref={importFileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      await processarPlanilha(file);
                    }}
                  />
                </label>
              </div>
            </div>
          ) : (
            /* Fase 2 — Preview */
            <>
              {/* Resumo */}
              <div className="flex gap-3 shrink-0">
                {(() => {
                  const validas    = importRows.filter(r => r.erros.length === 0).length;
                  const diaristas  = importRows.filter(r => r.tipo_plantao === 'diarista').length;
                  const duplicadas = importRows.filter(r => r.erros.some(e => e.startsWith('Já lançado') || e.startsWith('Duplicado'))).length;
                  const invalidas  = importRows.filter(r => r.erros.length > 0 && !r.erros.some(e => e.startsWith('Já lançado') || e.startsWith('Duplicado'))).length;
                  return (
                    <>
                      <div className="flex-1 rounded-lg border border-green-200 bg-green-50 p-3 text-center">
                        <p className="text-2xl font-bold text-green-700">{validas}</p>
                        <p className="text-xs text-green-600">válida{validas !== 1 ? 's' : ''}</p>
                      </div>
                      {diaristas > 0 && (
                        <div className="flex-1 rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-center">
                          <p className="text-2xl font-bold text-yellow-700">{diaristas}</p>
                          <p className="text-xs text-yellow-700 font-semibold">diarista{diaristas !== 1 ? 's' : ''} ⚠</p>
                        </div>
                      )}
                      {duplicadas > 0 && (
                        <div className="flex-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
                          <p className="text-2xl font-bold text-amber-600">{duplicadas}</p>
                          <p className="text-xs text-amber-600">duplicada{duplicadas !== 1 ? 's' : ''}</p>
                        </div>
                      )}
                      {invalidas > 0 && (
                        <div className="flex-1 rounded-lg border border-red-200 bg-red-50 p-3 text-center">
                          <p className="text-2xl font-bold text-red-600">{invalidas}</p>
                          <p className="text-xs text-red-500">com erro{invalidas !== 1 ? 's' : ''}</p>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Tabela de preview */}
              <div className="flex-1 overflow-auto border rounded-lg min-h-0">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">#</th>
                      <th className="px-3 py-2 text-left font-medium">Cooperado</th>
                      <th className="px-3 py-2 text-left font-medium">Cliente / Setor</th>
                      <th className="px-3 py-2 text-left font-medium">Data</th>
                      <th className="px-3 py-2 text-left font-medium">Horário</th>
                      <th className="px-3 py-2 text-right font-medium">Valor cliente</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {importRows.map(row => {
                      const ok   = row.erros.length === 0;
                      const isDup = row.erros.some(e => e.startsWith('Já lançado') || e.startsWith('Duplicado'));
                      return (
                        <tr key={row.linha} className={ok ? '' : isDup ? 'bg-amber-50/70' : 'bg-red-50/60'}>
                          <td className="px-3 py-2 text-muted-foreground">{row.linha}</td>
                          <td className="px-3 py-2 font-medium">{row.cooperado_nome}</td>
                          <td className="px-3 py-2">
                            <div>{row.hospital_nome}</div>
                            <div className="text-muted-foreground">{row.setor_nome}</div>
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {row.data_plantao ? formatDate(row.data_plantao) : <span className="text-red-500">{row.data_str}</span>}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {row.horario_inicio && row.horario_fim
                              ? `${row.horario_inicio}–${row.horario_fim}`
                              : <span className="text-red-500">{row.horario_inicio_str}–{row.horario_fim_str}</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.valor_cobrado_cliente != null ? formatCurrency(row.valor_cobrado_cliente) : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {ok ? (
                              <div className="space-y-0.5">
                                <span className="flex items-center gap-1 text-green-600 font-medium">
                                  <CheckCircle2 className="h-3.5 w-3.5" /> OK
                                </span>
                                {(row as any).avisos?.map((a: string, i: number) => (
                                  <div key={i} className="flex items-start gap-1 text-amber-600 text-[11px]">
                                    <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                                    <span>{a}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                {row.erros.map((e, i) => (
                                  <div key={i} className="flex items-start gap-1 text-red-600">
                                    <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                                    <span>{e}</span>
                                  </div>
                                ))}
                                {(row as any).avisos?.map((a: string, i: number) => (
                                  <div key={`a${i}`} className="flex items-start gap-1 text-amber-600">
                                    <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                                    <span>{a}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <DialogFooter className="shrink-0 pt-1">
                <Button variant="outline" onClick={() => { setImportRows([]); if (importFileRef.current) importFileRef.current.value = ''; }}>
                  ← Trocar arquivo
                </Button>
                {importRows.filter(r => r.erros.length === 0).length > 0 && (
                  <Button onClick={importarLinhas} disabled={importando} className="gap-2">
                    <Upload className="h-4 w-4" />
                    {importando
                      ? 'Importando…'
                      : `Importar ${importRows.filter(r => r.erros.length === 0).length} lançamento${importRows.filter(r => r.erros.length === 0).length !== 1 ? 's' : ''}`}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmBulk} onOpenChange={o => !o && setConfirmBulk(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lançamentos selecionados</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{selectedIds.size} lançamento{selectedIds.size !== 1 ? 's' : ''}</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmarBulkDelete} disabled={deletingBulk}>
              {deletingBulk ? 'Excluindo…' : `Excluir ${selectedIds.size}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={o => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lançamento</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Tem certeza que deseja excluir este lançamento? Esta ação não pode ser desfeita.</p>
                {deleteTarget && (
                  <div className="rounded-md bg-muted p-3 text-sm space-y-1">
                    <div><span className="text-muted-foreground">Cooperado:</span> {deleteTarget.cooperados?.nome}</div>
                    <div><span className="text-muted-foreground">Data:</span> {formatDate(deleteTarget.data_plantao)}</div>
                    <div><span className="text-muted-foreground">Cliente:</span> {deleteTarget.hospitals?.nome}</div>
                    <div><span className="text-muted-foreground">Valor:</span> {formatCurrency(deleteTarget.valor_cobrado_cliente)}</div>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmarDelete} disabled={deleting}>
              Excluir lançamento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
