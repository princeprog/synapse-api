import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  WsException,
  ConnectedSocket,
} from '@nestjs/websockets';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

type AccessTokenPayload = {
  sub: string;
};

type ChannelPayload = {
  workspaceSlug: string;
  channelId: string;
};

type UpdatePayload = ChannelPayload & {
  messageId: string;
  dto: UpdateMessageDto;
};

type DeletePayload = ChannelPayload & {
  messageId: string;
};

type CreatePayload = ChannelPayload & {
  dto: CreateMessageDto;
};

type ReactionPayload = ChannelPayload & {
  messageId: string;
  emoji: string;
};

type ReactionsPayload = ChannelPayload & {
  messageId: string;
};

type RepliesPayload = ChannelPayload & {
  messageId: string;
};

type ThreadPayload = ChannelPayload & {
  messageId: string;
};

@WebSocketGateway({
  namespace: '/messages',
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
  },
})
export class MessagesGateway {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(MessagesGateway.name);

  constructor(
    private readonly messagesService: MessagesService,
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

      client.data.userId = payload.sub;
    } catch (error) {
      this.logger.warn('Rejected websocket connection due to invalid token');
      client.disconnect(true);
    }
  }

  @SubscribeMessage('messages:join')
  async joinChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ChannelPayload,
  ) {
    const userId = this.getClientUserId(client);

    await this.messagesService.findAllForChannel(
      userId,
      body.workspaceSlug,
      body.channelId,
    );

    client.join(this.getChannelRoom(body.workspaceSlug, body.channelId));

    return {
      success: true,
      room: this.getChannelRoom(body.workspaceSlug, body.channelId),
    };
  }

  @SubscribeMessage('messages:leave')
  leaveChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ChannelPayload,
  ) {
    client.leave(this.getChannelRoom(body.workspaceSlug, body.channelId));
    return { success: true };
  }

  @SubscribeMessage('messages:history')
  async history(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ChannelPayload,
  ) {
    const userId = this.getClientUserId(client);

    const messages = await this.messagesService.findAllForChannel(
      userId,
      body.workspaceSlug,
      body.channelId,
    );

    return {
      success: true,
      data: messages,
    };
  }

  @SubscribeMessage('messages:create')
  async create(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: CreatePayload,
  ) {
    const userId = this.getClientUserId(client);

    const message = await this.messagesService.createForChannel(
      userId,
      body.workspaceSlug,
      body.channelId,
      body.dto,
    );

    this.server
      .to(this.getChannelRoom(body.workspaceSlug, body.channelId))
      .emit('messages:created', message);

    return {
      success: true,
      data: message,
    };
  }

  @SubscribeMessage('messages:update')
  async update(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: UpdatePayload,
  ) {
    const userId = this.getClientUserId(client);

    const message = await this.messagesService.updateForChannel(
      userId,
      body.workspaceSlug,
      body.channelId,
      body.messageId,
      body.dto,
    );

    this.server
      .to(this.getChannelRoom(body.workspaceSlug, body.channelId))
      .emit('messages:updated', message);

    return {
      success: true,
      data: message,
    };
  }

  @SubscribeMessage('messages:delete')
  async remove(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: DeletePayload,
  ) {
    const userId = this.getClientUserId(client);

    const result = await this.messagesService.removeForChannel(
      userId,
      body.workspaceSlug,
      body.channelId,
      body.messageId,
    );

    this.server
      .to(this.getChannelRoom(body.workspaceSlug, body.channelId))
      .emit('messages:deleted', { id: body.messageId });

    return {
      success: true,
      data: result,
    };
  }

  @SubscribeMessage('messages:reaction:toggle')
  async toggleReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ReactionPayload,
  ) {
    const userId = this.getClientUserId(client);

    const result = await this.messagesService.toggleReactionForChannel(
      userId,
      body.workspaceSlug,
      body.channelId,
      body.messageId,
      body.emoji,
    );

    this.server
      .to(this.getChannelRoom(body.workspaceSlug, body.channelId))
      .emit('messages:reaction:toggled', result);

    return {
      success: true,
      data: result,
    };
  }

  @SubscribeMessage('messages:reactions:get')
  async getReactions(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ReactionsPayload,
  ) {
    const userId = this.getClientUserId(client);

    const result = await this.messagesService.getMessageReactionsForChannel(
      userId,
      body.workspaceSlug,
      body.channelId,
      body.messageId,
    );

    return {
      success: true,
      data: result,
    };
  }

  @SubscribeMessage('messages:replies:get')
  async getReplies(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: RepliesPayload,
  ) {
    const userId = this.getClientUserId(client);

    const result = await this.messagesService.getMessageRepliesForChannel(
      userId,
      body.workspaceSlug,
      body.channelId,
      body.messageId,
    );

    return {
      success: true,
      data: result,
    };
  }

  @SubscribeMessage('messages:thread:get')
  async getThread(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: ThreadPayload,
  ) {
    const userId = this.getClientUserId(client);

    const result = await this.messagesService.getMessageThreadForChannel(
      userId,
      body.workspaceSlug,
      body.channelId,
      body.messageId,
    );

    return {
      success: true,
      data: result,
    };
  }

  private getClientUserId(client: Socket): string {
    const userId = client.data.userId as string | undefined;
    if (!userId) {
      throw new WsException('Unauthenticaed socket');
    }
    return userId;
  }

  private getChannelRoom(workspaceSlug: string, channelId: string) {
    return 'workspace:' + workspaceSlug + ':channel:' + channelId;
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

  @SubscribeMessage('findAllMessages')
  findAll() {
    return this.messagesService.findAll();
  }

  @SubscribeMessage('findOneMessage')
  findOne(@MessageBody() id: number) {
    return this.messagesService.findOne(id);
  }
}
