import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';

import { DATABASE_TOKEN } from '../../database/database.module';
import type { DB, JsonValue } from '../../database/database.types';
import { NotificationsGateway } from './notifications.gateway';

export type NotificationEventType =
  | 'workspace.invite.created'
  | 'workspace.invite.revoked'
  | 'workspace.invite.accepted'
  | 'workspace.invite.declined'
  | 'message.mention.created'
  | 'message.reply.created';

type PublishNotificationEventInput = {
  eventType: NotificationEventType;
  workspaceId?: string;
  actorUserId?: string;
  entityType: string;
  entityId?: string;
  payload: Record<string, JsonValue>;
  recipientUserId: string | null;
};

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Kysely<DB>,
    private readonly notificationsGateway: NotificationsGateway,
  ) { }

  async publishEvent(input: PublishNotificationEventInput) {
    if (!input.recipientUserId) {
      return;
    if(!input.recipientUserId) {
      return
    }


    const event = await this.db
      .insertInto('notifications.events')
      .values({
        event_type: input.eventType,
        workspace_id: input.workspaceId ?? null,
        actor_user_id: input.actorUserId ?? null,
        entity_type: input.entityType,
        entity_id: input.entityId ?? null,
        payload: input.payload,
      })
      .returning([
        'id',
        'event_type',
        'workspace_id',
        'actor_user_id',
        'entity_type',
        'entity_id',
        'payload',
        'created_at',
      ])
      .executeTakeFirstOrThrow();

    await this.db
      .insertInto('notifications.deliveries')
      .values({
        event_id: event.id,
        recipient_user_id: input.recipientUserId,
      })
      .execute();

    this.notificationsGateway.emitToUsers(
      [input.recipientUserId],
      'notification.created',
      {
        eventId: event.id,
        eventType: event.event_type,
        workspaceId: event.workspace_id,
        actorUserId: event.actor_user_id,
        entityType: event.entity_type,
        entityId: event.entity_id,
        payload: event.payload,
        createdAt: event.created_at,
      },
    );
          event_id: event.id,
          recipient_user_id: input.recipientUserId,
      })
      .execute();

    this.notificationsGateway.emitToUsers([input.recipientUserId], 'notification.created', {
      eventId: event.id,
      eventType: event.event_type,
      workspaceId: event.workspace_id,
      actorUserId: event.actor_user_id,
      entityType: event.entity_type,
      entityId: event.entity_id,
      payload: event.payload,
      createdAt: event.created_at,
    });

    return event;
  }

  async findFeedForUser(userId: string, limit = 25) {
    const rows = await this.db
      .selectFrom('notifications.deliveries as d')
      .innerJoin('notifications.events as e', 'e.id', 'd.event_id')
      .leftJoin('workspaces.workspaces as w', 'w.id', 'e.workspace_id')
      .leftJoin('workspaces.workspace_invitations as wi', 'wi.id', 'e.entity_id')
      .innerJoin('workspaces.workspace_invitations as wi', 'wi.workspace_id', 'w.id')
      .select([
        'd.id as delivery_id',
        'd.status as delivery_status',
        'e.id as event_id',
        'e.event_type',
        'e.entity_id',
        'e.payload',
        'e.created_at',
        'w.id as workspace_id',
        'w.name as workspace_name',
        'w.slug as workspace_slug',
        'wi.status as invitation_status',
      ])
      ]) 
      .where('d.recipient_user_id', '=', userId)
      .where('wi.status', 'in', ['accepted', 'pending'])
      .orderBy('e.created_at', 'desc')
      .limit(limit)
      .execute();

    return rows.map((row) => {
      const payload = row.payload as Record<string, unknown>;
      const invitation = this.extractInvitationPayload(payload, row.entity_id);

      return {
        id: row.delivery_id,
        eventId: row.event_id,
        type: row.event_type,
        createdAt: row.created_at,
        workspace: row.workspace_id
          ? {
            id: row.workspace_id,
            name: row.workspace_name,
            slug: row.workspace_slug,
          }
          : null,
        invitation,
        status: row.invitation_status ?? row.delivery_status,
        message: this.buildMessage(
          row.event_type,
          row.workspace_name,
          row.invitation_status,
        ),
        status: row.invitation_status,
        message: this.buildMessage(row.event_type, row.workspace_name, row.invitation_status),
      };
    });
  }

  async markAllAsSeen(userId: string) {
    await this.db
      .updateTable('notifications.deliveries')
      .set({
        status: 'seen',
        seen_at: sql`now()`,
      })
      .where('recipient_user_id', '=', userId)
      .where('status', '=', 'sent')
      .execute();
  }

  private extractInvitationPayload(
    payload: Record<string, unknown>,
    entityId: string | null,
  ) {
    if (!entityId) {
      return null;
    }

    return {
      id: entityId,
      email:
        typeof payload.email === 'string'
          ? payload.email
          : typeof payload.invitedEmail === 'string'
            ? payload.invitedEmail
            : null,
      role: typeof payload.role === 'string' ? payload.role : null,
      status: typeof payload.status === 'string' ? payload.status : null,
      expiresAt:
        typeof payload.expiresAt === 'string' ? payload.expiresAt : null,
    };
  }

  private buildMessage(
    eventType: string,
    workspaceName: string | null,
    invitationStatus: string | null,
  ) {
  private buildMessage(eventType: string, workspaceName: string | null, invitationStatus: string | null) {
    const workspaceLabel = workspaceName ?? 'a workspace';

    switch (eventType) {
      case 'workspace.invite.created':
        if (invitationStatus === 'pending') {
        if(invitationStatus === 'pending') {
          return `You have been invited to join ${workspaceLabel}.`;
        }
        return `You have accepted an invitation to ${workspaceLabel}.`;
      case 'workspace.invite.accepted':
        return `An invitation was accepted in ${workspaceLabel}.`;
      case 'workspace.invite.declined':
        return `An invitation was declined in ${workspaceLabel}.`;
      case 'workspace.invite.revoked':
        return `An invitation was revoked in ${workspaceLabel}.`;
      case 'message.mention.created':
        return `You were mentioned in ${workspaceLabel}.`;
      case 'message.reply.created':
        return `Someone replied to your message in ${workspaceLabel}.`;
      default:
        return 'You have a new notification.';
    }
  }
}
