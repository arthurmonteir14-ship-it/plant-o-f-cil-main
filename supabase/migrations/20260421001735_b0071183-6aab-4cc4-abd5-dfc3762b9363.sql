
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin_master', 'coordenadora', 'administrativo', 'nac');
CREATE TYPE public.profissao_enum AS ENUM ('enfermeiro', 'tecnico_enfermagem', 'fonoaudiologo', 'assistente_social');
CREATE TYPE public.tipo_plantao_enum AS ENUM ('normal', 'extra', 'sobreaviso');
CREATE TYPE public.status_lancamento_enum AS ENUM ('lancado', 'aprovado', 'faturado', 'pago');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
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

CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admin manages roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin_master'))
  WITH CHECK (public.has_role(auth.uid(),'admin_master'));

-- ============ TIMESTAMP TRIGGER ============
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

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
  -- Primeiro usuário do sistema vira admin_master automaticamente
  IF (SELECT count(*) FROM public.user_roles) = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin_master');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ HOSPITALS ============
CREATE TABLE public.hospitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cnpj TEXT,
  endereco TEXT,
  cidade TEXT,
  estado TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_hospitals_updated BEFORE UPDATE ON public.hospitals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE POLICY "Authenticated read hospitals" ON public.hospitals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Financeiro manages hospitals" ON public.hospitals FOR ALL TO authenticated
  USING (public.has_any_financeiro_role(auth.uid()))
  WITH CHECK (public.has_any_financeiro_role(auth.uid()));

-- ============ SECTORS ============
CREATE TABLE public.sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_sectors_hospital ON public.sectors(hospital_id);

CREATE POLICY "Authenticated read sectors" ON public.sectors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Financeiro manages sectors" ON public.sectors FOR ALL TO authenticated
  USING (public.has_any_financeiro_role(auth.uid()))
  WITH CHECK (public.has_any_financeiro_role(auth.uid()));

-- ============ COOPERADOS ============
CREATE TABLE public.cooperados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cpf TEXT,
  profissao profissao_enum NOT NULL,
  telefone TEXT,
  email TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.cooperados ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_cooperados_updated BEFORE UPDATE ON public.cooperados
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE POLICY "Authenticated read cooperados" ON public.cooperados FOR SELECT TO authenticated USING (true);
CREATE POLICY "Financeiro manages cooperados" ON public.cooperados FOR ALL TO authenticated
  USING (public.has_any_financeiro_role(auth.uid()))
  WITH CHECK (public.has_any_financeiro_role(auth.uid()));

-- ============ TABELA VALORES ============
CREATE TABLE public.tabela_valores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profissao profissao_enum NOT NULL,
  tipo_plantao tipo_plantao_enum NOT NULL,
  hospital_id UUID REFERENCES public.hospitals(id) ON DELETE CASCADE,
  valor_hora_cliente NUMERIC(10,2) NOT NULL CHECK (valor_hora_cliente >= 0),
  percentual_repasse NUMERIC(5,2) NOT NULL DEFAULT 70 CHECK (percentual_repasse >= 0 AND percentual_repasse <= 100),
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tabela_valores ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX idx_tabela_valores_unique
  ON public.tabela_valores (profissao, tipo_plantao, COALESCE(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE ativo = true;
CREATE TRIGGER trg_tabela_valores_updated BEFORE UPDATE ON public.tabela_valores
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE POLICY "Financeiro reads valores" ON public.tabela_valores FOR SELECT TO authenticated
  USING (public.has_any_financeiro_role(auth.uid()));
CREATE POLICY "Admin/Adm manages valores" ON public.tabela_valores FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin_master') OR public.has_role(auth.uid(),'administrativo'))
  WITH CHECK (public.has_role(auth.uid(),'admin_master') OR public.has_role(auth.uid(),'administrativo'));

-- ============ LANCAMENTOS PLANTOES ============
CREATE TABLE public.lancamentos_plantoes (
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
CREATE INDEX idx_lanc_data ON public.lancamentos_plantoes(data_plantao DESC);
CREATE INDEX idx_lanc_hospital ON public.lancamentos_plantoes(hospital_id);
CREATE INDEX idx_lanc_cooperado ON public.lancamentos_plantoes(cooperado_id);
CREATE INDEX idx_lanc_status ON public.lancamentos_plantoes(status);
CREATE TRIGGER trg_lanc_updated BEFORE UPDATE ON public.lancamentos_plantoes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE POLICY "Financeiro reads lancamentos" ON public.lancamentos_plantoes FOR SELECT TO authenticated
  USING (public.has_any_financeiro_role(auth.uid()));
CREATE POLICY "Financeiro insere lancamentos" ON public.lancamentos_plantoes FOR INSERT TO authenticated
  WITH CHECK (public.has_any_financeiro_role(auth.uid()) AND lancado_por = auth.uid());
CREATE POLICY "Financeiro atualiza lancamentos" ON public.lancamentos_plantoes FOR UPDATE TO authenticated
  USING (public.has_any_financeiro_role(auth.uid()))
  WITH CHECK (public.has_any_financeiro_role(auth.uid()));
CREATE POLICY "Admin deleta lancamentos" ON public.lancamentos_plantoes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin_master'));

-- ============ SEED DATA ============
INSERT INTO public.hospitals (id, nome, cnpj, cidade, estado) VALUES
  ('11111111-1111-1111-1111-111111111111','Hospital São Lucas','12.345.678/0001-90','São Paulo','SP'),
  ('22222222-2222-2222-2222-222222222222','Hospital Santa Maria','98.765.432/0001-10','Rio de Janeiro','RJ'),
  ('33333333-3333-3333-3333-333333333333','Clínica Vida Plena','45.678.912/0001-55','Belo Horizonte','MG');

INSERT INTO public.sectors (hospital_id, nome) VALUES
  ('11111111-1111-1111-1111-111111111111','UTI Adulto'),
  ('11111111-1111-1111-1111-111111111111','UTI Neonatal'),
  ('11111111-1111-1111-1111-111111111111','Centro Cirúrgico'),
  ('22222222-2222-2222-2222-222222222222','Pronto Socorro'),
  ('22222222-2222-2222-2222-222222222222','Pediatria'),
  ('33333333-3333-3333-3333-333333333333','Atendimento Geral');

INSERT INTO public.cooperados (nome, cpf, profissao, email) VALUES
  ('Ana Paula Ribeiro','111.222.333-44','enfermeiro','ana.ribeiro@example.com'),
  ('Carlos Eduardo Lima','222.333.444-55','tecnico_enfermagem','carlos.lima@example.com'),
  ('Beatriz Souza Moura','333.444.555-66','fonoaudiologo','beatriz.moura@example.com'),
  ('Helena Martins Costa','444.555.666-77','enfermeiro','helena.costa@example.com'),
  ('Rafael Santos Pereira','555.666.777-88','assistente_social','rafael.santos@example.com');

INSERT INTO public.tabela_valores (profissao, tipo_plantao, valor_hora_cliente, percentual_repasse) VALUES
  ('enfermeiro','normal',50.00,70),
  ('enfermeiro','extra',65.00,70),
  ('enfermeiro','sobreaviso',25.00,70),
  ('tecnico_enfermagem','normal',35.00,70),
  ('tecnico_enfermagem','extra',45.00,70),
  ('tecnico_enfermagem','sobreaviso',18.00,70),
  ('fonoaudiologo','normal',60.00,70),
  ('fonoaudiologo','extra',75.00,70),
  ('assistente_social','normal',45.00,70),
  ('assistente_social','extra',58.00,70);
