import {text, integer, index, sqliteTable, blob, unique} from "drizzle-orm/sqlite-core";

export const posts = sqliteTable('posts', {
    id: integer('id').primaryKey(),
    created_at: integer('created_at', {mode: "timestamp_ms"}).defaultNow().notNull(),
    user_id: text('user_id').notNull(),
    messageUrl: text('message_url').notNull(),
    message: text('message').notNull(),
    guild_id: text('guild_id'),
}, (table) => {
    return {
        userIdIdx: index('user_id_idx').on(table.user_id),
        createdAtIdx: index('created_at_idx').on(table.created_at),
        guildIdIdx: index('posts_guild_id_idx').on(table.guild_id),
    }
});

export const attachments = sqliteTable('attachments', {
    pHash: blob('hash', {mode: "buffer"}).notNull(),
    postId: integer('post_id').notNull().references(() => posts.id),
    guild_id: text('guild_id'),
}, (table) => {
    return {
        hashIdx: index('hash_idx').on(table.pHash),
        guildIdIdx: index('attachments_guild_id_idx').on(table.guild_id),
    }
})

export const links = sqliteTable('links', {
    url: text('url').notNull(),
    postId: integer('post_id').notNull().references(() => posts.id),
    guild_id: text('guild_id'),
}, (table) => {
    return {
        urlIdx: index('url_idx').on(table.url),
        guildIdIdx: index('links_guild_id_idx').on(table.guild_id),
    }
})

export const link_blacklist = sqliteTable('link_blacklist', {
    url: text('url').notNull(),
    guild_id: text('guild_id'),
}, (table) => {
    return {
        urlIdx: unique('link_blacklist_url_idx').on(table.url, table.guild_id),
        guildIdIdx: index('blacklist_guild_id_idx').on(table.guild_id),
    }
})

export const guilds = sqliteTable('guilds', {
    guild_id: text('guild_id').primaryKey(),
    settings: text('settings', {mode: 'json'}).notNull().default('{}'),
    created_at: integer('created_at', {mode: "timestamp_ms"}).defaultNow().notNull()
})

export const whitelist = sqliteTable('whitelist', {
    pattern: text('pattern').notNull(),
    guild_id: text('guild_id'),
}, (table) => {
    return {
        patternIdx: unique('whitelist_pattern_idx').on(table.pattern, table.guild_id),
        guildIdIdx: index('whitelist_guild_id_idx').on(table.guild_id),
    }
})