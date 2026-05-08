import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('workspaces')
    .alterTable('workspace_members')
    .addColumn('workspace_display_name', 'varchar(255)')
    .addColumn('job_title', 'varchar(255)')
    .addColumn('invited_by_user_id', 'uuid', (col) =>
      col.references('auth.users.id').onDelete('set null'),
    )
    .execute();

  await sql`
    alter table workspaces.workspace_members
    alter column joined_at type timestamptz
    using to_timestamp(joined_at / 1000.0)
  `.execute(db);

  await sql`
    alter table workspaces.workspace_members
    alter column joined_at set default now()
  `.execute(db);

  await db.schema
    .withSchema('workspaces')
    .createIndex('workspace_members_invited_by_user_id_idx')
    .on('workspace_members')
    .column('invited_by_user_id')
    .execute();

  await db.schema
    .withSchema('workspaces')
    .alterTable('workspace_invitations')
    .addColumn('invited_by_user_id', 'uuid', (col) =>
      col.references('auth.users.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .withSchema('workspaces')
    .createIndex('workspace_invitations_invited_by_user_id_idx')
    .on('workspace_invitations')
    .column('invited_by_user_id')
    .execute();
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('workspaces')
    .dropIndex('workspace_invitations_invited_by_user_id_idx')
    .execute();

  await db.schema
    .withSchema('workspaces')
    .alterTable('workspace_invitations')
    .dropColumn('invited_by_user_id')
    .execute();

  await db.schema
    .withSchema('workspaces')
    .dropIndex('workspace_members_invited_by_user_id_idx')
    .execute();

  await sql`
    alter table workspaces.workspace_members
    alter column joined_at drop default
  `.execute(db);

  await sql`
    alter table workspaces.workspace_members
    alter column joined_at type bigint
    using (extract(epoch from joined_at) * 1000)::bigint
  `.execute(db);

  await db.schema
    .withSchema('workspaces')
    .alterTable('workspace_members')
    .dropColumn('invited_by_user_id')
    .dropColumn('job_title')
    .dropColumn('workspace_display_name')
    .execute();
}
