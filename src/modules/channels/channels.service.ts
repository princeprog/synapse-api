import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';

import type { DB } from '../../database/database.types';
import { DATABASE_TOKEN } from '../../database/database.module';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';

@Injectable()
export class ChannelsService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Kysely<DB>) {}

  private mapChannelRow(row: {
    id: string | number | bigint;
    workspace_id: string;
    name: string;
    description: string | null;
    created_by: string;
    created_at: Date;
  }) {
    return {
      id: String(row.id),
      workspaceId: row.workspace_id,
      name: row.name,
      description: row.description,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }

  private async resolveWorkspaceForMember(
    workspaceSlug: string,
    userId: string,
  ) {
    const workspace = await this.db
      .selectFrom('workspaces.workspaces as w')
      .innerJoin('workspaces.workspace_members as wm', (join) =>
        join
          .onRef('wm.workspace_id', '=', 'w.id')
          .on('wm.member_id', '=', userId),
      )
      .select(['w.id', 'w.slug'])
      .where('w.slug', '=', workspaceSlug)
      .executeTakeFirst();

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return workspace;
  }

  private async findChannelById(workspaceId: string, channelId: string) {
    const channel = await this.db
      .selectFrom('workspaces.channels')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', channelId)
      .executeTakeFirst();

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return channel;
  }

  async create(userId: string, workspaceSlug: string, dto: CreateChannelDto) {
    const workspace = await this.resolveWorkspaceForMember(
      workspaceSlug,
      userId,
    );
    const name = dto.name?.trim();

    if (!name) {
      throw new BadRequestException('Channel name is required');
    }

    const description = dto.description?.trim() || null;

    const channel = await this.db
      .insertInto('workspaces.channels')
      .values({
        workspace_id: workspace.id,
        name,
        description,
        created_by: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapChannelRow(channel);
  }

  async findAllForWorkspace(userId: string, workspaceSlug: string) {
    const workspace = await this.resolveWorkspaceForMember(
      workspaceSlug,
      userId,
    );

    const channels = await this.db
      .selectFrom('workspaces.channels')
      .selectAll()
      .where('workspace_id', '=', workspace.id)
      .orderBy('created_at', 'asc')
      .execute();

    return channels.map((channel) => this.mapChannelRow(channel));
  }

  async findOneForWorkspace(
    userId: string,
    workspaceSlug: string,
    channelId: string,
  ) {
    const workspace = await this.resolveWorkspaceForMember(
      workspaceSlug,
      userId,
    );
    const channel = await this.findChannelById(workspace.id, channelId);

    return this.mapChannelRow(channel);
  }

  async update(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    dto: UpdateChannelDto,
  ) {
    const workspace = await this.resolveWorkspaceForMember(
      workspaceSlug,
      userId,
    );
    const existing = await this.findChannelById(workspace.id, channelId);

    const updates: { name?: string; description?: string | null } = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('Channel name cannot be empty');
      }
      updates.name = name;
    }

    if (dto.description !== undefined) {
      updates.description = dto.description.trim() || null;
    }

    const hasUpdates = Object.keys(updates).length > 0;
    if (!hasUpdates) {
      return this.mapChannelRow(existing);
    }

    const updatedChannel = await this.db
      .updateTable('workspaces.channels')
      .set(updates)
      .where('workspace_id', '=', workspace.id)
      .where('id', '=', channelId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapChannelRow(updatedChannel);
  }

  async remove(userId: string, workspaceSlug: string, channelId: string) {
    const workspace = await this.resolveWorkspaceForMember(
      workspaceSlug,
      userId,
    );
    await this.findChannelById(workspace.id, channelId);

    await this.db
      .deleteFrom('workspaces.channels')
      .where('workspace_id', '=', workspace.id)
      .where('id', '=', channelId)
      .executeTakeFirst();

    return { message: 'Channel deleted successfully' };
  }
}
