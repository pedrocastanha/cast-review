import 'dotenv/config';
import PostgresDataSource from './postgres.datasource';

export const postgresProviders = [
  {
    provide: 'DATA_SOURCE',
    useFactory: async () => {
      return PostgresDataSource.initialize();
    },
  },
];
