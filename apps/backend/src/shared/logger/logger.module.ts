import { Global, Module } from '@nestjs/common';
import { AppLogger } from './logger.service';
import { LoggingInterceptor } from './logging.interceptor';

@Global()
@Module({
  providers: [AppLogger, LoggingInterceptor],
  exports: [AppLogger, LoggingInterceptor],
})
export class LoggerModule {}
