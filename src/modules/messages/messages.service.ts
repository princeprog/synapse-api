import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { DATABASE_TOKEN } from 'src/database/database.module';
import { Kysely, Selectable } from 'kysely';
import { DB } from 'src/database/database.types';
import { Message, User, UserChatMessages } from 'src/database/schema';
import { NotFoundException,ForbiddenException } from '@nestjs/common';

@Injectable()
export class MessagesService {

  constructor(@Inject(DATABASE_TOKEN) private readonly db: Kysely<DB>){}

  private mapMessageRow(row: {
    id: string | number | bigint;
    channel_id: string | number | bigint;
    sender_id: string;
    parent_id: string | number | bigint | null;
    content: string;
    is_edited: boolean;
    created_at: Date;
  }): Message {
    return {
      id: String(row.id),
      channel_id: String(row.channel_id),
      sender_id: row.sender_id,
      parent_id: row.parent_id === null ? null : String(row.parent_id),
      content: row.content,
      is_edited: row.is_edited,
      created_at: row.created_at,
    };
  }

  private CreatedMessageRow(row: {
    id: string | null;
    channel_id: string | null;
    sender_id: string | null;
    parent_id: string | null;
    content: string | null;
    is_edited: boolean | null;
    created_at: Date | null;
    username: string | null;  
  }): UserChatMessages {
    return {
      id: String(row.id),
      channel_id: String(row.channel_id),
      sender_id: row.sender_id,
      parent_id: row.parent_id === null ? null : String(row.parent_id),
      content: row.content,
      is_edited: row.is_edited,
      created_at: row.created_at,
      username: row.username,
    };
  }

  

  private async resolveWorkspaceForMember(workspaceSlug: string, userId: string) {
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
      .select(['id', 'workspace_id'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', channelId)
      .executeTakeFirst();

    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    return channel;
  }

  private async findMessageById(channelId: string, messageId: string) {
    const message = await this.db
      .selectFrom('chat.messages')
      .selectAll()
      .where('channel_id', '=', channelId)
      .where('id', '=', messageId)
      .executeTakeFirst();

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return message;
  }

  private assertOwner(messageSenderId: string, currentUserId: string) {
    if (messageSenderId !== currentUserId) {
      throw new ForbiddenException('You can only edit or delete your own messages');
    }
  }
  
  async createForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    dto: CreateMessageDto,
  ): Promise<UserChatMessages> {
    const workspace = await this.resolveWorkspaceForMember(workspaceSlug, userId);
    await this.findChannelById(workspace.id, channelId);

    const content = dto.content?.trim();
    if (!content) {
      throw new BadRequestException('Message content is required');
    }

    let parentId: string | null = null;
    if (dto.parentId !== undefined) {
      const normalizedParentId = dto.parentId.trim();
      if (!normalizedParentId) {
        throw new BadRequestException('parentId cannot be empty');
      }

      await this.findMessageById(channelId, normalizedParentId);
      parentId = normalizedParentId;
    }

    const created = await this.db
      .insertInto('chat.messages')
      .values({
        channel_id: channelId,
        sender_id: userId,
        parent_id: parentId,
        content,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

      const message = await this.db
        .selectFrom('chat.user_chat_messages')
        .selectAll()
        .where('id', '=', created.id)
        .executeTakeFirstOrThrow();

    return this.CreatedMessageRow(message);
  }

  async findAllForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
  ): Promise<UserChatMessages[]> {
    const workspace = await this.resolveWorkspaceForMember(workspaceSlug, userId);
    await this.findChannelById(workspace.id, channelId);

    const messages = await this.db
      .selectFrom('chat.user_chat_messages')
      .selectAll()
      .where('channel_id', '=', channelId)
      .orderBy('created_at', 'asc')
      .execute();

    return messages.map((message) => this.CreatedMessageRow(message));
  }

  async updateForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    messageId: string,
    dto: UpdateMessageDto,
  ): Promise<Message> {
    const workspace = await this.resolveWorkspaceForMember(workspaceSlug, userId);
    await this.findChannelById(workspace.id, channelId);

    const existing = await this.findMessageById(channelId, messageId);
    this.assertOwner(existing.sender_id, userId);

    if (dto.content === undefined) {
      return this.mapMessageRow(existing);
    }

    const content = dto.content.trim();
    if (!content) {
      throw new BadRequestException('Message content cannot be empty');
    }

    const updated = await this.db
      .updateTable('chat.messages')
      .set({
        content,
        is_edited: true,
      })
      .where('channel_id', '=', channelId)
      .where('id', '=', messageId)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapMessageRow(updated);
  }

  async removeForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    messageId: string,
  ): Promise<{ message: string; id: string }> {
    const workspace = await this.resolveWorkspaceForMember(workspaceSlug, userId);
    await this.findChannelById(workspace.id, channelId);

    const existing = await this.findMessageById(channelId, messageId);
    this.assertOwner(existing.sender_id, userId);

    await this.db
      .deleteFrom('chat.messages')
      .where('channel_id', '=', channelId)
      .where('id', '=', messageId)
      .executeTakeFirst();

    return {
      message: 'Message deleted successfully',
      id: messageId,
    };
  }
  
  findAll() {
    return `This action returns all messages`;
  }

  findOne(id: number) {
    return `This action returns a #${id} message`;
  }

  update(id: number, updateMessageDto: UpdateMessageDto) {
    return `This action updates a #${id} message`;
  }

  remove(id: number) {
    return `This action removes a #${id} message`;
  }
}