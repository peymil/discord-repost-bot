import {db} from "./sqlite.js";
import {guilds} from "./schema.js";
import {normalizeSettings} from "./settings.js";
import {isAllowedGuild} from "./allowedServers.js";

export interface HookTarget {
    guildId: string;
    threadId: string;
    threadName: string;
}

const hookIndex = new Map<string, HookTarget[]>()

export const buildHookIndex = async (): Promise<void> => {
    hookIndex.clear()
    const rows = await db.select().from(guilds).execute()
    for (const row of rows) {
        if (!isAllowedGuild(row.guild_id)) continue
        const settings = normalizeSettings(row.settings)
        for (const hook of settings.telegramHooks || []) {
            const key = String(hook.telegramChatId)
            const targets = hookIndex.get(key) || []
            targets.push({
                guildId: row.guild_id,
                threadId: hook.threadId,
                threadName: hook.threadName
            })
            hookIndex.set(key, targets)
        }
    }
    console.log(`Telegram hook index built: ${hookIndex.size} chat(s)`)
}

export const hooksForChat = (chatId: string): HookTarget[] => {
    return hookIndex.get(chatId) || []
}