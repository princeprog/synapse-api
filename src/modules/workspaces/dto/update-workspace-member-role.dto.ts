import { ApiProperty } from '@nestjs/swagger';

export class UpdateWorkspaceMemberRoleDto {
  @ApiProperty({
    description: 'The role to assign to the member',
    example: 'Member',
  })
  role!: string;
}
