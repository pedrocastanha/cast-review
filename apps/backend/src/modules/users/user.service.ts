import { Injectable } from '@nestjs/common';
import { User } from './user.entity';
import { UserRepository } from './user.repository';

@Injectable()
export class UserService {
    constructor(
        private readonly userRepository: UserRepository
    ) {}
    async createUser(user: User): Promise<User> {
        return this.userRepository.save(user);
    }

    async getById(id: string): Promise<User | null> {
        return this.userRepository.findOne({ where: { id } });
    }
}