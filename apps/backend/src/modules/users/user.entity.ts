import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { encryptedColumn } from 'src/shared/crypto/secret-crypto';
import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';

@Entity({
  name: 'users',
  orderBy: {
    createdAt: 'ASC',
  },
})
export class User extends DefaultEntity<User> {
  @Column({ name: 'name', nullable: false, type: 'varchar' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @Index({ unique: true })
  @Column()
  @IsNotEmpty()
  email: string;

  @Index({ unique: true })
  @Column()
  @IsOptional()
  username: string;

  @Column({ select: false })
  @IsNotEmpty()
  password: string;

  @Column({
    name: 'current_refresh_token',
    type: 'varchar',
    nullable: true,
    select: false,
  })
  currentRefreshToken: string | null;

  @Column({
    name: 'github_token',
    type: 'varchar',
    nullable: true,
    select: false,
    transformer: encryptedColumn,
  })
  @IsOptional()
  githubToken: string | null;

  @Column({
    name: 'github_login',
    type: 'varchar',
    nullable: true,
  })
  @IsOptional()
  githubLogin: string | null;
}
