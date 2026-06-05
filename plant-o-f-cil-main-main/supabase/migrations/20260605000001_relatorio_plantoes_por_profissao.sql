CREATE OR REPLACE FUNCTION relatorio_plantoes_por_profissao(
  p_inicio date,
  p_fim date,
  p_hospital_id uuid DEFAULT NULL,
  p_setor_id uuid DEFAULT NULL
)
RETURNS TABLE(profissao text, qtd bigint, faturamento numeric, repasse numeric)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    profissao::text,
    COUNT(*)::bigint AS qtd,
    COALESCE(SUM(valor_cobrado_cliente), 0) AS faturamento,
    COALESCE(SUM(valor_repasse_cooperado), 0) AS repasse
  FROM lancamentos_plantoes
  WHERE data_plantao BETWEEN p_inicio AND p_fim
    AND (p_hospital_id IS NULL OR hospital_id = p_hospital_id)
    AND (p_setor_id IS NULL OR setor_id = p_setor_id)
  GROUP BY profissao
  ORDER BY SUM(valor_cobrado_cliente) DESC;
$$;
