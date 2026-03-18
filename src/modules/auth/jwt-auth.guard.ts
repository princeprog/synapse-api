import {
	CanActivate,
	ExecutionContext,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AuthService, AuthGuardUser } from './auth.service';

const ACCESS_TOKEN_COOKIE = 'access-token';
const REFRESH_TOKEN_COOKIE = 'refresh-token';
const ACCESS_TOKEN_EXPIRES_AT_COOKIE = 'access-token-expires-at';
const PROACTIVE_REFRESH_WINDOW_MS = 5 * 60 * 1000;

type AccessTokenPayload = {
	sub: string;
	username: string;
	session_id: number;
	exp?: number;
};

type GuardRequest = FastifyRequest & {
	user?: AuthGuardUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
	constructor(
		private readonly authService: AuthService,
		private readonly jwtService: JwtService,
		private readonly configService: ConfigService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<GuardRequest>();
		const response = context.switchToHttp().getResponse<FastifyReply>();

		const accessToken = request.cookies?.[ACCESS_TOKEN_COOKIE];
		const refreshToken = request.cookies?.[REFRESH_TOKEN_COOKIE];
		const expiresAtCookie = request.cookies?.[ACCESS_TOKEN_EXPIRES_AT_COOKIE];

		try {
			const payload = this.verifyAccessToken(accessToken);

			if (this.isNearExpiry(expiresAtCookie, payload.exp)) {
				request.user = await this.authService.refreshForGuard(
					refreshToken,
					response,
				);
				return true;
			}

			request.user = {
				userId: payload.sub,
				username: payload.username,
				sessionId: payload.session_id,
			};
			return true;
		} catch {
			try {
				request.user = await this.authService.refreshForGuard(
					refreshToken,
					response,
				);
				return true;
			} catch {
				this.authService.clearAuthCookies(response);
				throw new UnauthorizedException('Authentication required');
			}
		}
	}

	private verifyAccessToken(token: string | undefined): AccessTokenPayload {
		if (!token) {
			throw new UnauthorizedException('Missing access token');
		}

		return this.jwtService.verify<AccessTokenPayload>(token, {
			secret: this.configService.getOrThrow<string>('JWT_SECRET'),
		});
	}

	private isNearExpiry(
		expiresAtCookie: string | undefined,
		expClaim?: number,
	): boolean {
		let expiresAtFromCookie = Number.NaN;
		let expiresAtFromClaim = Number.NaN;

		if (expiresAtCookie) {
			const parsed = Number(expiresAtCookie);
			if (Number.isFinite(parsed)) {
				expiresAtFromCookie = parsed;
			}
		}

		if (expClaim) {
			expiresAtFromClaim = expClaim * 1000;
		}

		const knownExpiries = [expiresAtFromCookie, expiresAtFromClaim].filter((value) =>
			Number.isFinite(value),
		);

		const expiresAt = knownExpiries.length > 0 ? Math.min(...knownExpiries) : Number.NaN;

		if (!Number.isFinite(expiresAt)) {
			return true;
		}

		return expiresAt - Date.now() <= PROACTIVE_REFRESH_WINDOW_MS;
	}
}
