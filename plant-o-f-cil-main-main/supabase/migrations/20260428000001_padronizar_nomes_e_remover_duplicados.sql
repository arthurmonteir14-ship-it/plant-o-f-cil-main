-- ================================================================
-- CADES: Padronização de nomes e remoção de duplicados
-- Executa no SQL Editor do Supabase: New query → Run
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- STEP 1 — Normaliza todos os nomes para Title Case (initcap)
-- ────────────────────────────────────────────────────────────────
UPDATE public.cooperados SET nome = initcap(trim(nome)) WHERE nome IS DISTINCT FROM initcap(trim(nome));
UPDATE public.hospitals   SET nome = initcap(trim(nome)) WHERE nome IS DISTINCT FROM initcap(trim(nome));
UPDATE public.sectors     SET nome = initcap(trim(nome)) WHERE nome IS DISTINCT FROM initcap(trim(nome));

-- ────────────────────────────────────────────────────────────────
-- STEP 2 — Consolida cooperados duplicados
--   Master = quem tem mais lançamentos; empate → mais antigo (created_at)
-- ────────────────────────────────────────────────────────────────

-- 2a. Reatribui lançamentos dos duplicados ao master
WITH lanc_counts AS (
  SELECT cooperado_id, count(*) AS cnt
  FROM public.lancamentos_plantoes
  GROUP BY cooperado_id
),
ranked AS (
  SELECT
    c.id,
    lower(trim(c.nome)) AS nome_norm,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(c.nome))
      ORDER BY COALESCE(lc.cnt, 0) DESC, c.created_at ASC
    ) AS rn
  FROM public.cooperados c
  LEFT JOIN lanc_counts lc ON lc.cooperado_id = c.id
),
masters AS (SELECT nome_norm, id AS master_id FROM ranked WHERE rn = 1),
dups    AS (
  SELECT r.id AS dup_id, m.master_id
  FROM ranked r
  JOIN masters m ON m.nome_norm = r.nome_norm
  WHERE r.rn > 1
)
UPDATE public.lancamentos_plantoes lp
SET cooperado_id = d.master_id
FROM dups d
WHERE lp.cooperado_id = d.dup_id;

-- 2b. Exclui cooperados duplicados (somente os não-master)
WITH lanc_counts AS (
  SELECT cooperado_id, count(*) AS cnt
  FROM public.lancamentos_plantoes
  GROUP BY cooperado_id
),
ranked AS (
  SELECT
    c.id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(c.nome))
      ORDER BY COALESCE(lc.cnt, 0) DESC, c.created_at ASC
    ) AS rn
  FROM public.cooperados c
  LEFT JOIN lanc_counts lc ON lc.cooperado_id = c.id
)
DELETE FROM public.cooperados WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ────────────────────────────────────────────────────────────────
-- STEP 3 — Consolida hospitals duplicados
-- ────────────────────────────────────────────────────────────────

-- 3a. Reatribui sectors ao hospital master
WITH ranked AS (
  SELECT id,
    lower(trim(nome)) AS nome_norm,
    ROW_NUMBER() OVER (PARTITION BY lower(trim(nome)) ORDER BY created_at ASC) AS rn
  FROM public.hospitals
),
masters AS (SELECT nome_norm, id AS master_id FROM ranked WHERE rn = 1),
dups    AS (SELECT r.id AS dup_id, m.master_id FROM ranked r JOIN masters m ON m.nome_norm = r.nome_norm WHERE r.rn > 1)
UPDATE public.sectors s SET hospital_id = d.master_id FROM dups d WHERE s.hospital_id = d.dup_id;

-- 3b. Reatribui lancamentos ao hospital master
WITH ranked AS (
  SELECT id,
    lower(trim(nome)) AS nome_norm,
    ROW_NUMBER() OVER (PARTITION BY lower(trim(nome)) ORDER BY created_at ASC) AS rn
  FROM public.hospitals
),
masters AS (SELECT nome_norm, id AS master_id FROM ranked WHERE rn = 1),
dups    AS (SELECT r.id AS dup_id, m.master_id FROM ranked r JOIN masters m ON m.nome_norm = r.nome_norm WHERE r.rn > 1)
UPDATE public.lancamentos_plantoes lp SET hospital_id = d.master_id FROM dups d WHERE lp.hospital_id = d.dup_id;

-- 3c. Reatribui tabela_valores ao hospital master
WITH ranked AS (
  SELECT id,
    lower(trim(nome)) AS nome_norm,
    ROW_NUMBER() OVER (PARTITION BY lower(trim(nome)) ORDER BY created_at ASC) AS rn
  FROM public.hospitals
),
masters AS (SELECT nome_norm, id AS master_id FROM ranked WHERE rn = 1),
dups    AS (SELECT r.id AS dup_id, m.master_id FROM ranked r JOIN masters m ON m.nome_norm = r.nome_norm WHERE r.rn > 1)
UPDATE public.tabela_valores tv SET hospital_id = d.master_id FROM dups d WHERE tv.hospital_id = d.dup_id;

-- 3d. Exclui hospitals duplicados
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY lower(trim(nome)) ORDER BY created_at ASC) AS rn
  FROM public.hospitals
)
DELETE FROM public.hospitals WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ────────────────────────────────────────────────────────────────
-- STEP 4 — Consolida sectors duplicados dentro do mesmo hospital
-- ────────────────────────────────────────────────────────────────

-- 4a. Reatribui lancamentos ao sector master
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY hospital_id, lower(trim(nome)) ORDER BY created_at ASC) AS rn
  FROM public.sectors
),
masters AS (
  SELECT s.hospital_id, lower(trim(s.nome)) AS nome_norm, s.id AS master_id
  FROM public.sectors s JOIN ranked r ON r.id = s.id WHERE r.rn = 1
),
dups AS (
  SELECT r.id AS dup_id, m.master_id
  FROM ranked r
  JOIN public.sectors s ON s.id = r.id
  JOIN masters m ON m.hospital_id = s.hospital_id AND m.nome_norm = lower(trim(s.nome))
  WHERE r.rn > 1
)
UPDATE public.lancamentos_plantoes lp SET setor_id = d.master_id FROM dups d WHERE lp.setor_id = d.dup_id;

-- 4b. Exclui sectors duplicados
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY hospital_id, lower(trim(nome)) ORDER BY created_at ASC) AS rn
  FROM public.sectors
)
DELETE FROM public.sectors WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO FINAL (resultados esperados: 0 duplicados)
-- ────────────────────────────────────────────────────────────────
SELECT 'cooperados_duplicados' AS tabela, count(*) AS qtd
FROM (SELECT lower(trim(nome)) FROM public.cooperados GROUP BY 1 HAVING count(*) > 1) x
UNION ALL
SELECT 'hospitals_duplicados', count(*)
FROM (SELECT lower(trim(nome)) FROM public.hospitals GROUP BY 1 HAVING count(*) > 1) x
UNION ALL
SELECT 'sectors_duplicados', count(*)
FROM (SELECT hospital_id, lower(trim(nome)) FROM public.sectors GROUP BY 1,2 HAVING count(*) > 1) x;
