import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('chat')
    .createTable('mentions')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('message_id', 'bigint', (col) =>
      col.notNull().references('chat.messages.id').onDelete('cascade'),
    )
    .addColumn('mentioned_user_id', 'uuid', (col) =>
      col.notNull().references('auth.users.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('chat_mentions_message_user_uniq', [
      'message_id',
      'mentioned_user_id',
    ])
    .execute();

  await db.schema
    .withSchema('chat')
    .createIndex('chat_mentions_message_id_idx')
    .on('mentions')
    .column('message_id')
    .execute();

  await db.schema
    .withSchema('chat')
    .createIndex('chat_mentions_mentioned_user_id_idx')
    .on('mentions')
    .column('mentioned_user_id')
    .execute();

  await db.schema
    .withSchema('chat')
    .createTable('channel_read_markers')
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('auth.users.id').onDelete('cascade'),
    )
    .addColumn('channel_id', 'bigint', (col) =>
      col.notNull().references('workspaces.channels.id').onDelete('cascade'),
    )
    .addColumn('last_read_message_id', 'bigint', (col) =>
      col.references('chat.messages.id').onDelete('set null'),
    )
    .addColumn('last_read_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint('chat_channel_read_markers_pk', [
      'user_id',
      'channel_id',
    ])
    .execute();

  await db.schema
    .withSchema('chat')
    .createIndex('chat_channel_read_markers_channel_idx')
    .on('channel_read_markers')
    .column('channel_id')
    .execute();

  await sql`
    alter table notifications.events
    drop constraint if exists notifications_events_event_type_check
  `.execute(db);

  await sql`
    alter table notifications.events
    add constraint notifications_events_event_type_check
    check (event_type in (
      'workspace.invite.created',
      'workspace.invite.revoked',
      'workspace.invite.accepted',
      'workspace.invite.declined',
      'message.mention.created',
      'message.reply.created'
    ))
  `.execute(db);
}

// `any` is required here since migrations should be frozen in time.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    alter table notifications.events
    drop constraint if exists notifications_events_event_type_check
  `.execute(db);

  await sql`
    alter table notifications.events
    add constraint notifications_events_event_type_check
    check (event_type in (
      'workspace.invite.created',
      'workspace.invite.revoked',
      'workspace.invite.accepted',
      'workspace.invite.declined'
    ))
  `.execute(db);

  await db.schema
    .withSchema('chat')
    .dropIndex('chat_channel_read_markers_channel_idx')
    .ifExists()
    .execute();

  await db.schema
    .withSchema('chat')
    .dropTable('channel_read_markers')
    .ifExists()
    .execute();

  await db.schema
    .withSchema('chat')
    .dropIndex('chat_mentions_mentioned_user_id_idx')
    .ifExists()
    .execute();

  await db.schema
    .withSchema('chat')
    .dropIndex('chat_mentions_message_id_idx')
    .ifExists()
    .execute();

  await db.schema.withSchema('chat').dropTable('mentions').ifExists().execute();
}
