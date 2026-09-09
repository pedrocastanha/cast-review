import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { sessionCookiePolicy } from 'src/shared/security/production-config';
import { CreateUserDto } from '../users/dtos/create-user.dto';
import type { User } from '../users/user.entity';
import { AuthService } from './auth.service';
import { LoginDto } from './dtos/login.dto';
import { JwtRefreshGuard, readRefreshCookie } from './guards/jwt-refresh.guard';
import { Public } from './utils/public.decorator';

type AuthenticatedRequest = Request & {
  user: User;
  refreshFamilyId: string;
};

const REFRESH_COOKIE = 'cast_refresh';

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: sessionCookiePolicy(),
    path: '/',
  };
}

@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: CreateUserDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post('demo')
  @HttpCode(HttpStatus.OK)
  async demoLogin(@Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.authService.loginAsGuest());
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.authService.login(dto));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtRefreshGuard)
  async refreshToken(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      res,
      await this.authService.getNewTokens(req.user, req.refreshFamilyId),
    );
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions());
    await this.authService.logoutFromCookie(readRefreshCookie(req));
  }

  private respond(
    res: Response,
    tokens: {
      accessToken: string;
      refreshToken: string;
      refreshExpiresAt?: Date;
    },
  ) {
    const maxAge = tokens.refreshExpiresAt
      ? Math.max(0, tokens.refreshExpiresAt.getTime() - Date.now())
      : 7 * 24 * 60 * 60 * 1000;

    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...cookieOptions(),
      maxAge,
    });

    return { accessToken: tokens.accessToken };
  }
}
