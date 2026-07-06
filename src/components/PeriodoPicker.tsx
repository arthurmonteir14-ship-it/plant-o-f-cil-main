import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { calcPeriodo, PeriodoState, TIPO_LABELS, TipoPeriodo } from '@/lib/periodo';

interface Props {
  value: PeriodoState;
  onChange: (p: PeriodoState) => void;
  label?: string;
}

const TIPOS: TipoPeriodo[] = ['tudo', 'hoje', 'semana', 'mes', 'mes_passado', 'personalizado'];
const NAVEGAVEL: TipoPeriodo[] = ['hoje', 'semana', 'mes', 'mes_passado'];

export function PeriodoPicker({ value, onChange, label = 'Período' }: Props) {
  const { label: periodoLabel } = calcPeriodo(value);
  const navegavel = NAVEGAVEL.includes(value.tipo);

  const setTipo = (tipo: TipoPeriodo) => onChange({ ...value, tipo, offset: 0 });
  const nav = (dir: -1 | 1) => onChange({ ...value, offset: value.offset + dir });

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-1.5">
        {navegavel && (
          <Button variant="outline" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => nav(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <Select value={value.tipo} onValueChange={v => setTipo(v as TipoPeriodo)}>
          <SelectTrigger className="flex-1 min-w-0">
            <SelectValue>
              <span className="truncate">
                {value.tipo === 'personalizado' ? TIPO_LABELS.personalizado : periodoLabel}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {TIPOS.map(t => (
              <SelectItem key={t} value={t}>{TIPO_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {navegavel && (
          <Button variant="outline" size="icon" className="h-9 w-9 flex-shrink-0" onClick={() => nav(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
      {value.tipo === 'personalizado' && (
        <div className="flex items-center gap-2 pt-1">
          <Input
            type="date"
            value={value.customInicio}
            onChange={e => onChange({ ...value, customInicio: e.target.value })}
            className="flex-1"
          />
          <span className="text-muted-foreground text-sm">até</span>
          <Input
            type="date"
            value={value.customFim}
            onChange={e => onChange({ ...value, customFim: e.target.value })}
            className="flex-1"
          />
        </div>
      )}
    </div>
  );
}
