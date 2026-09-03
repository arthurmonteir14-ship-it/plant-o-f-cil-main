import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency, DESCONTO_COTA_PARTE, ALIQUOTA_ISS } from '@/lib/format';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { Printer, ArrowLeft, TrendingUp, TrendingDown, Minus, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const NAVY   = '#1a2f5a';
const INK    = '#1e293b';
const GOLD   = '#92400e';
const GREEN  = '#166534';
const DANGER = '#9f1d1d';
const BORDER = '#d8dce3';
const MUTED       = '#64748b';
const MUTED_LIGHT = '#94a3b8';
const SURFACE      = '#f8fafc';
const SURFACE_ALT  = '#eef2f9';
const PILL_NAVY_BG  = '#eff6ff';
const PILL_GREEN_BG = '#f0fdf4';
const SERIF  = "Georgia, 'Times New Roman', Times, serif";
const CORES = ['#1a2f5a','#2563eb','#16a34a','#d97706','#dc2626','#7c3aed','#0891b2','#be185d','#059669','#b45309'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MESES_CURTO = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const INDICADORES_LABELS: Record<string, string> = {
  faturado:           'Total Faturado',
  repassado:          'Total Repassado',
  taxaAdministrativa: 'Taxa Administrativa',
  cotaParte:          'Cota Parte',
};

const GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5',
};

interface KpiData    { total_plantoes: number; faturamento: number; repasse: number; }
interface ClienteRow { hospital_id: string; nome: string; faturamento: number; repasse: number; }
interface CategoriaRow { ano_mes: string; enfermeiros: number; tecnicos: number; }
interface ProfRow    { profissao: string; qtd: number; faturamento: number; repasse: number; }
interface SetorRelRow { setor_id: string; setor_nome: string; qtd: number; faturamento: number; repasse: number; }

const PROF_LABEL: Record<string, string> = {
  enfermeiro:          'Enfermeiro',
  tecnico_enfermagem:  'Técnico de Enfermagem',
  tecnico_hemodialise: 'Técnico em Hemodiálise',
  assistente_social:   'Assistente Social',
  fonoaudiologo:       'Fonoaudiólogo',
  assistente_sala:     'Assistente de Sala',
};

const fmtK = (v: number) => v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : formatCurrency(v);

function labelPeriodo(inicio: string, fim: string) {
  const [anoI, mesI] = inicio.split('-').map(Number);
  const [anoF, mesF] = fim.split('-').map(Number);
  if (inicio === fim) return `${MESES[mesI - 1]} de ${anoI}`;
  if (anoI === anoF)  return `${MESES[mesI - 1]} a ${MESES[mesF - 1]} de ${anoI}`;
  return `${MESES[mesI - 1]}/${anoI} a ${MESES[mesF - 1]}/${anoF}`;
}

function labelPeriodoCurto(inicio: string, fim: string) {
  const [anoI, mesI] = inicio.split('-').map(Number);
  const [anoF, mesF] = fim.split('-').map(Number);
  if (inicio === fim) return `${MESES_CURTO[mesI - 1]}/${anoI}`;
  return `${MESES_CURTO[mesI - 1]}/${anoI} a ${MESES_CURTO[mesF - 1]}/${anoF}`;
}

function calcPeriodoAnterior(inicioMes: string, fimMes: string) {
  const [anoI, mesI] = inicioMes.split('-').map(Number);
  const [anoF, mesF] = fimMes.split('-').map(Number);
  const durMeses = (anoF - anoI) * 12 + (mesF - mesI) + 1;
  const fimAntDate    = new Date(anoI, mesI - 2, 1);
  const inicioAntDate = new Date(fimAntDate.getFullYear(), fimAntDate.getMonth() - durMeses + 1, 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return { inicioAnt: fmt(inicioAntDate), fimAnt: fmt(fimAntDate) };
}

interface Hospital {
  id: string; nome: string;
  taxa_administrativa?: number | null;
  retem_iss?: boolean | null;
  gerar_relatorio_consolidado?: boolean | null;
}
interface Sector   { id: string; nome: string; hospital_id: string; }

export default function RelatorioFaturamento() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

  const [inicio, setInicio] = useState(searchParams.get('inicio') ?? mesAtual);
  const [fim,    setFim]    = useState(searchParams.get('fim')    ?? mesAtual);

  const [hospitalId,   setHospitalId]   = useState(searchParams.get('hospital')     ?? '');
  const [hospitalNome, setHospitalNome] = useState(searchParams.get('hospitalNome') ?? '');
  const [setorId,      setSetorId]      = useState(searchParams.get('setor')        ?? '');
  const [setorNome,    setSetorNome]    = useState(searchParams.get('setorNome')    ?? '');

  // Filtro de clientes incluídos no relatório (null = todos). Só faz sentido quando
  // nenhum cliente específico está selecionado no filtro "Cliente" acima.
  const [clientesFiltro, setClientesFiltro] = useState<Set<string> | null>(null);

  const [mostrarRepasse] = useState(searchParams.get('mostrarRepasse') !== '0');

  const [indicadoresVisiveis, setIndicadoresVisiveis] = useState<Record<string, boolean>>({
    faturado:           true,
    repassado:          searchParams.get('mostrarRepasse') !== '0',
    taxaAdministrativa: true,
    cotaParte:          searchParams.get('mostrarRepasse') !== '0',
  });

  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [sectors,   setSectors]   = useState<Sector[]>([]);

  const [kpi,           setKpi]           = useState<KpiData | null>(null);
  const [clientes,      setClientes]      = useState<ClienteRow[]>([]);
  const [catAtual,      setCatAtual]      = useState<CategoriaRow[]>([]);
  const [catAnterior,   setCatAnterior]   = useState<CategoriaRow[]>([]);
  const [profAtual,     setProfAtual]     = useState<ProfRow[]>([]);
  const [profAnterior,  setProfAnterior]  = useState<ProfRow[]>([]);
  const [setoresAtual,  setSetoresAtual]  = useState<SetorRelRow[]>([]);
  const [setoresAnt,    setSetoresAnt]    = useState<SetorRelRow[]>([]);
  const [periodoAnt,    setPeriodoAnt]    = useState({ inicioAnt: '', fimAnt: '' });
  const [loading,       setLoading]       = useState(true);
  const [cotaPartePorClienteRaw, setCotaPartePorClienteRaw] = useState<{ hospital_id: string; cooperados: number; cotaParte: number }[]>([]);

  useEffect(() => {
    supabase.from('hospitals').select('id, nome, taxa_administrativa, retem_iss, gerar_relatorio_consolidado').order('nome').then(({ data }) => setHospitals(data ?? []));
    supabase.from('sectors').select('id, nome, hospital_id').eq('ativo', true).order('nome').then(({ data }) => setSectors(data ?? []));
  }, []);

  const setoresFiltrados = useMemo(() =>
    hospitalId ? sectors.filter(s => s.hospital_id === hospitalId) : sectors,
  [sectors, hospitalId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const inicioDate = `${inicio}-01`;
      const [anoF, mesF] = fim.split('-').map(Number);
      const fimDate = new Date(anoF, mesF, 0).toISOString().slice(0, 10);
      const hId = hospitalId || null;
      const sId = setorId    || null;

      const ant = calcPeriodoAnterior(inicio, fim);
      const inicioDateAnt = `${ant.inicioAnt}-01`;
      const [anoFAnt, mesFAnt] = ant.fimAnt.split('-').map(Number);
      const fimDateAnt = new Date(anoFAnt, mesFAnt, 0).toISOString().slice(0, 10);
      setPeriodoAnt(ant);

      const basePromises = [
        supabase.rpc('dashboard_kpi',                      { p_inicio: inicioDate,    p_fim: fimDate,    p_hospital_id: hId, p_setor_id: sId }),
        supabase.rpc('relatorio_por_cliente',              { p_inicio: inicioDate,    p_fim: fimDate,    p_hospital_id: hId, p_setor_id: sId }),
        supabase.rpc('dashboard_plantoes_por_categoria',   { p_inicio: inicioDate,    p_fim: fimDate,    p_hospital_id: hId, p_setor_id: sId }),
        supabase.rpc('dashboard_plantoes_por_categoria',   { p_inicio: inicioDateAnt, p_fim: fimDateAnt, p_hospital_id: hId, p_setor_id: sId }),
        supabase.rpc('relatorio_plantoes_por_profissao',   { p_inicio: inicioDate,    p_fim: fimDate,    p_hospital_id: hId, p_setor_id: sId }),
        supabase.rpc('relatorio_plantoes_por_profissao',   { p_inicio: inicioDateAnt, p_fim: fimDateAnt, p_hospital_id: hId, p_setor_id: sId }),
      ] as const;

      const setoresPromises = hId ? [
        supabase.rpc('relatorio_setores_cliente', { p_inicio: inicioDate,    p_fim: fimDate,    p_hospital_id: hId, p_setor_id: sId }),
        supabase.rpc('relatorio_setores_cliente', { p_inicio: inicioDateAnt, p_fim: fimDateAnt, p_hospital_id: hId, p_setor_id: sId }),
      ] : [Promise.resolve({ data: [] }), Promise.resolve({ data: [] })];

      const fetchCooperadosPlantao = async () => {
        const PAGE = 1000;
        let all: { cooperado_id: string; data_plantao: string; hospital_id: string }[] = [];
        let from = 0;
        while (true) {
          let q = supabase
            .from('lancamentos_plantoes')
            .select('cooperado_id, data_plantao, hospital_id')
            .gte('data_plantao', inicioDate)
            .lte('data_plantao', fimDate)
            .range(from, from + PAGE - 1);
          if (hId) q = q.eq('hospital_id', hId);
          if (sId) q = q.eq('setor_id', sId);
          const { data } = await q;
          const page = data ?? [];
          all = [...all, ...page];
          if (page.length < PAGE) break;
          from += PAGE;
        }
        return all;
      };

      const [
        { data: kpiData },
        { data: clienteData },
        { data: catAtualData },
        { data: catAntData },
        { data: profAtualData },
        { data: profAntData },
        { data: setAtualData },
        { data: setAntData },
        cooperadosData,
      ] = await Promise.all([...basePromises, ...setoresPromises, fetchCooperadosPlantao()]);

      // Cota parte por projeto/cliente — descontada uma vez por cooperado distinto a cada mês, agrupada por hospital
      // (o total geral e a exclusão dos projetos Saúde Móvel são calculados depois, no useMemo cotaPartePorCliente)
      const porHospital = new Map<string, Set<string>>();
      cooperadosData.forEach(r => {
        const chave = `${r.cooperado_id}|${String(r.data_plantao).slice(0, 7)}`;
        if (!porHospital.has(r.hospital_id)) porHospital.set(r.hospital_id, new Set());
        porHospital.get(r.hospital_id)!.add(chave);
      });
      setCotaPartePorClienteRaw(
        [...porHospital.entries()].map(([hospital_id, chaves]) => ({
          hospital_id,
          cooperados: chaves.size,
          cotaParte: chaves.size * DESCONTO_COTA_PARTE,
        }))
      );

      const k = kpiData?.[0];
      setKpi(k ? {
        total_plantoes: Number(k.total_plantoes),
        faturamento:    Number(k.faturamento),
        repasse:        Number(k.repasse),
      } : null);
      setClientes((clienteData ?? []).map((c: any) => ({
        hospital_id: c.hospital_id,
        nome:        c.nome,
        faturamento: Number(c.faturamento),
        repasse:     Number(c.repasse),
      })));
      setCatAtual((catAtualData ?? []) as CategoriaRow[]);
      setCatAnterior((catAntData  ?? []) as CategoriaRow[]);
      setProfAtual((profAtualData ?? []).map((r: any) => ({ profissao: r.profissao, qtd: Number(r.qtd), faturamento: Number(r.faturamento), repasse: Number(r.repasse) })));
      setProfAnterior((profAntData  ?? []).map((r: any) => ({ profissao: r.profissao, qtd: Number(r.qtd), faturamento: Number(r.faturamento), repasse: Number(r.repasse) })));
      setSetoresAtual((setAtualData ?? []).map((r: any) => ({ setor_id: r.setor_id, setor_nome: r.setor_nome, qtd: Number(r.qtd), faturamento: Number(r.faturamento), repasse: Number(r.repasse) })));
      setSetoresAnt((setAntData   ?? []).map((r: any) => ({ setor_id: r.setor_id, setor_nome: r.setor_nome, qtd: Number(r.qtd), faturamento: Number(r.faturamento), repasse: Number(r.repasse) })));
      setLoading(false);
    })();
  }, [inicio, fim, hospitalId, setorId]);

  const clientesComMargem = useMemo(() =>
    clientes
      .filter(c => clientesFiltro === null || clientesFiltro.has(c.hospital_id))
      .map(c => ({
        ...c,
        margem:     c.faturamento - c.repasse,
        pctRepasse: c.faturamento > 0 ? (c.repasse / c.faturamento) * 100 : 0,
      })),
  [clientes, clientesFiltro]);

  // Totais gerais somam só os clientes marcados no filtro de clientes (kpi.total_plantoes fica de fora,
  // é só um número de apoio e não temos a contagem de plantões por cliente aqui).
  const kpiFiltrado = useMemo(() => ({
    faturamento: clientesComMargem.reduce((s, c) => s + c.faturamento, 0),
    repasse:     clientesComMargem.reduce((s, c) => s + c.repasse, 0),
  }), [clientesComMargem]);

  const margem = kpiFiltrado.faturamento - kpiFiltrado.repasse;

  // Totais de plantões por categoria
  const totEnfAtual = useMemo(() => catAtual.reduce((s, r)    => s + Number(r.enfermeiros), 0), [catAtual]);
  const totTecAtual = useMemo(() => catAtual.reduce((s, r)    => s + Number(r.tecnicos),    0), [catAtual]);
  const totEnfAnt   = useMemo(() => catAnterior.reduce((s, r) => s + Number(r.enfermeiros), 0), [catAnterior]);
  const totTecAnt   = useMemo(() => catAnterior.reduce((s, r) => s + Number(r.tecnicos),    0), [catAnterior]);

  const varEnf = totEnfAnt > 0 ? ((totEnfAtual - totEnfAnt) / totEnfAnt) * 100 : null;
  const varTec = totTecAnt > 0 ? ((totTecAtual - totTecAnt) / totTecAnt) * 100 : null;

  // Observações automáticas por profissão
  const obsProf = useMemo(() => {
    if (profAtual.length === 0 && profAnterior.length === 0) return [];
    const frases: string[] = [];
    const mapAtual = Object.fromEntries(profAtual.map(r => [r.profissao, r]));
    const mapAnt   = Object.fromEntries(profAnterior.map(r => [r.profissao, r]));
    const periodoAntLabel = periodoAnt.inicioAnt ? labelPeriodoCurto(periodoAnt.inicioAnt, periodoAnt.fimAnt) : '';

    // Categorias que desapareceram
    const desaparecidas = profAnterior.filter(r => !mapAtual[r.profissao] || mapAtual[r.profissao].qtd === 0);
    if (desaparecidas.length > 0) {
      const nomes = desaparecidas.map(r => PROF_LABEL[r.profissao] ?? r.profissao).join(' e ');
      const valorPerdido = desaparecidas.reduce((s, r) => s + r.faturamento, 0);
      frases.push(`Não houve plantões de ${nomes} neste período${periodoAntLabel ? `, categorias que representavam ${formatCurrency(valorPerdido)} em ${periodoAntLabel}` : ''}.`);
    }

    // Categorias que apareceram
    const novas = profAtual.filter(r => !mapAnt[r.profissao] || mapAnt[r.profissao].qtd === 0);
    if (novas.length > 0) {
      const nomes = novas.map(r => PROF_LABEL[r.profissao] ?? r.profissao).join(' e ');
      const valorGanho = novas.reduce((s, r) => s + r.faturamento, 0);
      frases.push(`Nova(s) categoria(s) registrada(s) neste período: ${nomes}, contribuindo com ${formatCurrency(valorGanho)} no faturamento.`);
    }

    // Variações significativas (≥5%) nas categorias que existem nos dois períodos
    const jaCitadas = new Set([...desaparecidas.map(r => r.profissao), ...novas.map(r => r.profissao)]);
    for (const r of profAtual) {
      if (jaCitadas.has(r.profissao)) continue;
      const ant = mapAnt[r.profissao];
      if (!ant || ant.qtd === 0) continue;
      const varPct = ((r.qtd - ant.qtd) / ant.qtd) * 100;
      const varFat = r.faturamento - ant.faturamento;
      if (Math.abs(varPct) < 5) continue;
      const label  = PROF_LABEL[r.profissao] ?? r.profissao;
      const dir    = varPct > 0 ? 'crescimento' : 'redução';
      const sinalF = varFat >= 0 ? '+' : '';
      frases.push(`${label}: ${dir} de ${varPct > 0 ? '+' : ''}${varPct.toFixed(1)}% (${ant.qtd}→${r.qtd} plantões), impacto de ${sinalF}${formatCurrency(Math.abs(varFat))} no faturamento.`);
    }

    // Análise de compensação quando houve desaparecimento
    if (desaparecidas.length > 0) {
      const valorPerdido = desaparecidas.reduce((s, r) => s + r.faturamento, 0);
      const totalGanho = profAtual
        .filter(r => !jaCitadas.has(r.profissao) || novas.find(n => n.profissao === r.profissao))
        .reduce((s, r) => {
          const ant = mapAnt[r.profissao];
          const fatAnt = ant ? ant.faturamento : 0;
          return s + Math.max(0, r.faturamento - fatAnt);
        }, 0);
      if (totalGanho > 0) {
        const comp = totalGanho >= valorPerdido ? 'integralmente' : 'parcialmente';
        frases.push(`O crescimento das demais categorias (${formatCurrency(totalGanho)}) compensou ${comp} a ausência das categorias citadas (${formatCurrency(valorPerdido)}).`);
      }
    }

    return frases;
  }, [profAtual, profAnterior, periodoAnt]);

  // Todas as profissões presentes em qualquer um dos períodos
  const todasProfs = useMemo(() => {
    const set = new Set([...profAtual.map(r => r.profissao), ...profAnterior.map(r => r.profissao)]);
    return [...set].sort((a, b) => {
      const fa = profAtual.find(r => r.profissao === a)?.faturamento ?? 0;
      const fb = profAtual.find(r => r.profissao === b)?.faturamento ?? 0;
      return fb - fa;
    });
  }, [profAtual, profAnterior]);

  // Todos os setores presentes em qualquer um dos períodos
  const todosSets = useMemo(() => {
    const map = new Map<string, string>();
    setoresAtual.forEach(r => map.set(r.setor_id, r.setor_nome));
    setoresAnt.forEach(r => { if (!map.has(r.setor_id)) map.set(r.setor_id, r.setor_nome); });
    return [...map.entries()].sort((a, b) => {
      const fa = setoresAtual.find(r => r.setor_id === a[0])?.faturamento ?? 0;
      const fb = setoresAtual.find(r => r.setor_id === b[0])?.faturamento ?? 0;
      return fb - fa;
    });
  }, [setoresAtual, setoresAnt]);

  // Observações automáticas por setor
  const obsSetores = useMemo(() => {
    if (setoresAtual.length === 0 && setoresAnt.length === 0) return [];
    const frases: string[] = [];
    const mapAt = Object.fromEntries(setoresAtual.map(r => [r.setor_id, r]));
    const mapAn = Object.fromEntries(setoresAnt.map(r => [r.setor_id, r]));
    const periodoAntLabel = periodoAnt.inicioAnt ? labelPeriodoCurto(periodoAnt.inicioAnt, periodoAnt.fimAnt) : '';

    // Setores que desapareceram
    const desapar = setoresAnt.filter(r => !mapAt[r.setor_id] || mapAt[r.setor_id].qtd === 0);
    if (desapar.length > 0) {
      const nomes = desapar.map(r => r.setor_nome).join(', ');
      const valor = desapar.reduce((s, r) => s + r.faturamento, 0);
      frases.push(`Setores sem plantões neste período: ${nomes}${periodoAntLabel ? ` (representavam ${formatCurrency(valor)} em ${periodoAntLabel})` : ''}.`);
    }

    // Setores novos
    const novos = setoresAtual.filter(r => !mapAn[r.setor_id] || mapAn[r.setor_id].qtd === 0);
    if (novos.length > 0) {
      const nomes = novos.map(r => r.setor_nome).join(', ');
      const valor = novos.reduce((s, r) => s + r.faturamento, 0);
      frases.push(`Novo(s) setor(es) com plantões neste período: ${nomes}, contribuindo com ${formatCurrency(valor)}.`);
    }

    // Variações significativas (≥5%)
    const citados = new Set([...desapar.map(r => r.setor_id), ...novos.map(r => r.setor_id)]);
    for (const r of setoresAtual) {
      if (citados.has(r.setor_id)) continue;
      const an = mapAn[r.setor_id];
      if (!an || an.qtd === 0) continue;
      const varPct = ((r.qtd - an.qtd) / an.qtd) * 100;
      const varFat = r.faturamento - an.faturamento;
      if (Math.abs(varPct) < 5) continue;
      const dir    = varPct > 0 ? 'crescimento' : 'redução';
      const sinalF = varFat >= 0 ? '+' : '';
      frases.push(`Setor ${r.setor_nome}: ${dir} de ${varPct > 0 ? '+' : ''}${varPct.toFixed(1)}% (${an.qtd}→${r.qtd} plantões), impacto de ${sinalF}${formatCurrency(Math.abs(varFat))}.`);
    }

    // Setor destaque (maior faturamento)
    if (setoresAtual.length > 0) {
      const top = setoresAtual[0];
      const total = setoresAtual.reduce((s, r) => s + r.faturamento, 0);
      const pct = total > 0 ? ((top.faturamento / total) * 100).toFixed(0) : '0';
      frases.push(`O setor com maior faturamento foi ${top.setor_nome} (${formatCurrency(top.faturamento)}, ${pct}% do total do cliente).`);
    }

    return frases;
  }, [setoresAtual, setoresAnt, periodoAnt]);

  const analise = useMemo(() => {
    if (!kpi || clientes.length === 0) return [];
    const sorted    = [...clientesComMargem].sort((a, b) => b.faturamento - a.faturamento);
    const maiorFat  = sorted[0];
    const maiorMarg = [...clientesComMargem].sort((a, b) => b.margem - a.margem)[0];
    const periodoAntLabel = labelPeriodoCurto(periodoAnt.inicioAnt, periodoAnt.fimAnt);

    const frases: string[] = [
      mostrarRepasse
        ? `No período analisado, o faturamento total foi de ${formatCurrency(kpiFiltrado.faturamento)}, com repasse de ${formatCurrency(kpiFiltrado.repasse)} aos cooperados, resultando em margem operacional de ${formatCurrency(margem)}.`
        : `No período analisado, o faturamento total foi de ${formatCurrency(kpiFiltrado.faturamento)}.`,
    ];
    if (maiorFat)  frases.push(`O cliente com maior volume foi ${maiorFat.nome}, representando ${kpiFiltrado.faturamento > 0 ? ((maiorFat.faturamento / kpiFiltrado.faturamento) * 100).toFixed(2) : 0}% do faturamento total (${formatCurrency(maiorFat.faturamento)}).`);
    if (mostrarRepasse && maiorMarg) frases.push(`A maior margem operacional foi registrada em ${maiorMarg.nome}, com ${formatCurrency(maiorMarg.margem)} de diferença entre faturado e repassado.`);

    // Análise de plantões por categoria
    const totalAtual = totEnfAtual + totTecAtual;
    if (totalAtual > 0) {
      const pctEnf = ((totEnfAtual / totalAtual) * 100).toFixed(0);
      const pctTec = ((totTecAtual / totalAtual) * 100).toFixed(0);
      frases.push(`Quanto à distribuição de plantões, foram realizados ${totEnfAtual} plantões de enfermeiros (${pctEnf}%) e ${totTecAtual} de técnicos de enfermagem (${pctTec}%) no período.`);
    }

    if (varEnf !== null) {
      const dir = varEnf > 0 ? 'aumento' : varEnf < 0 ? 'queda' : 'estabilidade';
      const abs = Math.abs(varEnf).toFixed(1);
      frases.push(`Comparando com o período anterior (${periodoAntLabel}): plantões de enfermeiros tiveram ${dir} de ${abs}% (de ${totEnfAnt} para ${totEnfAtual}).`);
    }
    if (varTec !== null) {
      const dir = varTec > 0 ? 'aumento' : varTec < 0 ? 'queda' : 'estabilidade';
      const abs = Math.abs(varTec).toFixed(1);
      frases.push(`Plantões de técnicos de enfermagem tiveram ${dir} de ${abs}% em relação ao período anterior (de ${totTecAnt} para ${totTecAtual}).`);
    }

    // Inserir observações de profissão
    obsProf.forEach(f => frases.push(f));

    // Inserir observações de setor (apenas quando hospital selecionado)
    obsSetores.forEach(f => frases.push(f));

    return frases;
  }, [kpi, clientes, clientesComMargem, kpiFiltrado, margem, totEnfAtual, totTecAtual, totEnfAnt, totTecAnt, varEnf, varTec, periodoAnt, obsProf, obsSetores, mostrarRepasse]);

  const periodo  = labelPeriodo(inicio, fim);
  const dataGer  = hoje.toLocaleDateString('pt-BR');

  // Taxa Administrativa por cliente — percentual do cadastro (hospitals.taxa_administrativa), incide sobre o valor de cobrança já carregado por cliente
  const taxaAdministrativaPorCliente = useMemo(() => {
    const taxaMap = new Map(hospitals.map(h => [h.id, Number(h.taxa_administrativa ?? 0)]));
    return clientesComMargem.map(c => {
      const taxaPct = taxaMap.get(c.hospital_id) ?? 0;
      return { ...c, taxaPct, taxaValor: c.faturamento * (taxaPct / 100) };
    });
  }, [clientesComMargem, hospitals]);

  // Cota parte por projeto/cliente — junta a contagem calculada acima com o nome do cliente.
  // Projetos "Saúde Móvel" não arrecadam cota parte (continuam no relatório normalmente,
  // só não entram nessa contagem). Também respeita o filtro de clientes marcados.
  const cotaPartePorCliente = useMemo(() => {
    const nomeMap = new Map(hospitals.map(h => [h.id, h.nome]));
    return cotaPartePorClienteRaw
      .map(r => ({ ...r, nome: nomeMap.get(r.hospital_id) ?? '—' }))
      .filter(r => !r.nome.toLowerCase().includes('saúde móvel') && !r.nome.toLowerCase().includes('saude movel'))
      .filter(r => clientesFiltro === null || clientesFiltro.has(r.hospital_id))
      .sort((a, b) => b.cotaParte - a.cotaParte);
  }, [cotaPartePorClienteRaw, hospitals, clientesFiltro]);

  const cotaParte = useMemo(() =>
    cotaPartePorCliente.reduce((s, c) => s + c.cotaParte, 0),
  [cotaPartePorCliente]);

  const taxaAdministrativaTotal = useMemo(() =>
    taxaAdministrativaPorCliente.reduce((s, c) => s + c.taxaValor, 0),
  [taxaAdministrativaPorCliente]);

  // Respeita o checkbox "Taxa Administrativa" em Indicadores: desmarcado, o relatório deixa de considerá-la em qualquer cálculo (produção pura, sem a taxa)
  const taxaAdministrativaAtiva = indicadoresVisiveis.taxaAdministrativa;
  const taxaAdministrativaAplicada = taxaAdministrativaAtiva ? taxaAdministrativaTotal : 0;

  // ISS retido por cliente — usa hospitals.retem_iss do cadastro; incide sobre o valor bruto total (faturamento + taxa administrativa, se considerada) do próprio cliente
  const issRetidoPorCliente = useMemo(() => {
    const retemIssMap = new Map(hospitals.map(h => [h.id, h.retem_iss === true]));
    return taxaAdministrativaPorCliente.map(c => {
      const retemIss = retemIssMap.get(c.hospital_id) ?? false;
      const taxaValorAplicada = taxaAdministrativaAtiva ? c.taxaValor : 0;
      const valorBrutoClienteTotal = c.faturamento + taxaValorAplicada;
      const issValor = retemIss ? valorBrutoClienteTotal * (ALIQUOTA_ISS / 100) : 0;
      return { ...c, retemIss, issValor, valorBrutoClienteTotal };
    });
  }, [taxaAdministrativaPorCliente, hospitals, taxaAdministrativaAtiva]);

  const issRetidoTotal = useMemo(() =>
    issRetidoPorCliente.reduce((s, c) => s + c.issValor, 0),
  [issRetidoPorCliente]);

  // Extrato Financeiro — complemento; reaproveita kpiFiltrado e cotaParte já calculados acima
  // A Taxa Administrativa só entra no Valor Bruto Total (afetando PIS/COFINS/ISS/Líquido) quando o indicador está marcado
  const extratoFinanceiro = useMemo(() => {
    const valorBrutoNF    = kpiFiltrado.faturamento;
    const valorBrutoTotal = valorBrutoNF + taxaAdministrativaAplicada;
    const pis          = valorBrutoTotal * 0.0065;
    const cofins       = valorBrutoTotal * 0.03;
    const iss          = issRetidoTotal;
    const totalRetido  = pis + cofins + iss;
    const valorLiquido = valorBrutoTotal - totalRetido;

    const repasseTotal   = kpiFiltrado.repasse;
    const inssPatronal   = repasseTotal * 0.20;
    const cotaParteTotal = cotaParte;

    return { valorBrutoNF, valorBrutoTotal, pis, cofins, iss, totalRetido, valorLiquido, repasseTotal, inssPatronal, cotaParteTotal };
  }, [kpiFiltrado, cotaParte, taxaAdministrativaAplicada, issRetidoTotal]);

  // Relatório Consolidado Mensal por Setor — só se aplica quando um cliente específico está selecionado
  // e esse cliente tem "Gerar relatório consolidado mensal" marcado no cadastro (hospitals.gerar_relatorio_consolidado).
  // Reaproveita setoresAtual (já carregado via RPC relatorio_setores_cliente quando hospitalId está definido) e
  // replica exatamente a mesma matemática do Extrato Financeiro acima, apenas decompondo por setor.
  const hospitalSelecionado = useMemo(() =>
    hospitals.find(h => h.id === hospitalId) ?? null,
  [hospitals, hospitalId]);

  const mostrarConsolidado = !!hospitalId && hospitalSelecionado?.gerar_relatorio_consolidado === true;

  const consolidadoPorSetor = useMemo(() => {
    if (!hospitalSelecionado) return [];
    const taxaPct   = Number(hospitalSelecionado.taxa_administrativa ?? 0);
    const retemIss  = hospitalSelecionado.retem_iss === true;
    return setoresAtual.map(s => {
      const valorBrutoNF    = s.faturamento;
      const taxaAdm         = taxaAdministrativaAtiva ? valorBrutoNF * (taxaPct / 100) : 0;
      const valorBrutoTotal = valorBrutoNF + taxaAdm;
      const pisCofins       = valorBrutoTotal * 0.0365;
      const iss             = retemIss ? valorBrutoTotal * (ALIQUOTA_ISS / 100) : 0;
      const totalDescontos  = pisCofins + iss;
      const valorLiquido    = valorBrutoTotal - totalDescontos;
      return { ...s, valorBrutoNF, taxaAdm, valorBrutoTotal, pisCofins, iss, totalDescontos, valorLiquido };
    });
  }, [setoresAtual, hospitalSelecionado, taxaAdministrativaAtiva]);

  const consolidadoTotais = useMemo(() => consolidadoPorSetor.reduce((acc, s) => ({
    valorBrutoNF:    acc.valorBrutoNF    + s.valorBrutoNF,
    taxaAdm:         acc.taxaAdm         + s.taxaAdm,
    valorBrutoTotal: acc.valorBrutoTotal + s.valorBrutoTotal,
    pisCofins:       acc.pisCofins       + s.pisCofins,
    iss:             acc.iss             + s.iss,
    totalDescontos:  acc.totalDescontos  + s.totalDescontos,
    valorLiquido:    acc.valorLiquido    + s.valorLiquido,
  }), { valorBrutoNF: 0, taxaAdm: 0, valorBrutoTotal: 0, pisCofins: 0, iss: 0, totalDescontos: 0, valorLiquido: 0 }),
  [consolidadoPorSetor]);

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @page { margin: 12mm; size: A4; }
          .break-avoid { break-inside: avoid; }
        }
        .report-tab-content[data-state='inactive'] { display: none; }
        @media print {
          .report-tab-content[data-state] { display: block !important; }
        }
      `}</style>

      {/* Barra de controles — oculta na impressão */}
      <div className="no-print sticky top-0 z-10 bg-muted/40 border-b px-6 py-3 flex flex-wrap items-center gap-4 shadow-sm">
        <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Mês</Label>
          <input type="month" value={inicio === fim ? inicio : ''} max={mesAtual}
            onChange={e => { setInicio(e.target.value); setFim(e.target.value); }}
            className="h-8 rounded-md border border-input bg-background px-3 text-sm shadow-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">De</Label>
          <input type="month" value={inicio} max={fim}
            onChange={e => setInicio(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-3 text-sm shadow-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Até</Label>
          <input type="month" value={fim} min={inicio} max={mesAtual}
            onChange={e => setFim(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-3 text-sm shadow-sm" />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Cliente</Label>
          <Select value={hospitalId || '__todos__'} onValueChange={v => {
            const id = v === '__todos__' ? '' : v;
            setHospitalId(id);
            setHospitalNome(id ? (hospitals.find(h => h.id === id)?.nome ?? '') : '');
            setSetorId(''); setSetorNome('');
          }}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos__">Todos os clientes</SelectItem>
              {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Setor</Label>
          <Select value={setorId || '__todos__'} onValueChange={v => {
            const id = v === '__todos__' ? '' : v;
            setSetorId(id);
            setSetorNome(id ? (sectors.find(s => s.id === id)?.nome ?? '') : '');
          }} disabled={setoresFiltrados.length === 0}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos__">Todos os setores</SelectItem>
              {setoresFiltrados.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {!hospitalId && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <SlidersHorizontal className="h-4 w-4" />
                Clientes {clientesFiltro !== null && `(${clientesFiltro.size}/${hospitals.length})`}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground">Clientes no relatório</p>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setClientesFiltro(null)}>
                  Selecionar todos
                </Button>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {hospitals.map(h => {
                  const checked = clientesFiltro === null || clientesFiltro.has(h.id);
                  return (
                    <label key={h.id} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={v => setClientesFiltro(prev => {
                          const base = prev ?? new Set(hospitals.map(x => x.id));
                          const next = new Set(base);
                          if (v === true) next.add(h.id); else next.delete(h.id);
                          return next;
                        })}
                      />
                      {h.nome}
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 ml-auto">
              <SlidersHorizontal className="h-4 w-4" /> Indicadores
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-60">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Indicadores no relatório</p>
            <div className="space-y-2">
              {Object.entries(INDICADORES_LABELS).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <Checkbox
                    checked={indicadoresVisiveis[key]}
                    onCheckedChange={v => setIndicadoresVisiveis(prev => ({ ...prev, [key]: v === true }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button size="sm" className="gap-1.5" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Imprimir
        </Button>
      </div>

      {/* Corpo do relatório */}
      <div className="max-w-5xl mx-auto px-8 py-8 bg-white min-h-screen">

        {/* Cabeçalho */}
        <div className="pb-6 mb-8 border-b-2" style={{ borderColor: NAVY }}>
          <div className="h-[3px] w-full mb-6" style={{ background: `linear-gradient(90deg, ${NAVY}, ${GOLD})` }} />
          <div className="flex items-center justify-between">
            <img src="/cades-logo.png" alt="CADES" className="h-20 object-contain" />
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400 mb-1">Documento Financeiro</p>
              <h2 className="text-2xl font-bold" style={{ color: NAVY, fontFamily: SERIF }}>Análise de Faturamento</h2>
              <p className="text-sm text-gray-600 mt-1">Período: <strong>{periodo}</strong></p>
              {hospitalNome && <p className="text-xs text-gray-500 mt-0.5">Cliente: <strong>{hospitalNome}</strong></p>}
              {setorNome    && <p className="text-xs text-gray-500 mt-0.5">Setor: <strong>{setorNome}</strong></p>}
              <p className="text-xs text-gray-400 mt-0.5">Gerado em: {dataGer}</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="no-print py-24 text-center text-gray-400">Carregando dados…</div>
        ) : (
          <Tabs defaultValue="analises">
            <TabsList className="no-print mb-6">
              <TabsTrigger value="analises">Análises</TabsTrigger>
              <TabsTrigger value="extrato">Extrato Financeiro</TabsTrigger>
              {mostrarConsolidado && <TabsTrigger value="consolidado">Relatório Consolidado</TabsTrigger>}
            </TabsList>

            <TabsContent value="analises" forceMount className="report-tab-content">
            {/* Seção 1 — KPIs */}
            <section className="mb-10 break-avoid">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-4 pb-2 border-b" style={{ color: NAVY, fontFamily: SERIF, borderColor: BORDER }}>
                Indicadores Gerais
              </h3>
              {(() => {
                const cards = [
                  { key: 'faturado',           label: 'Total Faturado',      value: formatCurrency(kpiFiltrado.faturamento), accent: NAVY,  primary: true },
                  { key: 'repassado',          label: 'Total Repassado',     value: formatCurrency(kpiFiltrado.repasse),     accent: GREEN, primary: true },
                  { key: 'taxaAdministrativa', label: 'Taxa Administrativa', value: formatCurrency(taxaAdministrativaTotal), accent: MUTED_LIGHT, primary: false },
                  { key: 'cotaParte',          label: 'Cota Parte',          value: formatCurrency(cotaParte),             accent: MUTED_LIGHT, primary: false },
                ].filter(card => indicadoresVisiveis[card.key]);
                return (
                  <div className={`grid ${GRID_COLS[cards.length] ?? 'grid-cols-1'} gap-4`}>
                    {cards.map(card => (
                      <div key={card.key} className="rounded-lg border bg-white p-4"
                        style={{ borderColor: BORDER, borderLeft: `3px solid ${card.accent}` }}>
                        <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: MUTED }}>{card.label}</p>
                        <p className="text-xl font-bold tabular-nums mt-1.5" style={{ color: INK }}>{card.value}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <p className="text-xs mt-3" style={{ color: MUTED_LIGHT }}>
                Total de plantões lançados no período: <strong style={{ color: MUTED }}>{kpi?.total_plantoes ?? 0}</strong>
              </p>
            </section>

            {/* Seção 2 — Tabela por cliente */}
            <section className="mb-10 break-avoid">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-4 pb-2 border-b" style={{ color: NAVY, fontFamily: SERIF, borderColor: BORDER }}>
                Faturamento por Cliente
              </h3>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr style={{ backgroundColor: NAVY, color: 'white' }}>
                    <th className="text-left px-4 py-2.5 font-semibold">Cliente</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Valor Faturado</th>
                    {mostrarRepasse && <th className="text-right px-4 py-2.5 font-semibold">Valor Repassado</th>}
                    <th className="text-right px-4 py-2.5 font-semibold">Taxa Administrativa</th>
                  </tr>
                </thead>
                <tbody>
                  {taxaAdministrativaPorCliente.map((c, i) => (
                    <tr key={c.hospital_id} style={{ backgroundColor: i % 2 === 0 ? '#f8f9fc' : 'white' }}>
                      <td className="px-4 py-2.5 font-medium" style={{ color: INK }}>{c.nome}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: INK }}>{formatCurrency(c.faturamento)}</td>
                      {mostrarRepasse && <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: INK }}>{formatCurrency(c.repasse)}</td>}
                      <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: INK }}>
                        {formatCurrency(c.taxaValor)}
                        <span className="text-xs ml-1" style={{ color: MUTED_LIGHT }}>({c.taxaPct}%)</span>
                      </td>
                    </tr>
                  ))}
                  <tr style={{ backgroundColor: NAVY, color: 'white', fontWeight: 700, borderTop: '3px double rgba(255,255,255,0.55)' }}>
                    <td className="px-4 py-2.5">TOTAL GERAL</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(kpiFiltrado.faturamento)}</td>
                    {mostrarRepasse && <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(kpiFiltrado.repasse)}</td>}
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(taxaAdministrativaTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            {/* Seção 2b — Cota Parte por Projeto (Cliente) */}
            {indicadoresVisiveis.cotaParte && cotaPartePorCliente.length > 0 && (
              <section className="mb-10 break-avoid">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-4 pb-2 border-b" style={{ color: NAVY, fontFamily: SERIF, borderColor: BORDER }}>
                  Cota Parte por Projeto (Cliente)
                </h3>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr style={{ backgroundColor: NAVY, color: 'white' }}>
                      <th className="text-left px-4 py-2.5 font-semibold">Cliente / Projeto</th>
                      <th className="text-right px-4 py-2.5 font-semibold">Cooperados</th>
                      <th className="text-right px-4 py-2.5 font-semibold">Cota Parte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cotaPartePorCliente.map((c, i) => (
                      <tr key={c.hospital_id} style={{ backgroundColor: i % 2 === 0 ? '#f8f9fc' : 'white' }}>
                        <td className="px-4 py-2.5 font-medium" style={{ color: INK }}>{c.nome}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: INK }}>{c.cooperados}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: INK }}>{formatCurrency(c.cotaParte)}</td>
                      </tr>
                    ))}
                    <tr style={{ backgroundColor: NAVY, color: 'white', fontWeight: 700, borderTop: '3px double rgba(255,255,255,0.55)' }}>
                      <td className="px-4 py-2.5">TOTAL GERAL</td>
                      <td className="px-4 py-2.5"></td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(cotaParte)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-xs mt-2" style={{ color: MUTED_LIGHT }}>
                  R$80 por cooperado distinto que atendeu o cliente em cada mês do período. Cooperados que atenderam mais de um cliente no mesmo mês são contados em cada um.
                </p>
              </section>
            )}

            {/* Seção 3 — Gráficos */}
            {clientesComMargem.length > 0 && (
              <section className="mb-10 break-avoid">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-4 pb-2 border-b" style={{ color: NAVY, fontFamily: SERIF, borderColor: BORDER }}>
                  Análise Gráfica
                </h3>
                <div className="grid grid-cols-2 gap-6">
                  {/* Barras */}
                  <div className="rounded-lg border p-4" style={{ borderColor: BORDER }}>
                    <p className="text-xs font-semibold mb-3" style={{ color: MUTED }}>Faturado vs Repassado por Cliente</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={clientesComMargem} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                        <XAxis dataKey="nome" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} stroke={BORDER} />
                        <YAxis tickFormatter={fmtK} tick={{ fontSize: 9 }} width={65} stroke={BORDER} />
                        <Tooltip
                          formatter={(v: number, n: string) => [formatCurrency(v), n]}
                          contentStyle={{ fontSize: 11, borderRadius: 6, border: `1px solid ${BORDER}` }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="faturamento" name="Faturado"   fill={NAVY}  radius={[3,3,0,0]} />
                        {mostrarRepasse && <Bar dataKey="repasse" name="Repassado" fill={GREEN} radius={[3,3,0,0]} />}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Pizza */}
                  <div className="rounded-lg border p-4" style={{ borderColor: BORDER }}>
                    <p className="text-xs font-semibold mb-3" style={{ color: MUTED }}>Distribuição do Faturamento (%)</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={clientesComMargem}
                          dataKey="faturamento"
                          nameKey="nome"
                          cx="50%" cy="45%"
                          outerRadius={80} innerRadius={35}
                          label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {clientesComMargem.map((_, i) => (
                            <Cell key={i} fill={CORES[i % CORES.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v: number) => [formatCurrency(v), 'Faturamento']}
                          contentStyle={{ fontSize: 11, borderRadius: 6, border: `1px solid ${BORDER}` }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: 10 }}
                          formatter={v => v.length > 22 ? v.slice(0, 21) + '…' : v}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </section>
            )}

            {/* Seção 4 — Análise de Plantões por Categoria */}
            {(totEnfAtual > 0 || totTecAtual > 0 || totEnfAnt > 0 || totTecAnt > 0) && (
              <section className="mb-10 break-avoid">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-4 pb-2 border-b" style={{ color: NAVY, fontFamily: SERIF, borderColor: BORDER }}>
                  Análise de Plantões por Categoria
                </h3>

                <div className="grid grid-cols-2 gap-6">
                  {/* Card Enfermeiros */}
                  <div className="rounded-lg border p-5" style={{ borderColor: BORDER }}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Enfermeiros</p>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ backgroundColor: PILL_NAVY_BG, color: NAVY }}>
                        {totEnfAtual + totTecAtual > 0
                          ? `${((totEnfAtual / (totEnfAtual + totTecAtual)) * 100).toFixed(0)}% do total`
                          : '—'}
                      </span>
                    </div>
                    <p className="text-3xl font-bold tabular-nums" style={{ color: NAVY }}>{totEnfAtual}</p>
                    <p className="text-xs text-gray-400 mt-0.5">plantões no período</p>

                    {varEnf !== null && (
                      <div className="mt-3 pt-3 border-t flex items-center gap-2">
                        {varEnf > 0
                          ? <TrendingUp className="h-4 w-4 text-green-600 flex-shrink-0" />
                          : varEnf < 0
                            ? <TrendingDown className="h-4 w-4 text-red-500 flex-shrink-0" />
                            : <Minus className="h-4 w-4 text-gray-400 flex-shrink-0" />}
                        <div>
                          <span className={`text-sm font-bold ${varEnf > 0 ? 'text-green-600' : varEnf < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                            {varEnf > 0 ? '+' : ''}{varEnf.toFixed(1)}%
                          </span>
                          <span className="text-xs text-gray-400 ml-1">
                            vs período anterior ({totEnfAnt} plantões)
                          </span>
                        </div>
                      </div>
                    )}
                    {varEnf === null && totEnfAnt === 0 && (
                      <p className="mt-3 pt-3 border-t text-xs text-gray-400 italic">Sem dados do período anterior</p>
                    )}
                  </div>

                  {/* Card Técnicos */}
                  <div className="rounded-lg border p-5" style={{ borderColor: BORDER }}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Técnicos de Enfermagem</p>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ backgroundColor: PILL_GREEN_BG, color: GREEN }}>
                        {totEnfAtual + totTecAtual > 0
                          ? `${((totTecAtual / (totEnfAtual + totTecAtual)) * 100).toFixed(0)}% do total`
                          : '—'}
                      </span>
                    </div>
                    <p className="text-3xl font-bold tabular-nums" style={{ color: GREEN }}>{totTecAtual}</p>
                    <p className="text-xs text-gray-400 mt-0.5">plantões no período</p>

                    {varTec !== null && (
                      <div className="mt-3 pt-3 border-t flex items-center gap-2">
                        {varTec > 0
                          ? <TrendingUp className="h-4 w-4 text-green-600 flex-shrink-0" />
                          : varTec < 0
                            ? <TrendingDown className="h-4 w-4 text-red-500 flex-shrink-0" />
                            : <Minus className="h-4 w-4 text-gray-400 flex-shrink-0" />}
                        <div>
                          <span className={`text-sm font-bold ${varTec > 0 ? 'text-green-600' : varTec < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                            {varTec > 0 ? '+' : ''}{varTec.toFixed(1)}%
                          </span>
                          <span className="text-xs text-gray-400 ml-1">
                            vs período anterior ({totTecAnt} plantões)
                          </span>
                        </div>
                      </div>
                    )}
                    {varTec === null && totTecAnt === 0 && (
                      <p className="mt-3 pt-3 border-t text-xs text-gray-400 italic">Sem dados do período anterior</p>
                    )}
                  </div>
                </div>

                {/* Tabela detalhada por profissão */}
                {todasProfs.length > 0 && (
                  <table className="w-full text-sm border-collapse mt-5">
                    <thead>
                      <tr style={{ backgroundColor: NAVY, color: 'white' }}>
                        <th className="text-left px-4 py-2.5 font-semibold">Profissão</th>
                        <th className="text-right px-4 py-2.5 font-semibold">
                          {periodoAnt.inicioAnt ? labelPeriodoCurto(periodoAnt.inicioAnt, periodoAnt.fimAnt) : 'Período anterior'}
                        </th>
                        <th className="text-right px-4 py-2.5 font-semibold">Faturado anterior</th>
                        <th className="text-right px-4 py-2.5 font-semibold">
                          {labelPeriodoCurto(inicio, fim)}
                        </th>
                        <th className="text-right px-4 py-2.5 font-semibold">Faturado atual</th>
                        <th className="text-right px-4 py-2.5 font-semibold">Variação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {todasProfs.map((prof, i) => {
                        const at  = profAtual.find(r => r.profissao === prof);
                        const an  = profAnterior.find(r => r.profissao === prof);
                        const qtdAt  = at?.qtd ?? 0;
                        const qtdAn  = an?.qtd ?? 0;
                        const fatAt  = at?.faturamento ?? 0;
                        const fatAn  = an?.faturamento ?? 0;
                        const varPct = qtdAn > 0 ? ((qtdAt - qtdAn) / qtdAn) * 100 : null;
                        const sumido = qtdAt === 0 && qtdAn > 0;
                        const novo   = qtdAt > 0 && qtdAn === 0;
                        return (
                          <tr key={prof} style={{
                            backgroundColor: i % 2 === 0 ? SURFACE : 'white',
                          }}>
                            <td className="px-4 py-2 font-medium">
                              {PROF_LABEL[prof] ?? prof}
                              {sumido && <span className="ml-2 text-[10px] text-red-500 font-semibold">AUSENTE</span>}
                              {novo   && <span className="ml-2 text-[10px] text-green-600 font-semibold">NOVO</span>}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-gray-500">{qtdAn || '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-gray-500">{fatAn > 0 ? formatCurrency(fatAn) : '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums font-medium">{qtdAt || '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums font-medium">{fatAt > 0 ? formatCurrency(fatAt) : '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums font-semibold"
                              style={{ color: varPct == null ? MUTED_LIGHT : varPct > 0 ? GREEN : varPct < 0 ? DANGER : MUTED_LIGHT }}>
                              {sumido ? '−100%' : novo ? 'Novo' : varPct == null ? '—' : `${varPct > 0 ? '+' : ''}${varPct.toFixed(1)}%`}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Linha de total */}
                      {(() => {
                        const totQtAt = profAtual.reduce((s, r) => s + r.qtd, 0);
                        const totQtAn = profAnterior.reduce((s, r) => s + r.qtd, 0);
                        const totFtAt = profAtual.reduce((s, r) => s + r.faturamento, 0);
                        const totFtAn = profAnterior.reduce((s, r) => s + r.faturamento, 0);
                        const vp = totQtAn > 0 ? ((totQtAt - totQtAn) / totQtAn) * 100 : null;
                        return (
                          <tr style={{ backgroundColor: NAVY, color: 'white', fontWeight: 700, borderTop: '3px double rgba(255,255,255,0.55)' }}>
                            <td className="px-4 py-2.5">TOTAL</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{totQtAn}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(totFtAn)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{totQtAt}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(totFtAt)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {vp == null ? '—' : `${vp > 0 ? '+' : ''}${vp.toFixed(1)}%`}
                            </td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            {/* Seção 5 — Análise por Setor (apenas quando cliente específico selecionado) */}
            {hospitalId && todosSets.length > 0 && (
              <section className="mb-10 break-avoid">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-4 pb-2 border-b" style={{ color: NAVY, fontFamily: SERIF, borderColor: BORDER }}>
                  Análise por Setor
                </h3>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr style={{ backgroundColor: NAVY, color: 'white' }}>
                      <th className="text-left px-4 py-2.5 font-semibold">Setor</th>
                      <th className="text-right px-4 py-2.5 font-semibold">
                        {periodoAnt.inicioAnt ? labelPeriodoCurto(periodoAnt.inicioAnt, periodoAnt.fimAnt) : 'Período anterior'}
                      </th>
                      <th className="text-right px-4 py-2.5 font-semibold">Faturado anterior</th>
                      <th className="text-right px-4 py-2.5 font-semibold">
                        {labelPeriodoCurto(inicio, fim)}
                      </th>
                      <th className="text-right px-4 py-2.5 font-semibold">Faturado atual</th>
                      <th className="text-right px-4 py-2.5 font-semibold">Variação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todosSets.map(([sid, sNome], i) => {
                      const at = setoresAtual.find(r => r.setor_id === sid);
                      const an = setoresAnt.find(r => r.setor_id === sid);
                      const qtdAt  = at?.qtd ?? 0;
                      const qtdAn  = an?.qtd ?? 0;
                      const fatAt  = at?.faturamento ?? 0;
                      const fatAn  = an?.faturamento ?? 0;
                      const varPct = qtdAn > 0 ? ((qtdAt - qtdAn) / qtdAn) * 100 : null;
                      const sumido = qtdAt === 0 && qtdAn > 0;
                      const novo   = qtdAt > 0 && qtdAn === 0;
                      return (
                        <tr key={sid} style={{
                          backgroundColor: sumido ? '#fff5f5' : novo ? '#f0fdf4' : i % 2 === 0 ? '#f8f9fc' : 'white',
                        }}>
                          <td className="px-4 py-2 font-medium">
                            {sNome}
                            {sumido && <span className="ml-2 text-[10px] text-red-500 font-semibold">SEM PLANTÕES</span>}
                            {novo   && <span className="ml-2 text-[10px] text-green-600 font-semibold">NOVO</span>}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-500">{qtdAn || '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-500">{fatAn > 0 ? formatCurrency(fatAn) : '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">{qtdAt || '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">{fatAt > 0 ? formatCurrency(fatAt) : '—'}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-semibold"
                            style={{ color: varPct == null ? '#9ca3af' : varPct > 0 ? '#16a34a' : varPct < 0 ? '#dc2626' : '#9ca3af' }}>
                            {sumido ? '−100%' : novo ? 'Novo' : varPct == null ? '—' : `${varPct > 0 ? '+' : ''}${varPct.toFixed(1)}%`}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Linha de total */}
                    {(() => {
                      const totQtAt = setoresAtual.reduce((s, r) => s + r.qtd, 0);
                      const totQtAn = setoresAnt.reduce((s, r) => s + r.qtd, 0);
                      const totFtAt = setoresAtual.reduce((s, r) => s + r.faturamento, 0);
                      const totFtAn = setoresAnt.reduce((s, r) => s + r.faturamento, 0);
                      const vp = totQtAn > 0 ? ((totQtAt - totQtAn) / totQtAn) * 100 : null;
                      return (
                        <tr style={{ backgroundColor: NAVY, color: 'white', fontWeight: 700, borderTop: '3px double rgba(255,255,255,0.55)' }}>
                          <td className="px-4 py-2.5">TOTAL</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{totQtAn}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(totFtAn)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{totQtAt}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(totFtAt)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {vp == null ? '—' : `${vp > 0 ? '+' : ''}${vp.toFixed(1)}%`}
                          </td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </section>
            )}

            {/* Seção 6 — Análise automática */}
            <section className="break-avoid">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-4 pb-2 border-b" style={{ color: NAVY, fontFamily: SERIF, borderColor: BORDER }}>
                Análise e Observações
              </h3>
              <div className="rounded-lg border p-5 text-sm" style={{ borderColor: BORDER, backgroundColor: SURFACE }}>
                {analise.length === 0 ? (
                  <p className="italic" style={{ color: MUTED_LIGHT }}>Sem dados suficientes para análise.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {analise.map((texto, i) => (
                      <li key={i} className="flex gap-2.5 leading-relaxed" style={{ color: INK }}>
                        <span className="mt-[7px] h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: NAVY }} />
                        <span>{texto}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="text-[10px] mt-6 text-center" style={{ color: MUTED_LIGHT }}>
                Documento gerado automaticamente pelo sistema CADES Financeiro — Confidencial
              </p>
            </section>
            </TabsContent>

            <TabsContent value="extrato" forceMount className="report-tab-content">
            {/* Seção 7 — Extrato Financeiro (complemento independente, não altera as seções acima) */}
            <section id="extrato-financeiro" className="break-avoid">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] pb-2 border-b" style={{ color: NAVY, fontFamily: SERIF, borderColor: BORDER }}>
                Extrato Financeiro
              </h3>
              <p className="text-xs text-gray-500 mt-2 mb-4 italic">Demonstrativo financeiro da competência de faturamento</p>

              {/* Bloco 1 — Demonstrativo da Nota Fiscal */}
              <table className="w-full text-sm border-collapse mb-6">
                <thead>
                  <tr style={{ backgroundColor: NAVY, color: 'white' }}>
                    <th className="text-left px-4 py-2.5 font-semibold">Descrição</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ backgroundColor: '#f8f9fc' }}>
                    <td className="px-4 py-2.5" style={{ color: INK }}>Valor Bruto da Nota Fiscal</td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: INK }}>{formatCurrency(extratoFinanceiro.valorBrutoNF)}</td>
                  </tr>
                  <tr style={{ backgroundColor: 'white' }}>
                    <td className="px-4 py-2.5" style={{ color: INK }}>
                      (+) Taxa Administrativa{!taxaAdministrativaAtiva && ' (não considerada — indicador desmarcado)'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: GOLD }}>{formatCurrency(taxaAdministrativaAplicada)}</td>
                  </tr>
                  <tr style={{ backgroundColor: '#f8f9fc', fontWeight: 600, borderTop: `1px solid ${BORDER}` }}>
                    <td className="px-4 py-2.5" style={{ color: INK }}>
                      (=) Valor Bruto Total {taxaAdministrativaAtiva ? '(NF + Taxa Administrativa)' : '(apenas NF — produção)'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: INK }}>{formatCurrency(extratoFinanceiro.valorBrutoTotal)}</td>
                  </tr>
                  <tr style={{ backgroundColor: 'white' }}>
                    <td className="px-4 py-2.5" style={{ color: INK }}>(−) PIS (0,65%)</td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: DANGER }}>{formatCurrency(extratoFinanceiro.pis)}</td>
                  </tr>
                  <tr style={{ backgroundColor: '#f8f9fc' }}>
                    <td className="px-4 py-2.5" style={{ color: INK }}>(−) COFINS (3,00%)</td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: DANGER }}>{formatCurrency(extratoFinanceiro.cofins)}</td>
                  </tr>
                  <tr style={{ backgroundColor: 'white', fontWeight: 600, borderTop: `1px solid ${BORDER}` }}>
                    <td className="px-4 py-2.5" style={{ color: INK }}>(=) Total das Contribuições Sociais Retidas (3,65%)</td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: DANGER }}>{formatCurrency(extratoFinanceiro.pis + extratoFinanceiro.cofins)}</td>
                  </tr>
                  {extratoFinanceiro.iss > 0 && (
                    <tr style={{ backgroundColor: '#f8f9fc' }}>
                      <td className="px-4 py-2.5" style={{ color: INK }}>(−) ISS Retido ({ALIQUOTA_ISS.toLocaleString('pt-BR')}%) — clientes com retenção na fonte</td>
                      <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: DANGER }}>{formatCurrency(extratoFinanceiro.iss)}</td>
                    </tr>
                  )}
                  <tr style={{ backgroundColor: 'white', fontWeight: 600, borderTop: `1px solid ${BORDER}` }}>
                    <td className="px-4 py-2.5" style={{ color: INK }}>(=) Total Geral Retido</td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: DANGER }}>{formatCurrency(extratoFinanceiro.totalRetido)}</td>
                  </tr>
                  <tr style={{ backgroundColor: NAVY, color: 'white', fontWeight: 700, borderTop: '3px double rgba(255,255,255,0.55)' }}>
                    <td className="px-4 py-2.5">(=) Valor Líquido a Receber</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(extratoFinanceiro.valorLiquido)}</td>
                  </tr>
                </tbody>
              </table>

              {/* Detalhamento da Taxa Administrativa por Cliente — especifica a linha "(+) Taxa Administrativa" acima; some quando o indicador está desmarcado */}
              {taxaAdministrativaAtiva && taxaAdministrativaPorCliente.length > 0 && (
                <>
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] mt-6 mb-3" style={{ color: MUTED }}>
                    Detalhamento da Taxa Administrativa por Cliente
                  </h4>
                  <table className="w-full text-sm border-collapse mb-6">
                    <thead>
                      <tr style={{ backgroundColor: SURFACE_ALT, color: NAVY, borderBottom: `1px solid ${BORDER}` }}>
                        <th className="text-left px-4 py-2.5 font-semibold">Cliente</th>
                        <th className="text-right px-4 py-2.5 font-semibold">Valor de Cobrança</th>
                        <th className="text-right px-4 py-2.5 font-semibold">Taxa (%)</th>
                        <th className="text-right px-4 py-2.5 font-semibold">Taxa Administrativa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxaAdministrativaPorCliente.map((c, i) => (
                        <tr key={c.hospital_id} style={{ backgroundColor: i % 2 === 0 ? SURFACE : 'white' }}>
                          <td className="px-4 py-2.5 font-medium" style={{ color: INK }}>{c.nome}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: INK }}>{formatCurrency(c.faturamento)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: INK }}>{c.taxaPct.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold" style={{ color: GOLD }}>{formatCurrency(c.taxaValor)}</td>
                        </tr>
                      ))}
                      <tr style={{ backgroundColor: NAVY, color: 'white', fontWeight: 700, borderTop: '3px double rgba(255,255,255,0.55)' }}>
                        <td className="px-4 py-2.5" colSpan={3}>TOTAL — Taxa Administrativa</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(taxaAdministrativaTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}

              {/* Detalhamento do ISS Retido por Cliente — apenas clientes com "Cliente retém ISS" marcado no cadastro */}
              {issRetidoPorCliente.some(c => c.retemIss) && (
                <>
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] mt-6 mb-3" style={{ color: MUTED }}>
                    Detalhamento do ISS Retido por Cliente
                  </h4>
                  <table className="w-full text-sm border-collapse mb-6">
                    <thead>
                      <tr style={{ backgroundColor: SURFACE_ALT, color: NAVY, borderBottom: `1px solid ${BORDER}` }}>
                        <th className="text-left px-4 py-2.5 font-semibold">Cliente</th>
                        <th className="text-right px-4 py-2.5 font-semibold">Valor Bruto Total</th>
                        <th className="text-right px-4 py-2.5 font-semibold">Alíquota</th>
                        <th className="text-right px-4 py-2.5 font-semibold">ISS Retido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issRetidoPorCliente.filter(c => c.retemIss).map((c, i) => (
                        <tr key={c.hospital_id} style={{ backgroundColor: i % 2 === 0 ? SURFACE : 'white' }}>
                          <td className="px-4 py-2.5 font-medium" style={{ color: INK }}>{c.nome}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: INK }}>{formatCurrency(c.valorBrutoClienteTotal)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: INK }}>{ALIQUOTA_ISS.toLocaleString('pt-BR')}%</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold" style={{ color: DANGER }}>{formatCurrency(c.issValor)}</td>
                        </tr>
                      ))}
                      <tr style={{ backgroundColor: NAVY, color: 'white', fontWeight: 700, borderTop: '3px double rgba(255,255,255,0.55)' }}>
                        <td className="px-4 py-2.5" colSpan={3}>TOTAL — ISS Retido</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(issRetidoTotal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </>
              )}

              {/* Bloco 2 — Resumo da Competência */}
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr style={{ backgroundColor: NAVY, color: 'white' }}>
                    <th className="text-left px-4 py-2.5 font-semibold">Indicador</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ backgroundColor: '#f8f9fc', fontWeight: 700 }}>
                    <td className="px-4 py-2.5" style={{ color: GREEN }}>Valor Total de Repasse aos Cooperados</td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: GREEN }}>{formatCurrency(extratoFinanceiro.repasseTotal)}</td>
                  </tr>
                  <tr style={{ backgroundColor: 'white', fontWeight: 700 }}>
                    <td className="px-4 py-2.5" style={{ color: GOLD }}>Total do INSS Patronal (20%)</td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: GOLD }}>{formatCurrency(extratoFinanceiro.inssPatronal)}</td>
                  </tr>
                  <tr style={{ backgroundColor: '#f8f9fc', fontWeight: 700 }}>
                    <td className="px-4 py-2.5" style={{ color: GOLD }}>Valor Total da Cota-Parte Arrecadada</td>
                    <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: GOLD }}>{formatCurrency(extratoFinanceiro.cotaParteTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </section>
            </TabsContent>

            {mostrarConsolidado && (
              <TabsContent value="consolidado" forceMount className="report-tab-content">
                <section id="relatorio-consolidado" className="break-avoid">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] pb-2 border-b" style={{ color: NAVY, fontFamily: SERIF, borderColor: BORDER }}>
                    Relatório Consolidado Mensal
                  </h3>
                  <p className="text-xs text-gray-500 mt-2 mb-4 italic">
                    Consolidado de todos os setores/unidades de {hospitalNome || 'cliente'} faturados no período — {periodo}. Uso interno do financeiro para conferência e envio ao cliente.
                  </p>

                  {consolidadoPorSetor.length === 0 ? (
                    <p className="text-sm italic" style={{ color: MUTED_LIGHT }}>Nenhum setor com faturamento neste período.</p>
                  ) : (
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr style={{ backgroundColor: NAVY, color: 'white' }}>
                          <th className="text-left px-3 py-2.5 font-semibold">Setor</th>
                          <th className="text-right px-3 py-2.5 font-semibold">Valor Bruto Faturado</th>
                          {taxaAdministrativaAtiva && <th className="text-right px-3 py-2.5 font-semibold">(+) Taxa Administrativa</th>}
                          {taxaAdministrativaAtiva && <th className="text-right px-3 py-2.5 font-semibold">(=) Valor Bruto Total</th>}
                          <th className="text-right px-3 py-2.5 font-semibold">(−) Impostos NF (PIS/COFINS)</th>
                          {hospitalSelecionado?.retem_iss && <th className="text-right px-3 py-2.5 font-semibold">(−) ISS Retido</th>}
                          <th className="text-right px-3 py-2.5 font-semibold">(=) Total de Descontos</th>
                          <th className="text-right px-3 py-2.5 font-semibold">(=) Valor Líquido a Receber</th>
                        </tr>
                      </thead>
                      <tbody>
                        {consolidadoPorSetor.map((s, i) => (
                          <tr key={s.setor_id} style={{ backgroundColor: i % 2 === 0 ? SURFACE : 'white' }}>
                            <td className="px-3 py-2.5 font-medium" style={{ color: INK }}>{s.setor_nome}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: INK }}>{formatCurrency(s.valorBrutoNF)}</td>
                            {taxaAdministrativaAtiva && <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: GOLD }}>{formatCurrency(s.taxaAdm)}</td>}
                            {taxaAdministrativaAtiva && <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: INK }}>{formatCurrency(s.valorBrutoTotal)}</td>}
                            <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: DANGER }}>{formatCurrency(s.pisCofins)}</td>
                            {hospitalSelecionado?.retem_iss && <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: DANGER }}>{formatCurrency(s.iss)}</td>}
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: DANGER }}>{formatCurrency(s.totalDescontos)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: INK }}>{formatCurrency(s.valorLiquido)}</td>
                          </tr>
                        ))}
                        <tr style={{ backgroundColor: NAVY, color: 'white', fontWeight: 700, borderTop: '3px double rgba(255,255,255,0.55)' }}>
                          <td className="px-3 py-2.5">TOTAL GERAL</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(consolidadoTotais.valorBrutoNF)}</td>
                          {taxaAdministrativaAtiva && <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(consolidadoTotais.taxaAdm)}</td>}
                          {taxaAdministrativaAtiva && <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(consolidadoTotais.valorBrutoTotal)}</td>}
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(consolidadoTotais.pisCofins)}</td>
                          {hospitalSelecionado?.retem_iss && <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(consolidadoTotais.iss)}</td>}
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(consolidadoTotais.totalDescontos)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatCurrency(consolidadoTotais.valorLiquido)}</td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                  <p className="text-[10px] mt-6 text-center" style={{ color: MUTED_LIGHT }}>
                    Documento gerado automaticamente pelo sistema CADES Financeiro — Confidencial
                  </p>
                </section>
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>
    </>
  );
}
