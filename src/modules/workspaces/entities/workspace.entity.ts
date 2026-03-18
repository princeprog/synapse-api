export class WorkspaceEntity {
  id!: string;
  name!: string;
  slug!: string;
  ownerId!: string;
  createdAt!: Date;
  role!: string;
  memberCount!: number;
}
