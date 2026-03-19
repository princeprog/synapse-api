export class ChannelEntity {
  id!: string;
  workspaceId!: string;
  name!: string;
  description!: string | null;
  createdBy!: string;
  createdAt!: Date;
}
