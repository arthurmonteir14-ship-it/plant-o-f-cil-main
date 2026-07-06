import { cn } from '@/lib/utils';
import { statusLabel } from '@/lib/format';

const styles: Record<string, string> = {
  lancado: 'bg-muted text-muted-foreground border-border',
  pago: 'bg-accent-soft text-accent border-accent/20',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        styles[status] ?? styles.lancado
      )}
    >
      <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {statusLabel[status] ?? status}
    </span>
  );
}
