import type { Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .withSchema('auth')
    .alterTable('users')
    .addColumn('status', 'varchar(50)', (col) =>
      col.notNull().defaultTo('active'),
    )
    .execute();

  await db.schema
    .withSchema('auth')
    .createTable('user_profiles')
    .addColumn('user_id', 'uuid', (col) =>
      col.primaryKey().references('auth.users.id').onDelete('cascade'),
    )
    .addColumn('display_name', 'varchar(255)')
    .addColumn('avatar_url', 'text')
    .addColumn('bio', 'text')
    .addColumn('timezone', 'varchar(100)')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.withSchema('auth').dropTable('user_profiles').execute();

  await db.schema
    .withSchema('auth')
    .alterTable('users')
    .dropColumn('status')
    .execute();
}
