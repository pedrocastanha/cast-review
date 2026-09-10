import { validateRuntimeDatabaseRole } from './runtime-role';

describe('runtime PostgreSQL role validation', () => {
  it('accepts a role without bypass or DDL privileges', async () => {
    const datasource = {
      query: jest.fn().mockResolvedValue([
        {
          rolname: 'cast_runtime',
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
          public_create: false,
          app_create: false,
          owns_table: false,
        },
      ]),
    };

    await expect(
      validateRuntimeDatabaseRole(datasource),
    ).resolves.toBeUndefined();
  });

  it.each([
    'rolsuper',
    'rolbypassrls',
    'rolcreatedb',
    'rolcreaterole',
    'public_create',
    'app_create',
    'owns_table',
  ])('rejects a role with %s', async (privilege) => {
    const datasource = {
      query: jest.fn().mockResolvedValue([
        {
          rolname: 'cast_runtime',
          rolsuper: false,
          rolbypassrls: false,
          rolcreatedb: false,
          rolcreaterole: false,
          public_create: false,
          app_create: false,
          owns_table: false,
          [privilege]: true,
        },
      ]),
    };

    await expect(validateRuntimeDatabaseRole(datasource)).rejects.toThrow(
      /Role PostgreSQL de runtime insegura/,
    );
  });
});
