import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { DATABASE_TOKEN } from 'src/database/database.module';
import { Kysely } from 'kysely';
import { DB } from 'src/database/database.types';
import {
  Message,
  MessageParentContext,
  MessageReactionActor,
  MessageReactionGroup,
  MessageWithReactions,
  UserChatMessages,
} from 'src/database/schema';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

type UserChatMessageRow = {
  id: string | null;
  channel_id: string | null;
  sender_id: string | null;
  parent_id: string | null;
  content: string | null;
  is_edited: boolean | null;
  created_at: Date | null;
  username: string | null;
};

@Injectable()
export class MessagesService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Kysely<DB>) {}

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

  private mapUserChatMessageRow(row: UserChatMessageRow): UserChatMessages {
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

  private mapMessageWithReactions(
    row: UserChatMessageRow,
    reactions: MessageReactionGroup[],
    parentContext: MessageParentContext | null,
  ): MessageWithReactions {
    return {
      ...this.mapUserChatMessageRow(row),
      reactions,
      parent_context: parentContext,
    };
  }

  private async buildParentContextMap(
    parentIds: string[],
  ): Promise<Record<string, MessageParentContext>> {
    if (parentIds.length === 0) {
      return {};
    }

    const uniqueParentIds = [...new Set(parentIds)];
    const parentRows = await this.db
      .selectFrom('chat.user_chat_messages')
      .select(['id', 'username', 'content'])
      .where('id', 'in', uniqueParentIds)
      .execute();

    const parentContextMap: Record<string, MessageParentContext> = {};

    for (const parent of parentRows) {
      if (parent.id === null) {
        continue;
      }

      const parentId = String(parent.id);
      parentContextMap[parentId] = {
        id: parentId,
        username: parent.username,
        content: parent.content,
        exists: true,
      };
    }

    for (const parentId of uniqueParentIds) {
      if (parentContextMap[parentId]) {
        continue;
      }

      // Parent was deleted; keep child reply visible with fallback context.
      parentContextMap[parentId] = {
        id: parentId,
        username: null,
        content: null,
        exists: false,
      };
    }

    return parentContextMap;
  }

  private normalizeEmoji(emoji: string): string {
    const normalized = emoji.trim();
    if (!normalized) {
      throw new BadRequestException('Emoji is required');
    }

    // Keep emoji storage bounded without restricting valid unicode emojis.
    if (normalized.length > 32) {
      throw new BadRequestException('Emoji is invalid');
    }

    return normalized;
  }

  private async buildReactionsMap(
    messageIds: string[],
  ): Promise<Record<string, MessageReactionGroup[]>> {
    if (messageIds.length === 0) {
      return {};
    }

    const rows = await this.db
      .selectFrom('chat.reactions as r')
      .innerJoin('auth.users as u', 'u.id', 'r.user_id')
      .select([
        'r.message_id as message_id',
        'r.emoji as emoji',
        'r.user_id as user_id',
        'u.username as username',
      ])
      .where('r.message_id', 'in', messageIds)
      .orderBy('r.created_at', 'asc')
      .execute();

    const grouped: Record<string, Record<string, MessageReactionActor[]>> = {};

    for (const row of rows) {
      const messageId = String(row.message_id);
      const emoji = row.emoji;

      if (!grouped[messageId]) {
        grouped[messageId] = {};
      }

      if (!grouped[messageId][emoji]) {
        grouped[messageId][emoji] = [];
      }

      grouped[messageId][emoji].push({
        user_id: row.user_id,
        username: row.username,
      });
    }

    const reactionsMap: Record<string, MessageReactionGroup[]> = {};

    for (const messageId of Object.keys(grouped)) {
      const emojiMap = grouped[messageId];
      const groups: MessageReactionGroup[] = Object.entries(emojiMap).map(
        ([emoji, reactors]) => ({
          emoji,
          count: reactors.length,
          reactors,
        }),
      );

      reactionsMap[messageId] = groups;
    }

    return reactionsMap;
  }

  private async getReactionsForMessage(
    messageId: string,
  ): Promise<MessageReactionGroup[]> {
    const map = await this.buildReactionsMap([messageId]);
    return map[messageId] ?? [];
  }

  private async enrichMessages(rows: UserChatMessageRow[]) {
    const messageIds = rows
      .map((message) => (message.id === null ? null : String(message.id)))
      .filter((messageId): messageId is string => Boolean(messageId));

    const parentIds = rows
      .map((message) => message.parent_id)
      .filter((parentId): parentId is string => Boolean(parentId));

    const [reactionsMap, parentContextMap] = await Promise.all([
      this.buildReactionsMap(messageIds),
      this.buildParentContextMap(parentIds),
    ]);

    return rows.map((row) => {
      const messageId = row.id === null ? '' : String(row.id);
      const parentContext = row.parent_id
        ? (parentContextMap[row.parent_id] ?? {
            id: row.parent_id,
            username: null,
            content: null,
            exists: false,
          })
        : null;

      return this.mapMessageWithReactions(
        row,
        reactionsMap[messageId] ?? [],
        parentContext,
      );
    });
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
      throw new ForbiddenException(
        'You can only edit or delete your own messages',
      );
    }
  }

  async createForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    dto: CreateMessageDto,
  ): Promise<MessageWithReactions> {
    const workspace = await this.resolveWorkspaceForMember(
      workspaceSlug,
      userId,
    );
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

    const [enriched] = await this.enrichMessages([message]);
    return enriched;
  }

  async findAllForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
  ): Promise<MessageWithReactions[]> {
    const workspace = await this.resolveWorkspaceForMember(
      workspaceSlug,
      userId,
    );
    await this.findChannelById(workspace.id, channelId);

    const messages = await this.db
      .selectFrom('chat.user_chat_messages')
      .selectAll()
      .where('channel_id', '=', channelId)
      .orderBy('created_at', 'asc')
      .execute();

    return this.enrichMessages(messages);
  }

  async updateForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    messageId: string,
    dto: UpdateMessageDto,
  ): Promise<MessageWithReactions> {
    const workspace = await this.resolveWorkspaceForMember(
      workspaceSlug,
      userId,
    );
    await this.findChannelById(workspace.id, channelId);

    const existing = await this.findMessageById(channelId, messageId);
    this.assertOwner(existing.sender_id, userId);

    if (dto.content === undefined) {
      const existingWithUser = await this.db
        .selectFrom('chat.user_chat_messages')
        .selectAll()
        .where('id', '=', existing.id)
        .executeTakeFirstOrThrow();

      const [enriched] = await this.enrichMessages([existingWithUser]);
      return enriched;
    }

    const content = dto.content.trim();
    if (!content) {
      throw new BadRequestException('Message content cannot be empty');
    }

    await this.db
      .updateTable('chat.messages')
      .set({
        content,
        is_edited: true,
      })
      .where('channel_id', '=', channelId)
      .where('id', '=', messageId)
      .executeTakeFirstOrThrow();

    const updatedWithUser = await this.db
      .selectFrom('chat.user_chat_messages')
      .selectAll()
      .where('id', '=', messageId)
      .executeTakeFirstOrThrow();

    const [enriched] = await this.enrichMessages([updatedWithUser]);
    return enriched;
  }

  async getMessageRepliesForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    messageId: string,
  ): Promise<{ messageId: string; replies: MessageWithReactions[] }> {
    const workspace = await this.resolveWorkspaceForMember(workspaceSlug, userId);
    await this.findChannelById(workspace.id, channelId);
    await this.findMessageById(channelId, messageId);

    const replies = await this.db
      .selectFrom('chat.user_chat_messages')
      .selectAll()
      .where('channel_id', '=', channelId)
      .where('parent_id', '=', messageId)
      .orderBy('created_at', 'asc')
      .execute();

    return {
      messageId,
      replies: await this.enrichMessages(replies),
    };
  }

  async getMessageThreadForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    rootMessageId: string,
  ): Promise<{ rootMessageId: string; thread: MessageWithReactions[] }> {
    const workspace = await this.resolveWorkspaceForMember(workspaceSlug, userId);
    await this.findChannelById(workspace.id, channelId);
    await this.findMessageById(channelId, rootMessageId);

    const messages = await this.db
      .selectFrom('chat.user_chat_messages')
      .selectAll()
      .where('channel_id', '=', channelId)
      .orderBy('created_at', 'asc')
      .execute();

    const messageByParent: Record<string, UserChatMessageRow[]> = {};
    for (const message of messages) {
      if (!message.parent_id) {
        continue;
      }

      if (!messageByParent[message.parent_id]) {
        messageByParent[message.parent_id] = [];
      }

      messageByParent[message.parent_id].push(message);
    }

    const includedIds = new Set<string>([rootMessageId]);
    const queue: string[] = [rootMessageId];

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId) {
        continue;
      }

      const children = messageByParent[currentId] ?? [];
      for (const child of children) {
        if (child.id === null) {
          continue;
        }

        const childId = String(child.id);
        if (includedIds.has(childId)) {
          continue;
        }

        includedIds.add(childId);
        queue.push(childId);
      }
    }

    const threadRows = messages.filter((message) => {
      if (message.id === null) {
        return false;
      }

      return includedIds.has(String(message.id));
    });

    return {
      rootMessageId,
      thread: await this.enrichMessages(threadRows),
    };
  }

  async removeForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    messageId: string,
  ): Promise<{ message: string; id: string }> {
    const workspace = await this.resolveWorkspaceForMember(
      workspaceSlug,
      userId,
    );
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

  async getMessageReactionsForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    messageId: string,
  ): Promise<{ messageId: string; reactions: MessageReactionGroup[] }> {
    const workspace = await this.resolveWorkspaceForMember(
      workspaceSlug,
      userId,
    );
    await this.findChannelById(workspace.id, channelId);
    await this.findMessageById(channelId, messageId);

    const reactions = await this.getReactionsForMessage(messageId);

    return {
      messageId,
      reactions,
    };
  }

  async getMessageReactionUsersForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<{
    messageId: string;
    emoji: string;
    reactors: MessageReactionActor[];
    count: number;
  }> {
    const workspace = await this.resolveWorkspaceForMember(
      workspaceSlug,
      userId,
    );
    await this.findChannelById(workspace.id, channelId);
    await this.findMessageById(channelId, messageId);

    const normalizedEmoji = this.normalizeEmoji(emoji);
    const reactions = await this.getReactionsForMessage(messageId);
    const reactionGroup = reactions.find(
      (reaction) => reaction.emoji === normalizedEmoji,
    );

    return {
      messageId,
      emoji: normalizedEmoji,
      reactors: reactionGroup?.reactors ?? [],
      count: reactionGroup?.count ?? 0,
    };
  }

  async toggleReactionForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<{
    messageId: string;
    emoji: string;
    action: 'added' | 'removed';
    reactions: MessageReactionGroup[];
  }> {
    const workspace = await this.resolveWorkspaceForMember(
      workspaceSlug,
      userId,
    );
    await this.findChannelById(workspace.id, channelId);
    await this.findMessageById(channelId, messageId);

    const normalizedEmoji = this.normalizeEmoji(emoji);

    const action = await this.db.transaction().execute(async (trx) => {
      const existingReaction = await trx
        .selectFrom('chat.reactions')
        .select(['id'])
        .where('message_id', '=', messageId)
        .where('user_id', '=', userId)
        .where('emoji', '=', normalizedEmoji)
        .executeTakeFirst();

      if (existingReaction) {
        await trx
          .deleteFrom('chat.reactions')
          .where('id', '=', existingReaction.id)
          .executeTakeFirst();
        return 'removed' as const;
      }

      await trx
        .insertInto('chat.reactions')
        .values({
          message_id: messageId,
          user_id: userId,
          emoji: normalizedEmoji,
        })
        .executeTakeFirst();

      return 'added' as const;
    });

    const reactions = await this.getReactionsForMessage(messageId);

    return {
      messageId,
      emoji: normalizedEmoji,
      action,
      reactions,
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
