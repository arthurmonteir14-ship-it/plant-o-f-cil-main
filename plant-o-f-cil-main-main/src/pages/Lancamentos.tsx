import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Search, Trash2, ChevronDown, ChevronUp, RefreshCw, Lock, CheckSquare, Pencil } from 'lucide-react';
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
interface Cooperado { id: string; nome: string; }
interface Hospital { id: string; nome: string; }
interface Sector { id: string; nome: string; hospital_id: string; }
interface CompetenciaFechada { id: string; setor_id: string; periodo_inicio: string; periodo_fim: string; }

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
    supabase.from('cooperados').select('id, nome').eq('ativo', true).order('nome').then(({ data }) => setCooperados(data ?? []));
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

  // Expande todos os grupos automaticamente sempre que os dados mudam
  useEffect(() => {
    if (grouped.length > 0) setExpandedGroups(new Set(grouped.map(([key]) => key)));
  }, [grouped]);

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
