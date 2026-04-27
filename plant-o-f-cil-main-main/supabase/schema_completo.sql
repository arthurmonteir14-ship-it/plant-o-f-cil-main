-- ================================================================
-- CADES FINANCEIRO — Schema Completo
-- Cole e execute no SQL Editor do Supabase (New query → Run)
-- ================================================================

-- ============ ENUMS ============
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin_master', 'coordenadora', 'administrativo', 'nac');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.profissao_enum AS ENUM ('enfermeiro', 'tecnico_enfermagem', 'fonoaudiologo', 'assistente_social');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.tipo_plantao_enum AS ENUM ('normal', 'extra', 'sobreaviso');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.status_lancamento_enum AS ENUM ('lancado', 'aprovado', 'faturado', 'pago');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ TIMESTAMP TRIGGER FUNCTION ============
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ============ PROFILES ============
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='Users can view own profile') THEN
    CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='Users can update own profile') THEN
    CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='profiles' AND policyname='Users can insert own profile') THEN
    CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
  END IF;
END $$;

-- ============ USER ROLES ============
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_any_financeiro_role(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin_master','coordenadora','administrativo')
  )
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_roles' AND policyname='Users can view own roles') THEN
    CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='user_roles' AND policyname='Admin manages roles') THEN
    CREATE POLICY "Admin manages roles" ON public.user_roles FOR ALL TO authenticated
      USING (public.has_role(auth.uid(),'admin_master'))
      WITH CHECK (public.has_role(auth.uid(),'admin_master'));
  END IF;
END $$;

-- ============ HANDLE NEW USER ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'nome', split_part(NEW.email,'@',1)),
    NEW.email
  );
  IF (SELECT count(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin_master');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ HOSPITALS / CLIENTES ============
CREATE TABLE IF NOT EXISTS public.hospitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  nome_fantasia TEXT,
  cnpj TEXT,
  tipo TEXT DEFAULT 'hospital',
  endereco TEXT,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  cidade TEXT,
  estado TEXT,
  cep TEXT,
  responsavel TEXT,
  telefone TEXT,
  email TEXT,
  dia_vencimento INTEGER,
  forma_pagamento TEXT DEFAULT 'boleto',
  observacoes_financeiras TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_hospitals_updated ON public.hospitals;
CREATE TRIGGER trg_hospitals_updated BEFORE UPDATE ON public.hospitals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='hospitals' AND policyname='Authenticated read hospitals') THEN
    CREATE POLICY "Authenticated read hospitals" ON public.hospitals FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='hospitals' AND policyname='Financeiro manages hospitals') THEN
    CREATE POLICY "Financeiro manages hospitals" ON public.hospitals FOR ALL TO authenticated
      USING (public.has_any_financeiro_role(auth.uid()))
      WITH CHECK (public.has_any_financeiro_role(auth.uid()));
  END IF;
END $$;

-- ============ SECTORS ============
CREATE TABLE IF NOT EXISTS public.sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_sectors_hospital ON public.sectors(hospital_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sectors' AND policyname='Authenticated read sectors') THEN
    CREATE POLICY "Authenticated read sectors" ON public.sectors FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sectors' AND policyname='Financeiro manages sectors') THEN
    CREATE POLICY "Financeiro manages sectors" ON public.sectors FOR ALL TO authenticated
      USING (public.has_any_financeiro_role(auth.uid()))
      WITH CHECK (public.has_any_financeiro_role(auth.uid()));
  END IF;
END $$;

-- ============ COOPERADOS ============
CREATE TABLE IF NOT EXISTS public.cooperados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cpf TEXT,
  data_nascimento DATE,
  profissao profissao_enum NOT NULL,
  registro_profissional TEXT,
  telefone TEXT,
  email TEXT,
  banco TEXT,
  agencia TEXT,
  conta TEXT,
  tipo_conta TEXT DEFAULT 'corrente',
  pix TEXT,
  observacoes TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cooperados ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_cooperados_updated ON public.cooperados;
CREATE TRIGGER trg_cooperados_updated BEFORE UPDATE ON public.cooperados
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cooperados' AND policyname='Authenticated read cooperados') THEN
    CREATE POLICY "Authenticated read cooperados" ON public.cooperados FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cooperados' AND policyname='Financeiro manages cooperados') THEN
    CREATE POLICY "Financeiro manages cooperados" ON public.cooperados FOR ALL TO authenticated
      USING (public.has_any_financeiro_role(auth.uid()))
      WITH CHECK (public.has_any_financeiro_role(auth.uid()));
  END IF;
END $$;

-- ============ TABELA VALORES ============
CREATE TABLE IF NOT EXISTS public.tabela_valores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profissao profissao_enum NOT NULL,
  tipo_plantao tipo_plantao_enum NOT NULL,
  hospital_id UUID REFERENCES public.hospitals(id) ON DELETE CASCADE,
  valor_hora_cliente NUMERIC(10,2) NOT NULL CHECK (valor_hora_cliente >= 0),
  percentual_repasse NUMERIC(5,2) NOT NULL DEFAULT 70 CHECK (percentual_repasse >= 0 AND percentual_repasse <= 100),
  valor_hora_cooperado NUMERIC(10,2),
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tabela_valores ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_tabela_valores_updated ON public.tabela_valores;
CREATE TRIGGER trg_tabela_valores_updated BEFORE UPDATE ON public.tabela_valores
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tabela_valores' AND policyname='Financeiro reads valores') THEN
    CREATE POLICY "Financeiro reads valores" ON public.tabela_valores FOR SELECT TO authenticated
      USING (public.has_any_financeiro_role(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tabela_valores' AND policyname='Admin/Adm manages valores') THEN
    CREATE POLICY "Admin/Adm manages valores" ON public.tabela_valores FOR ALL TO authenticated
      USING (public.has_role(auth.uid(),'admin_master') OR public.has_role(auth.uid(),'administrativo'))
      WITH CHECK (public.has_role(auth.uid(),'admin_master') OR public.has_role(auth.uid(),'administrativo'));
  END IF;
END $$;

-- ============ LANCAMENTOS PLANTOES ============
CREATE TABLE IF NOT EXISTS public.lancamentos_plantoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cooperado_id UUID NOT NULL REFERENCES public.cooperados(id),
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id),
  setor_id UUID NOT NULL REFERENCES public.sectors(id),
  data_plantao DATE NOT NULL,
  horario_inicio TIME NOT NULL,
  horario_fim TIME NOT NULL,
  total_horas NUMERIC(5,2) NOT NULL,
  profissao profissao_enum NOT NULL,
  tipo_plantao tipo_plantao_enum NOT NULL DEFAULT 'normal',
  valor_hora_cliente NUMERIC(10,2) NOT NULL,
  valor_cobrado_cliente NUMERIC(12,2) NOT NULL,
  percentual_repasse NUMERIC(5,2) NOT NULL,
  valor_repasse_cooperado NUMERIC(12,2) NOT NULL,
  status status_lancamento_enum NOT NULL DEFAULT 'lancado',
  observacao TEXT,
  lancado_por UUID REFERENCES auth.users(id),
  aprovado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.lancamentos_plantoes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_lanc_data ON public.lancamentos_plantoes(data_plantao DESC);
CREATE INDEX IF NOT EXISTS idx_lanc_hospital ON public.lancamentos_plantoes(hospital_id);
CREATE INDEX IF NOT EXISTS idx_lanc_cooperado ON public.lancamentos_plantoes(cooperado_id);
CREATE INDEX IF NOT EXISTS idx_lanc_status ON public.lancamentos_plantoes(status);

DROP TRIGGER IF EXISTS trg_lanc_updated ON public.lancamentos_plantoes;
CREATE TRIGGER trg_lanc_updated BEFORE UPDATE ON public.lancamentos_plantoes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lancamentos_plantoes' AND policyname='Financeiro reads lancamentos') THEN
    CREATE POLICY "Financeiro reads lancamentos" ON public.lancamentos_plantoes FOR SELECT TO authenticated
      USING (public.has_any_financeiro_role(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lancamentos_plantoes' AND policyname='Financeiro insere lancamentos') THEN
    CREATE POLICY "Financeiro insere lancamentos" ON public.lancamentos_plantoes FOR INSERT TO authenticated
      WITH CHECK (public.has_any_financeiro_role(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lancamentos_plantoes' AND policyname='Financeiro atualiza lancamentos') THEN
    CREATE POLICY "Financeiro atualiza lancamentos" ON public.lancamentos_plantoes FOR UPDATE TO authenticated
      USING (public.has_any_financeiro_role(auth.uid()))
      WITH CHECK (public.has_any_financeiro_role(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='lancamentos_plantoes' AND policyname='Admin deleta lancamentos') THEN
    CREATE POLICY "Admin deleta lancamentos" ON public.lancamentos_plantoes FOR DELETE TO authenticated
      USING (public.has_role(auth.uid(),'admin_master'));
  END IF;
END $$;

-- ============ SEED DATA (dados de exemplo) ============
INSERT INTO public.hospitals (id, nome, cidade, estado, tipo) VALUES
  ('11111111-1111-1111-1111-111111111111','Hospital São Lucas','São Paulo','SP','hospital'),
  ('22222222-2222-2222-2222-222222222222','Hospital Santa Maria','Rio de Janeiro','RJ','hospital'),
  ('33333333-3333-3333-3333-333333333333','Clínica Vida Plena','Belo Horizonte','MG','clinica')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sectors (hospital_id, nome) VALUES
  ('11111111-1111-1111-1111-111111111111','UTI Adulto'),
  ('11111111-1111-1111-1111-111111111111','UTI Neonatal'),
  ('11111111-1111-1111-1111-111111111111','Centro Cirúrgico'),
  ('22222222-2222-2222-2222-222222222222','Pronto Socorro'),
  ('22222222-2222-2222-2222-222222222222','Pediatria'),
  ('33333333-3333-3333-3333-333333333333','Atendimento Geral')
ON CONFLICT DO NOTHING;

INSERT INTO public.cooperados (nome, profissao, email) VALUES
  ('Ana Paula Ribeiro','enfermeiro','ana.ribeiro@example.com'),
  ('Carlos Eduardo Lima','tecnico_enfermagem','carlos.lima@example.com'),
  ('Beatriz Souza Moura','fonoaudiologo','beatriz.moura@example.com'),
  ('Helena Martins Costa','enfermeiro','helena.costa@example.com'),
  ('Rafael Santos Pereira','assistente_social','rafael.santos@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO public.tabela_valores (profissao, tipo_plantao, valor_hora_cliente, percentual_repasse, valor_hora_cooperado) VALUES
  ('enfermeiro','normal',50.00,70,35.00),
  ('enfermeiro','extra',65.00,70,45.50),
  ('tecnico_enfermagem','normal',35.00,70,24.50),
  ('tecnico_enfermagem','extra',45.00,70,31.50),
  ('fonoaudiologo','normal',60.00,70,42.00),
  ('fonoaudiologo','extra',75.00,70,52.50),
  ('assistente_social','normal',45.00,70,31.50),
  ('assistente_social','extra',58.00,70,40.60)
ON CONFLICT DO NOTHING;
