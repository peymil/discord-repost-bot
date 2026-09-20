import "dotenv/config";
import readline from "node:readline";
import {TelegramClient} from "telegram";
import {StringSession} from "telegram/sessions/index.js";

const apiId = parseInt(process.env.TELEGRAM_API_ID || "0", 10)
const apiHash = process.env.TELEGRAM_API_HASH || ""

const main = async () => {
    if (!apiId || !apiHash) {
        console.error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env first (get them from https://my.telegram.org).")
        process.exit(1)
    }

    const rl = readline.createInterface({input: process.stdin, output: process.stdout})
    const question = (q: string) => new Promise<string>(resolve => rl.question(q, resolve))

    const session = new StringSession("")
    const client = new TelegramClient(session, apiId, apiHash, {connectionRetries: 5})

    await client.start({
        phoneNumber: async () => await question("Phone number (e.g. +15551234567): "),
        password: async () => await question("2FA password (leave empty if none): "),
        phoneCode: async () => await question("Login code from Telegram: "),
        onError: (err) => console.error(err),
    })

    console.log("\nLogin successful. Add this line to your .env:\n")
    console.log(`TELEGRAM_SESSION=${client.session.save()}\n`)

    await client.disconnect()
    rl.close()
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})