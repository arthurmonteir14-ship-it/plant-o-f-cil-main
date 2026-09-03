-- Cota parte é um desconto fixo (R$80) por cooperado ativo no período, mantido pela CADES
-- (não é cobrado do cliente). Essa função soma quantos cooperados distintos atenderam
-- cada cliente no período e estima a arrecadação de cota parte por cliente/projeto.
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
  GROUP BY lp.hospital_id, h.nome ORDER BY 4 DESC;
$function$;
