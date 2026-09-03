-- Indica se o cliente retém o ISS na fonte, usado no Extrato Financeiro
ALTER TABLE public.hospitals
  ADD COLUMN IF NOT EXISTS retem_iss BOOLEAN NOT NULL DEFAULT false;
