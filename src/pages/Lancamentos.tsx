import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Search, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency, formatDate, profissaoLabel, tipoPlantaoLabel } from '@/lib/format';
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

  const load = async () => {
    setLoading(true);
    const { inicio, fim } = calcPeriodo(periodo);
    const { data } = await supabase
      .from('lancamentos_plantoes')
      .select('id, data_plantao, horario_inicio, horario_fim, total_horas, profissao, tipo_plantao, valor_cobrado_cliente, valor_repasse_cooperado, cooperados(id, nome), hospitals(id, nome), sectors(id, nome)')
      .gte('data_plantao', inicio)
      .lte('data_plantao', fim)
      .order('data_plantao', { ascending: false })
      .limit(500);
    setRows((data ?? []) as unknown as Row[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [periodo]);

  useEffect(() => {
    supabase.from('cooperados').select('id, nome').eq('ativo', true).order('nome').then(({ data }) => setCooperados(data ?? []));
    supabase.from('hospitals').select('id, nome').eq('ativo', true).order('nome').then(({ data }) => setHospitals(data ?? []));
    supabase.from('sectors').select('id, nome, hospital_id').eq('ativo', true).order('nome').then(({ data }) => setSectors(data ?? []));
  }, []);

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
    load();
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
        <Button asChild className="gap-2">
          <Link to="/financeiro/lancamentos/novo"><Plus className="h-4 w-4" /> Novo lançamento</Link>
        </Button>
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
                            <th className="text-left p-3 font-medium">Data</th>
                            <th className="text-left p-3 font-medium">Hospital / Setor</th>
                            <th className="text-left p-3 font-medium">Horário</th>
                            <th className="text-right p-3 font-medium">Horas</th>
                            <th className="text-left p-3 font-medium">Tipo</th>
                            <th className="text-right p-3 font-medium">Cliente</th>
                            <th className="text-right p-3 font-medium">Cooperado</th>
                            {canDelete && <th className="text-right p-3 font-medium" />}
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {group.rows.map(r => (
                            <tr key={r.id} className="hover:bg-muted/20">
                              <td className="p-3 tabular-nums">{formatDate(r.data_plantao)}</td>
                              <td className="p-3">
                                <div>{r.hospitals?.nome ?? '—'}</div>
                                <div className="text-xs text-muted-foreground">{r.sectors?.nome ?? '—'}</div>
                              </td>
                              <td className="p-3 tabular-nums text-xs">{r.horario_inicio?.slice(0,5)}–{r.horario_fim?.slice(0,5)}</td>
                              <td className="p-3 text-right tabular-nums">{Number(r.total_horas).toFixed(2)}h</td>
                              <td className="p-3 text-xs">{tipoPlantaoLabel[r.tipo_plantao]}</td>
                              <td className="p-3 text-right tabular-nums font-medium">{formatCurrency(r.valor_cobrado_cliente)}</td>
                              <td className="p-3 text-right tabular-nums text-accent">{formatCurrency(r.valor_repasse_cooperado)}</td>
                              {canDelete && (
                                <td className="p-3 text-right">
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                    onClick={() => setDeleteTarget(r)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-muted/20 font-medium">
                          <tr>
                            <td colSpan={5} className="p-3 text-right text-xs uppercase tracking-wider text-muted-foreground">
                              Total
                            </td>
                            <td className="p-3 text-right tabular-nums">{formatCurrency(gCliente)}</td>
                            <td className="p-3 text-right tabular-nums text-accent">{formatCurrency(gCoop)}</td>
                            {canDelete && <td />}
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
