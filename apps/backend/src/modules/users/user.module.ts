import { Module } from '@nestjs/common';
import { RefreshSessionRepository } from '../auth/refresh-session.repository';
import { UserController } from './user.controller';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

@Module({
  controllers: [UserController],
  providers: [UserService, UserRepository, RefreshSessionRepository],
  exports: [UserService, RefreshSessionRepository],
})
export class UsersModule {}
