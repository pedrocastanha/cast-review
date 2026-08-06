import { Injectable } from '@nestjs/common';
import { User } from './user.entity';
import { UserRepository } from './user.repository';
import { CreateUserDto } from './dtos/create-user.dto';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';

@Injectable()
export class UserService extends BaseService {
    constructor(
        private readonly userRepository: UserRepository,
        logger: AppLogger
    ) {
        super(logger)
    }
    
    async createUser(dto: CreateUserDto): Promise<User> {
      return await this.safeExecute(async () => {
      
      const user = this.userRepository.create(dto)
      await this.userRepository.save(user)

      return user
    })
    }

    async getById(id: string): Promise<User | null> {
        return this.userRepository.findOne({ where: { id } });
    }
}