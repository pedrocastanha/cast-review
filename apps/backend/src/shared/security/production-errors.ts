import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException } from '@nestjs/common';

@Catch()
export class ProductionErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (response.headersSent) {
      response.end();
      return;
    }
    const status = error instanceof HttpException ? error.getStatus() : 500;
    response
      .status(status)
      .json(
        status >= 500
          ? { statusCode: status, message: 'Serviço indisponível' }
          : (error as HttpException).getResponse(),
      );
  }
}
