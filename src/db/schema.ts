import { boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    nickname: text('nickname').notNull().unique(),
    color: text('color').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date', precision: 3 }).notNull().defaultNow(),
  },
  // Nicknames are unique regardless of case ("Alice" and "alice" can't both exist)
  (t) => [uniqueIndex('users_nickname_lower_idx').on(sql`lower(${t.nickname})`)],
);

export const rooms = pgTable('rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  createdBy: text('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date', precision: 3 }).notNull().defaultNow(),
});

export const messageTypes = ['message', 'join', 'leave', 'rename'] as const;
export type MessageType = (typeof messageTypes)[number];

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id').notNull().references(() => rooms.id),
    userId: text('user_id').references(() => users.id),
    content: text('content').notNull(),
    type: text('type', { enum: messageTypes }).notNull().default('message'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date', precision: 3 }).notNull().defaultNow(),
  },
  (t) => [index('messages_room_time_idx').on(t.roomId, t.createdAt)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    fromUserId: text('from_user_id').notNull().references(() => users.id),
    roomId: text('room_id').notNull().references(() => rooms.id),
    messageId: text('message_id').notNull().references(() => messages.id),
    preview: text('preview').notNull(),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date', precision: 3 }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.read, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type Message = typeof messages.$inferSelect;
