import type { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema
        .createTable('users')
        .addColumn('id', 'serial', col => col.primaryKey())
        .addColumn('name', 'varchar(255)', col => col.notNull())
        .addColumn('email', 'varchar(255)', col => col.notNull().unique())
        .addColumn('created_at', 'timestamp', col => col.defaultTo('now()').notNull())
        .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('users').execute()
}
