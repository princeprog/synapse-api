import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import '@fastify/cookie';
import type { FastifyReply } from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { Selectable } from 'kysely';
import type { Kysely } from 'kysely';

import { CreateUserDto } from '../users/dto/create-user.dto';
import type { DB } from '../../database/database.types';
import { DATABASE_TOKEN } from '../../database/database.module';

const ACCESS_TOKEN_COOKIE = 'access-token';
const REFRESH_TOKEN_COOKIE = 'refresh-token';
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const COOKIE_OPTIONS: CookieSerializeOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
};

type AuthPayload = {
  sub: string;
  username: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @Inject(DATABASE_TOKEN) private readonly db: Kysely<DB>,
  ) {}

  async register(createUserDto: CreateUserDto) {
    return await this.usersService.create(createUserDto);
  }

  async validateUser(username: string, password: string): Promise<any> {
    const user = await this.usersService.findOne(username);
    if (user && await bcrypt.compare(password, user.password_hash)) {
      return { id: user.id, username: user.username };
    }
    throw new UnauthorizedException('Invalid credentials');
  }

  async login(user: any, response: FastifyReply) {
    const payload = { username: user.username, sub: user.id };
    const { accessToken, refreshToken } = this.generateTokenPair(payload);
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    const now = new Date();
    const refreshExpiredAt = new Date(
      now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000,
    );

    await this.db
      .insertInto('auth.session')
      .values({
        user_id: user.id,
        refresh_token_hash: refreshTokenHash,
        expired_at: refreshExpiredAt,
        last_used_at: now,
      })
      .executeTakeFirstOrThrow();

    this.setAccessTokenCookie(response, accessToken);
    this.setRefreshTokenCookie(response, refreshToken);

    return { message: 'Login successful' };
  }

  async refresh(refreshToken: string | undefined, response: FastifyReply) {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const payload = this.verifyRefreshToken(refreshToken);
    const session = await this.findActiveSession(payload.sub, refreshToken);

    if (!session) {
      throw new UnauthorizedException('Invalid or expired refresh session');
    }

    const now = new Date();
    const { accessToken, refreshToken: nextRefreshToken } =
      this.generateTokenPair(payload);
    const nextRefreshTokenHash = await bcrypt.hash(nextRefreshToken, 10);
    const refreshExpiredAt = new Date(
      now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000,
    );

    await this.db
      .updateTable('auth.session')
      .set({
        refresh_token_hash: nextRefreshTokenHash,
        expired_at: refreshExpiredAt,
        last_used_at: now,
      })
      .where('id', '=', Number(session.id))
      .where('revoked_at', 'is', null)
      .executeTakeFirst();

    this.setAccessTokenCookie(response, accessToken);
    this.setRefreshTokenCookie(response, nextRefreshToken);

    return { message: 'Token refreshed' };
  }

  async logout(refreshToken: string | undefined, response: FastifyReply) {
    if (refreshToken) {
      try {
        const payload = this.verifyRefreshToken(refreshToken);
        const session = await this.findActiveSession(payload.sub, refreshToken);

        if (session) {
          await this.db
            .updateTable('auth.session')
            .set({
              revoked_at: new Date(),
            })
            .where('id', '=', Number(session.id))
            .executeTakeFirst();
        }
      } catch {
        // If token verification fails, cookies are still cleared.
      }
    }

    response.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    response.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
    return { message: 'Logout successful' };
  }

  private generateTokenPair(payload: AuthPayload) {
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: `${ACCESS_TOKEN_TTL_SECONDS}s`,
    });
    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: `${REFRESH_TOKEN_TTL_SECONDS}s`,
    });

    return { accessToken, refreshToken };
  }

  private verifyRefreshToken(refreshToken: string): AuthPayload {
    try {
      return this.jwtService.verify<AuthPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private setAccessTokenCookie(response: FastifyReply, accessToken: string) {
    response.setCookie(ACCESS_TOKEN_COOKIE, accessToken, {
      ...COOKIE_OPTIONS,
      maxAge: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  private setRefreshTokenCookie(response: FastifyReply, refreshToken: string) {
    response.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: REFRESH_TOKEN_TTL_SECONDS,
    });
  }

  private async findActiveSession(
    userId: string,
    refreshToken: string,
  ): Promise<Selectable<DB['auth.session']> | undefined> {
    const activeSessions = await this.db
      .selectFrom('auth.session')
      .selectAll()
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .where('expired_at', '>', new Date())
      .execute();

    for (const session of activeSessions) {
      const isMatch = await bcrypt.compare(
        refreshToken,
        session.refresh_token_hash,
      );

      if (isMatch) {
        return session;
      }
    }

    return undefined;
  }
}