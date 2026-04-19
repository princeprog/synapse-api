import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Create typing_indicators table
  await db.schema
    .withSchema('chat')
    .createTable('typing_indicators')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('channel_id', 'int8', (col) =>
      col.notNull().references('chat.channels.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('auth.users.id').onDelete('cascade'),
    )
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Add unique constraint so only one typing indicator per (channel_id, user_id)
  await db.schema
    .withSchema('chat')
    .createIndex('idx_typing_indicators_channel_user')
    .unique()
    .on('typing_indicators')
    .columns(['channel_id', 'user_id'])
    .execute();

  // Add index for cleanup queries
  await db.schema
    .withSchema('chat')
    .createIndex('idx_typing_indicators_expires_at')
    .on('typing_indicators')
    .column('expires_at')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.withSchema('chat').dropIndex('idx_typing_indicators_expires_at').ifExists().execute();
  await db.schema.withSchema('chat').dropIndex('idx_typing_indicators_channel_user').ifExists().execute();
  await db.schema.withSchema('chat').dropTable('typing_indicators').ifExists().execute();
}