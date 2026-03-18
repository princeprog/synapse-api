import { sql } from 'kysely';
import type { Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('auth')
    .alterTable('session')
    .dropColumn('token')
    .dropColumn('expires_at')
    .addColumn('refresh_token_hash', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('expired_at', 'timestamptz', (col) => col.notNull())
    .addColumn('last_used_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('revoked_at', 'timestamptz')
    .execute();

  await db.schema
    .withSchema('auth')
    .dropIndex('idx_session_token')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('auth')
    .dropIndex('idx_session_expires_at')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('auth')
    .createIndex('idx_session_refresh_token_hash')
    .on('session')
    .column('refresh_token_hash')
    .execute();
  await db.schema
    .withSchema('auth')
    .createIndex('idx_session_expired_at')
    .on('session')
    .column('expired_at')
    .execute();
  await db.schema
    .withSchema('auth')
    .createIndex('idx_session_revoked_at')
    .on('session')
    .column('revoked_at')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('auth')
    .dropIndex('idx_session_refresh_token_hash')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('auth')
    .dropIndex('idx_session_expired_at')
    .ifExists()
    .execute();
  await db.schema
    .withSchema('auth')
    .dropIndex('idx_session_revoked_at')
    .ifExists()
    .execute();

  await db.schema
    .withSchema('auth')
    .alterTable('session')
    .dropColumn('refresh_token_hash')
    .dropColumn('created_at')
    .dropColumn('expired_at')
    .dropColumn('last_used_at')
    .dropColumn('revoked_at')
    .addColumn('token', 'varchar(255)', (col) => col.notNull())
    .addColumn('expires_at', 'bigint', (col) => col.notNull())
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
}
