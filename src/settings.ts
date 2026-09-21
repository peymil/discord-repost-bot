import {eq} from "drizzle-orm";
import {db} from "./sqlite.js";
import {guilds} from "./schema.js";

export interface TelegramHook {
    threadId: string;
    threadName: string;
    telegramChatId: string;
    telegramTitle: string;
    lastMessageId?: number;
    createdAt: string;
}

export interface GuildSettings {
    repostInterval?: string;
    telegramHooks?: TelegramHook[];
    [key: string]: unknown;
}

export const normalizeSettings = (raw: unknown): GuildSettings => {
    if (!raw) return {}
    if (typeof raw === "string") {
        try {
            return JSON.parse(raw)
        } catch {
            return {}
        }
    }
    return raw as GuildSettings
}

export const getGuildSettings = async (guildId: string): Promise<GuildSettings> => {
    const rows = await db.select().from(guilds).where(eq(guilds.guild_id, guildId)).execute()
    if (rows.length === 0) return {}
    return normalizeSettings(rows[0].settings)
}

export const saveGuildSettings = async (guildId: string, settings: GuildSettings): Promise<void> => {
    const serialized = JSON.stringify(settings)
    await db.insert(guilds).values({
        guild_id: guildId,
        settings: serialized
    }).onConflictDoUpdate({
        target: guilds.guild_id,
        set: {settings: serialized}
    }).execute()
}