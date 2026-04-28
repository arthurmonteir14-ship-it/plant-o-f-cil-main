export const formatCurrency = (value: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value ?? 0));

export const formatDate = (value: string | Date) => {
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(value + 'T00:00:00')
    : new Date(value as string);
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
};

export const profissaoLabel: Record<string, string> = {
  enfermeiro: 'Enfermeiro(a)',
  tecnico_enfermagem: 'Técnico(a) de Enfermagem',
  fonoaudiologo: 'Fonoaudiólogo(a)',
  assistente_social: 'Assistente Social',
  fisioterapeuta: 'Fisioterapeuta',
  auxiliar_administrativo: 'Auxiliar Administrativo',
  tecnico_radiologia: 'Técnico de Radiologia',
  tecnico_hemodialise: 'Técnico de Hemodiálise',
};

export const tipoPlantaoLabel: Record<string, string> = {
  normal: 'Diurno',
  extra: 'Noturno',
  sobreaviso: 'Sobreaviso',
  diarista: 'Diarista',
};

export const tipoPlantaoOptions: { value: 'normal' | 'extra' | 'diarista'; label: string }[] = [
  { value: 'normal', label: 'Diurno' },
  { value: 'extra', label: 'Noturno' },
  { value: 'diarista', label: 'Diarista' },
];

export const statusLabel: Record<string, string> = {
  lancado: 'Lançado',
  pago: 'Pago',
};

export const roleLabel: Record<string, string> = {
  admin_master: 'Administrativo',
  coordenadora: 'Coordenadora',
  administrativo: 'Administrativo',
  nac: 'NAC',
};

/** Calcula horas decimais entre dois horários "HH:MM"; suporta plantão noturno cruzando meia-noite. */
export const calcularHoras = (inicio: string, fim: string): number => {
  if (!inicio || !fim) return 0;
  const [hi, mi] = inicio.split(':').map(Number);
  const [hf, mf] = fim.split(':').map(Number);
  if ([hi, mi, hf, mf].some(n => Number.isNaN(n))) return 0;
  let minutos = (hf * 60 + mf) - (hi * 60 + mi);
  if (minutos <= 0) minutos += 24 * 60;
  return Math.round((minutos / 60) * 100) / 100;
};
