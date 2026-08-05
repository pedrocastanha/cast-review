import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Cast Review API — orchestrator (NestJS)';
  }
}
