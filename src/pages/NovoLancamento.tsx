import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Loader2, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { calcularHoras, formatCurrency, profissaoLabel, tipoPlantaoOptions } from '@/lib/format';
import { toast } from 'sonner';

interface Cooperado { id: string; nome: string; profissao: string; }
interface Hospital { id: string; nome: string; }
interface Sector { id: string; nome: string; hospital_id: string; }
interface ValorRow {
  profissao: string; tipo_plantao: string; hospital_id: string | null;
  valor_hora_cliente: number; percentual_repasse: number; valor_hora_cooperado: number | null;
}

const HORARIOS: Record<'normal' | 'extra', { inicio: string; fim: string }> = {
  normal: { inicio: '07:00', fim: '19:00' },
  extra: { inicio: '19:00', fim: '07:00' },
};

const schema = z.object({
  cooperado_id: z.string().uuid('Selecione um cooperado'),
  hospital_id: z.string().uuid('Selecione um hospital'),
  setor_id: z.string().uuid('Selecione um setor'),
  horario_inicio: z.string().regex(/^\d{2}:\d{2}$/, 'Horário inválido'),
  horario_fim: z.string().regex(/^\d{2}:\d{2}$/, 'Horário inválido'),
  tipo_plantao: z.enum(['normal', 'extra']),
  observacao: z.string().max(500).optional(),
});

export default function NovoLancamento() {
  const navigate = useNavigate();
  const [cooperados, setCooperados] = useState<Cooperado[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [valores, setValores] = useState<ValorRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [datasPlantao, setDatasPlantao] = useState<Date[]>([new Date()]);

  const [form, setForm] = useState<{
    cooperado_id: string; hospital_id: string; setor_id: string;
    horario_inicio: string; horario_fim: string;
    tipo_plantao: 'normal' | 'extra'; observacao: string;
  }>({
    cooperado_id: '', hospital_id: '', setor_id: '',
    ...HORARIOS.normal, tipo_plantao: 'normal', observacao: '',
  });

  useEffect(() => {
    (async () => {
      const [c, h, s, v] = await Promise.all([
        supabase.from('cooperados').select('id, nome, profissao').eq('ativo', true).order('nome'),
        supabase.from('hospitals').select('id, nome').eq('ativo', true).order('nome'),
        supabase.from('sectors').select('id, nome, hospital_id').eq('ativo', true).order('nome'),
        supabase.from('tabela_valores').select('profissao, tipo_plantao, hospital_id, valor_hora_cliente, percentual_repasse, valor_hora_cooperado').eq('ativo', true),
      ]);
      setCooperados(c.data ?? []);
      setHospitals(h.data ?? []);
      setSectors(s.data ?? []);
      setValores((v.data ?? []) as unknown as ValorRow[]);
    })();
  }, []);

  const setTipoPlantao = (tipo: 'normal' | 'extra') =>
    setForm(f => ({ ...f, tipo_plantao: tipo, ...HORARIOS[tipo] }));

  const cooperadoSelecionado = cooperados.find(c => c.id === form.cooperado_id);
  const setoresDoHospital = sectors.filter(s => s.hospital_id === form.hospital_id);

  const totalHoras = useMemo(
    () => calcularHoras(form.horario_inicio, form.horario_fim),
    [form.horario_inicio, form.horario_fim]
  );

  const valorAplicavel = useMemo(() => {
    if (!cooperadoSelecionado) return null;
    const candidatos = valores.filter(
      v => v.profissao === cooperadoSelecionado.profissao && v.tipo_plantao === form.tipo_plantao
    );
    return candidatos.find(v => v.hospital_id === form.hospital_id) ?? candidatos.find(v => v.hospital_id === null) ?? null;
  }, [cooperadoSelecionado, form.tipo_plantao, form.hospital_id, valores]);

  const valorHoraCliente = Number(valorAplicavel?.valor_hora_cliente ?? 0);
  const valorHoraCooperado = valorAplicavel
    ? (valorAplicavel.valor_hora_cooperado != null
        ? Number(valorAplicavel.valor_hora_cooperado)
        : +(valorHoraCliente * Number(valorAplicavel.percentual_repasse) / 100).toFixed(2))
    : 0;
  const percentual = valorHoraCliente > 0 ? (valorHoraCooperado / valorHoraCliente) * 100 : 0;
  const valorCliente = +(totalHoras * valorHoraCliente).toFixed(2);
  const valorCooperado = +(totalHoras * valorHoraCooperado).toFixed(2);

  const datasLabel = datasPlantao.length === 0
    ? 'Selecione'
    : datasPlantao.length === 1
      ? format(datasPlantao[0], "dd 'de' MMMM 'de' yyyy", { locale: ptBR })
      : `${datasPlantao.length} dias selecionados`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    if (datasPlantao.length === 0) { toast.error('Selecione ao menos uma data'); return; }
    if (totalHoras <= 0) { toast.error('Total de horas deve ser maior que zero'); return; }
    if (!valorAplicavel) { toast.error('Sem tabela de valores para essa combinação'); return; }
    if (!cooperadoSelecionado) return;

    setSubmitting(true);
    const inserts = datasPlantao.map(data => ({
      cooperado_id: form.cooperado_id,
      hospital_id: form.hospital_id,
      setor_id: form.setor_id,
      data_plantao: format(data, 'yyyy-MM-dd'),
      horario_inicio: form.horario_inicio,
      horario_fim: form.horario_fim,
      total_horas: totalHoras,
      profissao: cooperadoSelecionado.profissao as 'enfermeiro' | 'tecnico_enfermagem' | 'fonoaudiologo' | 'assistente_social',
      tipo_plantao: form.tipo_plantao,
      valor_hora_cliente: valorHoraCliente,
      valor_cobrado_cliente: valorCliente,
      percentual_repasse: percentual,
      valor_repasse_cooperado: valorCooperado,
      observacao: form.observacao || null,
      lancado_por: null,
    }));

    const { error } = await supabase.from('lancamentos_plantoes').insert(inserts);
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(datasPlantao.length > 1 ? `${datasPlantao.length} plantões registrados` : 'Plantão registrado com sucesso');
    navigate('/financeiro/lancamentos');
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Novo lançamento de plantão</h1>
          <p className="text-sm text-muted-foreground">Os valores são calculados automaticamente pela tabela vigente</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Dados do plantão</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Cooperado *</Label>
                <Select value={form.cooperado_id} onValueChange={v => setForm(f => ({ ...f, cooperado_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {cooperados.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome} — <span className="text-muted-foreground">{profissaoLabel[c.profissao]}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {cooperadoSelecionado && (
                  <p className="mt-1 text-xs text-muted-foreground">Profissão: {profissaoLabel[cooperadoSelecionado.profissao]}</p>
                )}
              </div>

              <div>
                <Label>Tipo de plantão *</Label>
                <Select value={form.tipo_plantao} onValueChange={v => setTipoPlantao(v as 'normal' | 'extra')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {tipoPlantaoOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Hospital / Cliente *</Label>
                <Select value={form.hospital_id} onValueChange={v => setForm(f => ({ ...f, hospital_id: v, setor_id: '' }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Setor *</Label>
                <Select value={form.setor_id} onValueChange={v => setForm(f => ({ ...f, setor_id: v }))} disabled={!form.hospital_id}>
                  <SelectTrigger><SelectValue placeholder={form.hospital_id ? 'Selecione…' : 'Escolha um hospital primeiro'} /></SelectTrigger>
                  <SelectContent>
                    {setoresDoHospital.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="md:col-span-2">
                <Label>
                  Datas do plantão *
                  <span className="ml-1 font-normal text-muted-foreground">(selecione uma ou mais datas)</span>
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn('w-full mt-1 justify-start text-left font-normal', !datasPlantao.length && 'text-muted-foreground')}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {datasLabel}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="multiple" selected={datasPlantao} onSelect={d => setDatasPlantao(d ?? [])}
                      initialFocus locale={ptBR} className="p-3 pointer-events-auto" />
                    {datasPlantao.length > 0 && (
                      <div className="border-t p-2">
                        <p className="text-xs text-muted-foreground px-1 mb-1">
                          {datasPlantao.length} {datasPlantao.length === 1 ? 'dia selecionado' : 'dias selecionados'}
                        </p>
                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                          {[...datasPlantao].sort((a, b) => a.getTime() - b.getTime()).map(d => (
                            <span key={d.toISOString()} className="rounded bg-primary/10 text-primary text-xs px-2 py-0.5">
                              {format(d, 'dd/MM', { locale: ptBR })}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Início</Label>
                  <Input type="time" value={form.horario_inicio} onChange={e => setForm(f => ({ ...f, horario_inicio: e.target.value }))} />
                </div>
                <div>
                  <Label>Fim</Label>
                  <Input type="time" value={form.horario_fim} onChange={e => setForm(f => ({ ...f, horario_fim: e.target.value }))} />
                </div>
              </div>
            </div>

            <div>
              <Label>Observação</Label>
              <Textarea value={form.observacao} onChange={e => setForm(f => ({ ...f, observacao: e.target.value }))}
                placeholder="Informações adicionais (opcional)" rows={3} />
            </div>
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader><CardTitle>Resumo financeiro</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-primary-soft p-4">
              <div className="text-xs uppercase tracking-wider text-primary mb-1">Total de horas</div>
              <div className="text-3xl font-bold tabular-nums text-primary">{totalHoras.toFixed(2)}h</div>
            </div>

            {datasPlantao.length > 1 && (
              <div className="rounded-lg bg-accent-soft p-3">
                <div className="text-xs uppercase tracking-wider text-accent mb-1">Dias selecionados</div>
                <div className="text-2xl font-bold tabular-nums text-accent">{datasPlantao.length}</div>
              </div>
            )}

            {valorAplicavel ? (
              <>
                <Row label="Valor/hora — Cliente" value={formatCurrency(valorHoraCliente)} />
                <Row label="Valor/hora — Cooperado" value={formatCurrency(valorHoraCooperado)} />
                <div className="border-t border-border/50 pt-2 space-y-1.5">
                  <Row label="Valor cliente (por dia)" value={formatCurrency(valorCliente)} bold />
                  <Row label="Repasse cooperado (por dia)" value={formatCurrency(valorCooperado)} accent />
                </div>
                {datasPlantao.length > 1 && (
                  <div className="border-t border-border/50 pt-2 space-y-1.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider">Total ({datasPlantao.length} dias)</p>
                    <Row label="Total cliente" value={formatCurrency(valorCliente * datasPlantao.length)} bold />
                    <Row label="Total cooperado" value={formatCurrency(valorCooperado * datasPlantao.length)} accent />
                  </div>
                )}
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-warning/40 bg-warning/5 p-3 text-xs text-warning-foreground/80">
                {cooperadoSelecionado
                  ? 'Sem tabela de valores para essa combinação. Cadastre em Tabela de Valores.'
                  : 'Selecione um cooperado para ver os valores.'}
              </p>
            )}

            <Button type="submit" className="w-full mt-4"
              disabled={submitting || !valorAplicavel || totalHoras <= 0 || datasPlantao.length === 0}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {datasPlantao.length > 1 ? `Criar ${datasPlantao.length} lançamentos` : 'Registrar plantão'}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-border/40 last:border-0">
      <span className="text-sm">{label}</span>
      <span className={cn('tabular-nums text-sm', bold && 'font-bold text-base', accent && 'text-accent font-semibold')}>{value}</span>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
