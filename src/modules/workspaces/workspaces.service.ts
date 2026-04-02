import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { randomBytes, createHash } from 'crypto';

import type { DB } from '../../database/database.types';
import { DATABASE_TOKEN } from '../../database/database.module';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { CreateWorkspaceInvitationsDto } from './dto/create-workspace-invitations.dto';
import { UpdateWorkspaceMemberRoleDto } from './dto/update-workspace-member-role.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Kysely<DB>,
    private readonly notificationsService: NotificationsService,
  ) {}

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  private async generateUniqueSlug(
    name: string,
    providedSlug?: string,
  ): Promise<string> {
    const baseSlug = this.slugify((providedSlug || name).trim());

    if (!baseSlug) {
      throw new BadRequestException(
        'Workspace name or slug must contain valid characters',
      );
    }

    let candidate = baseSlug;
    let counter = 1;

    while (true) {
      const existing = await this.db
        .selectFrom('workspaces.workspaces')
        .select('id')
        .where('slug', '=', candidate)
        .executeTakeFirst();

      if (!existing) {
        return candidate;
      }

      counter += 1;
      candidate = `${baseSlug}-${counter}`;
    }
  }

  private mapWorkspaceRow(row: {
    id: string;
    name: string;
    slug: string;
    owner_id: string;
    created_at: Date;
    role: string;
    member_count: number | string | bigint;
  }) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      ownerId: row.owner_id,
      createdAt: row.created_at,
      role: row.role,
      memberCount: Number(row.member_count),
    };
  }

  async create(userId: string, dto: CreateWorkspaceDto) {
    const name = dto.name?.trim();

    if (!name) {
      throw new BadRequestException('Workspace name is required');
    }

    const slug = await this.generateUniqueSlug(name, dto.slug);

    const createdWorkspace = await this.db
      .insertInto('workspaces.workspaces')
      .values({
        name,
        slug,
        owner_id: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.db
      .insertInto('workspaces.workspace_members')
      .values({
        workspace_id: createdWorkspace.id,
        member_id: userId,
        role: 'Admin',
        joined_at: Date.now(),
      })
      .executeTakeFirst();

    return {
      id: createdWorkspace.id,
      name: createdWorkspace.name,
      slug: createdWorkspace.slug,
      ownerId: createdWorkspace.owner_id,
      createdAt: createdWorkspace.created_at,
      role: 'Admin',
      memberCount: 1,
    };
  }

  async findAllForUser(userId: string) {
    const rows = await this.db
      .selectFrom('workspaces.workspaces as w')
      .innerJoin('workspaces.workspace_members as wm', (join) =>
        join
          .onRef('wm.workspace_id', '=', 'w.id')
          .on('wm.member_id', '=', userId),
      )
      .leftJoin(
        'workspaces.workspace_members as all_members',
        'all_members.workspace_id',
        'w.id',
      )
      .select([
        'w.id',
        'w.name',
        'w.slug',
        'w.owner_id',
        'w.created_at',
        'wm.role as role',
        sql<number>`count(all_members.id)`.as('member_count'),
      ])
      .groupBy([
        'w.id',
        'w.name',
        'w.slug',
        'w.owner_id',
        'w.created_at',
        'wm.role',
      ])
      .orderBy('w.created_at', 'desc')
      .execute();

    return rows.map((row) => this.mapWorkspaceRow(row));
  }

  async findOneForUser(id: string, userId: string) {
    const row = await this.db
      .selectFrom('workspaces.workspaces as w')
      .innerJoin('workspaces.workspace_members as wm', (join) =>
        join
          .onRef('wm.workspace_id', '=', 'w.id')
          .on('wm.member_id', '=', userId),
      )
      .leftJoin(
        'workspaces.workspace_members as all_members',
        'all_members.workspace_id',
        'w.id',
      )
      .select([
        'w.id',
        'w.name',
        'w.slug',
        'w.owner_id',
        'w.created_at',
        'wm.role as role',
        sql<number>`count(all_members.id)`.as('member_count'),
      ])
      .where('w.id', '=', id)
      .groupBy([
        'w.id',
        'w.name',
        'w.slug',
        'w.owner_id',
        'w.created_at',
        'wm.role',
      ])
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundException('Workspace not found');
    }

    return this.mapWorkspaceRow(row);
  }

  async update(id: string, userId: string, dto: UpdateWorkspaceDto) {
    const existing = await this.db
      .selectFrom('workspaces.workspaces')
      .select(['id', 'owner_id', 'name', 'slug'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('Workspace not found');
    }

    if (existing.owner_id !== userId) {
      throw new ForbiddenException(
        'Only the workspace owner can update this workspace',
      );
    }

    const updates: { name?: string; slug?: string } = {};

    if (dto.name !== undefined) {
      const nextName = dto.name.trim();
      if (!nextName) {
        throw new BadRequestException('Workspace name cannot be empty');
      }
      updates.name = nextName;
    }

    if (dto.slug !== undefined) {
      updates.slug = await this.generateUniqueSlug(
        dto.name ?? existing.name,
        dto.slug,
      );
    } else if (dto.name !== undefined) {
      updates.slug = await this.generateUniqueSlug(dto.name);
    }

    const hasUpdates = Object.keys(updates).length > 0;
    if (!hasUpdates) {
      return this.findOneForUser(id, userId);
    }

    const updated = await this.db
      .updateTable('workspaces.workspaces')
      .set(updates)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();

    const memberCount = await this.db
      .selectFrom('workspaces.workspace_members')
      .select((eb) => eb.fn.count('id').as('member_count'))
      .where('workspace_id', '=', updated.id)
      .executeTakeFirst();

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      ownerId: updated.owner_id,
      createdAt: updated.created_at,
      role: 'Admin',
      memberCount: Number(memberCount?.member_count ?? 1),
    };
  }

  async remove(id: string, userId: string) {
    const workspace = await this.db
      .selectFrom('workspaces.workspaces')
      .select(['id', 'owner_id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    if (workspace.owner_id !== userId) {
      throw new ForbiddenException(
        'Only the workspace owner can delete this workspace',
      );
    }

    await this.db
      .deleteFrom('workspaces.workspaces')
      .where('id', '=', id)
      .executeTakeFirst();

    return { message: 'Workspace deleted successfully' };
  }

  async createWorkspaceInvitations(
    dto: CreateWorkspaceInvitationsDto,
    workspaceSlug: string,
    userId: string,
  ) {
    const workspaceAccess = await this.resolveWorkspaceMemberAccess(
      workspaceSlug,
      userId,
    );
    const actorRole = workspaceAccess.role.toLowerCase();

    if (actorRole !== 'admin') {
      throw new ForbiddenException('Only admins can create invitations');
    }

    const email = dto.email.trim().toLowerCase();
    const role = this.normalizeMemberRole(dto.role);

    const invitedUser = await this.db
      .selectFrom('auth.users')
      .select(['id'])
      .where('email', '=', email)
      .executeTakeFirst();

    const pendingInvitation = await this.isInvited(workspaceAccess.id, email);
    if (pendingInvitation) {
      throw new BadRequestException(
        'An invitation for this email already exists',
      );
    }

    const tokens = this.hashToken();

    const invitation = await this.db
      .insertInto('workspaces.workspace_invitations')
      .values({
        workspace_id: workspaceAccess.id,
        email,
        role,
        invited_user_id: invitedUser?.id ?? null,
        token_hash: tokens.hashedToken,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returningAll()
      .executeTakeFirst();

    if (invitation) {
      const workspace = await this.db
        .selectFrom('workspaces.workspaces')
        .select(['id', 'slug', 'name'])
        .where('id', '=', workspaceAccess.id)
        .executeTakeFirstOrThrow();

      const adminIds = await this.findWorkspaceAdminIds(workspace.id);
      const recipients = [
        ...adminIds,
        ...(invitedUser?.id ? [invitedUser.id] : []),
      ];

      await this.notificationsService.publishEvent({
        eventType: 'workspace.invite.created',
        workspaceId: workspace.id,
        actorUserId: userId,
        entityType: 'workspace_invitation',
        entityId: invitation.id,
        payload: {
          workspaceSlug: workspace.slug,
          workspaceName: workspace.name,
          email,
          role,
          status: 'pending',
          expiresAt: invitation.expires_at.toISOString(),
        },
        recipientUserId: invitedUser?.id ? invitedUser.id : null,
      });
    }

    return invitation;
  }

  async findPendingWorkspaceInvitations(workspaceSlug: string, userId: string) {
    const workspace = await this.resolveWorkspaceMemberAccess(
      workspaceSlug,
      userId,
    );
    const actorRole = workspace.role.toLowerCase();

    if (actorRole !== 'admin') {
      throw new ForbiddenException('Only admins can view pending invitations');
    }

    return this.db
      .selectFrom('workspaces.workspace_invitations')
      .select(['id', 'email', 'role', 'status', 'expires_at', 'accepted_at'])
      .where('workspace_id', '=', workspace.id)
      .where('status', '=', 'pending')
      .orderBy('expires_at', 'asc')
      .execute();
  }

  async removeWorkspaceInvitation(
    workspaceSlug: string,
    userId: string,
    invitationId: string,
  ) {
    const workspace = await this.resolveWorkspaceMemberAccess(
      workspaceSlug,
      userId,
    );
    const actorRole = workspace.role.toLowerCase();

    if (actorRole !== 'admin') {
      throw new ForbiddenException('Only admins can revoke invitations');
    }

    const invitation = await this.db
      .selectFrom('workspaces.workspace_invitations')
      .select(['id', 'status', 'email', 'role', 'invited_user_id'])
      .where('workspace_id', '=', workspace.id)
      .where('id', '=', invitationId)
      .executeTakeFirst();

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new BadRequestException('Only pending invitations can be revoked');
    }

    await this.db
      .deleteFrom('workspaces.workspace_invitations')
      .where('id', '=', invitationId)
      .executeTakeFirst();

    const adminIds = await this.findWorkspaceAdminIds(workspace.id);
    const recipients = [
      ...adminIds,
      ...(invitation.invited_user_id ? [invitation.invited_user_id] : []),
    ];

    await this.notificationsService.publishEvent({
      eventType: 'workspace.invite.revoked',
      workspaceId: workspace.id,
      actorUserId: userId,
      entityType: 'workspace_invitation',
      entityId: invitation.id,
      payload: {
        workspaceSlug,
        email: invitation.email,
        role: invitation.role,
        status: 'revoked',
      },
      recipientUserId: invitation.invited_user_id
        ? invitation.invited_user_id
        : null,
      recipientUserId: invitation.invited_user_id ? invitation.invited_user_id : null,
    });

    return { message: 'Invitation revoked successfully' };
  }

  async findMyPendingInvitations(userId: string) {
    const user = await this.db
      .selectFrom('auth.users')
      .select(['id', 'email'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();

    const invitations = await this.db
      .selectFrom('workspaces.workspace_invitations as wi')
      .innerJoin('workspaces.workspaces as w', 'w.id', 'wi.workspace_id')
      .select([
        'wi.id',
        'wi.email',
        'wi.role',
        'wi.status',
        'wi.expires_at',
        'wi.accepted_at',
        'w.id as workspace_id',
        'w.slug as workspace_slug',
        'w.name as workspace_name',
      ])
      .where('wi.status', '=', 'pending')
      .where('wi.expires_at', '>', new Date())
      .where((eb) =>
        eb.or([
          eb('wi.invited_user_id', '=', user.id),
          eb('wi.email', '=', user.email.toLowerCase()),
        ]),
      )
      .orderBy('wi.expires_at', 'asc')
      .execute();

    return invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expires_at,
      acceptedAt: invitation.accepted_at,
      workspace: {
        id: invitation.workspace_id,
        slug: invitation.workspace_slug,
        name: invitation.workspace_name,
      },
    }));
  }

  async acceptWorkspaceInvitation(invitationId: string, userId: string) {
    const user = await this.db
      .selectFrom('auth.users')
      .select(['id', 'email'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();

    const invitation = await this.db
      .selectFrom('workspaces.workspace_invitations as wi')
      .innerJoin('workspaces.workspaces as w', 'w.id', 'wi.workspace_id')
      .select([
        'wi.id',
        'wi.workspace_id',
        'wi.email',
        'wi.role',
        'wi.status',
        'wi.expires_at',
        'w.slug as workspace_slug',
        'w.name as workspace_name',
      ])
      .where('wi.id', '=', invitationId)
      .where((eb) =>
        eb.or([
          eb('wi.invited_user_id', '=', user.id),
          eb('wi.email', '=', user.email.toLowerCase()),
        ]),
      )
      .executeTakeFirst();

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new BadRequestException('Invitation is no longer pending');
    }

    if (invitation.expires_at.getTime() <= Date.now()) {
      await this.db
        .updateTable('workspaces.workspace_invitations')
        .set({ status: 'expired' })
        .where('id', '=', invitation.id)
        .executeTakeFirst();

      throw new BadRequestException('Invitation has expired');
    }

    await this.db.transaction().execute(async (trx) => {
      const existingMember = await trx
        .selectFrom('workspaces.workspace_members')
        .select('id')
        .where('workspace_id', '=', invitation.workspace_id)
        .where('member_id', '=', user.id)
        .executeTakeFirst();

      if (!existingMember) {
        await trx
          .insertInto('workspaces.workspace_members')
          .values({
            workspace_id: invitation.workspace_id,
            member_id: user.id,
            role: this.normalizeMemberRole(invitation.role),
            joined_at: Date.now(),
          })
          .executeTakeFirst();
      }

      await trx
        .updateTable('workspaces.workspace_invitations')
        .set({
          status: 'accepted',
          accepted_at: new Date(),
          responded_at: new Date(),
          responded_by_user_id: user.id,
          response: 'accepted',
        })
        .where('id', '=', invitation.id)
        .executeTakeFirst();
    });

    const adminIds = await this.findWorkspaceAdminIds(invitation.workspace_id);

    await this.notificationsService.publishEvent({
      eventType: 'workspace.invite.accepted',
      workspaceId: invitation.workspace_id,
      actorUserId: user.id,
      entityType: 'workspace_invitation',
      entityId: invitation.id,
      payload: {
        workspaceSlug: invitation.workspace_slug,
        workspaceName: invitation.workspace_name,
        invitedEmail: user.email,
        role: this.normalizeMemberRole(invitation.role),
        status: 'accepted',
      },
      recipientUserId: adminIds.length > 0 ? adminIds[0] : null,
    });

    return {
      message: 'Invitation accepted successfully',
      workspaceSlug: invitation.workspace_slug,
    };
  }

  async declineWorkspaceInvitation(invitationId: string, userId: string) {
    const user = await this.db
      .selectFrom('auth.users')
      .select(['id', 'email'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();

    const invitation = await this.db
      .selectFrom('workspaces.workspace_invitations as wi')
      .innerJoin('workspaces.workspaces as w', 'w.id', 'wi.workspace_id')
      .select([
        'wi.id',
        'wi.workspace_id',
        'wi.email',
        'wi.role',
        'wi.status',
        'wi.expires_at',
        'w.slug as workspace_slug',
        'w.name as workspace_name',
      ])
      .where('wi.id', '=', invitationId)
      .where((eb) =>
        eb.or([
          eb('wi.invited_user_id', '=', user.id),
          eb('wi.email', '=', user.email.toLowerCase()),
        ]),
      )
      .executeTakeFirst();

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new BadRequestException('Invitation is no longer pending');
    }

    await this.db
      .updateTable('workspaces.workspace_invitations')
      .set({
        status: 'declined',
        responded_at: new Date(),
        responded_by_user_id: user.id,
        response: 'declined',
      })
      .where('id', '=', invitation.id)
      .executeTakeFirst();

    const adminIds = await this.findWorkspaceAdminIds(invitation.workspace_id);

    await this.notificationsService.publishEvent({
      eventType: 'workspace.invite.declined',
      workspaceId: invitation.workspace_id,
      actorUserId: user.id,
      entityType: 'workspace_invitation',
      entityId: invitation.id,
      payload: {
        workspaceSlug: invitation.workspace_slug,
        workspaceName: invitation.workspace_name,
        invitedEmail: user.email,
        role: invitation.role,
        status: 'declined',
      },
      recipientUserId: adminIds.length > 0 ? adminIds[0] : null,
    });

    return { message: 'Invitation declined successfully' };
  }

  async findMyNotificationFeed(userId: string) {
    return this.notificationsService.findFeedForUser(userId);
  }

  private async isInvited(workspaceId: string, email: string) {
    const invitation = await this.db
      .selectFrom('workspaces.workspace_invitations')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .where('email', '=', email)
      .where('status', '=', 'pending')
      .executeTakeFirst();

    return !!invitation;
  }

  private async findWorkspaceAdminIds(workspaceId: string): Promise<string[]> {
    const admins = await this.db
      .selectFrom('workspaces.workspace_members')
      .select('member_id')
      .where('workspace_id', '=', workspaceId)
      .where(sql<boolean>`lower(role) = 'admin'`)
      .execute();

    return admins.map((admin) => admin.member_id);
  }

  private hashToken(): { hashedToken: string; token: string } {
    const token = randomBytes(32).toString('hex');

    const hashedToken = createHash('sha256').update(token).digest('hex');

    return { hashedToken, token };
  }

  private normalizeMemberRole(role: string): 'Admin' | 'Member' {
    const normalized = role.trim().toLowerCase();

    if (normalized === 'admin') {
      return 'Admin';
    }

    if (normalized === 'member') {
      return 'Member';
    }

    throw new BadRequestException('Role must be either Admin or Member');
  }

  private async resolveWorkspaceMemberAccess(
    workspaceSlug: string,
    userId: string,
  ) {
    const workspace = await this.db
      .selectFrom('workspaces.workspaces as w')
      .innerJoin('workspaces.workspace_members as wm', (join) =>
        join
          .onRef('wm.workspace_id', '=', 'w.id')
          .on('wm.member_id', '=', userId),
      )
      .select(['w.id', 'w.owner_id', 'wm.role'])
      .where('w.slug', '=', workspaceSlug)
      .executeTakeFirst();

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return workspace;
  }

  private async findWorkspaceMember(workspaceId: string, memberId: string) {
    const member = await this.db
      .selectFrom('workspaces.workspace_members')
      .select(['member_id', 'role'])
      .where('workspace_id', '=', workspaceId)
      .where('member_id', '=', memberId)
      .executeTakeFirst();

    if (!member) {
      throw new NotFoundException('Member not found in workspace');
    }

    return member;
  }

  async findWorkspaceMembers(workspaceSlug: string) {
    const workspace = await this.db
      .selectFrom('workspaces.workspaces')
      .select('id')
      .where('slug', '=', workspaceSlug)
      .executeTakeFirst();

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const members = await this.db
      .selectFrom('workspaces.workspace_members as wm')
      .innerJoin('auth.users as u', 'u.id', 'wm.member_id')
      .select([
        'wm.role',
        'wm.joined_at',
        'u.id as user_id',
        'u.username',
        'u.email',
      ])
      .where('wm.workspace_id', '=', workspace.id)
      .execute();
    return members;
  }

  async updateWorkspaceMemberRole(
    workspaceSlug: string,
    userId: string,
    memberId: string,
    dto: UpdateWorkspaceMemberRoleDto,
  ) {
    const workspace = await this.resolveWorkspaceMemberAccess(
      workspaceSlug,
      userId,
    );
    const actorRole = workspace.role.toLowerCase();

    if (actorRole !== 'admin') {
      throw new ForbiddenException('Only admins can update member roles');
    }

    const targetMember = await this.findWorkspaceMember(workspace.id, memberId);
    const nextRole = this.normalizeMemberRole(dto.role);

    if (targetMember.member_id === workspace.owner_id && nextRole !== 'Admin') {
      throw new ForbiddenException('Workspace owner role cannot be downgraded');
    }

    await this.db
      .updateTable('workspaces.workspace_members')
      .set({ role: nextRole })
      .where('workspace_id', '=', workspace.id)
      .where('member_id', '=', memberId)
      .executeTakeFirst();

    const updatedMember = await this.db
      .selectFrom('workspaces.workspace_members as wm')
      .innerJoin('auth.users as u', 'u.id', 'wm.member_id')
      .select([
        'wm.role',
        'wm.joined_at',
        'u.id as user_id',
        'u.username',
        'u.email',
      ])
      .where('wm.workspace_id', '=', workspace.id)
      .where('wm.member_id', '=', memberId)
      .executeTakeFirstOrThrow();

    return updatedMember;
  }

  async removeWorkspaceMember(
    workspaceSlug: string,
    userId: string,
    memberId: string,
  ) {
    const workspace = await this.resolveWorkspaceMemberAccess(
      workspaceSlug,
      userId,
    );
    const actorRole = workspace.role.toLowerCase();

    if (actorRole !== 'admin') {
      throw new ForbiddenException('Only admins can remove members');
    }

    const targetMember = await this.findWorkspaceMember(workspace.id, memberId);

    if (targetMember.member_id === workspace.owner_id) {
      throw new ForbiddenException('Workspace owner cannot be removed');
    }

    if (targetMember.member_id === userId) {
      throw new ForbiddenException(
        'You cannot remove yourself from this workspace',
      );
    }

    await this.db
      .deleteFrom('workspaces.workspace_members')
      .where('workspace_id', '=', workspace.id)
      .where('member_id', '=', memberId)
      .executeTakeFirst();

    return { message: 'Member removed successfully' };
  }
}
