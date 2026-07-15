import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { randomUUID } from "crypto";

export const documents = pgTable("documents", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  guestId: varchar("guest_id", { length: 64 }).notNull(),
  filename: text("filename").notNull(),
  chunkCount: integer("chunk_count").notNull().default(0),
  status: varchar("status", { length: 32 }).notNull().default("processing"),
  storagePath: text("storage_path"),
  /** Base64 PDF bytes for serverless (Vercel has no durable local disk). */
  fileBytes: text("file_bytes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const chunks = pgTable("chunks", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  guestId: varchar("guest_id", { length: 64 }).notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  page: integer("page").notNull().default(1),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const chats = pgTable("chats", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  guestId: varchar("guest_id", { length: 64 }).notNull(),
  title: text("title").notNull().default("New chat"),
  documentId: uuid("document_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  /** Selected document IDs for this chat; empty/null means all guest docs. */
  documentIds: jsonb("document_ids").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const messages = pgTable("messages", {
  id: uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  chatId: uuid("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 16 }).notNull(),
  content: text("content").notNull(),
  sources: jsonb("sources").$type<SourcePayload[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date()),
});

export type SourcePayload = {
  text: string;
  page: number;
  filename: string;
  documentId: string;
  score?: number;
};
