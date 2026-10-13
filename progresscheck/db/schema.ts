import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workspaces = sqliteTable("workspaces", {
  owner: text("owner").primaryKey(),
  state: text("state").notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").notNull(),
});

export const photoAssets = sqliteTable("photo_assets", {
  owner: text("owner").notNull(),
  id: text("id").notNull(),
  key: text("key").notNull(),
  mime: text("mime").notNull(),
  name: text("name").notNull(),
}, (table) => [primaryKey({ columns: [table.owner, table.id] })]);
