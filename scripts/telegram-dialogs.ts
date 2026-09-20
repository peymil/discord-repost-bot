import "dotenv/config";
import {getEntityChatId, getTelegramClient, telegramConfigured} from "../src/telegram.js";

const main = async () => {
    if (!telegramConfigured) {
        console.error("Set TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_SESSION in .env first.")
        process.exit(1)
    }

    const telegramClient = getTelegramClient()
    await telegramClient.connect()
    if (!(await telegramClient.isUserAuthorized())) {
        console.error("Telegram session is not authorized. Run `npm run telegram:login` first.")
        process.exit(1)
    }

    const dialogs = await telegramClient.getDialogs({})
    console.log("chat_id\ttitle\t@username")
    for (const dialog of dialogs) {
        const entity: any = dialog.entity
        const chatId = entity ? getEntityChatId(entity) : String(dialog.id)
        const username = entity?.username ? `@${entity.username}` : ""
        console.log(`${chatId}\t${dialog.title || ""}\t${username}`)
    }

    await telegramClient.disconnect()
    process.exit(0)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})