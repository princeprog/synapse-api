import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

type AccessTokenPayload = {
  sub: string;
};

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: ['http://localhost:3000'],
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  handleConnection(client: Socket) {
    const token = this.extractAccessToken(client.handshake.headers.cookie);

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify<AccessTokenPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });

      const userId = payload.sub;
      client.data.userId = userId;
      client.join(this.getUserRoom(userId));
    } catch {
      this.logger.warn('Rejected websocket connection due to invalid token');
      client.disconnect(true);
    }
  }

  emitToUsers(
    userIds: string[],
    event: 'notification.created',
    payload: Record<string, unknown>,
  ) {
    const uniqueUserIds = [...new Set(userIds)];

    for (const userId of uniqueUserIds) {
      this.server.to(this.getUserRoom(userId)).emit(event, payload);
    }
  }

  private getUserRoom(userId: string) {
    return `user:${userId}`;
  }

  private extractAccessToken(cookieHeader?: string): string | null {
    if (!cookieHeader) {
      return null;
    }

    const cookiePairs = cookieHeader.split(';');

    for (const cookiePair of cookiePairs) {
      const [rawName, ...rawValueParts] = cookiePair.trim().split('=');
      if (!rawName || rawValueParts.length === 0) {
        continue;
      }

      if (rawName !== 'access-token') {
        continue;
      }

      return decodeURIComponent(rawValueParts.join('='));
    }

    return null;
  }
}
