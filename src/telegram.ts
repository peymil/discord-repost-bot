import {TelegramClient, Api} from "telegram";
import {StringSession} from "telegram/sessions/index.js";
import {NewMessage, NewMessageEvent} from "telegram/events/index.js";
import {AttachmentBuilder} from "discord.js";
import {discordClient} from "./discord.js";
import {buildHookIndex, hooksForChat, knownChats} from "./telegramHooks.js";

const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10)
const apiHash = process.env.TELEGRAM_API_HASH || ""
const sessionString = process.env.TELEGRAM_SESSION || ""

const DISCORD_MAX_UPLOAD_BYTES = parseInt(process.env.DISCORD_MAX_UPLOAD_MB || "10", 10) * 1024 * 1024

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

const handleTelegramMessage = async (event: NewMessageEvent) => {
    const message = event.message

    const chatId = message.chatId?.toString()
    if (!chatId) return

    const hooks = hooksForChat(chatId)
    if (hooks.length === 0) {
        if (process.env.TELEGRAM_DEBUG) {
            console.log(`[telegram] message in chat ${chatId} has no hook. Known chats: ${knownChats().join(", ") || "(none)"}`)
        }
        return
    }
    console.log(`[telegram] forwarding message from ${chatId} to ${hooks.length} thread(s)`)

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
            console.error("Failed to download telegram media", e)
        }
    }

    const name = await senderName(message)
    const content = mediaBuffer || text ? `**${name}:** ${text}`.trim() : ""

    for (const hook of hooks) {
        try {
            const channel: any = await discordClient.channels.fetch(hook.threadId)
            if (!channel || typeof channel.send !== "function") continue

            const files = []
            if (mediaBuffer) {
                if (mediaBuffer.length <= DISCORD_MAX_UPLOAD_BYTES) {
                    files.push(new AttachmentBuilder(mediaBuffer, {name: mediaName}))
                } else {
                    console.warn(`Telegram media from ${chatId} exceeds Discord upload limit; sending text only`)
                }
            }
            await channel.send({content: content || undefined, files: files.length ? files : undefined})
        } catch (e) {
            console.error(`Failed to forward telegram message to thread ${hook.threadId}`, e)
        }
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

    client.addEventHandler(handleTelegramMessage, new NewMessage({}))
    console.log("Telegram bridge connected")
}