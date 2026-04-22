export const formatCurrency = (value: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value ?? 0));

export const formatDate = (value: string | Date) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));

export const profissaoLabel: Record<string, string> = {
  enfermeiro: 'Enfermeiro(a)',
  tecnico_enfermagem: 'Técnico(a) de Enfermagem',
  fonoaudiologo: 'Fonoaudiólogo(a)',
  assistente_social: 'Assistente Social',
};

export const tipoPlantaoLabel: Record<string, string> = {
  normal: 'Diurno',
  extra: 'Noturno',
  sobreaviso: 'Sobreaviso',
};

export const tipoPlantaoOptions: { value: 'normal' | 'extra'; label: string }[] = [
  { value: 'normal', label: 'Diurno' },
  { value: 'extra', label: 'Noturno' },
];

export const statusLabel: Record<string, string> = {
  lancado: 'Lançado',
  pago: 'Pago',
};

export const roleLabel: Record<string, string> = {
  admin_master: 'Admin Master',
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
