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
} from './database.types';

export type User = Selectable<AuthUsers>;
export type NewUser = Insertable<AuthUsers>;
export type UpdateUser = Updateable<AuthUsers>;