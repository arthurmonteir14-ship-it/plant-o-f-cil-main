import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

export function ModeToggle({ collapsed }: { collapsed?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={isDark ? 'Ativar modo claro' : 'Ativar modo noturno'}
      className={collapsed
        ? 'flex w-full items-center justify-center rounded-lg p-2 text-muted-foreground/50 hover:text-muted-foreground transition-colors'
        : 'rounded-md p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors'}
    >
      {isDark
        ? <Sun className={collapsed ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
        : <Moon className={collapsed ? 'h-4 w-4' : 'h-3.5 w-3.5'} />}
    </button>
  );
}
