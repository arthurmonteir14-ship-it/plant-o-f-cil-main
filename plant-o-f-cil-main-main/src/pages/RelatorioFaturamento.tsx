import { useEffect, useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency, DESCONTO_COTA_PARTE } from '@/lib/format';
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

const NAVY  = '#1a2f5a';
const GREEN = '#16a34a';
const BLUE  = '#2563eb';
const CORES = ['#1a2f5a','#2563eb','#16a34a','#d97706','#dc2626','#7c3aed','#0891b2','#be185d','#059669','#b45309'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MESES_CURTO = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const INDICADORES_LABELS: Record<string, string> = {
  faturado:   'Total Faturado',
  repassado:  'Total Repassado',
  margem:     'Margem Operacional',
  pctRepasse: '% de Repasse',
  cotaParte:  'Cota Parte',
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

interface Hospital { id: string; nome: string; }
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

  const [mostrarRepasse] = useState(searchParams.get('mostrarRepasse') !== '0');

  const [indicadoresVisiveis, setIndicadoresVisiveis] = useState<Record<string, boolean>>({
    faturado:   true,
    repassado:  searchParams.get('mostrarRepasse') !== '0',
    margem:     searchParams.get('mostrarRepasse') !== '0',
    pctRepasse: searchParams.get('mostrarRepasse') !== '0',
    cotaParte:  searchParams.get('mostrarRepasse') !== '0',
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
  const [cotaParte,     setCotaParte]     = useState(0);

  useEffect(() => {
    supabase.from('hospitals').select('id, nome').order('nome').then(({ data }) => setHospitals(data ?? []));
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
        let all: { cooperado_id: string; data_plantao: string }[] = [];
        let from = 0;
        while (true) {
          let q = supabase
            .from('lancamentos_plantoes')
            .select('cooperado_id, data_plantao')
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

      // Cota parte é descontada uma vez por cooperado a cada fechamento (mensal)
      const cooperadoMesUnicos = new Set(
        cooperadosData.map(r => `${r.cooperado_id}|${String(r.data_plantao).slice(0, 7)}`)
      ).size;
      setCotaParte(cooperadoMesUnicos * DESCONTO_COTA_PARTE);

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

  const margem     = (kpi?.faturamento ?? 0) - (kpi?.repasse ?? 0);
  const pctRepasse = kpi?.faturamento ? (kpi.repasse / kpi.faturamento) * 100 : 0;

  const clientesComMargem = useMemo(() =>
    clientes.map(c => ({
      ...c,
      margem:     c.faturamento - c.repasse,
      pctRepasse: c.faturamento > 0 ? (c.repasse / c.faturamento) * 100 : 0,
    })),
  [clientes]);

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
    const maiorPct  = [...clientesComMargem].sort((a, b) => b.pctRepasse - a.pctRepasse)[0];
    const periodoAntLabel = labelPeriodoCurto(periodoAnt.inicioAnt, periodoAnt.fimAnt);

    const frases: string[] = [
      mostrarRepasse
        ? `No período analisado, o faturamento total foi de ${formatCurrency(kpi.faturamento)}, com repasse de ${formatCurrency(kpi.repasse)} aos cooperados, resultando em margem operacional de ${formatCurrency(margem)} (${pctRepasse.toFixed(2)}% de repasse sobre o faturamento).`
        : `No período analisado, o faturamento total foi de ${formatCurrency(kpi.faturamento)}.`,
    ];
    if (maiorFat)  frases.push(`O cliente com maior volume foi ${maiorFat.nome}, representando ${kpi.faturamento > 0 ? ((maiorFat.faturamento / kpi.faturamento) * 100).toFixed(2) : 0}% do faturamento total (${formatCurrency(maiorFat.faturamento)}).`);
    if (mostrarRepasse && maiorMarg) frases.push(`A maior margem operacional foi registrada em ${maiorMarg.nome}, com ${formatCurrency(maiorMarg.margem)} de diferença entre faturado e repassado.`);
    if (mostrarRepasse && maiorPct)  frases.push(`O maior percentual de repasse foi de ${maiorPct.pctRepasse.toFixed(2)}%, referente ao cliente ${maiorPct.nome}.`);

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
  }, [kpi, clientes, clientesComMargem, margem, pctRepasse, totEnfAtual, totTecAtual, totEnfAnt, totTecAnt, varEnf, varTec, periodoAnt, obsProf, obsSetores, mostrarRepasse]);

  const periodo  = labelPeriodo(inicio, fim);
  const dataGer  = hoje.toLocaleDateString('pt-BR');

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; background: white; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          @page { margin: 12mm; size: A4; }
          .break-avoid { break-inside: avoid; }
        }
      `}</style>

      {/* Barra de controles — oculta na impressão */}
      <div className="no-print sticky top-0 z-10 bg-slate-50 border-b px-6 py-3 flex flex-wrap items-center gap-4 shadow-sm">
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
        <div className="flex items-center justify-between pb-6 mb-8 border-b-2" style={{ borderColor: NAVY }}>
          <img src="/cades-logo.png" alt="CADES" className="h-20 object-contain" />
          <div className="text-right">
            <h2 className="text-xl font-bold" style={{ color: NAVY }}>Análise de Faturamento</h2>
            <p className="text-sm text-gray-600 mt-1">Período: <strong>{periodo}</strong></p>
            {hospitalNome && <p className="text-xs text-gray-500 mt-0.5">Cliente: <strong>{hospitalNome}</strong></p>}
            {setorNome    && <p className="text-xs text-gray-500 mt-0.5">Setor: <strong>{setorNome}</strong></p>}
            <p className="text-xs text-gray-400 mt-0.5">Gerado em: {dataGer}</p>
          </div>
        </div>

        {loading ? (
          <div className="no-print py-24 text-center text-gray-400">Carregando dados…</div>
        ) : (
          <>
            {/* Seção 1 — KPIs */}
            <section className="mb-10 break-avoid">
              <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: NAVY }}>
                Indicadores Gerais
              </h3>
              {(() => {
                const cards = [
                  { key: 'faturado',   label: 'Total Faturado',      value: formatCurrency(kpi?.faturamento ?? 0), color: NAVY  },
                  { key: 'repassado',  label: 'Total Repassado',     value: formatCurrency(kpi?.repasse     ?? 0), color: GREEN },
                  { key: 'margem',     label: 'Margem Operacional',  value: formatCurrency(margem),                color: BLUE  },
                  { key: 'pctRepasse', label: '% de Repasse',        value: `${pctRepasse.toFixed(2)}%`,           color: '#d97706' },
                  { key: 'cotaParte',  label: 'Cota Parte',          value: formatCurrency(cotaParte),             color: '#7c3aed' },
                ].filter(card => indicadoresVisiveis[card.key]);
                return (
                  <div className={`grid ${GRID_COLS[cards.length] ?? 'grid-cols-1'} gap-4`}>
                    {cards.map(card => (
                      <div key={card.key} className="rounded-xl border p-4" style={{ borderColor: '#e5e7eb' }}>
                        <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{card.label}</p>
                        <p className="text-xl font-bold tabular-nums mt-1" style={{ color: card.color }}>{card.value}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <p className="text-xs text-gray-400 mt-3">
                Total de plantões lançados no período: <strong>{kpi?.total_plantoes ?? 0}</strong>
              </p>
            </section>

            {/* Seção 2 — Tabela por cliente */}
            <section className="mb-10 break-avoid">
              <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: NAVY }}>
                Faturamento por Cliente
              </h3>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr style={{ backgroundColor: NAVY, color: 'white' }}>
                    <th className="text-left px-4 py-2.5 font-semibold">Cliente</th>
                    <th className="text-right px-4 py-2.5 font-semibold">Valor Faturado</th>
                    {mostrarRepasse && <th className="text-right px-4 py-2.5 font-semibold">Valor Repassado</th>}
                    {mostrarRepasse && <th className="text-right px-4 py-2.5 font-semibold">Margem</th>}
                    {mostrarRepasse && <th className="text-right px-4 py-2.5 font-semibold">% Repasse</th>}
                  </tr>
                </thead>
                <tbody>
                  {clientesComMargem.map((c, i) => (
                    <tr key={c.hospital_id} style={{ backgroundColor: i % 2 === 0 ? '#f8f9fc' : 'white' }}>
                      <td className="px-4 py-2.5 font-medium">{c.nome}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(c.faturamento)}</td>
                      {mostrarRepasse && <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: GREEN }}>{formatCurrency(c.repasse)}</td>}
                      {mostrarRepasse && <td className="px-4 py-2.5 text-right tabular-nums" style={{ color: BLUE }}>{formatCurrency(c.margem)}</td>}
                      {mostrarRepasse && (
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold"
                          style={{ color: c.pctRepasse > 80 ? '#dc2626' : '#374151' }}>
                          {c.pctRepasse.toFixed(2)}%
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr style={{ backgroundColor: NAVY, color: 'white', fontWeight: 700 }}>
                    <td className="px-4 py-2.5">TOTAL GERAL</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(kpi?.faturamento ?? 0)}</td>
                    {mostrarRepasse && <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(kpi?.repasse ?? 0)}</td>}
                    {mostrarRepasse && <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(margem)}</td>}
                    {mostrarRepasse && <td className="px-4 py-2.5 text-right tabular-nums">{pctRepasse.toFixed(2)}%</td>}
                  </tr>
                </tbody>
              </table>
            </section>

            {/* Seção 3 — Gráficos */}
            {clientesComMargem.length > 0 && (
              <section className="mb-10 break-avoid">
                <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: NAVY }}>
                  Análise Gráfica
                </h3>
                <div className="grid grid-cols-2 gap-8">
                  {/* Barras */}
                  <div>
                    <p className="text-xs text-gray-500 font-semibold mb-3">Faturado vs Repassado por Cliente</p>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={clientesComMargem} margin={{ top: 4, right: 8, left: 0, bottom: 50 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="nome" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                        <YAxis tickFormatter={fmtK} tick={{ fontSize: 9 }} width={65} />
                        <Tooltip
                          formatter={(v: number, n: string) => [formatCurrency(v), n]}
                          contentStyle={{ fontSize: 11, borderRadius: 6 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="faturamento" name="Faturado"   fill={NAVY}  radius={[3,3,0,0]} />
                        {mostrarRepasse && <Bar dataKey="repasse" name="Repassado" fill={GREEN} radius={[3,3,0,0]} />}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Pizza */}
                  <div>
                    <p className="text-xs text-gray-500 font-semibold mb-3">Distribuição do Faturamento (%)</p>
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
                          contentStyle={{ fontSize: 11, borderRadius: 6 }}
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
                <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: NAVY }}>
                  Análise de Plantões por Categoria
                </h3>

                <div className="grid grid-cols-2 gap-6">
                  {/* Card Enfermeiros */}
                  <div className="rounded-xl border p-5" style={{ borderColor: '#e5e7eb' }}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Enfermeiros</p>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ backgroundColor: '#eff6ff', color: NAVY }}>
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
                  <div className="rounded-xl border p-5" style={{ borderColor: '#e5e7eb' }}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Técnicos de Enfermagem</p>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ backgroundColor: '#f0fdf4', color: GREEN }}>
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
                            backgroundColor: sumido ? '#fff5f5' : novo ? '#f0fdf4' : i % 2 === 0 ? '#f8f9fc' : 'white',
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
                              style={{ color: varPct == null ? '#9ca3af' : varPct > 0 ? '#16a34a' : varPct < 0 ? '#dc2626' : '#9ca3af' }}>
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
                          <tr style={{ backgroundColor: NAVY, color: 'white', fontWeight: 700 }}>
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
                <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: NAVY }}>
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
                        <tr style={{ backgroundColor: NAVY, color: 'white', fontWeight: 700 }}>
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
              <h3 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: NAVY }}>
                Análise e Observações
              </h3>
              <div className="rounded-xl p-5 text-sm leading-relaxed space-y-3"
                style={{ backgroundColor: '#f8f9fc', borderLeft: `4px solid ${NAVY}` }}>
                {analise.map((texto, i) => (
                  <p key={i} style={{ color: '#374151' }}>
                    {texto}
                  </p>
                ))}
                {analise.length === 0 && (
                  <p className="text-gray-400 italic">Sem dados suficientes para análise.</p>
                )}
              </div>
              <p className="text-[10px] text-gray-400 mt-6 text-center">
                Documento gerado automaticamente pelo sistema CADES Financeiro — Confidencial
              </p>
            </section>
          </>
        )}
      </div>
    </>
  );
}
