import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { formatCurrency, profissaoLabel, tipoPlantaoLabel, tipoPlantaoOptions } from '@/lib/format';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

interface Valor {
  id: string; profissao: string; tipo_plantao: string;
  hospital_id: string | null; valor_hora_cliente: number;
  percentual_repasse: number; valor_hora_cooperado: number | null; ativo: boolean;
}
interface Hospital { id: string; nome: string; }

export default function TabelaValores() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin_master') || hasRole('administrativo');
  const [rows, setRows] = useState<Valor[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [novo, setNovo] = useState({
    profissao: 'enfermeiro' as 'enfermeiro' | 'tecnico_enfermagem' | 'fonoaudiologo' | 'assistente_social',
    tipo_plantao: 'normal' as 'normal' | 'extra' | 'diarista',
    hospital_id: '__padrao__',
    valor_hora_cliente: '',
    valor_hora_cooperado: '',
  });

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

  const valorHoraClienteNum = parseFloat(novo.valor_hora_cliente.replace(',', '.'));
  const valorHoraCoopNum = parseFloat(novo.valor_hora_cooperado.replace(',', '.'));

  const adicionar = async () => {
    if (!valorHoraClienteNum || valorHoraClienteNum <= 0) return toast.error('Informe um valor por hora válido');
    if (isNaN(valorHoraCoopNum) || valorHoraCoopNum < 0) return toast.error('Informe um valor de repasse válido');
    if (valorHoraCoopNum > valorHoraClienteNum) return toast.error('Repasse não pode ser maior que o valor do cliente');
    const percentual = +((valorHoraCoopNum / valorHoraClienteNum) * 100).toFixed(4);
    setSaving(true);
    const { error } = await supabase.from('tabela_valores').insert({
      profissao: novo.profissao,
      tipo_plantao: novo.tipo_plantao,
      hospital_id: novo.hospital_id === '__padrao__' ? null : novo.hospital_id,
      valor_hora_cliente: valorHoraClienteNum,
      percentual_repasse: percentual,
      ativo: true,
    } as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Valor cadastrado');
    setOpen(false);
    setNovo({ profissao: 'enfermeiro', tipo_plantao: 'normal' as 'normal' | 'extra' | 'diarista', hospital_id: '__padrao__', valor_hora_cliente: '', valor_hora_cooperado: '' });
    load();
  };

  const desativar = async (id: string) => {
    const { error } = await supabase.from('tabela_valores').update({ ativo: false } as never).eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Valor desativado');
    load();
  };

  const resolveValorCooperado = (r: Valor) =>
    r.valor_hora_cooperado != null
      ? r.valor_hora_cooperado
      : +(r.valor_hora_cliente * r.percentual_repasse / 100).toFixed(2);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Tabela de valores</h1>
          <p className="text-sm text-muted-foreground">Configure preços por profissão, tipo de plantão e cliente</p>
        </div>
        {canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" /> Novo valor</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Novo valor</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Profissão</Label>
                  <Select value={novo.profissao} onValueChange={v => setNovo(n => ({ ...n, profissao: v as typeof n.profissao }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(profissaoLabel).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tipo de plantão</Label>
                  <Select value={novo.tipo_plantao} onValueChange={v => setNovo(n => ({ ...n, tipo_plantao: v as typeof n.tipo_plantao }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {tipoPlantaoOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cliente específico (opcional — vazio = padrão para todos)</Label>
                  <Select value={novo.hospital_id} onValueChange={v => setNovo(n => ({ ...n, hospital_id: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__padrao__">Padrão (todos os clientes)</SelectItem>
                      {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Valor/hora — Cliente (R$)</Label>
                    <Input value={novo.valor_hora_cliente} onChange={e => setNovo(n => ({ ...n, valor_hora_cliente: e.target.value }))} placeholder="50,00" />
                  </div>
                  <div>
                    <Label>Valor/hora — Cooperado (R$)</Label>
                    <Input value={novo.valor_hora_cooperado} onChange={e => setNovo(n => ({ ...n, valor_hora_cooperado: e.target.value }))} placeholder="35,00" />
                  </div>
                </div>
                {!isNaN(valorHoraClienteNum) && !isNaN(valorHoraCoopNum) && valorHoraCoopNum > valorHoraClienteNum && (
                  <p className="text-xs text-destructive">O repasse não pode ser maior que o valor do cliente.</p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={adicionar} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Valores ativos</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : rows.filter(r => r.ativo).length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Nenhum valor cadastrado.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left p-3 font-medium">Profissão</th>
                    <th className="text-left p-3 font-medium">Tipo</th>
                    <th className="text-left p-3 font-medium">Cliente</th>
                    <th className="text-right p-3 font-medium">Valor/hora Cliente</th>
                    <th className="text-right p-3 font-medium">Valor/hora Cooperado</th>
                    {canEdit && <th className="text-right p-3 font-medium">Ações</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.filter(r => r.ativo).map(r => {
                    const hospital = hospitals.find(h => h.id === r.hospital_id);
                    const valCoop = resolveValorCooperado(r);
                    return (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="p-3 font-medium">{profissaoLabel[r.profissao]}</td>
                        <td className="p-3">{tipoPlantaoLabel[r.tipo_plantao]}</td>
                        <td className="p-3">{hospital?.nome ?? <span className="text-muted-foreground italic">Padrão</span>}</td>
                        <td className="p-3 text-right tabular-nums">{formatCurrency(r.valor_hora_cliente)}</td>
                        <td className="p-3 text-right tabular-nums text-accent font-medium">{formatCurrency(valCoop)}</td>
                        {canEdit && (
                          <td className="p-3 text-right">
                            <Button size="sm" variant="ghost" onClick={() => desativar(r.id)} className="h-7 text-xs gap-1 text-destructive hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" /> Desativar
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
