import "dotenv/config";
import {discordClient} from "./discord.js";
import {db} from "./sqlite.js";
import phash from "sharp-phash"
import {and, asc, eq, gt} from "drizzle-orm";
import {attachments, link_blacklist, links, posts} from "./schema.js";
import distance from "sharp-phash/distance.js";
import {ApplicationCommandOptionType, PermissionsBitField} from "discord.js";


const whitelist = [
    "tenor.com",
    "giphy.com",
    "discord.com/channels",
    "cdn.discordapp.com",
    "media.discordapp.net",
    "imgur.com"
]

const main = async () => {


    Promise.all(whitelist.map((url) => {
        db.insert(link_blacklist).values({
            url
        }).execute().catch(() => {
            console.log(url + "Already exists in blacklist")
        })
    }))
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

        if (message.author.bot) return;
        const post = await db.insert(posts).values({
            user_id: message.author.id,
            message: message.content,
            messageUrl: message.url
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
                        ).orderBy(asc(posts.created_at));

                        for (const similarAttachment of similarAttachments) {
                            const distanceValue = distance(hash, similarAttachment.attachments.pHash.toString('binary'))
                            if (distanceValue < 5) {
                                isSimilarImageFound = true;
                                const similarPostUrl = await db.select().from(posts).where(
                                    eq(posts.id, similarAttachment.attachments.postId)
                                ).execute().then((res) => res[0].messageUrl)
                                await message.reply("Repost yapma eşşek " + similarPostUrl)
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
                }
            }
        } else {
            const messageLinks = message.content.match(/https?:\/\/[^\s]+/g)
            const linkBlacklist = await db.select().from(link_blacklist).then((res) => res.map(({url}) => url))
            if (messageLinks && messageLinks.length) {
                for (const messageLink of messageLinks) {

                    if (linkBlacklist.some((b) => messageLink.includes(b))) {
                        break;
                    }

                    const dbMessageLinks = await db.select().from(links).innerJoin(posts, eq(links.postId, posts.id)).where(
                        and(
                            eq(links.url, messageLink),
                            gt(posts.created_at, new Date(Date.now() - 1000 * 60 * 60 * 24))
                        ))
                        .orderBy(asc(posts.created_at))
                        .execute()

                    if (dbMessageLinks.map((link) => link.links.url).includes(messageLink)) {
                        await message.reply("Repost yapma eşşek " + message.url)
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

main()