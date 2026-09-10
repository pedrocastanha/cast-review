import { Global, Module } from '@nestjs/common';
import { postgresProviders } from './postgres.provider';
import { RlsTransaction } from './rls.transaction';

@Global()
@Module({
  providers: [...postgresProviders, RlsTransaction],
  exports: [...postgresProviders, RlsTransaction],
})
export class PostgresModule {}
