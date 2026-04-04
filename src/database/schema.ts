import type { Insertable, Updateable, Selectable } from 'kysely';

import type {
  AuthActivityLog,
  AuthSession,
  AuthUsers,
  ChatAttachments,
  ChatMessagePins,
  ChatMessageReadReceipts,
  ChatMessageTags,
  ChatMessages,
  ChatReactions,
  DocsPageBlocks,
  DocsPages,
  WorkspacesChannels,
  WorkspacesWorkspaceMembers,
  WorkspacesWorkspaces,
  Users,
  TasksTasks,
  ChatUserChatMessages,
} from './database.types';

export type User = Selectable<AuthUsers>;
export type NewUser = Insertable<AuthUsers>;
export type UpdateUser = Updateable<AuthUsers>;

export type Message = Selectable<ChatMessages>;
export type MessagePin = Selectable<ChatMessagePins>;
export type MessageTag = Selectable<ChatMessageTags>;
export type MessageReadReceipt = Selectable<ChatMessageReadReceipts>;
export type UserChatMessages = Selectable<ChatUserChatMessages>;

export type MessageReactionActor = {
  user_id: string;
  username: string;
};

export type MessageReactionGroup = {
  emoji: string;
  count: number;
  reactors: MessageReactionActor[];
};

export type MessageParentContext = {
  id: string;
  username: string | null;
  content: string | null;
  exists: boolean;
};

export type MessageWithReactions = UserChatMessages & {
  reactions: MessageReactionGroup[];
  parent_context: MessageParentContext | null;
  mentioned_user_ids: string[];
  reply_count: number;
  is_pinned: boolean;
  pinned_at: Date | null;
  pinned_by: string | null;
  tags: string[];
  seen_by_count: number;
  seen_by_user_ids: string[];
};
export type Message = Selectable<ChatMessages>
export type UserChatMessages = Selectable<ChatUserChatMessages>
export type MessageWithReactions = UserChatMessages & {
  reactions: MessageReactionGroup[];
};
