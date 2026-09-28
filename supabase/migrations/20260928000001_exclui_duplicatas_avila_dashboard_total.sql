-- Exclui as variacoes duplicadas de "Hospital De Avila" (usadas para RPA/relatorios,
-- nao representam faturamento real independente) do calculo agregado do Dashboard
-- (Total Faturado, Total Repassado, KPIs do topo), SOMENTE quando nenhum hospital
-- especifico esta filtrado. Se o usuario filtrar explicitamente por um desses
-- hospitais, o dado continua aparecendo normalmente.
--
-- Hospitais excluidos do agregado "Todos":
--   e53c8a8f-4347-4108-8ebb-2469222c5ba4  Hospital De Avila - Rpa
--   9d1d0f07-2e77-4bbe-8b35-91eaa939cd27  Rp Hospital De Avila
--   06083a0d-5cbb-4894-abf2-64262a43341d  Hospital de Avila - RPA Junho (Temporario)
--
-- dashboard_cota_parte_por_cliente TAMBEM exclui essas 3 variacoes (sempre,
-- sem excecao por filtro, ja que essa funcao nao recebe p_hospital_id) —
-- a pedido do usuario, pra nao aparecerem na tabela "Cota Parte por Projeto".
-- dashboard_por_cliente TAMBEM exclui essas 3 variacoes agora, ja que a tabela
-- "Cota Parte por Projeto" virou "Valor Faturado por Projeto" e passou a usar
-- essa funcao como fonte. O grafico de pizza "por Cliente" usa a mesma funcao
-- e passa a refletir a mesma exclusao.

CREATE OR REPLACE FUNCTION public.dashboard_kpi(p_inicio date, p_fim date)
 RETURNS TABLE(total_plantoes bigint, faturamento numeric, repasse numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(*), SUM(valor_cobrado_cliente), SUM(valor_repasse_cooperado)
  FROM lancamentos_plantoes
  WHERE data_plantao BETWEEN p_inicio AND p_fim
    AND hospital_id NOT IN (
      'e53c8a8f-4347-4108-8ebb-2469222c5ba4',
      '9d1d0f07-2e77-4bbe-8b35-91eaa939cd27',
      '06083a0d-5cbb-4894-abf2-64262a43341d'
    );
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_kpi(p_inicio date, p_fim date, p_hospital_id uuid DEFAULT NULL::uuid, p_setor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(total_plantoes bigint, faturamento numeric, repasse numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COUNT(*), SUM(valor_cobrado_cliente), SUM(valor_repasse_cooperado)
  FROM lancamentos_plantoes
  WHERE data_plantao BETWEEN p_inicio AND p_fim
    AND (p_hospital_id IS NULL OR hospital_id = p_hospital_id)
    AND (p_setor_id    IS NULL OR setor_id    = p_setor_id)
    AND (p_hospital_id IS NOT NULL OR hospital_id NOT IN (
      'e53c8a8f-4347-4108-8ebb-2469222c5ba4',
      '9d1d0f07-2e77-4bbe-8b35-91eaa939cd27',
      '06083a0d-5cbb-4894-abf2-64262a43341d'
    ));
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_mensal(p_inicio date, p_fim date, p_hospital_id uuid DEFAULT NULL::uuid, p_setor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(ano_mes text, faturamento numeric, repasse numeric, plantoes bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT to_char(data_plantao,'YYYY-MM'), SUM(valor_cobrado_cliente),
         SUM(valor_repasse_cooperado), COUNT(*)
  FROM lancamentos_plantoes
  WHERE data_plantao BETWEEN p_inicio AND p_fim
    AND (p_hospital_id IS NULL OR hospital_id = p_hospital_id)
    AND (p_setor_id IS NULL OR setor_id = p_setor_id)
    AND (p_hospital_id IS NOT NULL OR hospital_id NOT IN (
      'e53c8a8f-4347-4108-8ebb-2469222c5ba4',
      '9d1d0f07-2e77-4bbe-8b35-91eaa939cd27',
      '06083a0d-5cbb-4894-abf2-64262a43341d'
    ))
  GROUP BY 1 ORDER BY 1;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_cota_parte_por_cliente(p_inicio date, p_fim date, p_setor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(hospital_id uuid, nome text, cooperados bigint, cota_parte numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT lp.hospital_id, h.nome, COUNT(DISTINCT lp.cooperado_id), COUNT(DISTINCT lp.cooperado_id) * 80::numeric
  FROM lancamentos_plantoes lp
  JOIN hospitals h ON h.id = lp.hospital_id
  WHERE lp.data_plantao BETWEEN p_inicio AND p_fim
    AND (p_setor_id IS NULL OR lp.setor_id = p_setor_id)
    AND lp.hospital_id NOT IN (
      'e53c8a8f-4347-4108-8ebb-2469222c5ba4',
      '9d1d0f07-2e77-4bbe-8b35-91eaa939cd27',
      '06083a0d-5cbb-4894-abf2-64262a43341d'
    )
  GROUP BY lp.hospital_id, h.nome ORDER BY 4 DESC;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_por_cliente(p_inicio date, p_fim date, p_setor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(hospital_id uuid, nome text, faturamento numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT lp.hospital_id, h.nome, SUM(lp.valor_cobrado_cliente)
  FROM lancamentos_plantoes lp
  JOIN hospitals h ON h.id = lp.hospital_id
  WHERE lp.data_plantao BETWEEN p_inicio AND p_fim
    AND (p_setor_id IS NULL OR lp.setor_id = p_setor_id)
    AND lp.hospital_id NOT IN (
      'e53c8a8f-4347-4108-8ebb-2469222c5ba4',
      '9d1d0f07-2e77-4bbe-8b35-91eaa939cd27',
      '06083a0d-5cbb-4894-abf2-64262a43341d'
    )
  GROUP BY lp.hospital_id, h.nome ORDER BY 3 DESC;
$function$;
