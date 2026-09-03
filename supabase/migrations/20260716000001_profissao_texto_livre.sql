-- Converte "profissao" de enum fixo (profissao_enum) para texto livre nas 3 tabelas que o usam,
-- permitindo cadastrar novas profissões diretamente pela interface (Cadastro de Cooperado e
-- Tabela de Valores), sem precisar de uma migration a cada nova profissão adicionada.
-- O tipo profissao_enum é mantido (sem nenhuma coluna usando-o) para não quebrar nada externo
-- ao repositório que porventura dependa dele.
ALTER TABLE public.cooperados          ALTER COLUMN profissao TYPE TEXT USING profissao::TEXT;
ALTER TABLE public.tabela_valores       ALTER COLUMN profissao TYPE TEXT USING profissao::TEXT;
ALTER TABLE public.lancamentos_plantoes ALTER COLUMN profissao TYPE TEXT USING profissao::TEXT;
