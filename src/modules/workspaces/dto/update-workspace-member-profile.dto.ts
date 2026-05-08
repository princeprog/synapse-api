import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateWorkspaceMemberProfileDto {
  @ApiPropertyOptional({
    description: 'Workspace-specific display name for the member',
    example: 'Vincent P.',
  })
  workspaceDisplayName?: string;

  @ApiPropertyOptional({
    description: 'Workspace-specific job title for the member',
    example: 'Lead Engineer',
  })
  jobTitle?: string;
}
