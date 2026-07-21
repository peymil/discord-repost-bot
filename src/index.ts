import "dotenv/config";
import {discordClient} from "./discord.js";
import {db} from "./sqlite.js";
import phash from "sharp-phash"
import {and, asc, eq, gt} from "drizzle-orm";
import {attachments, link_blacklist, links, posts, guilds, whitelist as whitelistTable} from "./schema.js";
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

const isSuperuser = (userId: string) => {
    const superusersEnv = process.env.SUPERUSERS || ""
    const superusers = superusersEnv.split(",").map(id => id.trim())
    return superusers.includes(userId)
}

const isAdmin = (member: any) => {
    return member.permissions.has(PermissionsBitField.Flags.Administrator)
}

const hasPermission = (interaction: any) => {
    const userId = interaction.user.id;
    const member = interaction.member;
    
    return isSuperuser(userId) || isAdmin(member);
}

const patternMatchesUrl = (pattern: string, url: string) => {
    // Convert wildcard pattern to regex
    const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(url);
}

const getGuildRepostInterval = async (guildId: string | null) => {
    if (!guildId) return 24 * 60 * 60 * 1000; // Default 24 hours
    
    const guild = await db.select().from(guilds).where(eq(guilds.guild_id, guildId)).execute()
    if (guild.length === 0) return 24 * 60 * 60 * 1000;
    
    const settings = JSON.parse(guild[0].settings)
    const interval = settings.repostInterval || "24h"
    
    // Parse interval string like "24h", "12h", "36h"
    const match = interval.match(/^(\d+)([hdm])$/)
    if (!match) return 24 * 60 * 60 * 1000;
    
    const value = parseInt(match[1])
    const unit = match[2]
    
    switch (unit) {
        case "h": return value * 60 * 60 * 1000;
        case "d": return value * 24 * 60 * 60 * 1000;
        case "m": return value * 60 * 1000;
        default: return 24 * 60 * 60 * 1000;
    }
}

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

        await discordClient.application!.commands.create({
            name: "whitelist",
            dmPermission: false,
            defaultMemberPermissions: PermissionsBitField.Flags.Administrator,
            description: "Manage URL whitelist patterns",
            options: [
                {
                    name: "add",
                    type: ApplicationCommandOptionType.Subcommand,
                    description: "Add a URL pattern to whitelist (supports wildcards)",
                    options: [
                        {
                            name: "pattern",
                            type: ApplicationCommandOptionType.String,
                            description: "URL pattern to whitelist (e.g., *.example.com, example.com/*)",
                            required: true
                        }
                    ]
                },
                {
                    name: "remove",
                    type: ApplicationCommandOptionType.Subcommand,
                    description: "Remove a URL pattern from whitelist",
                    options: [
                        {
                            name: "pattern",
                            type: ApplicationCommandOptionType.String,
                            description: "URL pattern to remove from whitelist",
                            required: true
                        }
                    ]
                },
                {
                    name: "list",
                    type: ApplicationCommandOptionType.Subcommand,
                    description: "List all whitelisted URL patterns"
                }
            ]
        })

        await discordClient.application!.commands.create({
            name: "settings",
            dmPermission: false,
            defaultMemberPermissions: PermissionsBitField.Flags.Administrator,
            description: "Manage guild settings",
            options: [
                {
                    name: "set",
                    type: ApplicationCommandOptionType.Subcommand,
                    description: "Set a guild setting",
                    options: [
                        {
                            name: "name",
                            type: ApplicationCommandOptionType.String,
                            description: "Setting name",
                            required: true
                        },
                        {
                            name: "value",
                            type: ApplicationCommandOptionType.String,
                            description: "Setting value",
                            required: true
                        }
                    ]
                },
                {
                    name: "remove",
                    type: ApplicationCommandOptionType.Subcommand,
                    description: "Remove a guild setting",
                    options: [
                        {
                            name: "name",
                            type: ApplicationCommandOptionType.String,
                            description: "Setting name to remove",
                            required: true
                        }
                    ]
                },
                {
                    name: "list",
                    type: ApplicationCommandOptionType.Subcommand,
                    description: "List all guild settings"
                }
            ]
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
        } else if (interaction.commandName === "whitelist") {
            if (!hasPermission(interaction)) {
                await interaction.reply("You don't have permission to use this command")
                return
            }
            
            const subcommand = interaction.options.getSubcommand()
            
            if (subcommand === "add") {
                const pattern = interaction.options.get("pattern")!;
                await db.insert(whitelistTable).values({
                    pattern: pattern.value as string
                }).execute()
                await interaction.reply(`Pattern "${pattern.value}" added to whitelist`)
            } else if (subcommand === "remove") {
                const pattern = interaction.options.get("pattern")!;
                await db.delete(whitelistTable).where(eq(whitelistTable.pattern, pattern.value as string)).execute()
                await interaction.reply(`Pattern "${pattern.value}" removed from whitelist`)
            } else if (subcommand === "list") {
                const patterns = await db.select().from(whitelistTable).execute()
                await interaction.reply(`Whitelisted patterns: ${patterns.map(({pattern}) => pattern).join(", ")}`)
            }
        } else if (interaction.commandName === "settings") {
            if (!hasPermission(interaction)) {
                await interaction.reply("You don't have permission to use this command")
                return
            }
            
            const guildId = interaction.guildId;
            if (!guildId) {
                await interaction.reply("This command can only be used in a guild")
                return
            }
            
            const subcommand = interaction.options.getSubcommand()
            
            if (subcommand === "set") {
                const name = interaction.options.get("name")!;
                const value = interaction.options.get("value")!;
                
                const guild = await db.select().from(guilds).where(eq(guilds.guild_id, guildId)).execute()
                let settings = {}
                if (guild.length > 0) {
                    settings = JSON.parse(guild[0].settings)
                }
                
                settings[name.value as string] = value.value as string
                
                await db.insert(guilds).values({
                    guild_id: guildId,
                    settings: JSON.stringify(settings)
                }).onConflictDoUpdate({
                    target: guilds.guild_id,
                    set: { settings: JSON.stringify(settings) }
                }).execute()
                
                await interaction.reply(`Setting "${name.value}" set to "${value.value}"`)
            } else if (subcommand === "remove") {
                const name = interaction.options.get("name")!;
                
                const guild = await db.select().from(guilds).where(eq(guilds.guild_id, guildId)).execute()
                if (guild.length === 0) {
                    await interaction.reply("No settings found for this guild")
                    return
                }
                
                let settings = JSON.parse(guild[0].settings)
                delete settings[name.value as string]
                
                await db.update(guilds).set({ settings: JSON.stringify(settings) }).where(eq(guilds.guild_id, guildId)).execute()
                
                await interaction.reply(`Setting "${name.value}" removed`)
            } else if (subcommand === "list") {
                const guild = await db.select().from(guilds).where(eq(guilds.guild_id, guildId)).execute()
                if (guild.length === 0) {
                    await interaction.reply("No settings found for this guild")
                    return
                }
                
                const settings = JSON.parse(guild[0].settings)
                const settingsList = Object.entries(settings).map(([key, value]) => `${key}: ${value}`).join("\n")
                await interaction.reply(`Guild settings:\n${settingsList}`)
            }
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
                            gt(posts.created_at, new Date(Date.now() - await getGuildRepostInterval(message.guildId)))
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
            const linkWhitelist = await db.select().from(whitelistTable).then((res) => res.map(({pattern}) => pattern))
            
            if (messageLinks && messageLinks.length) {
                for (const messageLink of messageLinks) {
                    // Check if URL matches any whitelist pattern
                    const isWhitelisted = linkWhitelist.some(pattern => patternMatchesUrl(pattern, messageLink))
                    if (isWhitelisted) {
                        continue; // Skip processing for whitelisted URLs
                    }

                    if (linkBlacklist.some((b) => messageLink.includes(b))) {
                        break;
                    }

                    const dbMessageLinks = await db.select().from(links).innerJoin(posts, eq(links.postId, posts.id)).where(
                        and(
                            eq(links.url, messageLink),
                            gt(posts.created_at, new Date(Date.now() - await getGuildRepostInterval(message.guildId)))
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