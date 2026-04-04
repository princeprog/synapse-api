import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceInvitationsDto } from './dto/create-workspace-invitations.dto';
import { UpdateWorkspaceMemberRoleDto } from './dto/update-workspace-member-role.dto';
import { ApiBody, ApiOperation } from '@nestjs/swagger';

type AuthenticatedRequest = FastifyRequest & {
  user: {
    userId: string;
    username: string;
    sessionId: number;
  };
};

@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.workspacesService.create(req.user.userId, dto);
  }

  @Get()
  findAll(@Request() req: AuthenticatedRequest) {
    return this.workspacesService.findAllForUser(req.user.userId);
  }

  @Get('invitations/me')
  @ApiOperation({
    summary: 'List my pending invitations',
    description: 'Retrieves pending invitations for the authenticated user.',
  })
  getMyPendingInvitations(@Request() req: AuthenticatedRequest) {
    return this.workspacesService.findMyPendingInvitations(req.user.userId);
  }

  @Post('invitations/:invitationId/accept')
  @ApiOperation({
    summary: 'Accept invitation',
    description: 'Accepts a pending workspace invitation.',
  })
  acceptInvitation(
    @Request() req: AuthenticatedRequest,
    @Param('invitationId') invitationId: string,
  ) {
    return this.workspacesService.acceptWorkspaceInvitation(
      invitationId,
      req.user.userId,
    );
  }

  @Post('invitations/:invitationId/decline')
  @ApiOperation({
    summary: 'Decline invitation',
    description: 'Declines a pending workspace invitation.',
  })
  declineInvitation(
    @Request() req: AuthenticatedRequest,
    @Param('invitationId') invitationId: string,
  ) {
    return this.workspacesService.declineWorkspaceInvitation(
      invitationId,
      req.user.userId,
    );
  }

  @Get('notifications/me')
  @ApiOperation({
    summary: 'Get my notifications feed',
    description:
      'Retrieves realtime-backed notifications for the authenticated user.',
  })
  getMyNotifications(@Request() req: AuthenticatedRequest) {
    return this.workspacesService.findMyNotificationFeed(req.user.userId);
  }

  @Get(':workspaceSlug/members')
  @ApiOperation({
    summary: 'Get workspace members',
    description: 'Retrieves a list of members for a specific workspace.',
  })
  getMembers(@Param('workspaceSlug') workspaceSlug: string) {
    return this.workspacesService.findWorkspaceMembers(workspaceSlug);
  }

  @Patch(':workspaceSlug/members/:memberId')
  @ApiOperation({
    summary: 'Update workspace member role',
    description: 'Updates a member role inside a workspace.',
  })
  @ApiBody({
    type: UpdateWorkspaceMemberRoleDto,
    description: 'The new role to assign to the member',
  })
  updateMemberRole(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateWorkspaceMemberRoleDto,
  ) {
    return this.workspacesService.updateWorkspaceMemberRole(
      workspaceSlug,
      req.user.userId,
      memberId,
      dto,
    );
  }

  @Delete(':workspaceSlug/members/:memberId')
  @ApiOperation({
    summary: 'Remove workspace member',
    description: 'Removes a member from a workspace.',
  })
  removeMember(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('memberId') memberId: string,
  ) {
    return this.workspacesService.removeWorkspaceMember(
      workspaceSlug,
      req.user.userId,
      memberId,
    );
  }

  @Get(':id')
  findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.workspacesService.findOneForUser(id, req.user.userId);
  }

  @Patch(':id')
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspacesService.update(id, req.user.userId, dto);
  }

  @Delete(':id')
  remove(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.workspacesService.remove(id, req.user.userId);
  }

  @Post(':workspaceSlug/invitations')
  @ApiOperation({
    summary: 'Create workspace invitations',
    description: 'Creates invitations for a workspace to invite new members.',
  })
  @ApiBody({
    type: CreateWorkspaceInvitationsDto,
    description: 'The details of the invitations to create',
  })
  createInvitations(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Body() dto: CreateWorkspaceInvitationsDto,
  ) {
    return this.workspacesService.createWorkspaceInvitations(
      dto,
      workspaceSlug,
      req.user.userId,
    );
  }

  @Get(':workspaceSlug/invitations')
  @ApiOperation({
    summary: 'List pending workspace invitations',
    description: 'Retrieves pending invitations for a workspace.',
  })
  getPendingInvitations(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
  ) {
    return this.workspacesService.findPendingWorkspaceInvitations(
      workspaceSlug,
      req.user.userId,
    );
  }

  @Delete(':workspaceSlug/invitations/:invitationId')
  @ApiOperation({
    summary: 'Revoke workspace invitation',
    description: 'Revokes a pending invitation from a workspace.',
  })
  revokeInvitation(
    @Request() req: AuthenticatedRequest,
    @Param('workspaceSlug') workspaceSlug: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.workspacesService.removeWorkspaceInvitation(
      workspaceSlug,
      req.user.userId,
      invitationId,
    );
  }
}
