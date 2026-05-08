import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    alter table auth.users
    add constraint users_status_check
    check (status in ('active', 'offline'))
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    alter table auth.users
    drop constraint if exists users_status_check
  `.execute(db);
}
