import { sql, type Kysely } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
	.withSchema('workspaces')
	.createTable('workspace_invitations')
	.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
	.addColumn('workspace_id', 'uuid', (col) => col.notNull().references('workspaces.workspaces.id').onDelete('cascade'))
	.addColumn('email', 'varchar', (col) => col.notNull())
	.addColumn('role', 'varchar', (col) => col.notNull())
	.addColumn('token_hash', 'varchar', (col) => col.notNull())
	.addColumn('status', 'varchar', (col) => col.notNull().defaultTo('pending'))
	.addColumn('expires_at', 'timestamp', (col) => col.notNull())
	.addColumn('accepted_at', 'timestamp')
	.addCheckConstraint(
		'page_block_type_check',
		sql`status IN ('pending', 'accepted', 'expired')`,
	)
	.execute()


	await db.schema
	.withSchema('workspaces')
	.createIndex('workspace_invitations_email_idx')
	.on('workspace_invitations')
	.column('email')
	.execute()

	await db.schema
	.withSchema('workspaces')
	.createIndex('workspace_invitations_token_hash_idx')
	.on('workspace_invitations')
	.column('token_hash')
	.execute()

	await db.schema
	.withSchema('workspaces')
	.createIndex('workspace_invitations_expires_at_idx')
	.on('workspace_invitations')
	.column('expires_at')
	.execute()

	await db.schema
	.withSchema('workspaces')
	.createIndex('workspace_invitations_status_idx')
	.on('workspace_invitations')
	.column('status')
	.execute()

	await db.schema
	.withSchema('workspaces')
	.createIndex('workspace_invitations_workspace_id_idx')
	.on('workspace_invitations')
	.column('workspace_id')
	.execute()



}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema
	.withSchema('workspaces')
	.dropTable('workspace_invitations')
	.execute()
}
