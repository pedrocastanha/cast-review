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

CREATE ROLE cast_migrator LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- NOBYPASSRLS é obrigatório e NÃO é suficiente: o dono da tabela ignora RLS por
-- padrão. É por isso que cast_runtime nunca pode ser dono, e por isso a
-- migration usa FORCE ROW LEVEL SECURITY.
CREATE ROLE cast_runtime LOGIN PASSWORD :'runtime_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

ALTER DATABASE :"DBNAME" OWNER TO cast_migrator;
ALTER SCHEMA public OWNER TO cast_migrator;

-- As tabelas existentes pertencem à role original do bootstrap.
REASSIGN OWNED BY CURRENT_USER TO cast_migrator;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cast_runtime;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION cast_migrator;
GRANT USAGE ON SCHEMA app TO cast_runtime;
