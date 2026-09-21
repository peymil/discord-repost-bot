import {db} from "./sqlite.js";
import {guilds} from "./schema.js";
import {normalizeSettings} from "./settings.js";
import {isAllowedGuild} from "./allowedServers.js";

export interface HookTarget {
    guildId: string;
    threadId: string;
    threadName: string;
    lastMessageId?: number;
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
                threadName: hook.threadName,
                lastMessageId: typeof hook.lastMessageId === "number" ? hook.lastMessageId : undefined
            })
            hookIndex.set(key, targets)
        }
    }
    for (const [chatId, targets] of hookIndex) {
        const details = targets.map(t => `${t.guildId}/${t.threadId}@${t.lastMessageId ?? "new"}`).join(", ")
        console.log(`Telegram hook ${chatId} -> ${details}`)
    }
    console.log(`Telegram hook index built: ${hookIndex.size} chat(s)`)
}

export const hooksForChat = (chatId: string): HookTarget[] => {
    return hookIndex.get(chatId) || []
}

export const knownChats = (): string[] => {
    return Array.from(hookIndex.keys())
}