-- Adiciona o valor 'diarista' ao enum tipo_plantao_enum
ALTER TYPE public.tipo_plantao_enum ADD VALUE IF NOT EXISTS 'diarista';
