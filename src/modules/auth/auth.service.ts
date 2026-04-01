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
const ACCESS_TOKEN_EXPIRES_IN_COOKIE = 'access-token-expires-in';
const ACCESS_TOKEN_EXPIRES_AT_COOKIE = 'access-token-expires-at';
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
  session_id: number;
};

export type AuthGuardUser = {
  userId: string;
  username: string;
  sessionId: number;
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
    if (user && (await bcrypt.compare(password, user.password_hash))) {
      return { id: user.id, username: user.username };
    }
    throw new UnauthorizedException('Invalid credentials');
  }

  async login(user: any, response: FastifyReply) {
    const now = new Date();
    const refreshExpiredAt = new Date(
      now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000,
    );
    const tempRefreshTokenHash = await bcrypt.hash(
      `${user.id}:${now.getTime()}`,
      10,
    );

    const createdSession = await this.db
      .insertInto('auth.session')
      .values({
        user_id: user.id,
        refresh_token_hash: tempRefreshTokenHash,
        expired_at: refreshExpiredAt,
        last_used_at: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const payload: AuthPayload = {
      username: user.username,
      sub: user.id,
      session_id: Number(createdSession.id),
    };
    const { accessToken, refreshToken } = this.generateTokenPair(payload);
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    await this.db
      .updateTable('auth.session')
      .set({
        refresh_token_hash: refreshTokenHash,
      })
      .where('id', '=', Number(createdSession.id))
      .executeTakeFirst();

    this.setAccessTokenCookie(response, accessToken);
    this.setRefreshTokenCookie(response, refreshToken);
    this.setAccessTokenMetadataCookies(response, ACCESS_TOKEN_TTL_SECONDS);

    return { message: 'Login successful' };
  }

  async refresh(refreshToken: string | undefined, response: FastifyReply) {
    await this.rotateSessionFromRefreshToken(refreshToken, response);

    return { message: 'Token refreshed' };
  }

  async refreshForGuard(
    refreshToken: string | undefined,
    response: FastifyReply,
  ): Promise<AuthGuardUser> {
    const payload = await this.rotateSessionFromRefreshToken(
      refreshToken,
      response,
    );

    return {
      userId: payload.sub,
      username: payload.username,
      sessionId: payload.session_id,
    };
  }

  async logout(refreshToken: string | undefined, response: FastifyReply) {
    if (refreshToken) {
      try {
        const payload = this.verifyRefreshToken(refreshToken);
        const session = await this.findActiveSession(
          payload.sub,
          payload.session_id,
        );

        if (session) {
          const isSessionTokenMatch = await bcrypt.compare(
            refreshToken,
            session.refresh_token_hash,
          );

          if (!isSessionTokenMatch) {
            throw new UnauthorizedException('Invalid refresh token');
          }

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

    this.clearAuthCookies(response);
    return { message: 'Logout successful' };
  }

  clearAuthCookies(response: FastifyReply) {
    response.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    response.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
    response.clearCookie(ACCESS_TOKEN_EXPIRES_IN_COOKIE, { path: '/' });
    response.clearCookie(ACCESS_TOKEN_EXPIRES_AT_COOKIE, { path: '/' });
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

  private setAccessTokenMetadataCookies(
    response: FastifyReply,
    expiresInSeconds: number,
  ) {
    const expiresAt = Date.now() + expiresInSeconds * 5000;

    response.setCookie(
      ACCESS_TOKEN_EXPIRES_IN_COOKIE,
      String(expiresInSeconds),
      {
        ...COOKIE_OPTIONS,
        maxAge: ACCESS_TOKEN_TTL_SECONDS,
      },
    );

    response.setCookie(ACCESS_TOKEN_EXPIRES_AT_COOKIE, String(expiresAt), {
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

  private async rotateSessionFromRefreshToken(
    refreshToken: string | undefined,
    response: FastifyReply,
  ): Promise<AuthPayload> {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const payload = this.verifyRefreshToken(refreshToken);
    const session = await this.findActiveSession(
      payload.sub,
      payload.session_id,
    );

    if (!session) {
      throw new UnauthorizedException('Invalid or expired refresh session');
    }

    const isSessionTokenMatch = await bcrypt.compare(
      refreshToken,
      session.refresh_token_hash,
    );

    if (!isSessionTokenMatch) {
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
    this.setAccessTokenMetadataCookies(response, ACCESS_TOKEN_TTL_SECONDS);

    return payload;
  }

  private async findActiveSession(
    userId: string,
    sessionId: number,
  ): Promise<Selectable<DB['auth.session']> | undefined> {
    return this.db
      .selectFrom('auth.session')
      .selectAll()
      .where('id', '=', sessionId)
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .where('expired_at', '>', new Date())
      .executeTakeFirst();
  }
}