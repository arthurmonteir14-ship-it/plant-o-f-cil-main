-- Desconto de Uniforme: valor total dividido em parcelas, cobrado automaticamente do cooperado
-- escolhido no RPA de Fechamento, mês a mês, a partir da competência de início cadastrada.
CREATE TABLE IF NOT EXISTS public.descontos_uniforme (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cooperado_id UUID NOT NULL REFERENCES public.cooperados(id) ON DELETE CASCADE,
  valor_total NUMERIC(10,2) NOT NULL CHECK (valor_total > 0),
  parcelas INTEGER NOT NULL CHECK (parcelas > 0),
  valor_parcela NUMERIC(10,2) NOT NULL CHECK (valor_parcela > 0),
  competencia_inicio TEXT NOT NULL, -- formato 'YYYY-MM', mês da 1ª parcela
  observacao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.descontos_uniforme ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='descontos_uniforme' AND policyname='Financeiro reads descontos_uniforme') THEN
    CREATE POLICY "Financeiro reads descontos_uniforme" ON public.descontos_uniforme FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role IN ('admin_master','coordenadora','administrativo')
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='descontos_uniforme' AND policyname='Admin/Adm manages descontos_uniforme') THEN
    CREATE POLICY "Admin/Adm manages descontos_uniforme" ON public.descontos_uniforme FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role IN ('admin_master','administrativo')
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role IN ('admin_master','administrativo')
        )
      );
  END IF;
END $$;
