import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AnalysesModule } from './modules/analyses/analyses.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAccessGuard } from './modules/auth/guards/jwt-access.guard';
import { BenchmarksModule } from './modules/benchmarks/benchmarks.module';
import { ChatModule } from './modules/chat/chat.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RepositoriesModule } from './modules/repositories/repositories.module';
import { UsersModule } from './modules/users/user.module';
import { PostgresModule } from './shared/database/postgres/postgres.module';
import { LoggerModule } from './shared/logger/logger.module';
import { LoggingInterceptor } from './shared/logger/logging.interceptor';
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
    BenchmarksModule,
    ProjectsModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAccessGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
