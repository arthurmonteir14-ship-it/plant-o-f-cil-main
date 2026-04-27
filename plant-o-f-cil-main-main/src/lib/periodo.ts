export type TipoPeriodo = 'hoje' | 'semana' | 'mes' | 'mes_passado' | 'personalizado' | 'tudo';

export interface PeriodoState {
  tipo: TipoPeriodo;
  offset: number;
  customInicio: string;
  customFim: string;
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);
const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

export function calcPeriodo(p: PeriodoState): { inicio: string; fim: string; label: string } {
  const hoje = new Date();
  hoje.setHours(12, 0, 0, 0);

  switch (p.tipo) {
    case 'hoje': {
      const d = new Date(hoje);
      d.setDate(d.getDate() + p.offset);
      const s = fmt(d);
      return { inicio: s, fim: s, label: s.split('-').reverse().join('/') };
    }
    case 'semana': {
      const d = new Date(hoje);
      const day = d.getDay();
      d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day) + p.offset * 7);
      const inicio = fmt(d);
      d.setDate(d.getDate() + 6);
      const fim = fmt(d);
      return { inicio, fim, label: `${inicio.split('-').reverse().join('/')} – ${fim.split('-').reverse().join('/')}` };
    }
    case 'mes': {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + p.offset, 1);
      const inicio = fmt(d);
      const fim = fmt(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      return { inicio, fim, label: `${MESES[d.getMonth()]}/${d.getFullYear()}` };
    }
    case 'mes_passado': {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1 + p.offset, 1);
      const inicio = fmt(d);
      const fim = fmt(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      return { inicio, fim, label: `${MESES[d.getMonth()]}/${d.getFullYear()}` };
    }
    case 'tudo':
      return { inicio: '2000-01-01', fim: '2099-12-31', label: 'Todos os registros' };
    default:
      return {
        inicio: p.customInicio || fmt(hoje),
        fim: p.customFim || fmt(hoje),
        label: `${(p.customInicio || fmt(hoje)).split('-').reverse().join('/')} – ${(p.customFim || fmt(hoje)).split('-').reverse().join('/')}`,
      };
  }
}

export function periodoInicial(): PeriodoState {
  const hoje = new Date();
  return { tipo: 'mes', offset: 0, customInicio: fmt(hoje), customFim: fmt(hoje) };
}

export const TIPO_LABELS: Record<TipoPeriodo, string> = {
  hoje: 'Hoje',
  semana: 'Esta semana',
  mes: 'Este mês',
  mes_passado: 'Mês passado',
  personalizado: 'Personalizado',
  tudo: 'Todos os registros',
};
