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
import { Plus, Loader2, Pencil, PowerOff, Search, MapPin, Layers, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';

interface Cliente {
  id: string; nome: string; nome_fantasia: string | null; cnpj: string | null;
  tipo: string | null; ativo: boolean;
  cep: string | null; endereco: string | null; numero: string | null;
  complemento: string | null; bairro: string | null; cidade: string | null; estado: string | null;
  responsavel: string | null; telefone: string | null; email: string | null;
  dia_vencimento: number | null; forma_pagamento: string | null;
  observacoes_financeiras: string | null;
}
interface Setor { id: string; nome: string; ativo: boolean; hospital_id: string; }

const maskCNPJ = (v: string) =>
  v.replace(/\D/g, '').slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');

const maskCEP = (v: string) =>
  v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');

const validarCNPJ = (cnpj: string): boolean => {
  const n = cnpj.replace(/\D/g, '');
  if (n.length !== 14 || /^(\d)\1{13}$/.test(n)) return false;
  const calc = (len: number) => {
    let sum = 0, pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += parseInt(n[len - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    return sum % 11 < 2 ? 0 : 11 - (sum % 11);
  };
  return calc(12) === parseInt(n[12]) && calc(13) === parseInt(n[13]);
};

const emptyForm = {
  nome: '', nome_fantasia: '', cnpj: '', tipo: 'hospital', ativo: true,
  cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '',
  responsavel: '', telefone: '', email: '',
  dia_vencimento: '', forma_pagamento: 'boleto', observacoes_financeiras: '',
};

export default function CadastroCliente() {
  const [rows, setRows] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingCep, setLoadingCep] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [search, setSearch] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('__todos__');
  const [filtroStatus, setFiltroStatus] = useState('ativo');

  // Setores
  const [setorCliente, setSetorCliente] = useState<Cliente | null>(null);
  const [setores, setSetores] = useState<Setor[]>([]);
  const [loadingSetores, setLoadingSetores] = useState(false);
  const [novoSetor, setNovoSetor] = useState('');
  const [savingSetor, setSavingSetor] = useState(false);
  const [editandoSetor, setEditandoSetor] = useState<string | null>(null);
  const [editNomeSetor, setEditNomeSetor] = useState('');
  const [deletandoSetor, setDeletandoSetor] = useState<Setor | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('hospitals').select('*').order('nome');
    setRows((data ?? []) as unknown as Cliente[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const loadSetores = async (hospitalId: string) => {
    setLoadingSetores(true);
    const { data } = await supabase.from('sectors').select('*').eq('hospital_id', hospitalId).order('nome');
    setSetores((data ?? []) as unknown as Setor[]);
    setLoadingSetores(false);
  };

  const abrirSetores = (cliente: Cliente) => {
    setSetorCliente(cliente);
    setNovoSetor('');
    setEditandoSetor(null);
    loadSetores(cliente.id);
  };

  const adicionarSetor = async () => {
    if (!novoSetor.trim() || !setorCliente) return;
    setSavingSetor(true);
    const { error } = await supabase.from('sectors').insert({ hospital_id: setorCliente.id, nome: toTitleCase(novoSetor), ativo: true } as never);
    setSavingSetor(false);
    if (error) return toast.error(error.message);
    toast.success('Setor adicionado');
    setNovoSetor('');
    loadSetores(setorCliente.id);
  };

  const salvarEdicaoSetor = async (id: string) => {
    if (!editNomeSetor.trim() || !setorCliente) return;
    const { error } = await supabase.from('sectors').update({ nome: toTitleCase(editNomeSetor) } as never).eq('id', id);
    if (error) return toast.error(error.message);
    toast.success('Setor atualizado');
    setEditandoSetor(null);
    loadSetores(setorCliente.id);
  };

  const confirmarDeleteSetor = async () => {
    if (!deletandoSetor || !setorCliente) return;
    // Verificar lançamentos vinculados
    const { count } = await supabase.from('lancamentos_plantoes').select('id', { count: 'exact', head: true }).eq('setor_id', deletandoSetor.id);
    if ((count ?? 0) > 0) {
      toast.error(`Este setor possui ${count} lançamento(s). Delete os lançamentos primeiro.`);
      setDeletandoSetor(null);
      return;
    }
    const { error } = await supabase.from('sectors').delete().eq('id', deletandoSetor.id);
    if (error) return toast.error(error.message);
    toast.success('Setor removido');
    setDeletandoSetor(null);
    loadSetores(setorCliente.id);
  };

  const filtered = useMemo(() => rows.filter(r => {
    const q = search.toLowerCase();
    const matchSearch = !q || r.nome.toLowerCase().includes(q) ||
      (r.cnpj ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, '')) ||
      (r.nome_fantasia ?? '').toLowerCase().includes(q);
    const matchTipo = filtroTipo === '__todos__' || (r.tipo ?? 'hospital') === filtroTipo;
    const matchStatus = filtroStatus === '__todos__' ||
      (filtroStatus === 'ativo' ? r.ativo : !r.ativo);
    return matchSearch && matchTipo && matchStatus;
  }), [rows, search, filtroTipo, filtroStatus]);

  const openNew = () => { setEditId(null); setForm({ ...emptyForm }); setOpen(true); };

  const openEdit = (r: Cliente) => {
    setEditId(r.id);
    setForm({
      nome: r.nome, nome_fantasia: r.nome_fantasia ?? '', cnpj: r.cnpj ?? '',
      tipo: r.tipo ?? 'hospital', ativo: r.ativo,
      cep: r.cep ?? '', endereco: r.endereco ?? '', numero: r.numero ?? '',
      complemento: r.complemento ?? '', bairro: r.bairro ?? '',
      cidade: r.cidade ?? '', estado: r.estado ?? '',
      responsavel: r.responsavel ?? '', telefone: r.telefone ?? '', email: r.email ?? '',
      dia_vencimento: r.dia_vencimento?.toString() ?? '',
      forma_pagamento: r.forma_pagamento ?? 'boleto',
      observacoes_financeiras: r.observacoes_financeiras ?? '',
    });
    setOpen(true);
  };

  const buscarCEP = async () => {
    const nums = form.cep.replace(/\D/g, '');
    if (nums.length !== 8) return toast.error('CEP inválido');
    setLoadingCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${nums}/json/`);
      const data = await res.json();
      if (data.erro) { toast.error('CEP não encontrado'); }
      else {
        setForm(prev => ({
          ...prev,
          endereco: data.logradouro ?? prev.endereco,
          bairro: data.bairro ?? prev.bairro,
          cidade: data.localidade ?? prev.cidade,
          estado: data.uf ?? prev.estado,
        }));
        toast.success('Endereço preenchido');
      }
    } catch { toast.error('Erro ao buscar CEP'); }
    finally { setLoadingCep(false); }
  };

  const salvar = async () => {
    if (!form.nome.trim()) return toast.error('Informe o nome/razão social');
    if (form.cnpj && !validarCNPJ(form.cnpj)) return toast.error('CNPJ inválido');
    const diaVenc = form.dia_vencimento ? parseInt(form.dia_vencimento) : null;
    if (diaVenc !== null && (diaVenc < 1 || diaVenc > 31)) return toast.error('Dia de vencimento deve ser entre 1 e 31');
    setSaving(true);
    const payload = {
      nome: toTitleCase(form.nome), nome_fantasia: form.nome_fantasia.trim() || null,
      cnpj: form.cnpj.replace(/\D/g, '') || null, tipo: form.tipo, ativo: form.ativo,
      cep: form.cep.replace(/\D/g, '') || null, endereco: form.endereco.trim() || null,
      numero: form.numero.trim() || null, complemento: form.complemento.trim() || null,
      bairro: form.bairro.trim() || null, cidade: form.cidade.trim() || null, estado: form.estado.trim() || null,
      responsavel: form.responsavel.trim() || null, telefone: form.telefone.trim() || null,
      email: form.email.trim() || null, dia_vencimento: diaVenc,
      forma_pagamento: form.forma_pagamento || null,
      observacoes_financeiras: form.observacoes_financeiras.trim() || null,
    };
    const { error } = editId
      ? await supabase.from('hospitals').update(payload as never).eq('id', editId)
      : await supabase.from('hospitals').insert(payload as never);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editId ? 'Cliente atualizado' : 'Cliente cadastrado');
    setOpen(false);
    load();
  };

  const toggleAtivo = async (id: string, ativo: boolean) => {
    const { error } = await supabase.from('hospitals').update({ ativo: !ativo } as never).eq('id', id);
    if (error) return toast.error(error.message);
    toast.success(ativo ? 'Cliente desativado' : 'Cliente reativado');
    setConfirmId(null);
    load();
  };

  const f = (field: keyof typeof form, value: string | boolean) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const tipoLabel: Record<string, string> = { hospital: 'Hospital', clinica: 'Clínica', outro: 'Outro' };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Cadastro de Clientes</h1>
          <p className="text-sm text-muted-foreground">Gerencie hospitais e clínicas atendidas</p>
        </div>
        <Button className="gap-2" onClick={openNew}>
          <Plus className="h-4 w-4" /> Novo cliente
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar por nome ou CNPJ…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filtroTipo} onValueChange={setFiltroTipo}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__todos__">Todos os tipos</SelectItem>
            <SelectItem value="hospital">Hospital</SelectItem>
            <SelectItem value="clinica">Clínica</SelectItem>
            <SelectItem value="outro">Outro</SelectItem>
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
            Clientes cadastrados
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
              {rows.length === 0 ? 'Nenhum cliente cadastrado.' : 'Nenhum resultado para os filtros aplicados.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left p-3 font-medium">Nome</th>
                    <th className="text-left p-3 font-medium">CNPJ</th>
                    <th className="text-left p-3 font-medium">Tipo</th>
                    <th className="text-left p-3 font-medium">Cidade / UF</th>
                    <th className="text-center p-3 font-medium">Status</th>
                    <th className="text-right p-3 font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map(r => {
                    const cnpjFmt = r.cnpj
                      ? r.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
                      : null;
                    return (
                      <tr key={r.id} className="hover:bg-muted/30">
                        <td className="p-3">
                          <div className="font-medium">{r.nome}</div>
                          {r.nome_fantasia && <div className="text-xs text-muted-foreground">{r.nome_fantasia}</div>}
                        </td>
                        <td className="p-3 tabular-nums text-muted-foreground">{cnpjFmt ?? '—'}</td>
                        <td className="p-3">{tipoLabel[r.tipo ?? 'hospital'] ?? r.tipo}</td>
                        <td className="p-3 text-muted-foreground">
                          {r.cidade && r.estado ? `${r.cidade} / ${r.estado}` : r.cidade ?? r.estado ?? '—'}
                        </td>
                        <td className="p-3 text-center">
                          <Badge variant={r.ativo ? 'default' : 'secondary'}>
                            {r.ativo ? 'Ativo' : 'Inativo'}
                          </Badge>
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => abrirSetores(r)} className="h-7 text-xs gap-1">
                              <Layers className="h-3.5 w-3.5" /> Setores
                            </Button>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal de setores */}
      <Dialog open={!!setorCliente} onOpenChange={o => !o && setSetorCliente(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-4 w-4" /> Setores — {setorCliente?.nome}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Adicionar setor */}
            <div className="flex gap-2">
              <Input
                placeholder="Nome do setor (ex.: UTI Adulto)"
                value={novoSetor}
                onChange={e => setNovoSetor(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && adicionarSetor()}
                className="flex-1"
              />
              <Button onClick={adicionarSetor} disabled={savingSetor || !novoSetor.trim()} className="gap-1">
                {savingSetor ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Adicionar
              </Button>
            </div>

            {/* Lista de setores */}
            {loadingSetores ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </div>
            ) : setores.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Nenhum setor cadastrado. Adicione o primeiro acima.
              </div>
            ) : (
              <div className="divide-y rounded-lg border">
                {setores.map(s => (
                  <div key={s.id} className="flex items-center gap-2 p-3">
                    {editandoSetor === s.id ? (
                      <>
                        <Input
                          value={editNomeSetor}
                          onChange={e => setEditNomeSetor(e.target.value)}
                          className="flex-1 h-8 text-sm"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter') salvarEdicaoSetor(s.id);
                            if (e.key === 'Escape') setEditandoSetor(null);
                          }}
                        />
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-success" onClick={() => salvarEdicaoSetor(s.id)}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditandoSetor(null)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm">{s.nome}</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditandoSetor(s.id); setEditNomeSetor(s.nome); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeletandoSetor(s)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSetorCliente(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar delete setor */}
      <AlertDialog open={!!deletandoSetor} onOpenChange={o => !o && setDeletandoSetor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover setor</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja remover o setor "{deletandoSetor?.nome}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmarDeleteSetor}>
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de cadastro/edição de cliente */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="empresa" className="mt-2">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="empresa">Empresa</TabsTrigger>
              <TabsTrigger value="endereco">Endereço</TabsTrigger>
              <TabsTrigger value="contato">Contato</TabsTrigger>
              <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
            </TabsList>

            <TabsContent value="empresa" className="space-y-3 mt-4">
              <div>
                <Label>Razão social *</Label>
                <Input value={form.nome} onChange={e => f('nome', e.target.value)} placeholder="Ex.: Hospital São Lucas Ltda" />
              </div>
              <div>
                <Label>Nome fantasia</Label>
                <Input value={form.nome_fantasia} onChange={e => f('nome_fantasia', e.target.value)} placeholder="Ex.: São Lucas" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>CNPJ</Label>
                  <Input value={form.cnpj} onChange={e => f('cnpj', maskCNPJ(e.target.value))} placeholder="00.000.000/0001-00" />
                </div>
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.tipo} onValueChange={v => f('tipo', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hospital">Hospital</SelectItem>
                      <SelectItem value="clinica">Clínica</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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

            <TabsContent value="endereco" className="space-y-3 mt-4">
              <div>
                <Label>CEP</Label>
                <div className="flex gap-2">
                  <Input value={form.cep} onChange={e => f('cep', maskCEP(e.target.value))} placeholder="00000-000" className="flex-1"
                    onBlur={() => form.cep.replace(/\D/g, '').length === 8 && buscarCEP()} />
                  <Button type="button" variant="outline" onClick={buscarCEP} disabled={loadingCep} className="gap-1.5">
                    {loadingCep ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} Buscar
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label>Rua / Avenida</Label>
                  <Input value={form.endereco} onChange={e => f('endereco', e.target.value)} placeholder="Rua das Flores" />
                </div>
                <div>
                  <Label>Número</Label>
                  <Input value={form.numero} onChange={e => f('numero', e.target.value)} placeholder="123" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Complemento</Label>
                  <Input value={form.complemento} onChange={e => f('complemento', e.target.value)} placeholder="Sala 10, Bloco B" />
                </div>
                <div>
                  <Label>Bairro</Label>
                  <Input value={form.bairro} onChange={e => f('bairro', e.target.value)} placeholder="Centro" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Label>Cidade</Label>
                  <Input value={form.cidade} onChange={e => f('cidade', e.target.value)} placeholder="São Paulo" />
                </div>
                <div>
                  <Label>UF</Label>
                  <Input value={form.estado} onChange={e => f('estado', e.target.value.toUpperCase())} placeholder="SP" maxLength={2} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="contato" className="space-y-3 mt-4">
              <div>
                <Label>Responsável pelo contato</Label>
                <Input value={form.responsavel} onChange={e => f('responsavel', e.target.value)} placeholder="Nome do responsável" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Telefone</Label>
                  <Input value={form.telefone} onChange={e => f('telefone', e.target.value)} placeholder="(11) 3333-0000" />
                </div>
                <div>
                  <Label>E-mail</Label>
                  <Input type="email" value={form.email} onChange={e => f('email', e.target.value)} placeholder="contato@hospital.com" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="financeiro" className="space-y-3 mt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Dia de vencimento</Label>
                  <Input type="number" min="1" max="31" value={form.dia_vencimento}
                    onChange={e => f('dia_vencimento', e.target.value)} placeholder="Ex.: 15" />
                </div>
                <div>
                  <Label>Forma de pagamento</Label>
                  <Select value={form.forma_pagamento} onValueChange={v => f('forma_pagamento', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="boleto">Boleto</SelectItem>
                      <SelectItem value="transferencia">Transferência</SelectItem>
                      <SelectItem value="pix">PIX</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Observações sobre faturamento</Label>
                <Textarea value={form.observacoes_financeiras} onChange={e => f('observacoes_financeiras', e.target.value)}
                  placeholder="Instruções especiais para faturamento, contato financeiro, etc." rows={5} />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar cliente
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
                return r?.ativo ? `Deseja desativar o cliente "${r?.nome}"?` : `Deseja reativar o cliente "${r?.nome}"?`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const r = rows.find(x => x.id === confirmId);
              if (r) toggleAtivo(r.id, r.ativo);
            }}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
