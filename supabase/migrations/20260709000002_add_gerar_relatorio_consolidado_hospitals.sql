-- Indica se o cliente deve ter o Relatório Consolidado Mensal por Setor disponível no relatório de faturamento
ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS gerar_relatorio_consolidado BOOLEAN NOT NULL DEFAULT false;
