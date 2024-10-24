import {text, integer, index, sqliteTable, blob, unique} from "drizzle-orm/sqlite-core";

export const posts = sqliteTable('posts', {
    id: integer('id').primaryKey(),
    created_at: integer('created_at', {mode: "timestamp_ms"}).defaultNow().notNull(),
    user_id: text('user_id').notNull(),
    messageUrl: text('message_url').notNull(),
    message: text('message').notNull(),
}, (table) => {
    return {
        userIdIdx: index('user_id_idx').on(table.user_id),
        createdAtIdx: index('created_at_idx').on(table.created_at)
    }
});

export const attachments = sqliteTable('attachments', {
    pHash: blob('hash', {mode: "buffer"}).notNull(),
    postId: integer('post_id').notNull().references(() => posts.id)
}, (table) => {
    return {
        hashIdx: index('hash_idx').on(table.pHash),
    }
})

export const links = sqliteTable('links', {
    url: text('url').notNull(),
    postId: integer('post_id').notNull().references(() => posts.id)
}, (table) => {
    return {
        urlIdx: index('url_idx').on(table.url)
    }
})

export const link_blacklist = sqliteTable('link_blacklist', {
    url: text('url').notNull()
}, (table) => {
    return {
        urlIdx: unique('link_blacklist_url_idx').on(table.url)
    }
})