-- Verificação de falha fechada. Deve rodar no CI e no deploy.
-- Qualquer linha retornada aqui é um bloqueio de release.
\set ON_ERROR_STOP on

-- 1. Nenhuma role da aplicação pode ignorar RLS.
SELECT rolname AS role_que_ignora_rls
FROM pg_roles
WHERE rolname IN ('cast_runtime', 'cast_migrator')
  AND (rolbypassrls OR rolsuper);

-- 2. A role de runtime não pode ser dona de nenhuma tabela (dono ignora RLS).
SELECT tablename AS tabela_pertencente_ao_runtime
FROM pg_tables
WHERE schemaname = 'public' AND tableowner = 'cast_runtime';

-- 3. Toda tabela de negócio precisa de RLS habilitada E forçada.
SELECT t.tablename AS tabela_sem_rls
FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
WHERE t.schemaname = 'public'
  AND t.tablename <> 'migrations'
  AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);

-- 4. Toda tabela com RLS precisa de ao menos uma policy.
SELECT c.relname AS tabela_sem_policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
WHERE c.relkind = 'r'
  AND c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);
