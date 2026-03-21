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

@Injectable()
export class WorkspacesService {
  constructor(@Inject(DATABASE_TOKEN) private readonly db: Kysely<DB>) {}

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

    const { email, role } = dto;

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
        token_hash: tokens.hashedToken,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returningAll()
      .executeTakeFirst();

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
      .select([
        'id',
        'email',
        'role',
        'status',
        'expires_at',
        'accepted_at',
      ])
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
      .select(['id', 'status'])
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

    return { message: 'Invitation revoked successfully' };
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
