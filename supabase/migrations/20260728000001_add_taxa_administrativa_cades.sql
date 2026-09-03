-- Taxa Administrativa CADES: percentual opcional por categoria/atividade (profissão + tipo de plantão)
-- na Tabela de Valores. Aceita até 3 casas decimais (ex.: 10,156%).
ALTER TABLE public.tabela_valores
  ADD COLUMN IF NOT EXISTS taxa_administrativa_cades NUMERIC(6,3)
    CHECK (taxa_administrativa_cades IS NULL OR (taxa_administrativa_cades >= 0 AND taxa_administrativa_cades <= 100));

-- Snapshot da taxa vigente no momento do lançamento — garante que editar a taxa depois
-- não altere retroativamente lançamentos já criados (cada um mantém a taxa do dia em que foi lançado).
ALTER TABLE public.lancamentos_plantoes
  ADD COLUMN IF NOT EXISTS taxa_administrativa_cades NUMERIC(6,3);
