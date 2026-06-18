-- Add admission date, education level and birth municipality to cooperados
ALTER TABLE public.cooperados
  ADD COLUMN IF NOT EXISTS data_adesao DATE,
  ADD COLUMN IF NOT EXISTS escolaridade TEXT,
  ADD COLUMN IF NOT EXISTS municipio_nascimento TEXT;
