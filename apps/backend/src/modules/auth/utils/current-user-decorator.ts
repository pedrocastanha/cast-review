import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from 'src/modules/users/user.entity';

export interface CurrentUserData {
  id: string;
  username: string;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserData => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as User;

    return {
      id: user.id,
      username: user.username,
      email: user.email,
    };
  },
);
