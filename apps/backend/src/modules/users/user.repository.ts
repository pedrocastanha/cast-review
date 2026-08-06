import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UserRepository extends DefaultRepository<User> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, User);
  }
}
