import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('chat')
    .createTable('message_pins')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('message_id', 'bigint', (col) =>
      col.notNull().references('chat.messages.id').onDelete('cascade'),
    )
    .addColumn('pinned_by', 'uuid', (col) =>
      col.notNull().references('auth.users.id').onDelete('cascade'),
    )
    .addColumn('pinned_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('chat_message_pins_message_uniq', ['message_id'])
    .execute();

  await db.schema
    .withSchema('chat')
    .createIndex('chat_message_pins_message_id_idx')
    .on('message_pins')
    .column('message_id')
    .execute();

  await db.schema
    .withSchema('chat')
    .createTable('message_tags')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('message_id', 'bigint', (col) =>
      col.notNull().references('chat.messages.id').onDelete('cascade'),
    )
    .addColumn('tag', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('chat_message_tags_message_tag_uniq', [
      'message_id',
      'tag',
    ])
    .execute();

  await db.schema
    .withSchema('chat')
    .createIndex('chat_message_tags_message_id_idx')
    .on('message_tags')
    .column('message_id')
    .execute();

  await db.schema
    .withSchema('chat')
    .createIndex('chat_message_tags_tag_idx')
    .on('message_tags')
    .column('tag')
    .execute();

  await db.schema
    .withSchema('chat')
    .createTable('message_read_receipts')
    .addColumn('message_id', 'bigint', (col) =>
      col.notNull().references('chat.messages.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('auth.users.id').onDelete('cascade'),
    )
    .addColumn('seen_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint('chat_message_read_receipts_pk', [
      'message_id',
      'user_id',
    ])
    .execute();

  await db.schema
    .withSchema('chat')
    .createIndex('chat_message_read_receipts_user_idx')
    .on('message_read_receipts')
    .column('user_id')
    .execute();

  await db.schema
    .withSchema('chat')
    .createIndex('chat_message_read_receipts_message_idx')
    .on('message_read_receipts')
    .column('message_id')
    .execute();
}

// `any` is required here since migrations should be frozen in time.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('chat')
    .dropIndex('chat_message_read_receipts_message_idx')
    .ifExists()
    .execute();

  await db.schema
    .withSchema('chat')
    .dropIndex('chat_message_read_receipts_user_idx')
    .ifExists()
    .execute();

  await db.schema
    .withSchema('chat')
    .dropTable('message_read_receipts')
    .ifExists()
    .execute();

  await db.schema
    .withSchema('chat')
    .dropIndex('chat_message_tags_tag_idx')
    .ifExists()
    .execute();

  await db.schema
    .withSchema('chat')
    .dropIndex('chat_message_tags_message_id_idx')
    .ifExists()
    .execute();

  await db.schema
    .withSchema('chat')
    .dropTable('message_tags')
    .ifExists()
    .execute();

  await db.schema
    .withSchema('chat')
    .dropIndex('chat_message_pins_message_id_idx')
    .ifExists()
    .execute();

  await db.schema
    .withSchema('chat')
    .dropTable('message_pins')
    .ifExists()
    .execute();
}