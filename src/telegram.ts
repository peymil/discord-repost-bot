import {TelegramClient, Api} from "telegram";
import {StringSession} from "telegram/sessions/index.js";
import {AttachmentBuilder} from "discord.js";
import {discordClient} from "./discord.js";
import {buildHookIndex, hooksForChat, knownChats, HookTarget} from "./telegramHooks.js";
import {getGuildSettings, saveGuildSettings} from "./settings.js";

const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10)
const apiHash = process.env.TELEGRAM_API_HASH || ""
const sessionString = process.env.TELEGRAM_SESSION || ""

const DISCORD_MAX_UPLOAD_BYTES = parseInt(process.env.DISCORD_MAX_UPLOAD_MB || "10", 10) * 1024 * 1024
const POLL_INTERVAL_MS = parseInt(process.env.TELEGRAM_POLL_INTERVAL_MS || "60000", 10)
const BACKFILL_COUNT = parseInt(process.env.TELEGRAM_BACKFILL || "0", 10)

const MIME_EXTENSIONS: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
    "audio/x-wav": "wav",
    "audio/wav": "wav",
    "audio/flac": "flac",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "application/x-rar-compressed": "rar",
    "application/x-7z-compressed": "7z",
    "application/json": "json",
    "text/plain": "txt",
    "text/csv": "csv"
}

const extensionForMime = (mime: string | undefined): string | undefined => {
    if (!mime) return undefined
    const normalized = mime.split(";")[0].trim().toLowerCase()
    if (!normalized) return undefined
    if (MIME_EXTENSIONS[normalized]) return MIME_EXTENSIONS[normalized]
    if (normalized.startsWith("image/")) return normalized.slice(6)
    if (normalized.startsWith("video/")) return normalized.slice(6)
    if (normalized.startsWith("audio/")) return normalized.slice(6)
    return normalized === "application/octet-stream" ? "bin" : undefined
}

const buildMediaName = (name: string | undefined, mime: string | undefined, messageId: number): string => {
    const extension = extensionForMime(mime)
    if (!name) {
        return `telegram_${messageId}${extension ? `.${extension}` : ""}`
    }
    const hasExtension = /\.[a-z0-9]{1,8}$/i.test(name)
    if (!hasExtension && extension) return `${name}.${extension}`
    return name
}

const DISCORD_MAX_CONTENT_LENGTH = 2000

const splitContent = (content: string, limit = DISCORD_MAX_CONTENT_LENGTH): string[] => {
    if (!content) return []
    if (content.length <= limit) return [content]

    const chunks: string[] = []
    let remaining = content
    while (remaining.length > limit) {
        let splitAt = remaining.lastIndexOf("\n", limit)
        if (splitAt <= 0) splitAt = remaining.lastIndexOf(" ", limit)
        if (splitAt <= 0) splitAt = limit
        chunks.push(remaining.slice(0, splitAt))
        remaining = remaining.slice(splitAt).replace(/^\n/, "")
    }
    if (remaining.length) chunks.push(remaining)
    return chunks
}

const sendToChannel = async (channel: any, content: string, files: AttachmentBuilder[]): Promise<void> => {
    const chunks = splitContent(content)
    if (chunks.length === 0) {
        await channel.send(files.length ? {files} : {content: ""})
        return
    }
    for (let i = 0; i < chunks.length; i++) {
        await channel.send({
            content: chunks[i],
            files: i === 0 && files.length ? files : undefined
        })
    }
}

export const telegramConfigured = apiId > 0 && !!apiHash && !!sessionString

let telegramClient: TelegramClient | undefined

export const getTelegramClient = (): TelegramClient => {
    if (!telegramConfigured) {
        throw new Error("Telegram bridge is not configured (missing TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION)")
    }
    if (!telegramClient) {
        telegramClient = new TelegramClient(
            new StringSession(sessionString),
            apiId,
            apiHash,
            {connectionRetries: 5}
        )
    }
    return telegramClient
}

export const getEntityChatId = (entity: any): string => {
    const className = entity?.className
    if (className === "Channel") return `-100${entity.id.toString()}`
    if (className === "Chat") return `-${entity.id.toString()}`
    return entity.id.toString()
}

const getEntityTitle = (entity: any): string => {
    if (entity?.title) return entity.title
    const name = [entity?.firstName, entity?.lastName].filter(Boolean).join(" ")
    if (name) return name
    if (entity?.username) return entity.username
    return entity?.id?.toString() || "unknown"
}

export const resolveTelegramChat = async (target: string) => {
    const client = getTelegramClient()
    const isNumeric = /^-?\d+$/.test(target)
    const entity = await client.getEntity(isNumeric ? Number(target) : target)
    return {
        chatId: getEntityChatId(entity),
        title: getEntityTitle(entity)
    }
}

const senderName = async (message: Api.Message): Promise<string> => {
    if (message.postAuthor) return message.postAuthor
    const sender: any = await message.getSender().catch(() => undefined)
    if (sender?.title) return sender.title
    const name = [sender?.firstName, sender?.lastName].filter(Boolean).join(" ")
    if (name) return name
    if (sender?.username) return sender.username
    return "Telegram"
}

const forwardTelegramMessage = async (chatId: string, message: Api.Message, hooks: HookTarget[]) => {
    const text = message.message || ""
    const hasMedia = !!(message.photo || message.document || message.video || message.audio || message.voice)
    if (!text && !hasMedia) return

    let mediaBuffer: Buffer | undefined
    let mediaName = `telegram_${message.id}`
    if (hasMedia) {
        try {
            const downloaded = await getTelegramClient().downloadMedia(message)
            if (Buffer.isBuffer(downloaded) && downloaded.length > 0) {
                mediaBuffer = downloaded
                const file = message.file
                mediaName = buildMediaName(file?.name, file?.mimeType, message.id)
            }
        } catch (e) {
            console.error(`[telegram] failed to download media for ${chatId}/${message.id}`, e)
        }
    }

    const name = await senderName(message)
    const content = `**${name}:** ${text}`.trim()

    for (const hook of hooks) {
        try {
            const channel: any = await discordClient.channels.fetch(hook.threadId)
            if (!channel || typeof channel.send !== "function") continue

            const files: AttachmentBuilder[] = []
            if (mediaBuffer) {
                if (mediaBuffer.length <= DISCORD_MAX_UPLOAD_BYTES) {
                    files.push(new AttachmentBuilder(mediaBuffer, {name: mediaName}))
                } else {
                    console.warn(`[telegram] media ${chatId}/${message.id} exceeds Discord upload limit; sending text only`)
                }
            }

            try {
                await sendToChannel(channel, content, files)
            } catch (e) {
                if (channel.isThread?.() && channel.archived) {
                    await channel.setArchived(false)
                    await sendToChannel(channel, content, files)
                } else {
                    throw e
                }
            }
        } catch (e) {
            console.error(`Failed to forward telegram message ${chatId}/${message.id} to thread ${hook.threadId}`, e)
        }
    }
}

const persistLastMessageId = async (chatId: string, hooks: HookTarget[], messageId: number) => {
    const byGuild = new Map<string, HookTarget[]>()
    for (const hook of hooks) {
        const list = byGuild.get(hook.guildId) || []
        list.push(hook)
        byGuild.set(hook.guildId, list)
    }

    for (const [guildId, guildHooks] of byGuild) {
        try {
            const settings = await getGuildSettings(guildId)
            const entries = settings.telegramHooks || []
            for (const guildHook of guildHooks) {
                const entry = entries.find(e => e.telegramChatId === chatId && e.threadId === guildHook.threadId)
                if (entry) entry.lastMessageId = messageId
                guildHook.lastMessageId = messageId
            }
            await saveGuildSettings(guildId, settings)
        } catch (e) {
            console.error(`[telegram] failed to persist last message id for ${chatId}`, e)
        }
    }
}

let polling = false

const pollChat = async (chatId: string) => {
    const hooks = hooksForChat(chatId)
    if (hooks.length === 0) return

    const client = getTelegramClient()
    const entity = await client.getEntity(Number(chatId))
    const messages = await client.getMessages(entity, {limit: Math.max(20, BACKFILL_COUNT)})
    const ascending = messages.slice().sort((a, b) => a.id - b.id)
    if (ascending.length === 0) return

    const latest = ascending[ascending.length - 1].id
    const known = hooks.map(h => h.lastMessageId).filter((v): v is number => typeof v === "number")
    let lastSeen: number
    if (known.length > 0) {
        lastSeen = Math.min(...known)
    } else if (BACKFILL_COUNT > 0) {
        const startIndex = Math.max(0, ascending.length - BACKFILL_COUNT)
        lastSeen = startIndex > 0 ? ascending[startIndex - 1].id : ascending[0].id - 1
    } else {
        lastSeen = latest
    }

    const fresh = ascending.filter(m => m.id > lastSeen)
    for (const message of fresh) {
        console.log(`[telegram] forwarding message ${chatId}/${message.id} to ${hooks.length} thread(s)`)
        await forwardTelegramMessage(chatId, message, hooks)
    }

    const nextId = fresh.length > 0 ? fresh[fresh.length - 1].id : lastSeen
    if (nextId !== lastSeen || known.length === 0) {
        await persistLastMessageId(chatId, hooks, nextId)
    }
}

export const pollTelegramHooks = async () => {
    if (!telegramConfigured || polling) return
    polling = true
    try {
        for (const chatId of knownChats()) {
            try {
                await pollChat(chatId)
            } catch (e) {
                console.error(`[telegram] failed to poll ${chatId}`, e)
            }
        }
    } finally {
        polling = false
    }
}

export const startTelegram = async () => {
    if (!telegramConfigured) {
        console.warn("Telegram bridge disabled: set TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_SESSION")
        return
    }

    await buildHookIndex()
    const client = getTelegramClient()
    await client.connect()
    if (!(await client.isUserAuthorized())) {
        console.error("Telegram session is not authorized. Run `npm run telegram:login` and update TELEGRAM_SESSION.")
        return
    }

    await pollTelegramHooks()
    setInterval(() => { void pollTelegramHooks() }, POLL_INTERVAL_MS)
    console.log(`Telegram bridge connected. Polling every ${Math.round(POLL_INTERVAL_MS / 1000)}s`)
}