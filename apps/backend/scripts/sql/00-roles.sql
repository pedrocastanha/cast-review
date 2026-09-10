-- Roles de runtime e migration para RLS (SEC-15).
--
-- Executar UMA VEZ por banco, com um superusuário, ANTES da migration
-- EnableRowLevelSecurity. Não vai no TypeORM porque exige privilégio que a role
-- de migration não tem — e não deve ter.
--
--   psql -v migrator_password=... -v runtime_password=... -f 00-roles.sql
--
-- Depois: MIGRATION_DATABASE_URL aponta para cast_migrator, DB_USER para
-- cast_runtime. Nunca o contrário, e nunca o mesmo.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cast_migrator') THEN
    CREATE ROLE cast_migrator;
  END IF;
END
$$;

ALTER ROLE cast_migrator LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- NOBYPASSRLS é obrigatório e NÃO é suficiente: o dono da tabela ignora RLS por
-- padrão. É por isso que cast_runtime nunca pode ser dono, e por isso a
-- migration usa FORCE ROW LEVEL SECURITY.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cast_runtime') THEN
    CREATE ROLE cast_runtime;
  END IF;
END
$$;

ALTER ROLE cast_runtime LOGIN PASSWORD :'runtime_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

SELECT format('ALTER DATABASE %I OWNER TO cast_migrator', current_database())
\gexec
ALTER SCHEMA public OWNER TO cast_migrator;

-- As tabelas existentes pertencem à role original do bootstrap.
SELECT format(
  'ALTER %s %I.%I OWNER TO cast_migrator',
  CASE c.relkind
    WHEN 'r' THEN 'TABLE'
    WHEN 'p' THEN 'TABLE'
    WHEN 'S' THEN 'SEQUENCE'
    WHEN 'v' THEN 'VIEW'
    WHEN 'm' THEN 'MATERIALIZED VIEW'
    WHEN 'f' THEN 'FOREIGN TABLE'
  END,
  n.nspname,
  c.relname
)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
  AND n.nspname IN ('public', 'app')
  AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
\gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cast_runtime;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION cast_migrator;
GRANT USAGE ON SCHEMA app TO cast_runtime;
