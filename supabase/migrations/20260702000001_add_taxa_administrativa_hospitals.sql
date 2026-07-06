-- Taxa administrativa por cliente (percentual), usada apenas no relatório de faturamento
ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS taxa_administrativa NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (taxa_administrativa >= 0 AND taxa_administrativa <= 100);
