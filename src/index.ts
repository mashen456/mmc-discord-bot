import { 
    Client, 
    GatewayIntentBits, 
    ActivityType, 
    TextChannel, 
    EmbedBuilder,
    REST,
    Routes,
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    PermissionFlagsBits,
    GuildMember,
    InteractionResponseType,
    ChannelType,
    CategoryChannel
} from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Datenbank-Interface
interface UserRole {
    userId: string;
    roleId: string;
    assignedAt: string;
}

interface ServerConfig {
    guildId: string;
    rejoinLogChannelId?: string;
    roleSelectionChannelId?: string;
    roleSelectionMessageId?: string;
    roleAssignmentLogChannelId?: string;
    roleErrorLogChannelId?: string;
    reactionRoles: Map<string, string>;
    userRoles: UserRole[]; // Server-spezifische Benutzer-Rollen
    familyChannels: {
        [roleId: string]: {
            categoryId: string;
            timeChannelId: string;
            commChannelId: string;
            passwordChannelId: string;
            routeTimes?: {
                startTime: string;
                endTime: string;
                addedBy: string;
                addedAt: string;
                password?: string;
            }[];
        }
    };
    commandRoles?: string[]; // IDs der Rollen, die Befehle ausführen dürfen
    infoChannels?: string[]; // IDs der Info-Kanäle
}

interface Database {
    serverConfigs: { [guildId: string]: ServerConfig };
}

// Datenbank-Funktionen
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.json');

function loadDatabase(): Database {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
            // Konvertiere reactionRoles von Objekt zu Map
            Object.values(data.serverConfigs || {}).forEach((config: any) => {
                if (config.reactionRoles) {
                    config.reactionRoles = new Map(Object.entries(config.reactionRoles));
                }
            });
            return data;
        }
    } catch (error) {
        console.error('Fehler beim Laden der Datenbank:', error);
    }
    return { serverConfigs: {} };
}

function saveDatabase(db: Database) {
    try {
        // Konvertiere Maps zu Objekten für JSON-Serialisierung
        const dataToSave = {
            ...db,
            serverConfigs: Object.fromEntries(
                Object.entries(db.serverConfigs).map(([guildId, config]) => [
                    guildId,
                    {
                        ...config,
                        reactionRoles: Object.fromEntries(config.reactionRoles || new Map())
                    }
                ])
            )
        };
        fs.writeFileSync(DB_PATH, JSON.stringify(dataToSave, null, 2));
    } catch (error) {
        console.error('Fehler beim Speichern der Datenbank:', error);
    }
}

let database = loadDatabase();

// Hilfsfunktionen für Server-Konfiguration
function getServerConfig(guildId: string): ServerConfig {
    if (!database.serverConfigs[guildId]) {
        database.serverConfigs[guildId] = {
            guildId,
            reactionRoles: new Map(),
            userRoles: [],
            familyChannels: {}
        };
        saveDatabase(database);
    }
    return database.serverConfigs[guildId];
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Slash Commands definieren
const commands = [
    new SlashCommandBuilder()
        .setName('rollen-setup')
        .setDescription('Erstellt die Rollen-Auswahl-Nachricht'),
    new SlashCommandBuilder()
        .setName('familie-hinzufügen')
        .setDescription('Fügt eine neue Familie mit allen benötigten Kanälen hinzu')
        .addStringOption(option =>
            option.setName('emoji')
                .setDescription('Das Emoji für die Familie')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Der Name der Familie')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('familie-entfernen')
        .setDescription('Entfernt eine Familie und alle zugehörigen Kanäle')
        .addRoleOption(option =>
            option.setName('rolle')
                .setDescription('Die Rolle der zu löschenden Familie')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('rollen-liste')
        .setDescription('Zeigt alle verfügbaren Familien-Rollen an'),
    new SlashCommandBuilder()
        .setName('rejoin-log-setzen')
        .setDescription('Setzt den Kanal für Rejoin-Logs')
        .addChannelOption(option =>
            option.setName('kanal')
                .setDescription('Der Kanal für Rejoin-Logs')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('rollen-log-setzen')
        .setDescription('Setzt den Kanal für Rollenvergabe-Logs')
        .addChannelOption(option =>
            option.setName('kanal')
                .setDescription('Der Kanal für Rollenvergabe-Logs')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('rollen-fehler-log-setzen')
        .setDescription('Setzt den Kanal für Rollen-Fehler-Logs')
        .addChannelOption(option =>
            option.setName('kanal')
                .setDescription('Der Kanal für Rollen-Fehler-Logs')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('routenzeit-setzen')
        .setDescription('Legt die Routenzeit für eine Familie fest')
        .addRoleOption(option =>
            option.setName('rolle')
                .setDescription('Die Rolle der Familie')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('tage')
                .setDescription('Anzahl der Tage für die Route')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('passwort')
                .setDescription('Das Passwort für die Route')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('routenpasswort-setzen')
        .setDescription('Legt das Passwort für eine Route fest')
        .addRoleOption(option =>
            option.setName('rolle')
                .setDescription('Die Rolle der Familie')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('passwort')
                .setDescription('Das Passwort für die Route')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('routenpasswort-hinzufügen')
        .setDescription('Fügt ein weiteres Passwort für eine Route hinzu')
        .addRoleOption(option =>
            option.setName('rolle')
                .setDescription('Die Rolle der Familie')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('passwort')
                .setDescription('Das neue Passwort für die Route')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('routenzeit-hinzufügen')
        .setDescription('Fügt eine weitere Routenzeit hinzu')
        .addRoleOption(option =>
            option.setName('rolle')
                .setDescription('Die Rolle der Familie')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('tage')
                .setDescription('Anzahl der Tage für die Route')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('passwort')
                .setDescription('Das Passwort für die Route')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('befehl-rolle-hinzufügen')
        .setDescription('Fügt einer Rolle die Berechtigung hinzu, Befehle auszuführen')
        .addRoleOption(option =>
            option.setName('rolle')
                .setDescription('Die Rolle, die Befehle ausführen dürfen soll')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('befehl-rolle-entfernen')
        .setDescription('Entfernt einer Rolle die Berechtigung, Befehle auszuführen')
        .addRoleOption(option =>
            option.setName('rolle')
                .setDescription('Die Rolle, die keine Befehle mehr ausführen dürfen soll')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('befehl-rollen-liste')
        .setDescription('Zeigt alle Rollen an, die Befehle ausführen dürfen'),
    new SlashCommandBuilder()
        .setName('info-kanal-hinzufügen')
        .setDescription('Fügt einen Kanal zu den Info-Kanälen hinzu')
        .addChannelOption(option =>
            option.setName('kanal')
                .setDescription('Der Kanal, der als Info-Kanal hinzugefügt werden soll')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('info-kanal-entfernen')
        .setDescription('Entfernt einen Kanal aus den Info-Kanälen')
        .addChannelOption(option =>
            option.setName('kanal')
                .setDescription('Der Kanal, der aus den Info-Kanälen entfernt werden soll')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('info-kanäle-liste')
        .setDescription('Zeigt alle Info-Kanäle an'),
].map(command => command.toJSON());

// Funktion zum Registrieren der Slash Commands
async function registerCommands() {
    try {
        console.log('Starte das Aktualisieren der Slash Commands...');
        
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN!);
        
        // Registriere die Commands global
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID!),
            { body: commands }
        );
        
        console.log('Slash Commands wurden erfolgreich aktualisiert!');
    } catch (error) {
        console.error('Fehler beim Aktualisieren der Slash Commands:', error);
    }
}

// Funktion zum Aktualisieren der Routenzeiten
async function updateRouteTimes() {
    console.log('Aktualisiere Routenzeiten...');
    
    for (const [guildId, serverConfig] of Object.entries(database.serverConfigs)) {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) continue;

        for (const [roleId, familyData] of Object.entries(serverConfig.familyChannels)) {
            if (!familyData.routeTimes || familyData.routeTimes.length === 0) continue;

            // Aktualisiere alle Routenzeiten
            const timeChannel = await guild.channels.fetch(familyData.timeChannelId).catch(() => null) as TextChannel;
            if (timeChannel) {
                const timeEmbed = new EmbedBuilder()
                    .setTitle('⏰ Routenzeiten')
                    .setDescription('Hier sind alle Routenzeiten:')
                    .addFields(
                        familyData.routeTimes.map((time, index) => {
                            const start = new Date(time.startTime);
                            const end = new Date(time.endTime);
                            const now = new Date();
                            const timeLeft = end.getTime() - now.getTime();
                            const daysLeft = Math.ceil(timeLeft / (1000 * 60 * 60 * 24));
                            
                            return {
                                name: `Route ${index + 1}`,
                                value: `Start: ${start.toLocaleString('de-DE')}\nEnde: ${end.toLocaleString('de-DE')}\nVerbleibend: ${daysLeft} Tage`,
                                inline: true
                            };
                        })
                    )
                    .setColor('#00ff00')
                    .setTimestamp();

                // Lösche alte Nachrichten
                const messages = await timeChannel.messages.fetch({ limit: 10 });
                await Promise.all(messages.map(msg => msg.delete()));

                await timeChannel.send({ embeds: [timeEmbed] });
            }

            // Entferne abgelaufene Routenzeiten
            familyData.routeTimes = familyData.routeTimes.filter(time => {
                const endTime = new Date(time.endTime);
                return endTime > new Date();
            });

            saveDatabase(database);
        }
    }
}

client.once('ready', async () => {
    console.log(`Bot ist online als ${client.user?.tag}!`);
    
    // Registriere die Slash Commands
    await registerCommands();
    
    // Starte den Timer für die Routenzeit-Aktualisierung
    setInterval(updateRouteTimes, 60 * 60 * 1000); // Stündlich
    // Führe die erste Aktualisierung sofort durch
    await updateRouteTimes();
    
    // Aktualisiere die Setup-Nachrichten für alle Server
    for (const [guildId, serverConfig] of Object.entries(database.serverConfigs)) {
        if (serverConfig.roleSelectionChannelId && serverConfig.roleSelectionMessageId) {
            try {
                const guild = await client.guilds.fetch(guildId);
                const channel = await guild.channels.fetch(serverConfig.roleSelectionChannelId) as TextChannel;
                
                if (channel) {
                    try {
                        const message = await channel.messages.fetch(serverConfig.roleSelectionMessageId);
                        
                        // Bearbeite die bestehende Nachricht
                        const embed = new EmbedBuilder()
                            .setTitle('🎭 Rollen-Auswahl')
                            .setDescription('Klicke auf eine der Reaktionen unten, um dir eine Rolle zuzuweisen.\n' +
                                'Du kannst nur eine Rolle gleichzeitig haben.\n' +
                                '**Wichtig:** Einmal zugewiesene Rollen können nicht mehr entfernt werden!\n\n' +
                                '**Verfügbare Rollen:**\n' +
                                Array.from(serverConfig.reactionRoles.entries())
                                    .map(([emoji, roleId]) => {
                                        const role = guild.roles.cache.get(roleId);
                                        return `${emoji} - ${role?.name || 'Unbekannte Rolle'}`;
                                    })
                                    .join('\n'))
                            .setColor('#0099ff')
                            .setFooter({ text: 'Wähle deine Rolle mit Bedacht - sie kann nicht mehr entfernt werden!' });

                        await message.edit({ embeds: [embed] });
                        
                        // Entferne alte Reaktionen
                        const reactions = message.reactions.cache;
                        for (const reaction of reactions.values()) {
                            await reaction.remove();
                        }

                        // Füge neue Reaktionen hinzu
                        for (const emoji of serverConfig.reactionRoles.keys()) {
                            await message.react(emoji);
                        }
                    } catch (error) {
                        console.error(`Fehler beim Aktualisieren der Nachricht für Server ${guildId}:`, error);
                    }
                }
            } catch (error) {
                console.error(`Fehler beim Zugriff auf den Kanal für Server ${guildId}:`, error);
            }
        }
    }
    
    client.user?.setPresence({
        activities: [{ 
            name: 'Wacht über die Route',
            type: ActivityType.Watching 
        }],
        status: 'online'
    });
});

// Event für neue Reaktionen
client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    
    // Erstelle die vollständige Emoji-Notation
    const emojiIdentifier = reaction.emoji.id && reaction.emoji.name ? 
        `<:${reaction.emoji.name}:${reaction.emoji.id}>` : 
        (reaction.emoji.name || '');
    
    console.log('Reaktion hinzugefügt:', emojiIdentifier);
    
    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            console.error('Fehler beim Laden der Reaktion:', error);
            return;
        }
    }

    const guild = reaction.message.guild;
    if (!guild) {
        console.log('Keine Guild gefunden');
        return;
    }

    const serverConfig = getServerConfig(guild.id);
    console.log('Server Config:', serverConfig);
    console.log('Reaction Roles:', Array.from(serverConfig.reactionRoles.entries()));
    
    // Suche nach der Rolle mit der vollständigen Emoji-Notation
    const roleId = serverConfig.reactionRoles.get(emojiIdentifier);
    console.log('Gefundene Role ID:', roleId);
    
    if (!roleId) {
        console.log('Keine passende Rolle gefunden für Emoji:', emojiIdentifier);
        return;
    }

    try {
        const member = await guild.members.fetch(user.id);
        const role = guild.roles.cache.get(roleId);
        const botMember = await guild.members.fetch(client.user!.id);

        console.log('Member:', member.user.tag);
        console.log('Role:', role?.name);
        console.log('Bot Member:', botMember.user.tag);

        if (!role) {
            console.log('Rolle nicht gefunden');
            return;
        }

        // Prüfe, ob der Benutzer bereits eine Rolle hat
        const existingRole = serverConfig.userRoles.find(ur => ur.userId === user.id);
        if (existingRole) {
            console.log('Benutzer hat bereits eine Rolle:', existingRole.roleId);
            await reaction.users.remove(user.id);
            
            // Logge den Versuch einer doppelten Rollenauswahl
            if (serverConfig.roleErrorLogChannelId) {
                const errorLogChannel = guild.channels.cache.get(serverConfig.roleErrorLogChannelId) as TextChannel;
                if (errorLogChannel) {
                    const errorEmbed = new EmbedBuilder()
                        .setTitle('⚠️ Doppelte Rollenauswahl')
                        .setDescription(`${user.tag} hat versucht, eine weitere Rolle auszuwählen`)
                        .addFields(
                            { name: 'Benutzer ID', value: user.id },
                            { name: 'Bereits zugewiesene Rolle', value: `<@&${existingRole.roleId}>` },
                            { name: 'Gewünschte Rolle', value: `<@&${role.id}>` }
                        )
                        .setColor('#ff0000')
                        .setTimestamp();

                    await errorLogChannel.send({ embeds: [errorEmbed] });
                }
            }
            return;
        }

        // Prüfe Bot-Berechtigungen
        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            console.error('Bot hat keine Berechtigung zum Verwalten von Rollen');
            return;
        }

        // Prüfe, ob die Bot-Rolle höher ist als die zu verwaltende Rolle
        if (botMember.roles.highest.position <= role.position) {
            console.error('Bot-Rolle ist nicht hoch genug, um diese Rolle zu verwalten');
            return;
        }

        console.log('Entferne alte Rollen...');
        // Entferne alle anderen Reaktions-Rollen
        for (const [_, existingRoleId] of serverConfig.reactionRoles) {
            const existingRole = guild.roles.cache.get(existingRoleId);
            if (existingRole && member.roles.cache.has(existingRoleId)) {
                await member.roles.remove(existingRole);
            }
        }
        
        console.log('Füge neue Rolle hinzu...');
        // Füge die neue Rolle hinzu
        await member.roles.add(role);
        
        // Speichere die Rolle in der Datenbank
        serverConfig.userRoles.push({
            userId: user.id,
            roleId: role.id,
            assignedAt: new Date().toISOString()
        });
        saveDatabase(database);
        
        console.log(`Rolle ${role.name} wurde ${user.tag} zugewiesen`);

        // Logge die erfolgreiche Rollenvergabe
        if (serverConfig.roleAssignmentLogChannelId) {
            const logChannel = guild.channels.cache.get(serverConfig.roleAssignmentLogChannelId) as TextChannel;
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('✅ Rolle zugewiesen')
                    .setDescription(`${user.tag} hat sich eine Rolle zugewiesen`)
                    .addFields(
                        { name: 'Benutzer ID', value: user.id },
                        { name: 'Zugewiesene Rolle', value: `<@&${role.id}>` }
                    )
                    .setColor('#00ff00')
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed] });
            }
        }
    } catch (error) {
        console.error('Fehler beim Zuweisen der Rolle:', error);
    }
});

// Event für Server-Beitritt
client.on('guildMemberAdd', async (member) => {
    const serverConfig = getServerConfig(member.guild.id);
    
    // Prüfe, ob der Benutzer bereits eine Rolle hatte
    const userRole = serverConfig.userRoles.find(ur => ur.userId === member.id);
    if (userRole) {
        const role = member.guild.roles.cache.get(userRole.roleId);
        if (role) {
            try {
                await member.roles.add(role);
                console.log(`Vorherige Rolle ${role.name} wurde ${member.user.tag} wieder zugewiesen`);
            } catch (error) {
                console.error('Fehler beim Wiederherstellen der Rolle:', error);
            }
        }
    }

    // Sende Log-Nachricht
    if (serverConfig.rejoinLogChannelId) {
        const logChannel = member.guild.channels.cache.get(serverConfig.rejoinLogChannelId) as TextChannel;
        if (logChannel) {
            const embed = new EmbedBuilder()
                .setTitle('👋 Mitglied ist zurückgekehrt')
                .setDescription(`${member.user.tag} ist dem Server wieder beigetreten`)
                .addFields(
                    { name: 'Benutzer ID', value: member.id },
                    { name: 'Vorherige Rolle', value: userRole ? `<@&${userRole.roleId}>` : 'Keine' }
                )
                .setColor('#00ff00')
                .setTimestamp();

            await logChannel.send({ embeds: [embed] });
        }
    }
});

// Hilfsfunktion zum Aktualisieren der Reaktions-Nachricht
async function updateReactionMessage(channel: TextChannel) {
    const serverConfig = getServerConfig(channel.guild.id);
    const messages = await channel.messages.fetch({ limit: 100 });
    const roleMessage = messages.find(msg => 
        msg.author.id === client.user?.id && 
        msg.embeds.length > 0 && 
        msg.embeds[0].title === '🎭 Rollen-Auswahl'
    );

    if (roleMessage) {
        serverConfig.roleSelectionMessageId = roleMessage.id;
        serverConfig.roleSelectionChannelId = channel.id;
        saveDatabase(database);

        // Filtere ungültige Rollen heraus
        const validRoles = Array.from(serverConfig.reactionRoles.entries())
            .filter(([_, roleId]) => {
                const role = channel.guild.roles.cache.get(roleId);
                return role !== undefined;
            });

        // Aktualisiere die Reaktions-Rollen in der Datenbank
        serverConfig.reactionRoles = new Map(validRoles);
        saveDatabase(database);

        const embed = new EmbedBuilder()
            .setTitle('🎭 Rollen-Auswahl')
            .setDescription('Klicke auf eine der Reaktionen unten, um dir eine Rolle zuzuweisen.\n' +
                'Du kannst nur eine Rolle gleichzeitig haben.\n' +
                '**Wichtig:** Einmal zugewiesene Rollen können nicht mehr entfernt werden!')
            .setColor('#0099ff')
            .setFooter({ text: 'Wähle deine Rolle mit Bedacht - sie kann nicht mehr entfernt werden!' });

        await roleMessage.edit({ embeds: [embed] });
        
        // Entferne alte Reaktionen
        const reactions = roleMessage.reactions.cache;
        for (const reaction of reactions.values()) {
            await reaction.remove();
        }

        // Lösche alte Rollen-Nachrichten
        const oldRoleMessages = messages.filter(msg => 
            msg.author.id === client.user?.id && 
            msg.id !== roleMessage.id
        );
        await Promise.all(oldRoleMessages.map(msg => msg.delete()));

        // Sende für jede Rolle eine separate Nachricht
        for (const [emoji, roleId] of validRoles) {
            const role = channel.guild.roles.cache.get(roleId);
            if (role) {
                await channel.send(`${emoji} - ${role.name}`);
                await roleMessage.react(emoji);
            }
        }
    }
}

// Slash Command Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const member = interaction.member as GuildMember;
    const serverConfig = getServerConfig(interaction.guildId!);
    
    // Prüfe, ob der Benutzer Administrator ist oder eine berechtigte Rolle hat
    const hasPermission = member.permissions.has(PermissionFlagsBits.Administrator) ||
        (serverConfig.commandRoles && member.roles.cache.some(role => 
            serverConfig.commandRoles!.includes(role.id)
        ));

    if (!hasPermission) {
        await interaction.reply({ 
            content: 'Du hast keine Berechtigung für diesen Befehl!', 
            flags: 64
        });
        return;
    }

    const { commandName } = interaction;

    switch (commandName) {
        case 'rollen-setup':
            if (!(interaction.channel instanceof TextChannel)) {
                await interaction.reply({ 
                    content: 'Dieser Befehl kann nur in Textkanälen verwendet werden!', 
                    flags: 64
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle('🎭 Rollen-Auswahl')
                .setDescription('Klicke auf eine der Reaktionen unten, um dir eine Rolle zuzuweisen.\n' +
                    'Du kannst nur eine Rolle gleichzeitig haben.\n' +
                    '**Wichtig:** Einmal zugewiesene Rollen können nicht mehr entfernt werden!')
                .setColor('#0099ff')
                .setFooter({ text: 'Wähle deine Rolle mit Bedacht - sie kann nicht mehr entfernt werden!' });

            const roleMessage = await interaction.channel.send({ embeds: [embed] });
            
            serverConfig.roleSelectionMessageId = roleMessage.id;
            serverConfig.roleSelectionChannelId = interaction.channel.id;
            saveDatabase(database);
            
            // Sende für jede Rolle eine separate Nachricht
            for (const [emoji, roleId] of serverConfig.reactionRoles) {
                const role = interaction.guild?.roles.cache.get(roleId);
                if (role) {
                    await interaction.channel.send(`${emoji} - ${role.name}`);
                    await roleMessage.react(emoji);
                }
            }

            await interaction.reply({ 
                content: 'Rollen-Auswahl wurde erstellt!', 
                flags: 64
            });
            break;

        case 'familie-hinzufügen':
            const emoji = interaction.options.getString('emoji', true);
            const familyName = interaction.options.getString('name', true);

            // Sofortige Antwort auf die Interaktion
            await interaction.reply({
                content: `Erstelle Familie ${familyName}...`,
                flags: 64
            });

            try {
                // Erstelle die Familien-Rolle
                const familyRole = await interaction.guild?.roles.create({
                    name: familyName,
                    color: 'Random',
                    reason: 'Automatische Erstellung der Familien-Rolle'
                });

                if (!familyRole) {
                    await interaction.editReply('Fehler beim Erstellen der Familien-Rolle!');
                    return;
                }

                // Erstelle die Kategorie für die Familie
                if (!interaction.guild) {
                    await interaction.editReply('Fehler: Kein Server gefunden!');
                    return;
                }

                const category = await interaction.guild.channels.create({
                    name: `🏠 ${familyName}`,
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                        {
                            id: interaction.guild.id,
                            deny: [PermissionFlagsBits.ViewChannel]
                        },
                        {
                            id: familyRole.id,
                            allow: [PermissionFlagsBits.ViewChannel]
                        }
                    ]
                });

                if (!category) {
                    await interaction.editReply('Fehler beim Erstellen der Kategorie!');
                    return;
                }

                // Erstelle die Kanäle direkt in der Kategorie
                const channels = await Promise.all([
                    category.children.create({
                        name: '⏰ route-zeit',
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            {
                                id: interaction.guild.id,
                                deny: [PermissionFlagsBits.ViewChannel]
                            },
                            {
                                id: familyRole.id,
                                allow: [PermissionFlagsBits.ViewChannel]
                            }
                        ]
                    }),
                    category.children.create({
                        name: '💬 kommunikation',
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            {
                                id: interaction.guild.id,
                                deny: [PermissionFlagsBits.ViewChannel]
                            },
                            {
                                id: familyRole.id,
                                allow: [PermissionFlagsBits.ViewChannel]
                            }
                        ]
                    }),
                    category.children.create({
                        name: '🔑 passwort',
                        type: ChannelType.GuildText,
                        permissionOverwrites: [
                            {
                                id: interaction.guild.id,
                                deny: [PermissionFlagsBits.ViewChannel]
                            },
                            {
                                id: familyRole.id,
                                allow: [PermissionFlagsBits.ViewChannel]
                            }
                        ]
                    })
                ]);

                const [timeChannel, commChannel, passwordChannel] = channels;

                if (!timeChannel || !commChannel || !passwordChannel) {
                    await interaction.editReply('Fehler beim Erstellen der Kanäle!');
                    return;
                }

                // Speichere die Reaktions-Rolle
                serverConfig.reactionRoles.set(emoji, familyRole.id);
                saveDatabase(database);

                // Speichere die Kanal-IDs in der Datenbank
                if (!serverConfig.familyChannels) {
                    serverConfig.familyChannels = {};
                }
                serverConfig.familyChannels[familyRole.id] = {
                    categoryId: category.id,
                    timeChannelId: timeChannel.id,
                    commChannelId: commChannel.id,
                    passwordChannelId: passwordChannel.id
                };
                saveDatabase(database);

                // Sende Willkommensnachrichten
                const welcomeEmbed = new EmbedBuilder()
                    .setTitle('Willkommen auf eurer Route!')
                    .setDescription('Hier wird eure verbleibende Zeit auf der Route angezeigt.')
                    .setColor('#00ff00')
                    .setTimestamp();

                const commEmbed = new EmbedBuilder()
                    .setTitle('Kommunikations-Kanal')
                    .setDescription('Hier könnt ihr euch über eure Route austauschen.')
                    .setColor('#0099ff')
                    .setTimestamp();

                const passwordEmbed = new EmbedBuilder()
                    .setTitle('Passwort & Erkennungsmerkmale')
                    .setDescription('Hier findest du das Passwort für die Route.')
                    .setColor('#ff9900')
                    .setTimestamp();

                await Promise.all([
                    timeChannel.send({ embeds: [welcomeEmbed] }),
                    commChannel.send({ embeds: [commEmbed] }),
                    passwordChannel.send({ embeds: [passwordEmbed] })
                ]);

                // Aktualisiere die Antwort
                await interaction.editReply({
                    content: `Familie ${familyName} wurde erfolgreich erstellt!\n` +
                        `Rolle: ${familyRole}\n` +
                        `Kategorie: ${category}\n` +
                        `Kanäle:\n` +
                        `- ${timeChannel}\n` +
                        `- ${commChannel}\n` +
                        `- ${passwordChannel}`
                });

                if (interaction.channel instanceof TextChannel) {
                    await updateReactionMessage(interaction.channel);
                }

                // Nach dem Erstellen der Rolle, aktualisiere die Berechtigungen für alle Info-Kanäle
                if (serverConfig.infoChannels) {
                    for (const channelId of serverConfig.infoChannels) {
                        const channel = await interaction.guild?.channels.fetch(channelId) as TextChannel;
                        if (channel) {
                            await channel.permissionOverwrites.create(familyRole, {
                                ViewChannel: true
                            });
                        }
                    }
                }
            } catch (error) {
                console.error('Fehler beim Erstellen der Familie:', error);
                await interaction.editReply('Es ist ein Fehler aufgetreten beim Erstellen der Familie!');
            }
            break;

        case 'familie-entfernen':
            const familyRole = interaction.options.getRole('rolle', true);
            if (!familyRole || !('delete' in familyRole)) {
                await interaction.reply({
                    content: 'Die angegebene Rolle wurde nicht gefunden oder kann nicht gelöscht werden!',
                    flags: 64
                });
                return;
            }

            const familyChannels = serverConfig.familyChannels[familyRole.id];

            if (!familyChannels) {
                await interaction.reply({
                    content: 'Diese Familie wurde nicht gefunden!',
                    flags: 64
                });
                return;
            }

            try {
                // Sofortige Antwort auf die Interaktion
                await interaction.reply({
                    content: `Lösche Familie ${familyRole.name}...`,
                    flags: 64
                });

                // Lösche zuerst die Unterkanäle
                const channelsToDelete = [
                    familyChannels.timeChannelId,
                    familyChannels.commChannelId,
                    familyChannels.passwordChannelId,
                    familyChannels.categoryId
                ];

                for (const channelId of channelsToDelete) {
                    try {
                        const channel = await interaction.guild?.channels.fetch(channelId);
                        if (channel) {
                            await channel.delete();
                        }
                    } catch (error) {
                        console.error(`Fehler beim Löschen des Kanals ${channelId}:`, error);
                        // Fahre mit dem nächsten Kanal fort
                    }
                }

                // Entferne die Rolle
                try {
                    await familyRole.delete();
                } catch (error) {
                    console.error('Fehler beim Löschen der Rolle:', error);
                }

                // Entferne die Familie aus der Datenbank
                delete serverConfig.familyChannels[familyRole.id];
                serverConfig.reactionRoles.delete(familyRole.id);
                saveDatabase(database);

                // Aktualisiere die Rollen-Auswahl-Nachricht
                if (interaction.channel instanceof TextChannel) {
                    try {
                        await updateReactionMessage(interaction.channel);
                    } catch (error) {
                        console.error('Fehler beim Aktualisieren der Rollen-Auswahl-Nachricht:', error);
                    }
                }

                // Sende eine neue Nachricht statt die Interaktion zu bearbeiten
                if (interaction.channel instanceof TextChannel) {
                    await interaction.channel.send({
                        content: `Familie ${familyRole.name} wurde erfolgreich entfernt!`
                    });
                }
            } catch (error) {
                console.error('Fehler beim Löschen der Familie:', error);
                // Sende eine neue Nachricht statt die Interaktion zu bearbeiten
                if (interaction.channel instanceof TextChannel) {
                    await interaction.channel.send({
                        content: 'Es ist ein Fehler beim Löschen der Familie aufgetreten!'
                    });
                }
            }
            break;

        case 'rollen-liste':
            const availableRoles = Array.from(serverConfig.reactionRoles.entries())
                .map(([emoji, roleId]) => {
                    const role = interaction.guild?.roles.cache.get(roleId);
                    return `${emoji} - ${role?.name || 'Unbekannte Rolle'}`;
                })
                .join('\n');

            const rolesEmbed = new EmbedBuilder()
                .setTitle('📋 Verfügbare Reaktions-Rollen')
                .setDescription(availableRoles || 'Keine Rollen konfiguriert')
                .setColor('#0099ff');

            await interaction.reply({ 
                embeds: [rolesEmbed], 
                flags: 64
            });
            break;

        case 'rejoin-log-setzen':
            const channel = interaction.options.getChannel('kanal', true);
            if (!(channel instanceof TextChannel)) {
                await interaction.reply({
                    content: 'Der ausgewählte Kanal muss ein Textkanal sein!',
                    flags: 64
                });
                return;
            }

            serverConfig.rejoinLogChannelId = channel.id;
            saveDatabase(database);

            await interaction.reply({
                content: `Rejoin-Log-Kanal wurde auf ${channel} gesetzt!`,
                flags: 64
            });
            break;

        case 'rollen-log-setzen':
            const roleLogChannel = interaction.options.getChannel('kanal', true);
            if (!(roleLogChannel instanceof TextChannel)) {
                await interaction.reply({
                    content: 'Der ausgewählte Kanal muss ein Textkanal sein!',
                    flags: 64
                });
                return;
            }

            serverConfig.roleAssignmentLogChannelId = roleLogChannel.id;
            saveDatabase(database);

            await interaction.reply({
                content: `Rollenvergabe-Log-Kanal wurde auf ${roleLogChannel} gesetzt!`,
                flags: 64
            });
            break;

        case 'rollen-fehler-log-setzen':
            const errorLogChannel = interaction.options.getChannel('kanal', true);
            if (!(errorLogChannel instanceof TextChannel)) {
                await interaction.reply({
                    content: 'Der ausgewählte Kanal muss ein Textkanal sein!',
                    flags: 64
                });
                return;
            }

            serverConfig.roleErrorLogChannelId = errorLogChannel.id;
            saveDatabase(database);

            await interaction.reply({
                content: `Rollen-Fehler-Log-Kanal wurde auf ${errorLogChannel} gesetzt!`,
                flags: 64
            });
            break;

        case 'routenzeit-setzen':
            const routeRole = interaction.options.getRole('rolle', true);
            const days = interaction.options.getInteger('tage', true);
            const routePassword = interaction.options.getString('passwort', true);

            if (!routeRole || !('id' in routeRole)) {
                await interaction.reply({
                    content: 'Die angegebene Rolle wurde nicht gefunden!',
                    flags: 64
                });
                return;
            }

            const familyData = serverConfig.familyChannels[routeRole.id];
            if (!familyData) {
                await interaction.reply({
                    content: 'Diese Familie wurde nicht gefunden!',
                    flags: 64
                });
                return;
            }

            try {
                const startTime = new Date();
                const endTime = new Date(startTime);
                endTime.setDate(endTime.getDate() + days);

                // Initialisiere das Routenzeiten-Array, falls es noch nicht existiert
                if (!familyData.routeTimes) {
                    familyData.routeTimes = [];
                }

                // Füge die neue Routenzeit hinzu
                familyData.routeTimes.push({
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                    addedBy: interaction.user.id,
                    addedAt: new Date().toISOString(),
                    password: routePassword
                });

                saveDatabase(database);

                // Aktualisiere den Zeit-Kanal
                const timeChannel = await interaction.guild?.channels.fetch(familyData.timeChannelId) as TextChannel;
                if (timeChannel) {
                    const timeEmbed = new EmbedBuilder()
                        .setTitle('⏰ Routenzeiten')
                        .setDescription('Hier sind alle Routenzeiten:')
                        .addFields(
                            familyData.routeTimes.map((time, index) => {
                                const start = new Date(time.startTime);
                                const end = new Date(time.endTime);
                                const daysLeft = Math.ceil((end.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                                
                                return {
                                    name: `Route ${index + 1}`,
                                    value: `Start: ${start.toLocaleString('de-DE')}\nEnde: ${end.toLocaleString('de-DE')}\nVerbleibend: ${daysLeft} Tage`,
                                    inline: true
                                };
                            })
                        )
                        .setColor('#00ff00')
                        .setTimestamp();

                    // Lösche alte Nachrichten
                    const messages = await timeChannel.messages.fetch({ limit: 10 });
                    await Promise.all(messages.map(msg => msg.delete()));

                    await timeChannel.send({ embeds: [timeEmbed] });
                }

                // Aktualisiere den Passwort-Kanal
                const passwordChannel = await interaction.guild?.channels.fetch(familyData.passwordChannelId) as TextChannel;
                if (passwordChannel) {
                    const passwordEmbed = new EmbedBuilder()
                        .setTitle('🔑 Routenpasswörter')
                        .setDescription('Hier sind die Passwörter für deine Routen:')
                        .addFields(
                            familyData.routeTimes.map((time, index) => ({
                                name: `Route ${index + 1}`,
                                value: time.password || 'Kein Passwort gesetzt',
                                inline: true
                            }))
                        )
                        .setColor('#ff9900')
                        .setTimestamp();

                    // Lösche alte Nachrichten
                    const messages = await passwordChannel.messages.fetch({ limit: 10 });
                    await Promise.all(messages.map(msg => msg.delete()));

                    await passwordChannel.send({ embeds: [passwordEmbed] });
                }

                await interaction.reply({
                    content: `Routenzeit und Passwort für ${routeRole.name} wurden erfolgreich gesetzt!`,
                    flags: 64
                });
            } catch (error) {
                console.error('Fehler beim Setzen der Routenzeit:', error);
                await interaction.reply({
                    content: 'Es ist ein Fehler beim Setzen der Routenzeit aufgetreten!',
                    flags: 64
                });
            }
            break;

        case 'routenpasswort-setzen':
            const setPasswordRole = interaction.options.getRole('rolle', true);
            const setPasswordValue = interaction.options.getString('passwort', true);

            if (!setPasswordRole || !('id' in setPasswordRole)) {
                await interaction.reply({
                    content: 'Die angegebene Rolle wurde nicht gefunden!',
                    flags: 64
                });
                return;
            }

            const setPasswordFamilyData = serverConfig.familyChannels[setPasswordRole.id];
            if (!setPasswordFamilyData) {
                await interaction.reply({
                    content: 'Diese Familie wurde nicht gefunden!',
                    flags: 64
                });
                return;
            }

            try {
                // Initialisiere das Routenzeiten-Array, falls es noch nicht existiert
                if (!setPasswordFamilyData.routeTimes) {
                    setPasswordFamilyData.routeTimes = [];
                }

                // Füge die neue Routenzeit mit Passwort hinzu
                setPasswordFamilyData.routeTimes.push({
                    startTime: new Date().toISOString(),
                    endTime: new Date().toISOString(),
                    addedBy: interaction.user.id,
                    addedAt: new Date().toISOString(),
                    password: setPasswordValue
                });

                saveDatabase(database);

                // Aktualisiere den Passwort-Kanal
                const passwordChannel = await interaction.guild?.channels.fetch(setPasswordFamilyData.passwordChannelId) as TextChannel;
                if (passwordChannel) {
                    const passwordEmbed = new EmbedBuilder()
                        .setTitle('🔑 Routenpasswörter')
                        .setDescription('Hier sind die Passwörter für deine Routen:')
                        .addFields(
                            setPasswordFamilyData.routeTimes.map((time: { password?: string }, index: number) => ({
                                name: `Route ${index + 1}`,
                                value: time.password || 'Kein Passwort gesetzt',
                                inline: true
                            }))
                        )
                        .setColor('#ff9900')
                        .setTimestamp();

                    // Lösche alte Nachrichten
                    const messages = await passwordChannel.messages.fetch({ limit: 10 });
                    await Promise.all(messages.map(msg => msg.delete()));

                    await passwordChannel.send({ embeds: [passwordEmbed] });
                }

                await interaction.reply({
                    content: `Passwort für ${setPasswordRole.name} wurde erfolgreich gesetzt!`,
                    flags: 64
                });
            } catch (error) {
                console.error('Fehler beim Setzen des Passworts:', error);
                await interaction.reply({
                    content: 'Es ist ein Fehler beim Setzen des Passworts aufgetreten!',
                    flags: 64
                });
            }
            break;

        case 'routenpasswort-hinzufügen':
            const addPasswordRole = interaction.options.getRole('rolle', true);
            const addPasswordValue = interaction.options.getString('passwort', true);

            if (!addPasswordRole || !('id' in addPasswordRole)) {
                await interaction.reply({
                    content: 'Die angegebene Rolle wurde nicht gefunden!',
                    flags: 64
                });
                return;
            }

            const addPasswordFamilyData = serverConfig.familyChannels[addPasswordRole.id];
            if (!addPasswordFamilyData) {
                await interaction.reply({
                    content: 'Diese Familie wurde nicht gefunden!',
                    flags: 64
                });
                return;
            }

            try {
                // Initialisiere das Routenzeiten-Array, falls es noch nicht existiert
                if (!addPasswordFamilyData.routeTimes) {
                    addPasswordFamilyData.routeTimes = [];
                }

                // Füge die neue Routenzeit mit Passwort hinzu
                addPasswordFamilyData.routeTimes.push({
                    startTime: new Date().toISOString(),
                    endTime: new Date().toISOString(),
                    addedBy: interaction.user.id,
                    addedAt: new Date().toISOString(),
                    password: addPasswordValue
                });

                saveDatabase(database);

                // Aktualisiere den Passwort-Kanal
                const passwordChannel = await interaction.guild?.channels.fetch(addPasswordFamilyData.passwordChannelId) as TextChannel;
                if (passwordChannel) {
                    const passwordEmbed = new EmbedBuilder()
                        .setTitle('🔑 Routenpasswörter')
                        .setDescription('Hier sind die Passwörter für deine Routen:')
                        .addFields(
                            addPasswordFamilyData.routeTimes.map((time: { password?: string }, index: number) => ({
                                name: `Route ${index + 1}`,
                                value: time.password || 'Kein Passwort gesetzt',
                                inline: true
                            }))
                        )
                        .setColor('#ff9900')
                        .setTimestamp();

                    // Lösche alte Nachrichten
                    const messages = await passwordChannel.messages.fetch({ limit: 10 });
                    await Promise.all(messages.map(msg => msg.delete()));

                    await passwordChannel.send({ embeds: [passwordEmbed] });
                }

                await interaction.reply({
                    content: `Neues Passwort für ${addPasswordRole.name} wurde erfolgreich hinzugefügt!`,
                    flags: 64
                });
            } catch (error) {
                console.error('Fehler beim Hinzufügen des Passworts:', error);
                await interaction.reply({
                    content: 'Es ist ein Fehler beim Hinzufügen des Passworts aufgetreten!',
                    flags: 64
                });
            }
            break;

        case 'routenzeit-hinzufügen':
            const addTimeRole = interaction.options.getRole('rolle', true);
            const addDays = interaction.options.getInteger('tage', true);
            const addRoutePassword = interaction.options.getString('passwort', true);

            if (!addTimeRole || !('id' in addTimeRole)) {
                await interaction.reply({
                    content: 'Die angegebene Rolle wurde nicht gefunden!',
                    flags: 64
                });
                return;
            }

            const addTimeFamilyData = serverConfig.familyChannels[addTimeRole.id];
            if (!addTimeFamilyData) {
                await interaction.reply({
                    content: 'Diese Familie wurde nicht gefunden!',
                    flags: 64
                });
                return;
            }

            try {
                // Initialisiere das Routenzeiten-Array, falls es noch nicht existiert
                if (!addTimeFamilyData.routeTimes) {
                    addTimeFamilyData.routeTimes = [];
                }

                const startTime = new Date();
                const endTime = new Date(startTime);
                endTime.setDate(endTime.getDate() + addDays);

                // Füge die neue Routenzeit hinzu
                addTimeFamilyData.routeTimes.push({
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                    addedBy: interaction.user.id,
                    addedAt: new Date().toISOString(),
                    password: addRoutePassword
                });

                saveDatabase(database);

                // Aktualisiere den Zeit-Kanal
                const timeChannel = await interaction.guild?.channels.fetch(addTimeFamilyData.timeChannelId) as TextChannel;
                if (timeChannel) {
                    const timeEmbed = new EmbedBuilder()
                        .setTitle('⏰ Routenzeiten')
                        .setDescription('Hier sind alle Routenzeiten:')
                        .addFields(
                            addTimeFamilyData.routeTimes.map((time, index) => {
                                const start = new Date(time.startTime);
                                const end = new Date(time.endTime);
                                const daysLeft = Math.ceil((end.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                                
                                return {
                                    name: `Route ${index + 1}`,
                                    value: `Start: ${start.toLocaleString('de-DE')}\nEnde: ${end.toLocaleString('de-DE')}\nVerbleibend: ${daysLeft} Tage`,
                                    inline: true
                                };
                            })
                        )
                        .setColor('#00ff00')
                        .setTimestamp();

                    // Lösche alte Nachrichten
                    const messages = await timeChannel.messages.fetch({ limit: 10 });
                    await Promise.all(messages.map(msg => msg.delete()));

                    await timeChannel.send({ embeds: [timeEmbed] });
                }

                // Aktualisiere den Passwort-Kanal
                const passwordChannel = await interaction.guild?.channels.fetch(addTimeFamilyData.passwordChannelId) as TextChannel;
                if (passwordChannel) {
                    const passwordEmbed = new EmbedBuilder()
                        .setTitle('🔑 Routenpasswörter')
                        .setDescription('Hier sind die Passwörter für deine Routen:')
                        .addFields(
                            addTimeFamilyData.routeTimes.map((time, index) => ({
                                name: `Route ${index + 1}`,
                                value: time.password || 'Kein Passwort gesetzt',
                                inline: true
                            }))
                        )
                        .setColor('#ff9900')
                        .setTimestamp();

                    // Lösche alte Nachrichten
                    const messages = await passwordChannel.messages.fetch({ limit: 10 });
                    await Promise.all(messages.map(msg => msg.delete()));

                    await passwordChannel.send({ embeds: [passwordEmbed] });
                }

                await interaction.reply({
                    content: `Neue Routenzeit und Passwort für ${addTimeRole.name} wurden erfolgreich hinzugefügt!`,
                    flags: 64
                });
            } catch (error) {
                console.error('Fehler beim Hinzufügen der Routenzeit:', error);
                await interaction.reply({
                    content: 'Es ist ein Fehler beim Hinzufügen der Routenzeit aufgetreten!',
                    flags: 64
                });
            }
            break;

        case 'befehl-rolle-hinzufügen':
            const roleToAdd = interaction.options.getRole('rolle', true);
            
            if (!serverConfig.commandRoles) {
                serverConfig.commandRoles = [];
            }

            if (serverConfig.commandRoles.includes(roleToAdd.id)) {
                await interaction.reply({
                    content: 'Diese Rolle hat bereits die Berechtigung, Befehle auszuführen!',
                    flags: 64
                });
                return;
            }

            serverConfig.commandRoles.push(roleToAdd.id);
            saveDatabase(database);

            await interaction.reply({
                content: `Die Rolle ${roleToAdd} kann jetzt Befehle ausführen!`,
                flags: 64
            });
            break;

        case 'befehl-rolle-entfernen':
            const roleToRemove = interaction.options.getRole('rolle', true);
            
            if (!serverConfig.commandRoles || !serverConfig.commandRoles.includes(roleToRemove.id)) {
                await interaction.reply({
                    content: 'Diese Rolle hat keine Berechtigung, Befehle auszuführen!',
                    flags: 64
                });
                return;
            }

            serverConfig.commandRoles = serverConfig.commandRoles.filter(id => id !== roleToRemove.id);
            saveDatabase(database);

            await interaction.reply({
                content: `Die Rolle ${roleToRemove} kann keine Befehle mehr ausführen!`,
                flags: 64
            });
            break;

        case 'befehl-rollen-liste':
            if (!serverConfig.commandRoles || serverConfig.commandRoles.length === 0) {
                await interaction.reply({
                    content: 'Es sind keine zusätzlichen Rollen für Befehle konfiguriert.',
                    flags: 64
                });
                return;
            }

            const commandRoleList = serverConfig.commandRoles.map(roleId => {
                const role = interaction.guild?.roles.cache.get(roleId);
                return role ? `${role}` : 'Unbekannte Rolle';
            }).join('\n');

            const commandRolesEmbed = new EmbedBuilder()
                .setTitle('📋 Rollen mit Befehlsberechtigung')
                .setDescription(commandRoleList)
                .setColor('#0099ff');

            await interaction.reply({ 
                embeds: [commandRolesEmbed], 
                flags: 64
            });
            break;

        case 'info-kanal-hinzufügen':
            const channelToAdd = interaction.options.getChannel('kanal', true);
            
            if (!(channelToAdd instanceof TextChannel || channelToAdd instanceof CategoryChannel)) {
                await interaction.reply({
                    content: 'Der ausgewählte Kanal muss ein Textkanal oder eine Kategorie sein!',
                    flags: 64
                });
                return;
            }

            if (!serverConfig.infoChannels) {
                serverConfig.infoChannels = [];
            }

            if (serverConfig.infoChannels.includes(channelToAdd.id)) {
                await interaction.reply({
                    content: 'Dieser Kanal ist bereits als Info-Kanal konfiguriert!',
                    flags: 64
                });
                return;
            }

            serverConfig.infoChannels.push(channelToAdd.id);
            saveDatabase(database);

            // Aktualisiere die Berechtigungen für alle Familien-Rollen
            for (const roleId of serverConfig.reactionRoles.values()) {
                const role = interaction.guild?.roles.cache.get(roleId);
                if (role) {
                    await channelToAdd.permissionOverwrites.create(role, {
                        ViewChannel: true
                    });
                }
            }

            await interaction.reply({
                content: `Der Kanal ${channelToAdd} wurde als Info-Kanal hinzugefügt!`,
                flags: 64
            });
            break;

        case 'info-kanal-entfernen':
            const channelToRemove = interaction.options.getChannel('kanal', true);
            
            if (!(channelToRemove instanceof TextChannel || channelToRemove instanceof CategoryChannel)) {
                await interaction.reply({
                    content: 'Der ausgewählte Kanal muss ein Textkanal oder eine Kategorie sein!',
                    flags: 64
                });
                return;
            }
            
            if (!serverConfig.infoChannels || !serverConfig.infoChannels.includes(channelToRemove.id)) {
                await interaction.reply({
                    content: 'Dieser Kanal ist kein Info-Kanal!',
                    flags: 64
                });
                return;
            }

            serverConfig.infoChannels = serverConfig.infoChannels.filter(id => id !== channelToRemove.id);
            saveDatabase(database);

            // Entferne die Berechtigungen für alle Familien-Rollen
            for (const roleId of serverConfig.reactionRoles.values()) {
                const role = interaction.guild?.roles.cache.get(roleId);
                if (role) {
                    await channelToRemove.permissionOverwrites.delete(role);
                }
            }

            await interaction.reply({
                content: `Der Kanal ${channelToRemove} wurde aus den Info-Kanälen entfernt!`,
                flags: 64
            });
            break;

        case 'info-kanäle-liste':
            if (!serverConfig.infoChannels || serverConfig.infoChannels.length === 0) {
                await interaction.reply({
                    content: 'Es sind keine Info-Kanäle konfiguriert.',
                    flags: 64
                });
                return;
            }

            const infoChannelList = serverConfig.infoChannels.map(channelId => {
                const channel = interaction.guild?.channels.cache.get(channelId);
                return channel ? `${channel}` : 'Unbekannter Kanal';
            }).join('\n');

            const infoChannelsEmbed = new EmbedBuilder()
                .setTitle('📋 Info-Kanäle')
                .setDescription(infoChannelList)
                .setColor('#0099ff');

            await interaction.reply({ 
                embeds: [infoChannelsEmbed], 
                flags: 64
            });
            break;
    }
});

client.login(process.env.TOKEN); 