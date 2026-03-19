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
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

type AuthenticatedRequest = FastifyRequest & {
  user: {
    userId: string;
    username: string;
    sessionId: number;
  };
};

@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceSlug/channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post()
  create(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Body() dto: CreateChannelDto,
  ) {
    return this.channelsService.create(req.user.userId, workspaceSlug, dto);
  }

  @Get()
  findAll(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
  ) {
    return this.channelsService.findAllForWorkspace(
      req.user.userId,
      workspaceSlug,
    );
  }

  @Get(':channelId')
  findOne(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
  ) {
    return this.channelsService.findOneForWorkspace(
      req.user.userId,
      workspaceSlug,
      channelId,
    );
  }

  @Patch(':channelId')
  update(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
    @Body() dto: UpdateChannelDto,
  ) {
    return this.channelsService.update(
      req.user.userId,
      workspaceSlug,
      channelId,
      dto,
    );
  }

  @Delete(':channelId')
  remove(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('channelId') channelId: string,
  ) {
    return this.channelsService.remove(
      req.user.userId,
      workspaceSlug,
      channelId,
    );
  }
}
