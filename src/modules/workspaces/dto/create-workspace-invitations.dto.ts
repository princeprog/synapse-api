import { ApiProperty } from '@nestjs/swagger';

export class CreateWorkspaceInvitationsDto {
  @ApiProperty({
    description: 'The email address of the invitee',
    example: 'test@example.com',
  })
  email!: string;
  @ApiProperty({ description: 'The role of the invitee', example: 'member' })
  role!: string;
}
