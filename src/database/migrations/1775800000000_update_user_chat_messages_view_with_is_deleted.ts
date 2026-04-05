import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Drop the old view
  await db.schema.withSchema('chat').dropView('user_chat_messages').ifExists().execute();

  // Recreate the view with is_deleted column using raw SQL
  await sql`
    CREATE VIEW chat.user_chat_messages AS
    SELECT 
      m.id,
      m.channel_id,
      m.sender_id,
      m.parent_id,
      m.content,
      m.is_edited,
      m.is_deleted,
      m.created_at,
      u.username
    FROM chat.messages m
    INNER JOIN auth.users u ON u.id = m.sender_id
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // Drop the updated view
  await db.schema.withSchema('chat').dropView('user_chat_messages').ifExists().execute();

  // Recreate the old view without is_deleted
  await sql`
    CREATE VIEW chat.user_chat_messages AS
    SELECT 
      m.id,
      m.channel_id,
      m.sender_id,
      m.parent_id,
      m.content,
      m.is_edited,
      m.created_at,
      u.username
    FROM chat.messages m
    INNER JOIN auth.users u ON u.id = m.sender_id
  `.execute(db);
}
