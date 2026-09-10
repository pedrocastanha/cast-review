import 'dotenv/config';
import { isProduction } from '../../security/production-config';
import PostgresDataSource from './postgres.datasource';
import { validateRuntimeDatabaseRole } from './runtime-role';

export const postgresProviders = [
  {
    provide: 'DATA_SOURCE',
    useFactory: async () => {
      const datasource = await PostgresDataSource.initialize();
      if (isProduction()) {
        try {
          await validateRuntimeDatabaseRole(datasource);
        } catch (error) {
          await datasource.destroy();
          throw error;
        }
      }
      return datasource;
    },
  },
];
