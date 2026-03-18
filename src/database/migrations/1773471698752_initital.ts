import { sql } from 'kysely';
import type { Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  // ── Schemas ────────────────────────────────────────────────────────────────
  await db.schema.createSchema('auth').ifNotExists().execute();
  await db.schema.createSchema('workspaces').ifNotExists().execute();
  await db.schema.createSchema('chat').ifNotExists().execute();
  await db.schema.createSchema('docs').ifNotExists().execute();
  await db.schema.createSchema('tasks').ifNotExists().execute();

  // ── auth.users ─────────────────────────────────────────────────────────────
  await db.schema
    .withSchema('auth')
    .createTable('users')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('username', 'varchar(255)', (col) => col.notNull())
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('password_hash', 'varchar(255)', (col) => col.notNull())
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // ── auth.session ───────────────────────────────────────────────────────────
  await db.schema
    .withSchema('auth')
    .createTable('session')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('auth.users.id').onDelete('cascade'),
    )
    .addColumn('token', 'varchar(255)', (col) => col.notNull())
    .addColumn('expires_at', 'bigint', (col) => col.notNull())
    .execute();

  // ── auth.activity_log ──────────────────────────────────────────────────────
  await db.schema
    .withSchema('auth')
    .createTable('activity_log')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('auth.users.id').onDelete('cascade'),
    )
    .addColumn('activity', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // ── workspaces.workspaces ──────────────────────────────────────────────────
  await db.schema
    .withSchema('workspaces')
    .createTable('workspaces')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('name', 'varchar(255)', (col) =>
      col.notNull().defaultTo('Sample'),
    )
    .addColumn('slug', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('owner_id', 'uuid', (col) =>
      col.notNull().references('auth.users.id').onDelete('cascade'),
    )
    .execute();

  // ── workspaces.workspace_members ───────────────────────────────────────────
  // workspace_id corrected to uuid (matches workspaces.id); role corrected to varchar
  await db.schema
    .withSchema('workspaces')
    .createTable('workspace_members')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('member_id', 'uuid', (col) =>
      col.notNull().references('auth.users.id').onDelete('cascade'),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.workspaces.id').onDelete('cascade'),
    )
    .addColumn('joined_at', 'bigint', (col) => col.notNull())
    .addColumn('role', 'varchar(255)', (col) => col.notNull())
    .execute();

  // ── workspaces.channels ────────────────────────────────────────────────────
  // description corrected to text and made nullable
  await db.schema
    .withSchema('workspaces')
    .createTable('channels')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.workspaces.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text') // nullable – descriptions are optional
    .addColumn('created_by', 'uuid', (col) =>
      col.notNull().references('auth.users.id'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // ── chat.messages ──────────────────────────────────────────────────────────
  // content widened to text; parent_id corrected to bigint (self-ref) and nullable
  await db.schema
    .withSchema('chat')
    .createTable('messages')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('channel_id', 'bigint', (col) =>
      col.notNull().references('workspaces.channels.id').onDelete('cascade'),
    )
    .addColumn('sender_id', 'uuid', (col) =>
      col.notNull().references('auth.users.id'),
    )
    .addColumn('parent_id', 'bigint') // nullable – null means top-level message
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('is_edited', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // ── chat.attachments ───────────────────────────────────────────────────────
  await db.schema
    .withSchema('chat')
    .createTable('attachments')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('message_id', 'bigint', (col) =>
      col.notNull().references('chat.messages.id').onDelete('cascade'),
    )
    .addColumn('file_url', 'text', (col) => col.notNull())
    .addColumn('file_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('file_size', 'bigint', (col) => col.notNull())
    .addColumn('mime_type', 'varchar(255)', (col) => col.notNull())
    .execute();

  // ── chat.reactions ─────────────────────────────────────────────────────────
  await db.schema
    .withSchema('chat')
    .createTable('reactions')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('message_id', 'bigint', (col) =>
      col.notNull().references('chat.messages.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('auth.users.id').onDelete('cascade'),
    )
    .addColumn('emoji', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // ── docs.pages ─────────────────────────────────────────────────────────────
  // icon made nullable; parent_id already nullable (self-ref hierarchy)
  await db.schema
    .withSchema('docs')
    .createTable('pages')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.workspaces.id').onDelete('cascade'),
    )
    .addColumn('channel_id', 'bigint', (col) =>
      col.notNull().references('workspaces.channels.id').onDelete('cascade'),
    )
    .addColumn('parent_id', 'uuid') // nullable – null means root page
    .addColumn('created_by', 'uuid', (col) =>
      col.notNull().references('auth.users.id'),
    )
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('icon', 'varchar(255)') // nullable – icon is optional
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // ── docs.page_blocks ───────────────────────────────────────────────────────
  await db.schema
    .withSchema('docs')
    .createTable('page_blocks')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.notNull().references('docs.pages.id').onDelete('cascade'),
    )
    .addColumn('type', 'varchar(255)', (col) => col.notNull())
    .addColumn('content', 'jsonb', (col) => col.notNull())
    .addColumn('position', 'integer', (col) => col.notNull())
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'page_blocks_type_check',
      sql`type IN ('text', 'heading', 'image', 'code', 'list', 'divider', 'embed', 'table', 'checklist')`,
    )
    .execute();

  // ── tasks.tasks ────────────────────────────────────────────────────────────
  // assigned_to, description, and due_date made nullable
  await db.schema
    .withSchema('tasks')
    .createTable('tasks')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.workspaces.id').onDelete('cascade'),
    )
    .addColumn('created_by', 'uuid', (col) =>
      col.notNull().references('auth.users.id'),
    )
    .addColumn('assigned_to', 'uuid') // nullable – task may be unassigned
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text') // nullable – description is optional
    .addColumn('status', 'varchar(255)', (col) => col.notNull())
    .addColumn('due_date', 'timestamp') // nullable – no deadline tasks are valid
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'tasks_status_check',
      sql`status IN ('todo', 'in_progress', 'done', 'cancelled')`,
    )
    .execute();

  // ── Indexes ────────────────────────────────────────────────────────────────

  // auth.users
  await db.schema
    .withSchema('auth')
    .createIndex('idx_users_username')
    .on('users')
    .column('username')
    .execute();
  await db.schema
    .withSchema('auth')
    .createIndex('idx_users_is_active')
    .on('users')
    .column('is_active')
    .execute();

  // auth.session
  await db.schema
    .withSchema('auth')
    .createIndex('idx_session_user_id')
    .on('session')
    .column('user_id')
    .execute();
  await db.schema
    .withSchema('auth')
    .createIndex('idx_session_token')
    .on('session')
    .column('token')
    .execute();
  await db.schema
    .withSchema('auth')
    .createIndex('idx_session_expires_at')
    .on('session')
    .column('expires_at')
    .execute();

  // auth.activity_log
  await db.schema
    .withSchema('auth')
    .createIndex('idx_activity_log_user_id')
    .on('activity_log')
    .column('user_id')
    .execute();
  await db.schema
    .withSchema('auth')
    .createIndex('idx_activity_log_created_at')
    .on('activity_log')
    .column('created_at')
    .execute();

  // workspaces.workspaces
  await db.schema
    .withSchema('workspaces')
    .createIndex('idx_workspaces_owner_id')
    .on('workspaces')
    .column('owner_id')
    .execute();

  // workspaces.workspace_members
  await db.schema
    .withSchema('workspaces')
    .createIndex('idx_workspace_members_member_id')
    .on('workspace_members')
    .column('member_id')
    .execute();
  await db.schema
    .withSchema('workspaces')
    .createIndex('idx_workspace_members_workspace_id')
    .on('workspace_members')
    .column('workspace_id')
    .execute();
  await db.schema
    .withSchema('workspaces')
    .createIndex('idx_workspace_members_workspace_member')
    .on('workspace_members')
    .columns(['workspace_id', 'member_id'])
    .unique()
    .execute();

  // workspaces.channels
  await db.schema
    .withSchema('workspaces')
    .createIndex('idx_channels_workspace_id')
    .on('channels')
    .column('workspace_id')
    .execute();
  await db.schema
    .withSchema('workspaces')
    .createIndex('idx_channels_created_by')
    .on('channels')
    .column('created_by')
    .execute();

  // chat.messages
  await db.schema
    .withSchema('chat')
    .createIndex('idx_messages_channel_id')
    .on('messages')
    .column('channel_id')
    .execute();
  await db.schema
    .withSchema('chat')
    .createIndex('idx_messages_sender_id')
    .on('messages')
    .column('sender_id')
    .execute();
  await db.schema
    .withSchema('chat')
    .createIndex('idx_messages_parent_id')
    .on('messages')
    .column('parent_id')
    .execute();
  await db.schema
    .withSchema('chat')
    .createIndex('idx_messages_created_at')
    .on('messages')
    .column('created_at')
    .execute();

  // chat.attachments
  await db.schema
    .withSchema('chat')
    .createIndex('idx_attachments_message_id')
    .on('attachments')
    .column('message_id')
    .execute();

  // chat.reactions
  await db.schema
    .withSchema('chat')
    .createIndex('idx_reactions_message_id')
    .on('reactions')
    .column('message_id')
    .execute();
  await db.schema
    .withSchema('chat')
    .createIndex('idx_reactions_user_id')
    .on('reactions')
    .column('user_id')
    .execute();
  await db.schema
    .withSchema('chat')
    .createIndex('idx_reactions_message_user_emoji')
    .on('reactions')
    .columns(['message_id', 'user_id', 'emoji'])
    .unique()
    .execute();

  // docs.pages
  await db.schema
    .withSchema('docs')
    .createIndex('idx_pages_workspace_id')
    .on('pages')
    .column('workspace_id')
    .execute();
  await db.schema
    .withSchema('docs')
    .createIndex('idx_pages_channel_id')
    .on('pages')
    .column('channel_id')
    .execute();
  await db.schema
    .withSchema('docs')
    .createIndex('idx_pages_parent_id')
    .on('pages')
    .column('parent_id')
    .execute();
  await db.schema
    .withSchema('docs')
    .createIndex('idx_pages_created_by')
    .on('pages')
    .column('created_by')
    .execute();

  // docs.page_blocks
  await db.schema
    .withSchema('docs')
    .createIndex('idx_page_blocks_page_id')
    .on('page_blocks')
    .column('page_id')
    .execute();
  await db.schema
    .withSchema('docs')
    .createIndex('idx_page_blocks_page_position')
    .on('page_blocks')
    .columns(['page_id', 'position'])
    .execute();

  // tasks.tasks
  await db.schema
    .withSchema('tasks')
    .createIndex('idx_tasks_workspace_id')
    .on('tasks')
    .column('workspace_id')
    .execute();
  await db.schema
    .withSchema('tasks')
    .createIndex('idx_tasks_created_by')
    .on('tasks')
    .column('created_by')
    .execute();
  await db.schema
    .withSchema('tasks')
    .createIndex('idx_tasks_assigned_to')
    .on('tasks')
    .column('assigned_to')
    .execute();
  await db.schema
    .withSchema('tasks')
    .createIndex('idx_tasks_status')
    .on('tasks')
    .column('status')
    .execute();
  await db.schema
    .withSchema('tasks')
    .createIndex('idx_tasks_due_date')
    .on('tasks')
    .column('due_date')
    .execute();
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  // Drop indexes first
  await db.schema
    .withSchema('tasks')
    .dropIndex('idx_tasks_due_date')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('tasks')
    .dropIndex('idx_tasks_status')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('tasks')
    .dropIndex('idx_tasks_assigned_to')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('tasks')
    .dropIndex('idx_tasks_created_by')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('tasks')
    .dropIndex('idx_tasks_workspace_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('docs')
    .dropIndex('idx_page_blocks_page_position')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('docs')
    .dropIndex('idx_page_blocks_page_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('docs')
    .dropIndex('idx_pages_created_by')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('docs')
    .dropIndex('idx_pages_parent_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('docs')
    .dropIndex('idx_pages_channel_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('docs')
    .dropIndex('idx_pages_workspace_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('chat')
    .dropIndex('idx_reactions_message_user_emoji')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('chat')
    .dropIndex('idx_reactions_user_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('chat')
    .dropIndex('idx_reactions_message_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('chat')
    .dropIndex('idx_attachments_message_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('chat')
    .dropIndex('idx_messages_created_at')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('chat')
    .dropIndex('idx_messages_parent_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('chat')
    .dropIndex('idx_messages_sender_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('chat')
    .dropIndex('idx_messages_channel_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('workspaces')
    .dropIndex('idx_channels_created_by')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('workspaces')
    .dropIndex('idx_channels_workspace_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('workspaces')
    .dropIndex('idx_workspace_members_workspace_member')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('workspaces')
    .dropIndex('idx_workspace_members_workspace_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('workspaces')
    .dropIndex('idx_workspace_members_member_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('workspaces')
    .dropIndex('idx_workspaces_owner_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('auth')
    .dropIndex('idx_activity_log_created_at')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('auth')
    .dropIndex('idx_activity_log_user_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('auth')
    .dropIndex('idx_session_expires_at')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('auth')
    .dropIndex('idx_session_token')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('auth')
    .dropIndex('idx_session_user_id')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('auth')
    .dropIndex('idx_users_is_active')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('auth')
    .dropIndex('idx_users_username')
    .ifExists()
    .execute();

  // Drop in reverse dependency order, then drop schemas
  await db.schema.withSchema('tasks').dropTable('tasks').ifExists().execute();
  await db.schema
    .withSchema('docs')
    .dropTable('page_blocks')
    .ifExists()
    .execute();
  await db.schema.withSchema('docs').dropTable('pages').ifExists().execute();
  await db.schema
    .withSchema('chat')
    .dropTable('reactions')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('chat')
    .dropTable('attachments')
    .ifExists()
    .execute();
  await db.schema.withSchema('chat').dropTable('messages').ifExists().execute();
  await db.schema
    .withSchema('workspaces')
    .dropTable('channels')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('workspaces')
    .dropTable('workspace_members')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('workspaces')
    .dropTable('workspaces')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('auth')
    .dropTable('activity_log')
    .ifExists()
    .execute();
  await db.schema.withSchema('auth').dropTable('session').ifExists().execute();
  await db.schema.withSchema('auth').dropTable('users').ifExists().execute();

  await db.schema.dropSchema('tasks').ifExists().execute();
  await db.schema.dropSchema('docs').ifExists().execute();
  await db.schema.dropSchema('chat').ifExists().execute();
  await db.schema.dropSchema('workspaces').ifExists().execute();
  await db.schema.dropSchema('auth').ifExists().execute();
}
