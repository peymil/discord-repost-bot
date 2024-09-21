import "dotenv/config";
import {discordClient} from "./discord";
import {db} from "./sqlite";
import phash from "sharp-phash"
import {and, eq, gt, lt, sql} from "drizzle-orm";
import {attachments, link_blacklist, links, posts} from "./schema";
import distance from "sharp-phash/distance.js";
import {ApplicationCommandOptionType, PermissionsBitField} from "discord.js";


const main = async () => {
    await discordClient.login(process.env.DISCORD_TOKEN)


    discordClient.on('ready', async () => {
        console.log(`Logged in as ${discordClient.user?.tag}!`);
        await discordClient.application!.commands.create({
            name: "register_blacklist",
            dmPermission: false,
            defaultMemberPermissions: PermissionsBitField.Flags.Administrator,
            description: "Register website to whitelist.",
            options: [
                {
                    name: "url",
                    type: ApplicationCommandOptionType.String,
                    description: "URL to register google.com, twitter.com, etc.",
                    required: true
                }
            ]
        })

        await discordClient.application!.commands.create({
            name: "list_blacklist",
            dmPermission: false,
            defaultMemberPermissions: PermissionsBitField.Flags.Administrator,
            description: "List blacklist websites"
        })
    })
    discordClient.on("interactionCreate", async interaction => {
        if (!interaction.isCommand()) return;
        if (interaction.commandName === "register_blacklist") {
            const url = interaction.options.get("url")!;
            await db.insert(link_blacklist).values({
                url: url.value as string
            }).execute()
            await interaction.reply(`URL ${url} added to blacklist`)
        } else if (interaction.commandName === "list_blacklist") {
            const urls = await db.select().from(link_blacklist).execute()
            await interaction.reply(`Blacklisted URLs: ${urls.map(({url}) => url).join(", ")}`)
        }
    })
    discordClient.on('messageCreate', async message => {
        const post = await db.insert(posts).values({
            user_id: message.author.id,
            message: message.content,
        }).execute()
        if (message.attachments.size) {
            let isSimilarImageFound = false;
            for (const attachment of message.attachments.values()) {
                try {
                    const response = Buffer.from(await fetch(attachment.url).then(res => res.arrayBuffer()))
                    const hash = await phash(response)
                    const bufferHash = Buffer.from(hash, 'binary')
                    if (!isSimilarImageFound) {
                        const similarAttachments = await db.select().from(attachments).innerJoin(
                            posts, eq(attachments.postId, posts.id)
                        ).where(
                            gt(posts.created_at, new Date(Date.now() - 1000 * 60 * 60 * 24))
                        )


                        for (const similarAttachment of similarAttachments) {
                            const distanceValue = distance(hash, similarAttachment.attachments.pHash.toString('binary'))
                            if (distanceValue < 16) {
                                isSimilarImageFound = true;
                                await message.reply("Repost yapma eşşek")
                                break;
                            }
                        }
                    }
                    await db.insert(attachments).values({
                        pHash: bufferHash,
                        postId: post.lastInsertRowid as number
                    }).execute()
                } catch (e) {
                    console.error(e)
                    console.log("content-type:", attachment.contentType)
                    console.log("url:", attachment.url)
                    console.log("size:", attachment.size)
                }
            }
        } else {
            const messageLinks = message.content.match(/https?:\/\/[^\s]+/g)
            const linkBlacklist = await db.select().from(link_blacklist).then((res) => res.map(({url}) => url))
            if (messageLinks && messageLinks.length) {
                for (const messageLink of messageLinks) {
                    const rootMessageLink = rootDomain(messageLink)
                    console.log(rootMessageLink)


                    if (linkBlacklist.includes(rootMessageLink)) {
                        break;
                    }

                    const dbMessageLinks = await db.select().from(links).innerJoin(posts, eq(links.postId, posts.id)).where(
                        and(
                            eq(links.url, messageLink),
                            gt(posts.created_at, new Date(Date.now() - 1000 * 60 * 60 * 24))
                        )).execute()

                    if (dbMessageLinks.map((link) => link.links.url).includes(messageLink)) {
                        await message.reply("Repost yapma eşşek")
                        break;
                    }

                    await db.insert(links).values({
                        url: messageLink,
                        postId: post.lastInsertRowid as number
                    }).execute()
                }


            }
        }
    })

}


function rootDomain(_hostname: string) {
    const hostname = new URL(_hostname).hostname;
    let parts = hostname.split(".");
    if (parts.length <= 2)
        return hostname;

    parts = parts.slice(-3);
    if (['co', 'com'].indexOf(parts[1]) > -1)
        return parts.join('.');

    const b = parts.slice(-2).join('.');
    return b.replace("/", "")
}

main()