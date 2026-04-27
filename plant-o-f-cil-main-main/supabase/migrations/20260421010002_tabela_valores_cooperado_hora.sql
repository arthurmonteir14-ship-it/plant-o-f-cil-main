-- Add direct R$/hour value for cooperado instead of only percentage
ALTER TABLE public.tabela_valores
  ADD COLUMN IF NOT EXISTS valor_hora_cooperado NUMERIC(10,2);

-- Backfill from existing percentual_repasse
UPDATE public.tabela_valores
SET valor_hora_cooperado = ROUND(valor_hora_cliente * percentual_repasse / 100, 2)
WHERE valor_hora_cooperado IS NULL;
