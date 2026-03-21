import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';

import { DATABASE_TOKEN } from '../../database/database.module';
import type { DB, JsonValue } from '../../database/database.types';
import { NotificationsGateway } from './notifications.gateway';

export type NotificationEventType =
  | 'workspace.invite.created'
  | 'workspace.invite.revoked'
  | 'workspace.invite.accepted'
  | 'workspace.invite.declined';

type PublishNotificationEventInput = {
  eventType: NotificationEventType;
  workspaceId?: string;
  actorUserId?: string;
  entityType: string;
  entityId?: string;
  payload: Record<string, JsonValue>;
  recipientUserIds: string[];
};

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DATABASE_TOKEN) private readonly db: Kysely<DB>,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  async publishEvent(input: PublishNotificationEventInput) {
    const recipients = [...new Set(input.recipientUserIds.filter(Boolean))];

    if (recipients.length === 0) {
      return null;
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
      .values(
        recipients.map((recipientUserId) => ({
          event_id: event.id,
          recipient_user_id: recipientUserId,
        })),
      )
      .execute();

    this.notificationsGateway.emitToUsers(recipients, 'notification.created', {
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
      .select([
        'd.id as delivery_id',
        'e.id as event_id',
        'e.event_type',
        'e.entity_id',
        'e.payload',
        'e.created_at',
        'w.id as workspace_id',
        'w.name as workspace_name',
        'w.slug as workspace_slug',
      ])
      .where('d.recipient_user_id', '=', userId)
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
        message: this.buildMessage(row.event_type, row.workspace_name),
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

  private buildMessage(eventType: string, workspaceName: string | null) {
    const workspaceLabel = workspaceName ?? 'a workspace';

    switch (eventType) {
      case 'workspace.invite.created':
        return `You have a workspace invitation to ${workspaceLabel}.`;
      case 'workspace.invite.accepted':
        return `An invitation was accepted in ${workspaceLabel}.`;
      case 'workspace.invite.declined':
        return `An invitation was declined in ${workspaceLabel}.`;
      case 'workspace.invite.revoked':
        return `An invitation was revoked in ${workspaceLabel}.`;
      default:
        return 'You have a new notification.';
    }
  }
}