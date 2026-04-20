import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time.
export async function up(db: Kysely<any>): Promise<void> {
  // Normalize any pre-existing values before enforcing the constraint.
  await sql`
    update auth.users
    set status = 'active'
    where status is null or status not in ('active', 'offline')
  `.execute(db);

  await sql`
    alter table auth.users
    drop constraint if exists auth_users_status_check
  `.execute(db);

  await sql`
    alter table auth.users
    add constraint auth_users_status_check
    check (status in ('active', 'offline'))
  `.execute(db);
}

// `any` is required here since migrations should be frozen in time.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    alter table auth.users
    drop constraint if exists auth_users_status_check
  `.execute(db);
}
