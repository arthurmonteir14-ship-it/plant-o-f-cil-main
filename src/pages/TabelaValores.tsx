import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, Loader2, Pencil } from 'lucide-react';
import { formatCurrency, profissaoLabel, tipoPlantaoLabel, tipoPlantaoOptions } from '@/lib/format';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

interface Valor {
  id: string; profissao: string; tipo_plantao: string;
  hospital_id: string | null; valor_hora_cliente: number;
  percentual_repasse: number; valor_hora_cooperado: number | null;
  horas: number | null; ativo: boolean;
}
interface Hospital { id: string; nome: string; }

type FormState = {
  profissao: string; tipo_plantao: string; hospital_id: string;
  horas: string; valor_hora_cliente: string; valor_hora_cooperado: string;
};

const emptyForm: FormState = {
  profissao: 'enfermeiro', tipo_plantao: 'normal', hospital_id: '__padrao__',
  horas: '12', valor_hora_cliente: '', valor_hora_cooperado: '',
};

export default function TabelaValores() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin_master') || hasRole('administrativo');

  const [rows, setRows]           = useState<Valor[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [loading, setLoading]     = useState(true);
  const [openNovo, setOpenNovo]   = useState(false);
  const [openEdit, setOpenEdit]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [editId, setEditId]       = useState<string | null>(null);
  const [form, setForm]           = useState<FormState>({ ...emptyForm });
  const [filtroCliente, setFiltroCliente] = useState('__todos__');
  const [filtroTipo, setFiltroTipo]       = useState('__todos__');

  const load = async () => {
    setLoading(true);
    const [v, h] = await Promise.all([
      supabase.from('tabela_valores').select('*').order('profissao').order('tipo_plantao'),
      supabase.from('hospitals').select('id, nome').order('nome'),
    ]);
    setRows((v.data ?? []) as unknown as Valor[]);
    setHospitals(h.data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const resolveValorCoop = (r: Valor) =>
    r.valor_hora_cooperado != null
      ? r.valor_hora_cooperado
      : +(r.valor_hora_cliente * r.percentual_repasse / 100).toFixed(2);

  const rowsFiltradas = useMemo(() => rows.filter(r => {
    if (!r.ativo) return false;
    if (filtroCliente !== '__todos__') {
      if (filtroCliente === '__padrao__' && r.hospital_id !== null) return false;
      if (filtroCliente !== '__padrao__' && r.hospital_id !== filtroCliente) return false;
    }
    if (filtroTipo !== '__todos__' && r.tipo_plantao !== filtroTipo) return false;
    return true;
  }), [rows, filtroCliente, filtroTipo]);

  const grupos = useMemo(() => {
    const map: Record<string, { nome: string; rows: Valor[] }> = {};
    rowsFiltradas.forEach(r => {
      const key = r.hospital_id ?? '__padrao__';
      if (!map[key]) {
        const h = hospitals.find(h => h.id === r.hospital_id);
        map[key] = { nome: h?.nome ?? 'Padrão (todos os clientes)', rows: [] };
      }
      map[key].rows.push(r);
    });
    return Object.entries(map).sort((a, b) => {
      if (a[0] === '__padrao__') return -1;
      if (b[0] === '__padrao__') return 1;
      return a[1].nome.localeCompare(b[1].nome);
    });
  }, [rowsFiltradas, hospitals]);

  const clienteHora = parseFloat(form.valor_hora_cliente.replace(',', '.'));
  const coopHora    = parseFloat(form.valor_hora_cooperado.replace(',', '.'));
  const horasNum    = parseFloat(form.horas.replace(',', '.'));
  const coopMaior   = !isNaN(clienteHora) && !isNaN(coopHora) && coopHora > clienteHora;

  const salvar = async () => {
    if (!clienteHora || clienteHora <= 0) return toast.error('Informe um valor por hora válido');
    if (isNaN(coopHora) || coopHora < 0)  return toast.error('Informe um valor de repasse válido');
    if (coopMaior) return toast.error('Repasse não pode ser maior que o valor do cliente');
    if (!horasNum || horasNum <= 0) return toast.error('Informe a quantidade de horas');
    const percentual = +((coopHora / clienteHora) * 100).toFixed(4);
    const payload = {
      profissao: form.profissao, tipo_plantao: form.tipo_plantao,
      hospital_id: form.hospital_id === '__padrao__' ? null : form.hospital_id,
      horas: horasNum,
      valor_hora_cliente: clienteHora,
      percentual_repasse: percentual,
      ativo: true,
    };
    setSaving(true);
    const { error } = editId
      ? await supabase.from('tabela_valores').update(payload as never).eq('id', editId)
      : await supabase.from('tabela_valores').insert(payload as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editId ? 'Valor atualizado' : 'Valor cadastrado');
    setOpenNovo(false); setOpenEdit(false);
    setEditId(null); setForm({ ...emptyForm });
    load();
  };

  const abrirEdicao = (r: Valor) => {
    setEditId(r.id);
    setForm({
      profissao: r.profissao, tipo_plantao: r.tipo_plantao,
      hospital_id: r.hospital_id ?? '__padrao__',
      horas: (r.horas ?? 12).toString(),
      valor_hora_cliente:   r.valor_hora_cliente.toFixed(2).replace('.', ','),
      valor_hora_cooperado: resolveValorCoop(r).toFixed(2).replace('.', ','),
    });
    setOpenEdit(true);
  };

  const desativar = async (id: string) => {
    const { error } = await supabase.from('tabela_valores').update({ ativo: false } as never).eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Valor removido'); load();
  };

  // Preview do valor bruto no formulário
  const prevBrutoCliente = !isNaN(clienteHora) && !isNaN(horasNum) ? clienteHora * horasNum : null;
  const prevBrutoCoop    = !isNaN(coopHora) && !isNaN(horasNum) ? coopHora * horasNum : null;

  const formulario = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Profissão</Label>
          <Select value={form.profissao} onValueChange={v => setForm(f => ({ ...f, profissao: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(profissaoLabel).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Tipo de plantão</Label>
          <Select value={form.tipo_plantao} onValueChange={v => setForm(f => ({ ...f, tipo_plantao: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {tipoPlantaoOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Cliente <span className="text-muted-foreground font-normal text-xs">(vazio = todos)</span></Label>
          <Select value={form.hospital_id} onValueChange={v => setForm(f => ({ ...f, hospital_id: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__padrao__">Padrão (todos os clientes)</SelectItem>
              {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Quantidade de horas do plantão</Label>
          <Input
            value={form.horas}
            onChange={e => setForm(f => ({ ...f, horas: e.target.value }))}
            placeholder="12"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Valor/hora — Cliente (R$)</Label>
          <Input value={form.valor_hora_cliente} onChange={e => setForm(f => ({ ...f, valor_hora_cliente: e.target.value }))} placeholder="50,00" />
        </div>
        <div>
          <Label>Valor/hora — Cooperado (R$)</Label>
          <Input value={form.valor_hora_cooperado} onChange={e => setForm(f => ({ ...f, valor_hora_cooperado: e.target.value }))} placeholder="35,00" />
        </div>
      </div>
      {/* Preview valor bruto */}
      {(prevBrutoCliente !== null || prevBrutoCoop !== null) && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs grid grid-cols-2 gap-2">
          {prevBrutoCliente !== null && (
            <div><span className="text-muted-foreground">Valor bruto Cliente: </span><span className="font-semibold tabular-nums">{formatCurrency(prevBrutoCliente)}</span></div>
          )}
          {prevBrutoCoop !== null && (
            <div><span className="text-muted-foreground">Valor bruto Cooperado: </span><span className="font-semibold tabular-nums text-accent">{formatCurrency(prevBrutoCoop)}</span></div>
          )}
        </div>
      )}
      {coopMaior && <p className="text-xs text-destructive">O repasse não pode ser maior que o valor do cliente.</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Tabela de valores</h1>
          <p className="text-sm text-muted-foreground">Configure preços por profissão, tipo de plantão e cliente</p>
        </div>
        {canEdit && (
          <Dialog open={openNovo} onOpenChange={v => { setOpenNovo(v); if (!v) { setForm({ ...emptyForm }); setEditId(null); } }}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" /> Novo valor</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Novo valor</DialogTitle></DialogHeader>
              {formulario}
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenNovo(false)}>Cancelar</Button>
                <Button onClick={salvar} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Modal edição */}
      <Dialog open={openEdit} onOpenChange={v => { setOpenEdit(v); if (!v) { setForm({ ...emptyForm }); setEditId(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Editar valor</DialogTitle></DialogHeader>
          {formulario}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenEdit(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[200px]">
          <Label className="text-xs">Cliente</Label>
          <Select value={filtroCliente} onValueChange={setFiltroCliente}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos__">Todos os clientes</SelectItem>
              <SelectItem value="__padrao__">Padrão (sem cliente)</SelectItem>
              {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[180px]">
          <Label className="text-xs">Tipo de plantão</Label>
          <Select value={filtroTipo} onValueChange={setFiltroTipo}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos__">Todos os tipos</SelectItem>
              {tipoPlantaoOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabela agrupada */}
      {loading ? (
        <div className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : grupos.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-sm text-muted-foreground">Nenhum valor para os filtros selecionados.</CardContent></Card>
      ) : (
        <div className="space-y-5">
          {grupos.map(([key, grupo]) => (
            <Card key={key}>
              <CardHeader className="pb-0">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  {key === '__padrao__'
                    ? <span className="text-muted-foreground italic">Padrão — todos os clientes</span>
                    : grupo.nome}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({grupo.rows.length} {grupo.rows.length === 1 ? 'registro' : 'registros'})
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 mt-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="text-left p-3 font-medium bg-muted/40" rowSpan={1}>Profissão</th>
                        <th className="text-left p-3 font-medium bg-muted/40">Tipo</th>
                        <th className="text-right p-3 font-medium bg-muted/40">Horas</th>
                        {/* grupo cliente — fundo azul muito leve */}
                        <th className="text-right p-3 font-medium bg-blue-50 text-blue-700 border-l border-blue-200">Valor/h Cliente</th>
                        <th className="text-right p-3 font-medium bg-blue-50 text-blue-700 border-r border-blue-200">Valor Bruto Cliente</th>
                        {/* grupo cooperado — fundo verde muito leve */}
                        <th className="text-right p-3 font-medium bg-emerald-50 text-emerald-700 border-l border-emerald-200">Valor/h Cooperado</th>
                        <th className="text-right p-3 font-medium bg-emerald-50 text-emerald-700 border-r border-emerald-200">Valor Bruto Cooperado</th>
                        {canEdit && <th className="text-right p-3 font-medium bg-muted/40">Ações</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {grupo.rows.map(r => {
                        const horas = r.horas ?? null;
                        const coop = resolveValorCoop(r);
                        const brutoCli  = horas != null ? r.valor_hora_cliente * horas : null;
                        const brutoCoop = horas != null ? coop * horas : null;
                        return (
                          <tr key={r.id} className="hover:bg-muted/20">
                            <td className="p-3 font-medium">{profissaoLabel[r.profissao] ?? r.profissao}</td>
                            <td className="p-3">{tipoPlantaoLabel[r.tipo_plantao] ?? r.tipo_plantao}</td>
                            <td className="p-3 text-right tabular-nums text-muted-foreground">{horas != null ? `${horas}h` : '—'}</td>
                            {/* cliente */}
                            <td className="p-3 text-right tabular-nums bg-blue-50/50 border-l border-blue-100 text-blue-900">
                              {formatCurrency(r.valor_hora_cliente)}
                            </td>
                            <td className="p-3 text-right tabular-nums bg-blue-50/50 border-r border-blue-100 font-semibold text-blue-900">
                              {brutoCli != null ? formatCurrency(brutoCli) : '—'}
                            </td>
                            {/* cooperado */}
                            <td className="p-3 text-right tabular-nums bg-emerald-50/50 border-l border-emerald-100 text-emerald-900">
                              {formatCurrency(coop)}
                            </td>
                            <td className="p-3 text-right tabular-nums bg-emerald-50/50 border-r border-emerald-100 font-semibold text-emerald-900">
                              {brutoCoop != null ? formatCurrency(brutoCoop) : '—'}
                            </td>
                            {canEdit && (
                              <td className="p-3 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button size="sm" variant="ghost" onClick={() => abrirEdicao(r)} className="h-7 text-xs gap-1">
                                    <Pencil className="h-3.5 w-3.5" /> Editar
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => desativar(r.id)} className="h-7 text-xs gap-1 text-destructive hover:text-destructive">
                                    <Trash2 className="h-3.5 w-3.5" /> Remover
                                  </Button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
