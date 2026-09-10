-- Verificação de falha fechada. Deve rodar no CI e no deploy.
-- Qualquer linha retornada aqui é um bloqueio de release.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cast_runtime')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cast_migrator') THEN
    RAISE EXCEPTION 'cast_runtime and cast_migrator roles are required';
  END IF;
END
$$;

-- 1. Nenhuma role da aplicação pode ignorar RLS.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN ('cast_runtime', 'cast_migrator')
      AND (rolbypassrls OR rolsuper)
  ) THEN
    RAISE EXCEPTION 'runtime/migration role can bypass RLS';
  END IF;
END
$$;

-- 2. A role de runtime não pode ser dona de nenhuma tabela (dono ignora RLS).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tableowner = 'cast_runtime'
  ) THEN
    RAISE EXCEPTION 'runtime role owns a table';
  END IF;
END
$$;

-- 3. Toda tabela de negócio precisa de RLS habilitada E forçada.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
    WHERE t.schemaname = 'public'
      AND t.tablename <> 'migrations'
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'business table without forced RLS';
  END IF;
END
$$;

-- 4. Toda tabela com RLS precisa de ao menos uma policy.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r'
      AND c.relrowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
  ) THEN
    RAISE EXCEPTION 'RLS table without policy';
  END IF;
END
$$;
