export const allowedDiscordServers = (process.env.ALLOWED_DISCORD_SERVERS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean)

export const isAllowedGuild = (guildId: string | null | undefined): boolean => {
    if (allowedDiscordServers.length === 0) return true
    return !!guildId && allowedDiscordServers.includes(guildId)
}