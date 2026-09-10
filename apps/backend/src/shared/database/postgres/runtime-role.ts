import type { DataSource } from 'typeorm';

interface RuntimeRoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  public_create: boolean;
  app_create: boolean;
  owns_table: boolean;
}

export async function validateRuntimeDatabaseRole(
  datasource: Pick<DataSource, 'query'>,
): Promise<void> {
  const rows = (await datasource.query(`
    SELECT
      current_user AS rolname,
      r.rolsuper,
      r.rolbypassrls,
      r.rolcreatedb,
      r.rolcreaterole,
      has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
      has_schema_privilege(current_user, 'app', 'CREATE') AS app_create,
      EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relowner = r.oid
          AND c.relkind IN ('r', 'p')
          AND n.nspname = 'public'
          AND c.relname <> 'migrations'
      ) AS owns_table
    FROM pg_roles r
    WHERE r.rolname = current_user
  `)) as RuntimeRoleRow[];

  const role = rows[0];
  if (!role) throw new Error('Não foi possível validar a role PostgreSQL');

  const unsafe =
    role.rolsuper ||
    role.rolbypassrls ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.public_create ||
    role.app_create ||
    role.owns_table;

  if (unsafe) {
    throw new Error(
      `Role PostgreSQL de runtime insegura: ${role.rolname} precisa ser NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, não ser dona de tabelas e não ter CREATE nos schemas`,
    );
  }
}
