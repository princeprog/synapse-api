import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`create schema if not exists notifications`.execute(db);

  await db.schema
    .withSchema('notifications')
    .createTable('events')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('event_type', 'varchar', (col) => col.notNull())
    .addColumn('channel', 'varchar', (col) => col.notNull().defaultTo('in_app'))
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.workspaces.id').onDelete('set null'),
    )
    .addColumn('actor_user_id', 'uuid', (col) =>
      col.references('auth.users.id').onDelete('set null'),
    )
    .addColumn('entity_type', 'varchar', (col) => col.notNull())
    .addColumn('entity_id', 'uuid')
    .addColumn('payload_version', 'integer', (col) =>
      col.notNull().defaultTo(1),
    )
    .addColumn('payload', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'notifications_events_event_type_check',
      sql`event_type in (
        'workspace.invite.created',
        'workspace.invite.revoked',
        'workspace.invite.accepted',
        'workspace.invite.declined'
      )`,
    )
    .addCheckConstraint(
      'notifications_events_channel_check',
      sql`channel in ('in_app')`,
    )
    .execute();

  await db.schema
    .withSchema('notifications')
    .createIndex('notifications_events_recency_idx')
    .on('events')
    .column('created_at')
    .execute();

  await db.schema
    .withSchema('notifications')
    .createIndex('notifications_events_workspace_idx')
    .on('events')
    .column('workspace_id')
    .execute();

  await db.schema
    .withSchema('notifications')
    .createTable('deliveries')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('event_id', 'uuid', (col) =>
      col.notNull().references('notifications.events.id').onDelete('cascade'),
    )
    .addColumn('recipient_user_id', 'uuid', (col) =>
      col.notNull().references('auth.users.id').onDelete('cascade'),
    )
    .addColumn('status', 'varchar', (col) => col.notNull().defaultTo('sent'))
    .addColumn('delivered_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('seen_at', 'timestamp')
    .addColumn('read_at', 'timestamp')
    .addCheckConstraint(
      'notifications_deliveries_status_check',
      sql`status in ('sent', 'seen', 'read')`,
    )
    .addUniqueConstraint('notifications_deliveries_event_recipient_uniq', [
      'event_id',
      'recipient_user_id',
    ])
    .execute();

  await db.schema
    .withSchema('notifications')
    .createIndex('notifications_deliveries_recipient_idx')
    .on('deliveries')
    .column('recipient_user_id')
    .execute();

  await db.schema
    .withSchema('notifications')
    .createIndex('notifications_deliveries_event_idx')
    .on('deliveries')
    .column('event_id')
    .execute();

  await db.schema
    .withSchema('workspaces')
    .alterTable('workspace_invitations')
    .addColumn('invited_user_id', 'uuid', (col) =>
      col.references('auth.users.id').onDelete('set null'),
    )
    .addColumn('responded_at', 'timestamp')
    .addColumn('responded_by_user_id', 'uuid', (col) =>
      col.references('auth.users.id').onDelete('set null'),
    )
    .addColumn('response', 'varchar')
    .execute();

  await db.schema
    .withSchema('workspaces')
    .createIndex('workspace_invitations_invited_user_id_idx')
    .on('workspace_invitations')
    .column('invited_user_id')
    .execute();

  await sql`
    alter table workspaces.workspace_invitations
    drop constraint if exists page_block_type_check
  `.execute(db);

  await sql`
    alter table workspaces.workspace_invitations
    add constraint workspace_invitations_status_check
    check (status in ('pending', 'accepted', 'expired', 'declined'))
  `.execute(db);

  await sql`
    alter table workspaces.workspace_invitations
    add constraint workspace_invitations_response_check
    check (response is null or response in ('accepted', 'declined'))
  `.execute(db);
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    alter table workspaces.workspace_invitations
    drop constraint if exists workspace_invitations_response_check
  `.execute(db);

  await sql`
    alter table workspaces.workspace_invitations
    drop constraint if exists workspace_invitations_status_check
  `.execute(db);

  await sql`
    alter table workspaces.workspace_invitations
    add constraint page_block_type_check
    check (status in ('pending', 'accepted', 'expired'))
  `.execute(db);

  await db.schema
    .withSchema('workspaces')
    .dropIndex('workspace_invitations_invited_user_id_idx')
    .execute();

  await db.schema
    .withSchema('workspaces')
    .alterTable('workspace_invitations')
    .dropColumn('response')
    .dropColumn('responded_by_user_id')
    .dropColumn('responded_at')
    .dropColumn('invited_user_id')
    .execute();

  await db.schema.withSchema('notifications').dropTable('deliveries').execute();
  await db.schema.withSchema('notifications').dropTable('events').execute();
  await sql`drop schema if exists notifications`.execute(db);
}
