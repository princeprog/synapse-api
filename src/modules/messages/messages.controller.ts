import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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

  @Get('search')
  search(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
    @Query('keyword') keyword?: string,
    @Query('username') username?: string,
    @Query('date') date?: string,
    @Query('tag') tag?: string,
  ) {
    return this.messagesService.searchForChannel(
      req.user.userId,
      workspaceSlug,
      channelId,
      {
        keyword,
        username,
        date,
        tag,
      },
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

  @Post(':messageId/pin')
  pin(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.pinMessageForChannel(
      req.user.userId,
      workspaceSlug,
      channelId,
      messageId,
    );
  }

  @Delete(':messageId/pin')
  unpin(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.unpinMessageForChannel(
      req.user.userId,
      workspaceSlug,
      channelId,
      messageId,
    );
  }

  @Get('pinned')
  getPinned(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
  ) {
    return this.messagesService.getPinnedMessagesForChannel(
      req.user.userId,
      workspaceSlug,
      channelId,
    );
  }

  @Post(':messageId/seen')
  markSeen(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.markMessageAsSeenForChannel(
      req.user.userId,
      workspaceSlug,
      channelId,
      messageId,
    );
  }

  @Get(':messageId/replies')
  getReplies(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.getMessageRepliesForChannel(
      req.user.userId,
      workspaceSlug,
      channelId,
      messageId,
    );
  }

  @Get(':messageId/thread')
  getThread(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.messagesService.getMessageThreadForChannel(
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
