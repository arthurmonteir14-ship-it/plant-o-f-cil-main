-- Adiciona o valor 'visita' ao enum tipo_plantao_enum.
-- Plantão do tipo "Visita": não é calculado por hora — o valor cadastrado na
-- Tabela de Valores é o valor integral da visita, lançado direto ao cooperado.
ALTER TYPE public.tipo_plantao_enum ADD VALUE IF NOT EXISTS 'visita';
