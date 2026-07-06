-- Extend cooperados with professional, banking and extra personal fields
ALTER TABLE public.cooperados
  ADD COLUMN IF NOT EXISTS data_nascimento DATE,
  ADD COLUMN IF NOT EXISTS registro_profissional TEXT,
  ADD COLUMN IF NOT EXISTS banco TEXT,
  ADD COLUMN IF NOT EXISTS agencia TEXT,
  ADD COLUMN IF NOT EXISTS conta TEXT,
  ADD COLUMN IF NOT EXISTS tipo_conta TEXT DEFAULT 'corrente',
  ADD COLUMN IF NOT EXISTS pix TEXT,
  ADD COLUMN IF NOT EXISTS observacoes TEXT;
