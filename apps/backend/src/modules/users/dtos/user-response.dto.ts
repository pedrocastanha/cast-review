import { User } from '../user.entity';

export class UserResponseDto {
  id: string;
  name: string;
  email: string;
  username: string | null;
  active: boolean;
  githubConnected: boolean;
  githubLogin: string | null;
  githubTokenLastFour: string | null;
  openaiConnected: boolean;
  openaiKeyLastFour: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toUserResponse(user: User): UserResponseDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    active: user.active,
    githubConnected: Boolean(user.githubLogin),
    githubLogin: user.githubLogin ?? null,
    githubTokenLastFour: user.githubTokenLastFour ?? null,
    openaiConnected: Boolean(user.openaiKeyLastFour),
    openaiKeyLastFour: user.openaiKeyLastFour ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
