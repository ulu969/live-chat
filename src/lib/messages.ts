import { and, asc, desc, eq, gte, lt, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, schema } from '../db/client';
import type { MessageType } from '../db/schema';

export type ChatMessage = {
  id: string;
  roomId: string;
  content: string;
  type: MessageType;
  createdAt: Date;
  user: { id: string; nickname: string; color: string } | null;
};

export const PAGE_SIZE = 50;

/**
 * Newest `limit` messages in a room, returned oldest-first.
 * `before` pages backwards: messages older than that timestamp, using `beforeId`
 * to break ties between messages sent in the same millisecond.
 */
export async function listMessages(
  roomId: string,
  opts: { before?: Date; beforeId?: string; limit?: number } = {},
) {
  const limit = opts.limit ?? PAGE_SIZE;
  const rows = await db
    .select({
      id: schema.messages.id,
      roomId: schema.messages.roomId,
      content: schema.messages.content,
      type: schema.messages.type,
      createdAt: schema.messages.createdAt,
      userId: schema.users.id,
      nickname: schema.users.nickname,
      color: schema.users.color,
    })
    .from(schema.messages)
    .leftJoin(schema.users, eq(schema.messages.userId, schema.users.id))
    .where(
      and(
        eq(schema.messages.roomId, roomId),
        opts.before
          ? opts.beforeId
            ? or(
                lt(schema.messages.createdAt, opts.before),
                and(eq(schema.messages.createdAt, opts.before), lt(schema.messages.id, opts.beforeId)),
              )
            : lt(schema.messages.createdAt, opts.before)
          : undefined,
      ),
    )
    .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  return {
    hasMore,
    messages: page.map<ChatMessage>((r) => ({
      id: r.id,
      roomId: r.roomId,
      content: r.content,
      type: r.type,
      createdAt: r.createdAt,
      user: r.userId ? { id: r.userId, nickname: r.nickname!, color: r.color! } : null,
    })),
  };
}

export const MAX_MESSAGE_LENGTH = 2000;

export async function createMessage(input: {
  roomId: string;
  user: { id: string; nickname: string; color: string } | null;
  content: string;
  type?: MessageType;
}): Promise<ChatMessage> {
  const [row] = await db
    .insert(schema.messages)
    .values({
      id: nanoid(),
      roomId: input.roomId,
      userId: input.user?.id ?? null,
      content: input.content,
      type: input.type ?? 'message',
    })
    .returning();
  return {
    id: row.id,
    roomId: row.roomId,
    content: row.content,
    type: row.type,
    createdAt: row.createdAt,
    user: input.user,
  };
}

/** The person's most recent join/leave event in a room, if any. */
export async function lastMembershipEvent(roomId: string, userId: string): Promise<'join' | 'leave' | null> {
  const [row] = await db
    .select({ type: schema.messages.type })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.roomId, roomId),
        eq(schema.messages.userId, userId),
        or(eq(schema.messages.type, 'join'), eq(schema.messages.type, 'leave')),
      ),
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);
  return (row?.type as 'join' | 'leave' | undefined) ?? null;
}

export const REPLAY_LIMIT = 500;

/** Messages at or after `since` (oldest-first) — what a reconnecting browser missed. */
export async function listMessagesSince(roomId: string, since: Date, limit = REPLAY_LIMIT): Promise<ChatMessage[]> {
  const rows = await db
    .select({
      id: schema.messages.id,
      roomId: schema.messages.roomId,
      content: schema.messages.content,
      type: schema.messages.type,
      createdAt: schema.messages.createdAt,
      userId: schema.users.id,
      nickname: schema.users.nickname,
      color: schema.users.color,
    })
    .from(schema.messages)
    .leftJoin(schema.users, eq(schema.messages.userId, schema.users.id))
    // >= rather than >: the client drops anything it already shows, and this way a
    // message sent in the same millisecond as the last one seen is never skipped.
    .where(and(eq(schema.messages.roomId, roomId), gte(schema.messages.createdAt, since)))
    .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    roomId: r.roomId,
    content: r.content,
    type: r.type,
    createdAt: r.createdAt,
    user: r.userId ? { id: r.userId, nickname: r.nickname!, color: r.color! } : null,
  }));
}
