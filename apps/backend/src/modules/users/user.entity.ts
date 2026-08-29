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
  @Column({ type: 'varchar', nullable: true })
  @IsOptional()
  username: string | null;

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
    name: 'github_token_last_four',
    type: 'varchar',
    length: 4,
    nullable: true,
  })
  @IsOptional()
  githubTokenLastFour: string | null;

  @Column({
    name: 'github_login',
    type: 'varchar',
    nullable: true,
  })
  @IsOptional()
  githubLogin: string | null;

  @Column({
    name: 'openai_key',
    type: 'varchar',
    nullable: true,
    select: false,
    transformer: encryptedColumn,
  })
  @IsOptional()
  openaiKey: string | null;

  @Column({
    name: 'openai_key_last_four',
    type: 'varchar',
    length: 4,
    nullable: true,
  })
  @IsOptional()
  openaiKeyLastFour: string | null;
}
