import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AnalysesModule } from './modules/analyses/analyses.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAccessGuard } from './modules/auth/guards/jwt-access.guard';
import { RepositoriesModule } from './modules/repositories/repositories.module';
import { UsersModule } from './modules/users/user.module';
import { PostgresModule } from './shared/database/postgres/postgres.module';
import { LoggerModule } from './shared/logger/logger.module';
import { resolveRedisConnection } from './shared/queue/redis-connection';

@Module({
  imports: [
    LoggerModule,
    PostgresModule,
    BullModule.forRoot({ connection: resolveRedisConnection() }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100, // default global; auth aperta com @Throttle próprio
      },
    ]),
    AuthModule,
    UsersModule,
    RepositoriesModule,
    AnalysesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAccessGuard,
    },
  ],
})
export class AppModule {}
