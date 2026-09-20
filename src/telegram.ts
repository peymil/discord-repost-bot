import {TelegramClient, Api} from "telegram";
import {StringSession} from "telegram/sessions/index.js";
import {NewMessage, NewMessageEvent} from "telegram/events/index.js";
import {AttachmentBuilder} from "discord.js";
import {discordClient} from "./discord.js";
import {buildHookIndex, hooksForChat} from "./telegramHooks.js";

const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10)
const apiHash = process.env.TELEGRAM_API_HASH || ""
const sessionString = process.env.TELEGRAM_SESSION || ""

const DISCORD_MAX_UPLOAD_BYTES = parseInt(process.env.DISCORD_MAX_UPLOAD_MB || "10", 10) * 1024 * 1024

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
    if (message.out) return

    const chatId = message.chatId?.toString()
    if (!chatId) return

    const hooks = hooksForChat(chatId)
    if (hooks.length === 0) return

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
                mediaName = message.file?.name || mediaName
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