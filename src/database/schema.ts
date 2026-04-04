import type { Insertable, Updateable, Selectable } from 'kysely';

import type {
  AuthActivityLog,
  AuthSession,
  AuthUsers,
  ChatAttachments,
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

export type MessageWithReactions = UserChatMessages & {
  reactions: MessageReactionGroup[];
};
