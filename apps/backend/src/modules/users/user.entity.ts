import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity } from 'typeorm';

@Entity({
  name: 'users',
  orderBy: {
    createdAt: 'ASC',
  },
})
export class User extends DefaultEntity<User> {
  @Column({ 'name': 'name', nullable: false, type: 'varchar'})
  @IsNotEmpty()
  @IsString()
  name: string

  @Column()
  @IsNotEmpty()
  email: string

  @Column()
  @IsOptional()
  username: string

  @Column()
  @IsNotEmpty()
  password: string
}
