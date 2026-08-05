import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import type { AuthUser } from '../../shared/types';
import { ValidatePatDto } from './dtos/validate-pat.dto';

@Injectable()
export class AuthService {
  async validatePat(dto: ValidatePatDto): Promise<AuthUser> {
    const token = dto.token?.trim();
    if (!token) {
      throw new BadRequestException('Token is required');
    }

    const octokit = new Octokit({ auth: token });

    try {
      const { data } = await octokit.users.getAuthenticated();

      return {
        login: data.login,
        id: data.id,
        name: data.name,
        avatarUrl: data.avatar_url,
      };
    } catch {
      throw new UnauthorizedException('Token do Github expirado ou inválido.');
    }
  }
}
