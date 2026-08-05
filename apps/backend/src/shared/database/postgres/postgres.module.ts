import { Global, Module } from '@nestjs/common'
import { postgresProviders } from './postgres.provider'

@Global()
@Module({
  providers: [...postgresProviders],
  exports: [...postgresProviders]
})
export class PostgresModule {}
