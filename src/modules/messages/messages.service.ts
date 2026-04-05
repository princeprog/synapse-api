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
import { NotificationsService } from '../notifications/notifications.service';

type UserChatMessageRow = {
  id: string | null;
  channel_id: string | null;
  sender_id: string | null;
  parent_id: string | null;
  content: string | null;
  is_edited: boolean | null;
  is_deleted: boolean | null;
  created_at: Date | null;
  username: string | null;
};

type MessagePinRow = {
  message_id: string | null;
  pinned_at: Date | null;
  pinned_by: string | null;
};

type MessageReadReceiptSummary = {
  seenByCount: number;
  seenByUserIds: string[];
};

type MessageSearchFilters = {
  keyword?: string;
  username?: string;
  date?: string;
  tag?: string;
};

@Injectable()
export class MessagesService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Kysely<DB>,
    private readonly notificationsService: NotificationsService,
  ) {}

  private mapMessageRow(row: {
    id: string | number | bigint;
    channel_id: string | number | bigint;
    sender_id: string;
    parent_id: string | number | bigint | null;
    content: string;
    is_edited: boolean;
    is_deleted: boolean;
    created_at: Date;
  }): Message {
    return {
      id: String(row.id),
      channel_id: String(row.channel_id),
      sender_id: row.sender_id,
      parent_id: row.parent_id === null ? null : String(row.parent_id),
      content: row.content,
      is_edited: row.is_edited,
      is_deleted: row.is_deleted,
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
      is_deleted: row.is_deleted,
      created_at: row.created_at,
      username: row.username,
    };
  }

  private mapMessageWithReactions(
    row: UserChatMessageRow,
    reactions: MessageReactionGroup[],
    parentContext: MessageParentContext | null,
    mentionedUserIds: string[],
    replyCount: number,
    isPinned: boolean,
    pinnedAt: Date | null,
    pinnedBy: string | null,
    tags: string[],
    readReceiptSummary: MessageReadReceiptSummary,
  ): MessageWithReactions {
    return {
      ...this.mapUserChatMessageRow(row),
      reactions,
      parent_context: parentContext,
      mentioned_user_ids: mentionedUserIds,
      reply_count: replyCount,
      is_pinned: isPinned,
      pinned_at: pinnedAt,
      pinned_by: pinnedBy,
      tags,
      seen_by_count: readReceiptSummary.seenByCount,
      seen_by_user_ids: readReceiptSummary.seenByUserIds,
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

  private extractTags(content: string): string[] {
    const tagRegex = /(^|\s)#([a-zA-Z0-9_]+)/g;
    const tags = new Set<string>();

    for (const match of content.matchAll(tagRegex)) {
      const rawTag = match[2]?.trim().toLowerCase();
      if (rawTag) {
        tags.add(rawTag);
      }
    }

    return [...tags];
  }

  private async syncTagsForMessage(messageId: string, content: string): Promise<string[]> {
    const nextTags = this.extractTags(content);
    const existingTags = await this.db
      .selectFrom('chat.message_tags')
      .select(['tag'])
      .where('message_id', '=', messageId)
      .execute();

    const existingTagSet = new Set(existingTags.map((tag) => tag.tag));
    const nextTagSet = new Set(nextTags);
    const toInsert = nextTags.filter((tag) => !existingTagSet.has(tag));
    const toDelete = [...existingTagSet].filter((tag) => !nextTagSet.has(tag));

    await this.db.transaction().execute(async (trx) => {
      if (toDelete.length > 0) {
        await trx
          .deleteFrom('chat.message_tags')
          .where('message_id', '=', messageId)
          .where('tag', 'in', toDelete)
          .execute();
      }

      if (toInsert.length > 0) {
        await trx
          .insertInto('chat.message_tags')
          .values(
            toInsert.map((tag) => ({
              message_id: messageId,
              tag,
            })),
          )
          .execute();
      }
    });

    return nextTags;
  }

  private async buildTagMap(messageIds: string[]): Promise<Record<string, string[]>> {
    if (messageIds.length === 0) {
      return {};
    }

    const rows = await this.db
      .selectFrom('chat.message_tags')
      .select(['message_id', 'tag'])
      .where('message_id', 'in', messageIds)
      .orderBy('created_at', 'asc')
      .execute();

    const tagMap: Record<string, string[]> = {};

    for (const row of rows) {
      const messageId = String(row.message_id);
      if (!tagMap[messageId]) {
        tagMap[messageId] = [];
      }

      tagMap[messageId].push(row.tag);
    }

    return tagMap;
  }

  private async buildPinnedMap(
    messageIds: string[],
  ): Promise<Record<string, { pinnedAt: Date; pinnedBy: string }>> {
    if (messageIds.length === 0) {
      return {};
    }

    const rows = await this.db
      .selectFrom('chat.message_pins')
      .select(['message_id', 'pinned_at', 'pinned_by'])
      .where('message_id', 'in', messageIds)
      .execute();

    const pinnedMap: Record<string, { pinnedAt: Date; pinnedBy: string }> = {};

    for (const row of rows) {
      if (row.message_id === null) {
        continue;
      }

      pinnedMap[String(row.message_id)] = {
        pinnedAt: row.pinned_at,
        pinnedBy: row.pinned_by,
      };
    }

    return pinnedMap;
  }

  private async buildReadReceiptMap(
    messageIds: string[],
  ): Promise<Record<string, MessageReadReceiptSummary>> {
    if (messageIds.length === 0) {
      return {};
    }

    const rows = await this.db
      .selectFrom('chat.message_read_receipts as receipt')
      .innerJoin('auth.users as u', 'u.id', 'receipt.user_id')
      .select(['receipt.message_id as message_id', 'receipt.user_id as user_id'])
      .where('receipt.message_id', 'in', messageIds)
      .execute();

    const receiptMap: Record<string, MessageReadReceiptSummary> = {};

    for (const row of rows) {
      const messageId = String(row.message_id);
      if (!receiptMap[messageId]) {
        receiptMap[messageId] = { seenByCount: 0, seenByUserIds: [] };
      }

      receiptMap[messageId].seenByCount += 1;
      receiptMap[messageId].seenByUserIds.push(row.user_id);
    }

    return receiptMap;
  }

  private async buildEnrichmentMaps(rows: UserChatMessageRow[]) {
    const messageIds = rows
      .map((message) => (message.id === null ? null : String(message.id)))
      .filter((messageId): messageId is string => Boolean(messageId));

    const parentIds = rows
      .map((message) => message.parent_id)
      .filter((parentId): parentId is string => Boolean(parentId));

    const [reactionsMap, parentContextMap, mentionMap, replyCountMap, tagMap, pinnedMap, readReceiptMap] =
      await Promise.all([
        this.buildReactionsMap(messageIds),
        this.buildParentContextMap(parentIds),
        this.buildMentionMap(messageIds),
        this.buildReplyCountMap(messageIds.length > 0 ? String(rows[0]?.channel_id ?? '') : ''),
        this.buildTagMap(messageIds),
        this.buildPinnedMap(messageIds),
        this.buildReadReceiptMap(messageIds),
      ]);

    return {
      reactionsMap,
      parentContextMap,
      mentionMap,
      replyCountMap,
      tagMap,
      pinnedMap,
      readReceiptMap,
    };
  }

  private extractMentions(content: string): {
    usernames: string[];
    mentionsEveryone: boolean;
  } {
    const mentionRegex = /(^|\s)@([a-zA-Z0-9_]+)/g;
    const usernames = new Set<string>();
    let mentionsEveryone = false;

    for (const match of content.matchAll(mentionRegex)) {
      const username = match[2]?.trim().toLowerCase();
      if (username) {
        if (username === 'everyone') {
          mentionsEveryone = true;
          continue;
        }

        usernames.add(username);
      }
    }

    return {
      usernames: [...usernames],
      mentionsEveryone,
    };
  }

  private async resolveMentionedUserIds(
    workspaceId: string,
    usernames: string[],
    mentionsEveryone: boolean,
  ): Promise<string[]> {
    if (usernames.length === 0 && !mentionsEveryone) {
      return [];
    }

    const members = await this.db
      .selectFrom('workspaces.workspace_members as wm')
      .innerJoin('auth.users as u', 'u.id', 'wm.member_id')
      .select(['u.id as user_id', 'u.username as username'])
      .where('wm.workspace_id', '=', workspaceId)
      .execute();

    const memberByUsername = new Map<string, string>();
    for (const member of members) {
      memberByUsername.set(member.username.toLowerCase(), member.user_id);
    }

    const mentionedUserIds: string[] = [];

    if (mentionsEveryone) {
      for (const member of members) {
        mentionedUserIds.push(member.user_id);
      }
    }

    for (const username of usernames) {
      const userId = memberByUsername.get(username);
      if (userId) {
        mentionedUserIds.push(userId);
      }
    }

    return [...new Set(mentionedUserIds)];
  }

  private async syncMentionsForMessage(input: {
    messageId: string;
    content: string;
    senderId: string;
    workspaceId: string;
    workspaceSlug: string;
    channelId: string;
    notifyNewMentions: boolean;
  }): Promise<string[]> {
    const mentionInfo = this.extractMentions(input.content);
    const resolvedUserIds = await this.resolveMentionedUserIds(
      input.workspaceId,
      mentionInfo.usernames,
      mentionInfo.mentionsEveryone,
    );
    const nextMentionedUserIds = resolvedUserIds.filter(
      (userId) => userId !== input.senderId,
    );

    const existingMentions = await this.db
      .selectFrom('chat.mentions')
      .select(['mentioned_user_id'])
      .where('message_id', '=', input.messageId)
      .execute();

    const existingUserIds = new Set(
      existingMentions.map((mention) => mention.mentioned_user_id),
    );
    const nextUserIds = new Set(nextMentionedUserIds);

    const toInsert = nextMentionedUserIds.filter(
      (userId) => !existingUserIds.has(userId),
    );
    const toDelete = [...existingUserIds].filter((userId) => !nextUserIds.has(userId));

    await this.db.transaction().execute(async (trx) => {
      if (toDelete.length > 0) {
        await trx
          .deleteFrom('chat.mentions')
          .where('message_id', '=', input.messageId)
          .where('mentioned_user_id', 'in', toDelete)
          .execute();
      }

      if (toInsert.length > 0) {
        await trx
          .insertInto('chat.mentions')
          .values(
            toInsert.map((userId) => ({
              message_id: input.messageId,
              mentioned_user_id: userId,
            })),
          )
          .execute();
      }
    });

    if (input.notifyNewMentions) {
      for (const mentionedUserId of toInsert) {
        await this.notificationsService.publishEvent({
          eventType: 'message.mention.created',
          workspaceId: input.workspaceId,
          actorUserId: input.senderId,
          entityType: 'message',
          recipientUserId: mentionedUserId,
          payload: {
            workspaceSlug: input.workspaceSlug,
            channelId: input.channelId,
            messageId: input.messageId,
            preview: input.content.slice(0, 180),
          },
        });
      }
    }

    return nextMentionedUserIds;
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

  private async buildMentionMap(
    messageIds: string[],
  ): Promise<Record<string, string[]>> {
    if (messageIds.length === 0) {
      return {};
    }

    const rows = await this.db
      .selectFrom('chat.mentions')
      .select(['message_id', 'mentioned_user_id'])
      .where('message_id', 'in', messageIds)
      .execute();

    const mentionMap: Record<string, string[]> = {};

    for (const row of rows) {
      const messageId = String(row.message_id);
      if (!mentionMap[messageId]) {
        mentionMap[messageId] = [];
      }

      mentionMap[messageId].push(row.mentioned_user_id);
    }

    return mentionMap;
  }

  private async buildReplyCountMap(
    channelId: string,
  ): Promise<Record<string, number>> {
    const rows = await this.db
      .selectFrom('chat.messages')
      .select(['id', 'parent_id'])
      .where('channel_id', '=', channelId)
      .where('is_deleted', '=', false)
      .execute();

    const childrenByParent: Record<string, string[]> = {};
    const messageIds: string[] = [];

    for (const row of rows) {
      const messageId = String(row.id);
      messageIds.push(messageId);

      if (row.parent_id === null) {
        continue;
      }

      const parentId = String(row.parent_id);
      if (!childrenByParent[parentId]) {
        childrenByParent[parentId] = [];
      }

      childrenByParent[parentId].push(messageId);
    }

    const memo = new Map<string, number>();

    const countDescendants = (messageId: string): number => {
      if (memo.has(messageId)) {
        return memo.get(messageId) ?? 0;
      }

      const children = childrenByParent[messageId] ?? [];
      let total = 0;

      for (const childId of children) {
        total += 1;
        total += countDescendants(childId);
      }

      memo.set(messageId, total);
      return total;
    };

    const replyCountMap: Record<string, number> = {};
    for (const messageId of messageIds) {
      replyCountMap[messageId] = countDescendants(messageId);
    }

    return replyCountMap;
  }

  private async getReactionsForMessage(
    messageId: string,
  ): Promise<MessageReactionGroup[]> {
    const map = await this.buildReactionsMap([messageId]);
    return map[messageId] ?? [];
  }

  private async enrichMessages(
    rows: UserChatMessageRow[],
    options?: { includeReplyCounts?: boolean; channelId?: string },
  ) {
    const messageIds = rows
      .map((message) => (message.id === null ? null : String(message.id)))
      .filter((messageId): messageId is string => Boolean(messageId));

    const parentIds = rows
      .map((message) => message.parent_id)
      .filter((parentId): parentId is string => Boolean(parentId));

    const [reactionsMap, parentContextMap, mentionMap, replyCountMap, tagMap, pinnedMap, readReceiptMap] =
      await Promise.all([
        this.buildReactionsMap(messageIds),
        this.buildParentContextMap(parentIds),
        this.buildMentionMap(messageIds),
        options?.includeReplyCounts && options.channelId
          ? this.buildReplyCountMap(options.channelId)
          : Promise.resolve<Record<string, number>>({}),
        this.buildTagMap(messageIds),
        this.buildPinnedMap(messageIds),
        this.buildReadReceiptMap(messageIds),
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
        mentionMap[messageId] ?? [],
        replyCountMap[messageId] ?? 0,
        Boolean(pinnedMap[messageId]),
        pinnedMap[messageId]?.pinnedAt ?? null,
        pinnedMap[messageId]?.pinnedBy ?? null,
        tagMap[messageId] ?? [],
        readReceiptMap[messageId] ?? { seenByCount: 0, seenByUserIds: [] },
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
    let parentMessageSenderId: string | null = null;
    if (dto.parentId !== undefined) {
      const normalizedParentId = dto.parentId.trim();
      if (!normalizedParentId) {
        throw new BadRequestException('parentId cannot be empty');
      }

      const parentMessage = await this.findMessageById(
        channelId,
        normalizedParentId,
      );
      parentMessageSenderId = parentMessage.sender_id;
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

    await this.syncMentionsForMessage({
      messageId: String(created.id),
      content,
      senderId: userId,
      workspaceId: workspace.id,
      workspaceSlug,
      channelId,
      notifyNewMentions: true,
    });

    await this.syncTagsForMessage(String(created.id), content);

    if (parentMessageSenderId && parentMessageSenderId !== userId) {
      await this.notificationsService.publishEvent({
        eventType: 'message.reply.created',
        workspaceId: workspace.id,
        actorUserId: userId,
        entityType: 'message',
        recipientUserId: parentMessageSenderId,
        payload: {
          workspaceSlug,
          channelId,
          messageId: String(created.id),
          parentMessageId: parentId,
          preview: content.slice(0, 180),
        },
      });
    }

    const [enriched] = await this.enrichMessages([message], {
      includeReplyCounts: true,
      channelId,
    });
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

    return this.enrichMessages(messages, {
      includeReplyCounts: true,
      channelId,
    });
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

      const [enriched] = await this.enrichMessages([existingWithUser], {
        includeReplyCounts: true,
        channelId,
      });
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

    await this.syncMentionsForMessage({
      messageId,
      content,
      senderId: userId,
      workspaceId: workspace.id,
      workspaceSlug,
      channelId,
      notifyNewMentions: true,
    });

    await this.syncTagsForMessage(messageId, content);

    const updatedWithUser = await this.db
      .selectFrom('chat.user_chat_messages')
      .selectAll()
      .where('id', '=', messageId)
      .executeTakeFirstOrThrow();

    const [enriched] = await this.enrichMessages([updatedWithUser], {
      includeReplyCounts: true,
      channelId,
    });
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
      replies: await this.enrichMessages(replies, {
        includeReplyCounts: true,
        channelId,
      }),
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
      thread: await this.enrichMessages(threadRows, {
        includeReplyCounts: true,
        channelId,
      }),
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
      .updateTable('chat.messages')
      .set({
        is_deleted: true,
      })
      .where('channel_id', '=', channelId)
      .where('id', '=', messageId)
      .executeTakeFirst();

    return {
      message: 'Message deleted successfully',
      id: messageId,
    };
  }

  async pinMessageForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    messageId: string,
  ): Promise<MessageWithReactions> {
    const workspace = await this.resolveWorkspaceForMember(workspaceSlug, userId);
    await this.findChannelById(workspace.id, channelId);
    await this.findMessageById(channelId, messageId);

    await this.db
      .insertInto('chat.message_pins')
      .values({
        message_id: messageId,
        pinned_by: userId,
      })
      .onConflict((oc) =>
        oc.column('message_id').doUpdateSet({
          pinned_by: userId,
          pinned_at: new Date(),
        }),
      )
      .executeTakeFirst();

    const pinnedMessage = await this.db
      .selectFrom('chat.user_chat_messages')
      .selectAll()
      .where('id', '=', messageId)
      .executeTakeFirstOrThrow();

    const [enriched] = await this.enrichMessages([pinnedMessage], {
      includeReplyCounts: true,
      channelId,
    });

    return enriched;
  }

  async unpinMessageForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    messageId: string,
  ): Promise<{ messageId: string }> {
    const workspace = await this.resolveWorkspaceForMember(workspaceSlug, userId);
    await this.findChannelById(workspace.id, channelId);
    await this.findMessageById(channelId, messageId);

    await this.db
      .deleteFrom('chat.message_pins')
      .where('message_id', '=', messageId)
      .executeTakeFirst();

    return { messageId };
  }

  async getPinnedMessagesForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
  ): Promise<MessageWithReactions[]> {
    const workspace = await this.resolveWorkspaceForMember(workspaceSlug, userId);
    await this.findChannelById(workspace.id, channelId);

    const pinnedMessages = await this.db
      .selectFrom('chat.user_chat_messages as m')
      .innerJoin('chat.message_pins as p', 'p.message_id', 'm.id')
      .selectAll('m')
      .where('m.channel_id', '=', channelId)
      .where('m.is_deleted', '=', false)
      .orderBy('p.pinned_at', 'desc')
      .execute();

    return this.enrichMessages(pinnedMessages, {
      includeReplyCounts: true,
      channelId,
    });
  }

  async searchForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    filters: MessageSearchFilters,
  ): Promise<MessageWithReactions[]> {
    const allMessages = await this.findAllForChannel(userId, workspaceSlug, channelId);
    const keyword = filters.keyword?.trim().toLowerCase();
    const username = filters.username?.trim().toLowerCase();
    const tag = filters.tag?.trim().replace(/^#/, '').toLowerCase();
    const date = filters.date?.trim();

    return allMessages.filter((message) => {
      if (message.is_deleted) {
        return false;
      }

      const content = (message.content ?? '').toLowerCase()
      const messageUsername = (message.username ?? '').toLowerCase()

      if (keyword) {
        const contentMatches = content.includes(keyword);
        const usernameMatches = messageUsername.includes(keyword);
        const tagMatches = message.tags.some((messageTag) => messageTag.includes(keyword));

        if (!contentMatches && !usernameMatches && !tagMatches) {
          return false;
        }
      }

      if (username && !messageUsername.includes(username)) {
        return false;
      }

      if (tag && !message.tags.includes(tag)) {
        return false;
      }

      if (date) {
        const messageDate = message.created_at
          ? new Date(message.created_at).toISOString().slice(0, 10)
          : '';
        if (messageDate !== new Date(date).toISOString().slice(0, 10)) {
          return false;
        }
      }

      return true;
    });
  }

  async markMessageAsSeenForChannel(
    userId: string,
    workspaceSlug: string,
    channelId: string,
    messageId: string,
  ): Promise<{ messageId: string; seenAt: Date }> {
    const workspace = await this.resolveWorkspaceForMember(workspaceSlug, userId);
    await this.findChannelById(workspace.id, channelId);
    await this.findMessageById(channelId, messageId);

    const seenAt = new Date();

    await this.db
      .insertInto('chat.message_read_receipts')
      .values({
        message_id: messageId,
        user_id: userId,
        seen_at: seenAt,
      })
      .onConflict((oc) =>
        oc.columns(['message_id', 'user_id']).doUpdateSet({
          seen_at: seenAt,
        }),
      )
      .executeTakeFirst();

    return {
      messageId,
      seenAt,
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
