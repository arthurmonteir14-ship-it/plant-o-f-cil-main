import { useEffect, useState, useMemo } from 'react';

const toTitleCase = (s: string) =>
  s.trim().toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Loader2, Pencil, PowerOff, Search } from 'lucide-react';
import { profissaoLabel } from '@/lib/format';
import { toast } from 'sonner';

interface Cooperado {
  id: string; nome: string; cpf: string | null; data_nascimento: string | null;
  telefone: string | null; email: string | null; profissao: string;
  registro_profissional: string | null; ativo: boolean;
  rg: string | null; pis_inss: string | null;
  banco: string | null; agencia: string | null; conta: string | null;
  tipo_conta: string | null; pix: string | null; observacoes: string | null;
  cep: string | null; logradouro: string | null; numero: string | null;
  complemento: string | null; bairro: string | null; cidade: string | null;
  estado_uf: string | null; estado_civil: string | null;
  sexo: string | null; raca_cor: string | null;
}

const profissoes = Object.entries(profissaoLabel) as [string, string][];

const maskCPF = (v: string) =>
  v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');

const maskCEP = (v: string) =>
  v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');

const maskPIS = (v: string) =>
  v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3}\.\d{5})(\d)/, '$1.$2')
    .replace(/(\d{3}\.\d{5}\.\d{2})(\d{1,2})$/, '$1-$2');

const validarPIS = (pis: string): boolean => {
  const n = pis.replace(/\D/g, '');
  if (n.length !== 11 || /^(\d)\1{10}$/.test(n)) return false;
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = n.slice(0, 10).split('').reduce((s, d, i) => s + parseInt(d) * pesos[i], 0);
  const resto = soma % 11;
  return (resto < 2 ? 0 : 11 - resto) === parseInt(n[10]);
};

const validarCPF = (cpf: string): boolean => {
  const n = cpf.replace(/\D/g, '');
  if (n.length !== 11 || /^(\d)\1{10}$/.test(n)) return false;
  const soma = (len: number) =>
    n.slice(0, len).split('').reduce((s, d, i) => s + parseInt(d) * (len + 1 - i), 0);
  return (soma(9) * 10) % 11 % 10 === parseInt(n[9]) &&
         (soma(10) * 10) % 11 % 10 === parseInt(n[10]);
};

const emptyForm = {
  nome: '', cpf: '', data_nascimento: '', telefone: '', email: '',
  profissao: 'enfermeiro', registro_profissional: '', ativo: true,
  rg: '', pis_inss: '',
  banco: '', agencia: '', conta: '', tipo_conta: 'corrente', pix: '',
  observacoes: '',
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', estado_uf: '',
  estado_civil: '', sexo: '', raca_cor: '',
};

export default function CadastroCooperado() {
  const [rows, setRows] = useState<Cooperado[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [buscandoCEP, setBuscandoCEP] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [search, setSearch] = useState('');
  const [filtroProfissao, setFiltroProfissao] = useState('__todos__');
  const [filtroStatus, setFiltroStatus] = useState('ativo');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('cooperados').select('*').order('nome');
    setRows((data ?? []) as unknown as Cooperado[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter(r => {
    const q = search.toLowerCase();
    const matchSearch = !q || r.nome.toLowerCase().includes(q) ||
      (r.registro_profissional ?? '').toLowerCase().includes(q);
    const matchProf = filtroProfissao === '__todos__' || r.profissao === filtroProfissao;
    const matchStatus = filtroStatus === '__todos__' ||
      (filtroStatus === 'ativo' ? r.ativo : !r.ativo);
    return matchSearch && matchProf && matchStatus;
  }), [rows, search, filtroProfissao, filtroStatus]);

  const openNew = () => {
    setEditId(null);
    setForm({ ...emptyForm });
    setOpen(true);
  };

  const openEdit = (r: Cooperado) => {
    setEditId(r.id);
    setForm({
      nome: r.nome, cpf: r.cpf ?? '', data_nascimento: r.data_nascimento ?? '',
      telefone: r.telefone ?? '', email: r.email ?? '',
      profissao: r.profissao, registro_profissional: r.registro_profissional ?? '',
      ativo: r.ativo,
      rg: r.rg ?? '', pis_inss: r.pis_inss ?? '',
      banco: r.banco ?? '', agencia: r.agencia ?? '', conta: r.conta ?? '',
      tipo_conta: r.tipo_conta ?? 'corrente', pix: r.pix ?? '',
      observacoes: r.observacoes ?? '',
      cep: r.cep ?? '', logradouro: r.logradouro ?? '', numero: r.numero ?? '',
      complemento: r.complemento ?? '', bairro: r.bairro ?? '',
      cidade: r.cidade ?? '', estado_uf: r.estado_uf ?? '',
      estado_civil: r.estado_civil ?? '', sexo: r.sexo ?? '', raca_cor: r.raca_cor ?? '',
    });
    setOpen(true);
  };

  const buscarCEP = async (cep: string) => {
    const raw = cep.replace(/\D/g, '');
    if (raw.length !== 8) return;
    setBuscandoCEP(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${raw}/json/`);
      const data = await res.json();
      if (data.erro) { toast.error('CEP não encontrado'); return; }
      setForm(prev => ({
        ...prev,
        logradouro: data.logradouro ?? prev.logradouro,
        bairro: data.bairro ?? prev.bairro,
        cidade: data.localidade ?? prev.cidade,
        estado_uf: data.uf ?? prev.estado_uf,
        complemento: data.complemento ?? prev.complemento,
      }));
    } catch {
      toast.error('Erro ao buscar CEP');
    } finally {
      setBuscandoCEP(false);
    }
  };

  const salvar = async () => {
    if (!form.nome.trim()) return toast.error('Informe o nome do cooperado');
    if (form.cpf && !validarCPF(form.cpf)) return toast.error('CPF inválido');
    if (form.pis_inss && !validarPIS(form.pis_inss)) return toast.error('PIS/INSS inválido');
    setSaving(true);
    const payload = {
      nome: toTitleCase(form.nome),
      cpf: form.cpf.replace(/\D/g, '') || null,
      data_nascimento: form.data_nascimento || null,
      telefone: form.telefone.trim() || null,
      email: form.email.trim() || null,
      profissao: form.profissao as 'enfermeiro' | 'enfermeiro_rt' | 'tecnico_enfermagem' | 'fonoaudiologo' | 'assistente_social',
      registro_profissional: form.registro_profissional.trim() || null,
      ativo: form.ativo,
      rg: form.rg.trim() || null,
      pis_inss: form.pis_inss.trim() || null,
      banco: form.banco.trim() || null,
      agencia: form.agencia.trim() || null,
      conta: form.conta.trim() || null,
      tipo_conta: form.tipo_conta || null,
      pix: form.pix.trim() || null,
      observacoes: form.observacoes.trim() || null,
      cep: form.cep.replace(/\D/g, '') || null,
      logradouro: form.logradouro.trim() || null,
      numero: form.numero.trim() || null,
      complemento: form.complemento.trim() || null,
      bairro: form.bairro.trim() || null,
      cidade: form.cidade.trim() || null,
      estado_uf: form.estado_uf.trim() || null,
      estado_civil: form.estado_civil || null,
      sexo: form.sexo || null,
      raca_cor: form.raca_cor || null,
    };
    const { error } = editId
      ? await supabase.from('cooperados').update(payload as never).eq('id', editId)
      : await supabase.from('cooperados').insert(payload as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editId ? 'Cooperado atualizado' : 'Cooperado cadastrado');
    setOpen(false);
    load();
  };

  const toggleAtivo = async (id: string, ativo: boolean) => {
    const { error } = await supabase.from('cooperados').update({ ativo: !ativo } as never).eq('id', id);
    if (error) return toast.error(error.message);
    toast.success(ativo ? 'Cooperado desativado' : 'Cooperado reativado');
    setConfirmId(null);
    load();
  };

  const f = (field: keyof typeof form, value: string | boolean) =>
    setForm(prev => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Cadastro de Cooperados</h1>
          <p className="text-sm text-muted-foreground">Gerencie os cooperados da CADES</p>
        </div>
        <Button className="gap-2" onClick={openNew}>
          <Plus className="h-4 w-4" /> Novo cooperado
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar por nome ou COREN…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filtroProfissao} onValueChange={setFiltroProfissao}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__todos__">Todas as profissões</SelectItem>
            {profissoes.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtroStatus} onValueChange={setFiltroStatus}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__todos__">Todos</SelectItem>
            <SelectItem value="ativo">Ativos</SelectItem>
            <SelectItem value="inativo">Inativos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Cooperados cadastrados
            <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              {rows.length === 0 ? 'Nenhum cooperado cadastrado.' : 'Nenhum resultado para os filtros aplicados.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left p-3 font-medium">Nome</th>
                    <th className="text-left p-3 font-medium">COREN / Registro</th>
                    <th className="text-left p-3 font-medium">Profissão</th>
                    <th className="text-left p-3 font-medium">Contato</th>
                    <th className="text-center p-3 font-medium">Status</th>
                    <th className="text-right p-3 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map(r => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="p-3 font-medium">{r.nome}</td>
                      <td className="p-3 text-muted-foreground">{r.registro_profissional ?? '—'}</td>
                      <td className="p-3">{profissaoLabel[r.profissao] ?? r.profissao}</td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {r.telefone && <div>{r.telefone}</div>}
                        {r.email && <div>{r.email}</div>}
                        {!r.telefone && !r.email && '—'}
                      </td>
                      <td className="p-3 text-center">
                        <Badge variant={r.ativo ? 'default' : 'secondary'}>
                          {r.ativo ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)} className="h-7 text-xs gap-1">
                            <Pencil className="h-3.5 w-3.5" /> Editar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmId(r.id)}
                            className={`h-7 text-xs gap-1 ${r.ativo ? 'text-destructive hover:text-destructive' : 'text-green-600 hover:text-green-700'}`}>
                            <PowerOff className="h-3.5 w-3.5" />
                            {r.ativo ? 'Desativar' : 'Reativar'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal de cadastro/edição */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? 'Editar cooperado' : 'Novo cooperado'}</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="pessoal" className="mt-2">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="pessoal">Pessoal</TabsTrigger>
              <TabsTrigger value="endereco">Endereço</TabsTrigger>
              <TabsTrigger value="profissional">Profissional</TabsTrigger>
              <TabsTrigger value="bancario">Bancário</TabsTrigger>
              <TabsTrigger value="obs">Observações</TabsTrigger>
            </TabsList>

            <TabsContent value="pessoal" className="space-y-3 mt-4">
              <div>
                <Label>Nome completo *</Label>
                <Input value={form.nome} onChange={e => f('nome', e.target.value)} placeholder="Ex.: Ana Paula Ribeiro" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>CPF</Label>
                  <Input
                    value={form.cpf}
                    onChange={e => f('cpf', maskCPF(e.target.value))}
                    placeholder="000.000.000-00"
                    className={form.cpf && form.cpf.replace(/\D/g,'').length === 11 && !validarCPF(form.cpf) ? 'border-red-500 focus-visible:ring-red-500' : ''}
                  />
                  {form.cpf && form.cpf.replace(/\D/g,'').length === 11 && !validarCPF(form.cpf) && (
                    <p className="text-xs text-red-500 mt-1">CPF inválido</p>
                  )}
                </div>
                <div>
                  <Label>RG</Label>
                  <Input value={form.rg} onChange={e => f('rg', e.target.value)} placeholder="Ex.: 1234567 SSP/ES" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>PIS / INSS</Label>
                  <Input
                    value={form.pis_inss}
                    onChange={e => f('pis_inss', maskPIS(e.target.value))}
                    placeholder="000.00000.00-0"
                    className={form.pis_inss && form.pis_inss.replace(/\D/g,'').length === 11 && !validarPIS(form.pis_inss) ? 'border-red-500 focus-visible:ring-red-500' : ''}
                  />
                  {form.pis_inss && form.pis_inss.replace(/\D/g,'').length === 11 && !validarPIS(form.pis_inss) && (
                    <p className="text-xs text-red-500 mt-1">PIS/INSS inválido</p>
                  )}
                </div>
                <div>
                  <Label>Data de nascimento</Label>
                  <Input type="date" value={form.data_nascimento} onChange={e => f('data_nascimento', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Telefone</Label>
                  <Input value={form.telefone} onChange={e => f('telefone', e.target.value)} placeholder="(11) 99999-0000" />
                </div>
                <div>
                  <Label>E-mail</Label>
                  <Input type="email" value={form.email} onChange={e => f('email', e.target.value)} placeholder="cooperado@email.com" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Estado civil</Label>
                  <Select value={form.estado_civil} onValueChange={v => f('estado_civil', v)}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="solteiro">Solteiro(a)</SelectItem>
                      <SelectItem value="casado">Casado(a)</SelectItem>
                      <SelectItem value="uniao_estavel">União Estável</SelectItem>
                      <SelectItem value="divorciado">Divorciado(a)</SelectItem>
                      <SelectItem value="viuvo">Viúvo(a)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Sexo</Label>
                  <Select value={form.sexo} onValueChange={v => f('sexo', v)}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="masculino">Masculino</SelectItem>
                      <SelectItem value="feminino">Feminino</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                      <SelectItem value="nao_informado">Prefiro não informar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Raça / Cor</Label>
                  <Select value={form.raca_cor} onValueChange={v => f('raca_cor', v)}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="branca">Branca</SelectItem>
                      <SelectItem value="preta">Preta</SelectItem>
                      <SelectItem value="parda">Parda</SelectItem>
                      <SelectItem value="amarela">Amarela</SelectItem>
                      <SelectItem value="indigena">Indígena</SelectItem>
                      <SelectItem value="nao_informado">Prefiro não informar</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="endereco" className="space-y-3 mt-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>CEP</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.cep}
                      onChange={e => f('cep', maskCEP(e.target.value))}
                      onBlur={e => buscarCEP(e.target.value)}
                      placeholder="00000-000"
                    />
                    {buscandoCEP && <Loader2 className="h-4 w-4 animate-spin mt-2.5 shrink-0" />}
                  </div>
                </div>
                <div className="col-span-2">
                  <Label>Logradouro</Label>
                  <Input value={form.logradouro} onChange={e => f('logradouro', e.target.value)} placeholder="Rua, Av., etc." />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Número</Label>
                  <Input value={form.numero} onChange={e => f('numero', e.target.value)} placeholder="Ex.: 123" />
                </div>
                <div className="col-span-2">
                  <Label>Complemento</Label>
                  <Input value={form.complemento} onChange={e => f('complemento', e.target.value)} placeholder="Apto, bloco, etc." />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Bairro</Label>
                  <Input value={form.bairro} onChange={e => f('bairro', e.target.value)} placeholder="Bairro" />
                </div>
                <div>
                  <Label>Cidade</Label>
                  <Input value={form.cidade} onChange={e => f('cidade', e.target.value)} placeholder="Cidade" />
                </div>
                <div>
                  <Label>UF</Label>
                  <Input value={form.estado_uf} onChange={e => f('estado_uf', e.target.value.toUpperCase().slice(0, 2))} placeholder="ES" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="profissional" className="space-y-3 mt-4">
              <div>
                <Label>Profissão *</Label>
                <Select value={form.profissao} onValueChange={v => f('profissao', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {profissoes.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>COREN / Registro profissional</Label>
                <Input value={form.registro_profissional} onChange={e => f('registro_profissional', e.target.value)} placeholder="COREN-SP 123456" />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.ativo ? 'ativo' : 'inativo'} onValueChange={v => f('ativo', v === 'ativo')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <TabsContent value="bancario" className="space-y-3 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Banco</Label>
                  <Input value={form.banco} onChange={e => f('banco', e.target.value)} placeholder="Ex.: Bradesco" />
                </div>
                <div>
                  <Label>Tipo de conta</Label>
                  <Select value={form.tipo_conta} onValueChange={v => f('tipo_conta', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="corrente">Conta Corrente</SelectItem>
                      <SelectItem value="poupanca">Conta Poupança</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Agência</Label>
                  <Input value={form.agencia} onChange={e => f('agencia', e.target.value)} placeholder="0001-5" />
                </div>
                <div>
                  <Label>Conta</Label>
                  <Input value={form.conta} onChange={e => f('conta', e.target.value)} placeholder="12345-6" />
                </div>
              </div>
              <div>
                <Label>PIX (opcional)</Label>
                <Input value={form.pix} onChange={e => f('pix', e.target.value)} placeholder="CPF, e-mail, telefone ou chave aleatória" />
              </div>
            </TabsContent>

            <TabsContent value="obs" className="space-y-3 mt-4">
              <div>
                <Label>Observações</Label>
                <Textarea
                  value={form.observacoes}
                  onChange={e => f('observacoes', e.target.value)}
                  placeholder="Anotações gerais sobre o cooperado…"
                  rows={6}
                />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar cooperado
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de ativar/desativar */}
      <AlertDialog open={!!confirmId} onOpenChange={o => !o && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar ação</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const r = rows.find(x => x.id === confirmId);
                return r?.ativo
                  ? `Deseja desativar o cooperado "${r?.nome}"? Ele não aparecerá nas seleções de novos lançamentos.`
                  : `Deseja reativar o cooperado "${r?.nome}"?`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const r = rows.find(x => x.id === confirmId);
              if (r) toggleAtivo(r.id, r.ativo);
            }}>
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
