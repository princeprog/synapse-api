import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { MessagesService } from './messages.service';

type AuthenticatedRequest = FastifyRequest & {
  user: {
    userId: string;
    username: string;
    sessionId: number;
  };
};

@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceSlug/channels/:channelId/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  create(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
    @Body() dto: CreateMessageDto,
  ) {
    return this.messagesService.createForChannel(
      req.user.userId,
      workspaceSlug,
      channelId,
      dto,
    );
  }

  @Get()
  findAll(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
  ) {
    return this.messagesService.findAllForChannel(
      req.user.userId,
      workspaceSlug,
      channelId,
    );
  }

  @Patch(':messageId')
  update(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
    @Body() dto: UpdateMessageDto,
  ) {
    return this.messagesService.updateForChannel(
      req.user.userId,
      workspaceSlug,
      channelId,
      messageId,
      dto,
    );
  }

  @Delete(':messageId')
  remove(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.removeForChannel(
      req.user.userId,
      workspaceSlug,
      channelId,
      messageId,
    );
  }

  @Post(':messageId/reactions/:emoji')
  toggleReaction(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
    @Param('emoji') emoji: string,
  ) {
    return this.messagesService.toggleReactionForChannel(
      req.user.userId,
      workspaceSlug,
      channelId,
      messageId,
      decodeURIComponent(emoji),
    );
  }

  @Get(':messageId/reactions')
  getReactions(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.getMessageReactionsForChannel(
      req.user.userId,
      workspaceSlug,
      channelId,
      messageId,
    );
  }

  @Get(':messageId/reactions/:emoji/users')
  getReactionUsers(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
    @Param('emoji') emoji: string,
  ) {
    return this.messagesService.getMessageReactionUsersForChannel(
      req.user.userId,
      workspaceSlug,
      channelId,
      messageId,
      decodeURIComponent(emoji),
    );
  }
}
