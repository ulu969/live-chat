import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/client';
import type { ChatMessage } from './messages';

export type NotificationView = {
  id: string;
  roomId: string;
  roomName: string;
  messageId: string;
  fromNickname: string;
  fromColor: string;
  preview: string;
  read: boolean;
  createdAt: Date;
};

const PREVIEW_LENGTH = 120;
const preview = (s: string) => (s.length > PREVIEW_LENGTH ? `${s.slice(0, PREVIEW_LENGTH - 1)}…` : s);

/** One notification per mentioned person (never the sender). Returns the new ids by recipient. */
export async function createMentionNotifications(message: ChatMessage, recipientIds: string[]) {
  const from = message.user!;
  const recipients = [...new Set(recipientIds)].filter((id) => id !== from.id && id !== 'system');
  if (!recipients.length) return [];
  const rows = recipients.map((userId) => ({
    id: nanoid(),
    userId,
    fromUserId: from.id,
    roomId: message.roomId,
    messageId: message.id,
    preview: preview(message.content),
  }));
  await db.insert(schema.notifications).values(rows);
  return rows.map((r) => ({ userId: r.userId, id: r.id }));
}

const select = {
  id: schema.notifications.id,
  roomId: schema.notifications.roomId,
  roomName: schema.rooms.name,
  messageId: schema.notifications.messageId,
  fromNickname: schema.users.nickname,
  fromColor: schema.users.color,
  preview: schema.notifications.preview,
  read: schema.notifications.read,
  createdAt: schema.notifications.createdAt,
};

/** Recent notifications for the bell: unread first, then the latest read ones. */
export async function listNotifications(userId: string, limit = 20): Promise<NotificationView[]> {
  return db
    .select(select)
    .from(schema.notifications)
    .innerJoin(schema.users, eq(schema.users.id, schema.notifications.fromUserId))
    .innerJoin(schema.rooms, eq(schema.rooms.id, schema.notifications.roomId))
    .where(eq(schema.notifications.userId, userId))
    .orderBy(schema.notifications.read, desc(schema.notifications.createdAt))
    .limit(limit);
}

export async function getNotifications(ids: string[]): Promise<NotificationView[]> {
  if (!ids.length) return [];
  return db
    .select(select)
    .from(schema.notifications)
    .innerJoin(schema.users, eq(schema.users.id, schema.notifications.fromUserId))
    .innerJoin(schema.rooms, eq(schema.rooms.id, schema.notifications.roomId))
    .where(inArray(schema.notifications.id, ids));
}

export async function countUnread(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.read, false)));
  return Number(row?.n ?? 0);
}

export async function markAllRead(userId: string) {
  await db
    .update(schema.notifications)
    .set({ read: true })
    .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.read, false)));
}
