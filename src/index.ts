import "dotenv/config";
import {discordClient} from "./discord.js";
import {db} from "./sqlite.js";
import phash from "sharp-phash"
import {and, asc, eq, gt, or, isNull} from "drizzle-orm";
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

    for (const url of whitelist) {
        const existing = await db.select().from(link_blacklist).where(
            and(eq(link_blacklist.url, url), isNull(link_blacklist.guild_id))
        ).limit(1).execute()
        if (existing.length === 0) {
            await db.insert(link_blacklist).values({ url }).execute()
        }
    }
    await discordClient.login(process.env.DISCORD_TOKEN)

    discordClient.on('ready', async () => {
        console.log(`Logged in as ${discordClient.user?.tag}!`);

        const commands = [
            {
                name: "register_blacklist",
                dmPermission: false,
                description: "Register website to whitelist.",
                options: [
                    {
                        name: "url",
                        type: ApplicationCommandOptionType.String,
                        description: "URL to register google.com, twitter.com, etc.",
                        required: true
                    }
                ]
            },
            {
                name: "list_blacklist",
                dmPermission: false,
                description: "List blacklist websites"
            },
            {
                name: "whitelist",
                dmPermission: false,
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
            },
            {
                name: "settings",
                dmPermission: false,
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
            }
        ]

        await discordClient.application!.commands.set(commands)
    })
    discordClient.on("interactionCreate", async interaction => {
        if (!interaction.isCommand()) return;
        if (interaction.commandName === "register_blacklist") {
            if (!hasPermission(interaction)) {
                await interaction.reply({ content: "You don't have permission to use this command", ephemeral: true })
                return
            }
            const url = interaction.options.get("url")!;
            await db.insert(link_blacklist).values({
                url: url.value as string,
                guild_id: interaction.guildId
            }).execute()
            await interaction.reply({ content: `URL ${url} added to blacklist`, ephemeral: true })
        } else if (interaction.commandName === "list_blacklist") {
            if (!hasPermission(interaction)) {
                await interaction.reply({ content: "You don't have permission to use this command", ephemeral: true })
                return
            }
            const urls = await db.select().from(link_blacklist).where(
                or(
                    eq(link_blacklist.guild_id, interaction.guildId),
                    isNull(link_blacklist.guild_id)
                )
            ).execute()
            await interaction.reply({ content: `Blacklisted URLs: ${urls.map(({url}) => url).join(", ")}`, ephemeral: true })
        } else if (interaction.commandName === "whitelist") {
            if (!hasPermission(interaction)) {
                await interaction.reply({ content: "You don't have permission to use this command", ephemeral: true })
                return
            }
            
            const subcommand = interaction.options.getSubcommand()
            
            if (subcommand === "add") {
                const pattern = interaction.options.get("pattern")!;
                await db.insert(whitelistTable).values({
                    pattern: pattern.value as string,
                    guild_id: interaction.guildId
                }).execute()
                await interaction.reply({ content: `Pattern "${pattern.value}" added to whitelist`, ephemeral: true })
            } else if (subcommand === "remove") {
                const pattern = interaction.options.get("pattern")!;
                await db.delete(whitelistTable).where(
                    and(
                        eq(whitelistTable.pattern, pattern.value as string),
                        or(
                            eq(whitelistTable.guild_id, interaction.guildId),
                            isNull(whitelistTable.guild_id)
                        )
                    )
                ).execute()
                await interaction.reply({ content: `Pattern "${pattern.value}" removed from whitelist`, ephemeral: true })
            } else if (subcommand === "list") {
                const patterns = await db.select().from(whitelistTable).where(
                    or(
                        eq(whitelistTable.guild_id, interaction.guildId),
                        isNull(whitelistTable.guild_id)
                    )
                ).execute()
                await interaction.reply({ content: `Whitelisted patterns: ${patterns.map(({pattern}) => pattern).join(", ")}`, ephemeral: true })
            }
        } else if (interaction.commandName === "settings") {
            if (!hasPermission(interaction)) {
                await interaction.reply({ content: "You don't have permission to use this command", ephemeral: true })
                return
            }
            
            const guildId = interaction.guildId;
            if (!guildId) {
                await interaction.reply({ content: "This command can only be used in a guild", ephemeral: true })
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
                
                await interaction.reply({ content: `Setting "${name.value}" set to "${value.value}"`, ephemeral: true })
            } else if (subcommand === "remove") {
                const name = interaction.options.get("name")!;
                
                const guild = await db.select().from(guilds).where(eq(guilds.guild_id, guildId)).execute()
                if (guild.length === 0) {
                    await interaction.reply({ content: "No settings found for this guild", ephemeral: true })
                    return
                }
                
                let settings = JSON.parse(guild[0].settings)
                delete settings[name.value as string]
                
                await db.update(guilds).set({ settings: JSON.stringify(settings) }).where(eq(guilds.guild_id, guildId)).execute()
                
                await interaction.reply({ content: `Setting "${name.value}" removed`, ephemeral: true })
            } else if (subcommand === "list") {
                const guild = await db.select().from(guilds).where(eq(guilds.guild_id, guildId)).execute()
                if (guild.length === 0) {
                    await interaction.reply({ content: "No settings found for this guild", ephemeral: true })
                    return
                }
                
                const settings = JSON.parse(guild[0].settings)
                const settingsList = Object.entries(settings).map(([key, value]) => `${key}: ${value}`).join("\n")
                await interaction.reply({ content: `Guild settings:\n${settingsList}`, ephemeral: true })
            }
        }
    })
    discordClient.on('messageCreate', async message => {

        if (message.author.bot) return;
        const post = await db.insert(posts).values({
            user_id: message.author.id,
            message: message.content,
            messageUrl: message.url,
            guild_id: message.guildId
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
                            and(
                                gt(posts.created_at, new Date(Date.now() - await getGuildRepostInterval(message.guildId))),
                                eq(posts.guild_id, message.guildId)
                            )
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
                        postId: post.lastInsertRowid as number,
                        guild_id: message.guildId
                    }).execute()
                } catch (e) {
                    console.error(e)
                }
            }
        } else {
            const messageLinks = message.content.match(/https?:\/\/[^\s]+/g)
            const linkBlacklist = await db.select().from(link_blacklist).where(
                or(
                    eq(link_blacklist.guild_id, message.guildId),
                    isNull(link_blacklist.guild_id)
                )
            ).then((res) => res.map(({url}) => url))
            const linkWhitelist = await db.select().from(whitelistTable).where(
                or(
                    eq(whitelistTable.guild_id, message.guildId),
                    isNull(whitelistTable.guild_id)
                )
            ).then((res) => res.map(({pattern}) => pattern))
            
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
                            eq(posts.guild_id, message.guildId),
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
                        postId: post.lastInsertRowid as number,
                        guild_id: message.guildId
                    }).execute()
                }


            }
        }

    })

}

main()