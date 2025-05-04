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
    CategoryChannel,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ButtonInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { updatePasswordChannel, createWorkerRemovedEmbed } from './workers';

dotenv.config();

// Datenbank-Interface
interface UserRole {
    userId: string;
    roleId: string;
    assignedAt: string;
    employerId?: string;
    password?: string; // Neues Feld für das Passwort
}

interface ServerConfig {
    guildId: string;
    rejoinLogChannelId?: string;
    roleSelectionChannelId?: string;
    roleSelectionMessageId?: string;
    roleAssignmentLogChannelId?: string;
    roleErrorLogChannelId?: string;
    workerInfoChannelId?: string;
    workerPasswordChannelId?: string; // Neuer Kanal für Passwörter
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
    pendingWorkerApplications?: {
        workerId: string;
        employerId: string;
        roleId: string;
        appliedAt: string;
    }[];
    routeControlChannelId?: string;
    routeControlLogChannelId?: string;
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

// Konstanten für die Arbeiter-Rolle
const WORKER_ROLE_NAME = 'Arbeiter';
const WORKER_EMOJI = '👷';

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
    new SlashCommandBuilder()
        .setName('arbeiter-info-kanal-setzen')
        .setDescription('Setzt den Kanal für Arbeiter-Informationen')
        .addChannelOption(option =>
            option.setName('kanal')
                .setDescription('Der Kanal für Arbeiter-Informationen')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('arbeiter-entfernen')
        .setDescription('Entfernt einen Arbeiter')
        .addUserOption(option =>
            option.setName('arbeiter')
                .setDescription('Der Arbeiter, der entfernt werden soll')
                .setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('arbeiter-passwort-kanal-setzen')
        .setDescription('Setzt den Kanal für Arbeiter-Passwörter')
        .addChannelOption(option =>
            option.setName('kanal')
                .setDescription('Der Kanal für Arbeiter-Passwörter')
                .setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('benutzer-entfernen')
        .setDescription('Entfernt einen Benutzer aus der Datenbank (Admin only)')
        .addUserOption(option =>
            option.setName('benutzer')
                .setDescription('Der Benutzer, der aus der Datenbank entfernt werden soll')
                .setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('route-kontrolle-setzen')
        .setDescription('Setzt den Kanal für das Routen-Kontroll-Menü')
        .addChannelOption(option =>
            option.setName('kanal')
                .setDescription('Der Kanal für das Routen-Kontroll-Menü')
                .setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('route-log-setzen')
        .setDescription('Setzt den Kanal für die Routen-Kontroll-Logs')
        .addChannelOption(option =>
            option.setName('kanal')
                .setDescription('Der Kanal für die Routen-Kontroll-Logs')
                .setRequired(true))
        .toJSON(),
];

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
                        
                        // Erstelle die Rollen-Auswahl-Nachricht mit Buttons
                        const { embed, rows } = await createRoleSelectionMessage(channel, serverConfig);
                        
                        // Bearbeite die bestehende Nachricht
                        await message.edit({ 
                            embeds: [embed],
                            components: rows
                        });
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

// Funktion zum Erstellen der Arbeiter-Rolle
async function createWorkerRole(guild: any) {
    try {
        // Prüfe, ob die Rolle bereits existiert
        let workerRole = guild.roles.cache.find((role: any) => role.name === WORKER_ROLE_NAME);
        
        if (!workerRole) {
            // Erstelle die Rolle, falls sie nicht existiert
            workerRole = await guild.roles.create({
                name: WORKER_ROLE_NAME,
                color: '#FFA500', // Orange Farbe
                reason: 'Automatische Erstellung der Arbeiter-Rolle'
            });
            console.log(`Arbeiter-Rolle wurde erstellt: ${workerRole.name}`);
        }

        // Füge die Rolle zur Datenbank hinzu
        const serverConfig = getServerConfig(guild.id);
        serverConfig.reactionRoles.set(WORKER_EMOJI, workerRole.id);
        saveDatabase(database);

        return workerRole;
    } catch (error) {
        console.error('Fehler beim Erstellen der Arbeiter-Rolle:', error);
        return null;
    }
}

// Funktion zum Erstellen der Rollen-Auswahl-Nachricht
async function createRoleSelectionMessage(channel: TextChannel, serverConfig: ServerConfig) {
    const embed = new EmbedBuilder()
        .setTitle('🎭 Rollen-Auswahl')
        .setDescription('Klicke auf einen der Buttons unten, um dir eine Rolle zuzuweisen.\n' +
            'Du kannst nur eine Rolle gleichzeitig haben.\n' +
            '**Wichtig:** Einmal zugewiesene Rollen können nicht mehr entfernt werden!')
        .setColor('#0099ff')
        .setFooter({ text: 'Wähle deine Rolle mit Bedacht - sie kann nicht mehr entfernt werden!' });

    // Erstelle Buttons für jede Rolle
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();
    let buttonCount = 0;

    // Füge zuerst den Arbeiter-Button hinzu
    const workerRole = channel.guild.roles.cache.find(role => role.name === WORKER_ROLE_NAME);
    if (workerRole) {
        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`role_${workerRole.id}`)
                .setLabel('Arbeiter')
                .setEmoji(WORKER_EMOJI)
                .setStyle(ButtonStyle.Primary)
        );
        buttonCount++;
    }

    // Füge dann die restlichen Rollen hinzu
    for (const [emoji, roleId] of serverConfig.reactionRoles) {
        if (emoji === WORKER_EMOJI) continue; // Überspringe die Arbeiter-Rolle, da sie bereits hinzugefügt wurde

        const role = channel.guild.roles.cache.get(roleId);
        if (role) {
            if (buttonCount === 5) {
                rows.push(currentRow);
                currentRow = new ActionRowBuilder<ButtonBuilder>();
                buttonCount = 0;
            }

            currentRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`role_${role.id}`)
                    .setLabel(role.name)
                    .setEmoji(emoji)
                    .setStyle(ButtonStyle.Primary)
            );
            buttonCount++;
        }
    }

    if (buttonCount > 0) {
        rows.push(currentRow);
    }

    return { embed, rows };
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

            // Erstelle die Arbeiter-Rolle
            const createdWorkerRole = await createWorkerRole(interaction.guild);
            
            // Erstelle die Rollen-Auswahl-Nachricht mit Buttons
            const { embed, rows } = await createRoleSelectionMessage(interaction.channel, serverConfig);
            
            const roleMessage = await interaction.channel.send({ 
                embeds: [embed],
                components: rows
            });
            
            serverConfig.roleSelectionMessageId = roleMessage.id;
            serverConfig.roleSelectionChannelId = interaction.channel.id;
            saveDatabase(database);

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

        case 'arbeiter-info-kanal-setzen':
            const workerInfoChannel = interaction.options.getChannel('kanal', true);
            if (!(workerInfoChannel instanceof TextChannel)) {
                await interaction.reply({
                    content: 'Der ausgewählte Kanal muss ein Textkanal sein!',
                    flags: 64
                });
                return;
            }

            serverConfig.workerInfoChannelId = workerInfoChannel.id;
            saveDatabase(database);

            // Erstelle eine Willkommensnachricht im neuen Kanal
            const workerInfoEmbed = new EmbedBuilder()
                .setTitle('👷 Arbeiter-Informationen')
                .setDescription('In diesem Kanal werden wichtige Informationen für Arbeiter geteilt.\n' +
                    'Hier findest du:\n' +
                    '• Passwörter für Routen\n' +
                    '• Wichtige Ankündigungen\n' +
                    '• Andere relevante Informationen')
                .setColor('#FFA500')
                .setTimestamp();

            await workerInfoChannel.send({ embeds: [workerInfoEmbed] });

            // Setze die Berechtigungen für den Kanal
            const workerRoleForChannel = interaction.guild?.roles.cache.find(role => role.name === WORKER_ROLE_NAME);
            if (workerRoleForChannel) {
                await workerInfoChannel.permissionOverwrites.create(workerRoleForChannel, {
                    ViewChannel: true,
                    ReadMessageHistory: true
                });
            }

            await interaction.reply({
                content: `Der Arbeiter-Info-Kanal wurde auf ${workerInfoChannel} gesetzt!`,
                flags: 64
            });
            break;

        case 'arbeiter-entfernen':
            const workerToRemove = interaction.options.getUser('arbeiter', true);
            const workerMember = await interaction.guild?.members.fetch(workerToRemove.id);
            const existingWorkerRole = interaction.guild?.roles.cache.find(r => r.name === WORKER_ROLE_NAME);

            if (!workerMember || !existingWorkerRole) {
                await interaction.reply({
                    content: 'Der Arbeiter oder die Arbeiter-Rolle wurde nicht gefunden!',
                    flags: 64
                });
                return;
            }

            if (!workerMember.roles.cache.has(existingWorkerRole.id)) {
                await interaction.reply({
                    content: 'Dieser Benutzer ist kein Arbeiter!',
                    flags: 64
                });
                return;
            }

            try {
                // Entferne die Rolle
                await workerMember.roles.remove(existingWorkerRole);
                
                // Entferne die Rolle aus der Datenbank
                serverConfig.userRoles = serverConfig.userRoles.filter(ur => ur.userId !== workerMember.id);
                saveDatabase(database);

                // Logge das Entfernen der Rolle
                if (serverConfig.roleAssignmentLogChannelId) {
                    const logChannel = interaction.guild?.channels.cache.get(serverConfig.roleAssignmentLogChannelId) as TextChannel;
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('👋 Arbeiter entfernt')
                            .setDescription(`${workerMember.user.tag} wurde als Arbeiter entfernt`)
                            .addFields(
                                { name: 'Arbeiter', value: workerMember.user.tag },
                                { name: 'Chef', value: interaction.user.tag },
                                { name: 'Zeitpunkt', value: new Date().toLocaleString('de-DE') }
                            )
                            .setColor('#ff9900')
                            .setTimestamp();

                        await logChannel.send({ embeds: [logEmbed] });
                    }
                }

                // Benachrichtige den Arbeiter
                await workerMember.send(`Du wurdest von ${interaction.user.tag} als Arbeiter entfernt.`).catch(() => {});

                await interaction.reply({
                    content: `${workerMember.user.tag} wurde als Arbeiter entfernt.`,
                    flags: 64
                });
            } catch (error) {
                console.error('Fehler beim Entfernen des Arbeiters:', error);
                await interaction.reply({
                    content: 'Es ist ein Fehler beim Entfernen des Arbeiters aufgetreten!',
                    flags: 64
                });
            }
            break;

        case 'arbeiter-passwort-kanal-setzen':
            const workerPasswordChannel = interaction.options.getChannel('kanal', true);
            if (!(workerPasswordChannel instanceof TextChannel)) {
                await interaction.reply({
                    content: 'Der ausgewählte Kanal muss ein Textkanal sein!',
                    flags: 64
                });
                return;
            }

            serverConfig.workerPasswordChannelId = workerPasswordChannel.id;
            saveDatabase(database);

            // Erstelle eine Willkommensnachricht im neuen Kanal
            const workerPasswordEmbed = new EmbedBuilder()
                .setTitle('🔑 Arbeiter-Passwörter')
                .setDescription('In diesem Kanal werden die Passwörter der Arbeiter angezeigt.\n' +
                    'Hier findest du eine übersichtliche Liste aller Arbeiter und ihrer Passwörter.')
                .setColor('#FFA500')
                .setTimestamp();

            await workerPasswordChannel.send({ embeds: [workerPasswordEmbed] });

            // Setze die Berechtigungen für den Kanal
            const workerRoleForPasswordChannel = interaction.guild?.roles.cache.find(role => role.name === WORKER_ROLE_NAME);
            if (workerRoleForPasswordChannel) {
                await workerPasswordChannel.permissionOverwrites.create(workerRoleForPasswordChannel, {
                    ViewChannel: true,
                    ReadMessageHistory: true
                });
            }

            await interaction.reply({
                content: `Der Arbeiter-Passwort-Kanal wurde auf ${workerPasswordChannel} gesetzt!`,
                flags: 64
            });
            break;

        case 'benutzer-entfernen':
            // Sofortige Antwort auf die Interaktion
            await interaction.deferReply({ ephemeral: true });

            // Prüfe Admin-Berechtigung
            if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
                await interaction.editReply({
                    content: 'Du hast keine Berechtigung für diesen Befehl!'
                });
                return;
            }

            const userToRemove = interaction.options.getUser('benutzer', true);
            const userMember = await interaction.guild?.members.fetch(userToRemove.id);

            if (!userMember) {
                await interaction.editReply({
                    content: 'Der angegebene Benutzer wurde nicht gefunden!'
                });
                return;
            }

            try {
                // Entferne alle Rollen des Benutzers aus der Datenbank
                const removedRoles = serverConfig.userRoles.filter(ur => ur.userId === userToRemove.id);
                serverConfig.userRoles = serverConfig.userRoles.filter(ur => ur.userId !== userToRemove.id);

                // Entferne ausstehende Bewerbungen
                if (serverConfig.pendingWorkerApplications) {
                    serverConfig.pendingWorkerApplications = serverConfig.pendingWorkerApplications.filter(
                        app => app.workerId !== userToRemove.id && app.employerId !== userToRemove.id
                    );
                }

                saveDatabase(database);

                // Logge das Entfernen
                if (serverConfig.roleAssignmentLogChannelId) {
                    const logChannel = interaction.guild?.channels.cache.get(serverConfig.roleAssignmentLogChannelId) as TextChannel;
                    if (logChannel) {
                        const logEmbed = new EmbedBuilder()
                            .setTitle('🗑️ Benutzer aus Datenbank entfernt')
                            .setDescription(`<@${userToRemove.id}> wurde aus der Datenbank entfernt`)
                            .addFields(
                                { name: 'Benutzer', value: `<@${userToRemove.id}>` },
                                { name: 'Entfernt von', value: `<@${interaction.user.id}>` },
                                { name: 'Entfernte Rollen', value: removedRoles.length > 0 
                                    ? removedRoles.map(ur => `<@&${ur.roleId}>`).join(', ') 
                                    : 'Keine' },
                                { name: 'Zeitpunkt', value: new Date().toLocaleString('de-DE') }
                            )
                            .setColor('#ff0000')
                            .setTimestamp();

                        await logChannel.send({ embeds: [logEmbed] });
                    }
                }

                // Aktualisiere den Passwort-Kanal, falls vorhanden
                if (serverConfig.workerPasswordChannelId) {
                    const passwordChannel = interaction.guild?.channels.cache.get(serverConfig.workerPasswordChannelId) as TextChannel;
                    if (passwordChannel) {
                        const workersWithPasswords = serverConfig.userRoles
                            .filter(ur => ur.employerId)
                            .map(async ur => {
                                const workerMember = await interaction.guild?.members.fetch(ur.userId).catch(() => null);
                                const employerMember = await interaction.guild?.members.fetch(ur.employerId!).catch(() => null);
                                return {
                                    worker: workerMember,
                                    employer: employerMember,
                                    assignedAt: ur.assignedAt
                                };
                            });

                        const workers = await Promise.all(workersWithPasswords);

                        const passwordEmbed = new EmbedBuilder()
                            .setTitle('🔑 Arbeiter-Passwörter')
                            .setDescription('Hier sind alle Arbeiter und ihre Passwörter:')
                            .addFields(
                                {
                                    name: 'Arbeiter',
                                    value: workers.map((w, index) => {
                                        const workerRole = serverConfig.userRoles.find(ur => ur.userId === w.worker?.id);
                                        return `${w.worker?.displayName || 'Unbekannt'}: ${workerRole?.password || 'Kein Passwort gesetzt'}`;
                                    }).join('\n'),
                                    inline: false
                                }
                            )
                            .setColor('#FFA500')
                            .setTimestamp();

                        // Lösche alte Nachrichten
                        const messages = await passwordChannel.messages.fetch({ limit: 10 });
                        await Promise.all(messages.map(msg => msg.delete()));

                        await passwordChannel.send({ embeds: [passwordEmbed] });
                    }
                }

                await interaction.editReply({
                    content: `Der Benutzer <@${userToRemove.id}> wurde erfolgreich aus der Datenbank entfernt!`
                });
            } catch (error) {
                console.error('Fehler beim Entfernen des Benutzers:', error);
                await interaction.editReply({
                    content: 'Es ist ein Fehler beim Entfernen des Benutzers aufgetreten!'
                });
            }
            break;

        case 'route-kontrolle-setzen':
            const routeControlChannel = interaction.options.getChannel('kanal', true);
            if (!(routeControlChannel instanceof TextChannel)) {
                await interaction.reply({
                    content: 'Der ausgewählte Kanal muss ein Textkanal sein!',
                    flags: 64
                });
                return;
            }

            serverConfig.routeControlChannelId = routeControlChannel.id;
            saveDatabase(database);

            // Erstelle das Routen-Kontroll-Menü
            const { createRouteControlMenu } = await import('./routeControl');
            await createRouteControlMenu(routeControlChannel, serverConfig);

            await interaction.reply({
                content: `Der Routen-Kontroll-Kanal wurde auf ${routeControlChannel} gesetzt!`,
                flags: 64
            });
            break;

        case 'route-log-setzen':
            const routeControlLogChannel = interaction.options.getChannel('kanal', true);
            if (!(routeControlLogChannel instanceof TextChannel)) {
                await interaction.reply({
                    content: 'Der ausgewählte Kanal muss ein Textkanal sein!',
                    flags: 64
                });
                return;
            }

            serverConfig.routeControlLogChannelId = routeControlLogChannel.id;
            saveDatabase(database);

            // Erstelle eine Willkommensnachricht im neuen Kanal
            const routeControlLogEmbed = new EmbedBuilder()
                .setTitle('🚦 Routen-Kontroll-Logs')
                .setDescription('In diesem Kanal werden alle Routen-Kontrollen protokolliert.')
                .setColor('#0099ff')
                .setTimestamp();

            await routeControlLogChannel.send({ embeds: [routeControlLogEmbed] });

            await interaction.reply({
                content: `Der Routen-Kontroll-Log-Kanal wurde auf ${routeControlLogChannel} gesetzt!`,
                flags: 64
            });
            break;
    }
});

// Button Interaction Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    if (!customId.startsWith('role_')) return;

    const roleId = customId.replace('role_', '');
    const guild = interaction.guild;
    if (!guild) return;

    const serverConfig = getServerConfig(guild.id);
    const member = interaction.member as GuildMember;
    const role = guild.roles.cache.get(roleId);

    if (!role) {
        await interaction.reply({
            content: 'Diese Rolle existiert nicht mehr!',
            flags: 64
        });
        return;
    }

    try {
        // Prüfe, ob der Benutzer bereits eine Rolle hat
        const existingRole = serverConfig.userRoles.find(ur => ur.userId === member.id);
        if (existingRole) {
            await interaction.reply({
                content: 'Du hast bereits eine Rolle! Diese kann nicht mehr entfernt werden.',
                flags: 64
            });
            return;
        }

        // Wenn es sich um die Arbeiter-Rolle handelt, zeige den Modal
        if (role.name === WORKER_ROLE_NAME) {
            const modal = new ModalBuilder()
                .setCustomId(`worker_modal_${role.id}`)
                .setTitle('Arbeiter-Anmeldung');

            const employerInput = new TextInputBuilder()
                .setCustomId('employer')
                .setLabel('Wessen Arbeiter möchtest du sein?')
                .setPlaceholder('Gib den Namen deines zukünftigen Chefs ein')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(employerInput);
            modal.addComponents(firstActionRow);

            await interaction.showModal(modal);
            return;
        }

        // Für andere Rollen: Direkte Zuweisung
        await member.roles.add(role);
        
        // Speichere die Rolle in der Datenbank
        serverConfig.userRoles.push({
            userId: member.id,
            roleId: role.id,
            assignedAt: new Date().toISOString()
        });
        saveDatabase(database);

        // Logge die erfolgreiche Rollenvergabe
        if (serverConfig.roleAssignmentLogChannelId) {
            const logChannel = guild.channels.cache.get(serverConfig.roleAssignmentLogChannelId) as TextChannel;
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('✅ Rolle zugewiesen')
                    .setDescription(`${member.user.tag} hat sich eine Rolle zugewiesen`)
                    .addFields(
                        { name: 'Benutzer ID', value: member.id },
                        { name: 'Zugewiesene Rolle', value: `<@&${role.id}>` }
                    )
                    .setColor('#00ff00')
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed] });
            }
        }

        await interaction.reply({
            content: `Du hast die Rolle ${role} erhalten!`,
            flags: 64
        });
    } catch (error) {
        console.error('Fehler beim Zuweisen der Rolle:', error);
        await interaction.reply({
            content: 'Es ist ein Fehler beim Zuweisen der Rolle aufgetreten!',
            flags: 64
        });
    }
});

// Modal Submit Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    const customId = interaction.customId;
    if (!customId.startsWith('worker_modal_')) return;

    const roleId = customId.replace('worker_modal_', '');
    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({
            content: 'Dieser Befehl kann nur in einem Server verwendet werden!',
            flags: 64
        });
        return;
    }

    // Sofortige Antwort auf die Interaktion
    await interaction.deferReply({ ephemeral: true });

    const serverConfig = getServerConfig(guild.id);
    const member = interaction.member as GuildMember;
    const role = guild.roles.cache.get(roleId);

    if (!role) {
        await interaction.editReply({
            content: 'Diese Rolle existiert nicht mehr!'
        });
        return;
    }

    try {
        const employerInput = interaction.fields.getTextInputValue('employer');
        
        // Versuche den Arbeitgeber zu finden
        let employer = null;
        
        // Suche nach ID
        if (employerInput.match(/^\d+$/)) {
            try {
                employer = await guild.members.fetch(employerInput);
            } catch (error) {
                console.error('Fehler beim Abrufen des Mitglieds:', error);
            }
        }
        
        // Suche nach Username
        if (!employer) {
            try {
                // Suche nach exaktem Match
                const exactMatch = guild.members.cache.find(m => 
                    m.user.username.toLowerCase() === employerInput.toLowerCase() ||
                    m.displayName.toLowerCase() === employerInput.toLowerCase()
                );
                
                if (exactMatch) {
                    employer = exactMatch;
                } else {
                    // Suche nach Teilübereinstimmung
                    const partialMatch = guild.members.cache.find(m => 
                        m.user.username.toLowerCase().includes(employerInput.toLowerCase()) ||
                        m.displayName.toLowerCase().includes(employerInput.toLowerCase())
                    );
                    
                    if (partialMatch) {
                        employer = partialMatch;
                    }
                }
            } catch (error) {
                console.error('Fehler beim Suchen des Mitglieds:', error);
            }
        }

        if (!employer) {
            await interaction.editReply({
                content: 'Der angegebene Arbeitgeber wurde nicht gefunden! Bitte versuche es erneut.'
            });
            return;
        }

        // Prüfe, ob der Bewerber nicht der Arbeitgeber selbst ist
        if (employer.id === member.id) {
            await interaction.editReply({
                content: 'Du kannst nicht dein eigener Arbeiter sein!'
            });
            return;
        }

        // Speichere die Bewerbung in der Datenbank
        if (!serverConfig.pendingWorkerApplications) {
            serverConfig.pendingWorkerApplications = [];
        }
        
        serverConfig.pendingWorkerApplications.push({
            workerId: member.id,
            employerId: employer.id,
            roleId: role.id,
            appliedAt: new Date().toISOString()
        });
        saveDatabase(database);

        // Sende eine Nachricht in den Arbeiter-Info-Kanal
        if (serverConfig.workerInfoChannelId) {
            const workerInfoChannel = guild.channels.cache.get(serverConfig.workerInfoChannelId) as TextChannel;
            if (workerInfoChannel) {
                const workerInfoEmbed = new EmbedBuilder()
                    .setTitle('👷 Neuer Arbeiter-Bewerber')
                    .setDescription(`<@${member.id}> möchte Arbeiter von <@${employer.id}> werden`)
                    .addFields(
                        { name: 'Bewerber', value: `<@${member.id}>` },
                        { name: 'Zukünftiger Chef', value: `<@${employer.id}>` },
                        { name: 'Zeitpunkt', value: new Date().toLocaleString('de-DE') }
                    )
                    .setColor('#FFA500')
                    .setTimestamp();

                const acceptButton = new ButtonBuilder()
                    .setCustomId(`accept_worker_${member.id}_${role.id}_${employer.id}`)
                    .setLabel('Annehmen')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('✅');

                const rejectButton = new ButtonBuilder()
                    .setCustomId(`reject_worker_${member.id}_${role.id}_${employer.id}`)
                    .setLabel('Ablehnen')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('❌');

                const row = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(acceptButton, rejectButton);

                await workerInfoChannel.send({ 
                    embeds: [workerInfoEmbed],
                    components: [row]
                });
            }
        }

        await interaction.editReply({
            content: `Deine Bewerbung als Arbeiter für ${employer.user.tag} wurde eingereicht! Warte auf die Bestätigung.`
        });
    } catch (error) {
        console.error('Fehler beim Einreichen der Bewerbung:', error);
        await interaction.editReply({
            content: 'Es ist ein Fehler beim Einreichen der Bewerbung aufgetreten!'
        });
    }
});

// Im Button Interaction Handler für die Arbeiter-Aktionen
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    if (!customId.startsWith('accept_worker_') && !customId.startsWith('reject_worker_') && !customId.startsWith('remove_worker_')) return;

    const guild = interaction.guild;
    if (!guild) return;

    const serverConfig = getServerConfig(guild.id);
    const [action, _, workerId, roleId, employerId] = customId.split('_');
    const worker = await guild.members.fetch(workerId).catch(() => null);
    const role = guild.roles.cache.get(roleId);
    const employer = employerId ? await guild.members.fetch(employerId).catch(() => null) : null;

    if (!worker || !role) {
        await interaction.reply({
            content: 'Der Arbeiter oder die Rolle wurde nicht gefunden!',
            flags: 64
        });
        return;
    }

    // Prüfe Berechtigungen
    const member = interaction.member as GuildMember;
    const hasPermission = member.permissions.has(PermissionFlagsBits.Administrator) ||
        (serverConfig.commandRoles && member.roles.cache.some(role => 
            serverConfig.commandRoles!.includes(role.id)
        ));

    if (!hasPermission) {
        await interaction.reply({
            content: 'Du hast keine Berechtigung für diese Aktion!',
            flags: 64
        });
        return;
    }

    try {
        if (action === 'accept') {
            // Zeige das Passwort-Modal
            const modal = new ModalBuilder()
                .setCustomId(`worker_password_modal_${workerId}_${roleId}_${employerId}`)
                .setTitle('Arbeiter-Passwort festlegen');

            const passwordInput = new TextInputBuilder()
                .setCustomId('password')
                .setLabel('Passwort für den Arbeiter')
                .setPlaceholder('Gib ein Passwort ein, das dem Arbeiter mitgeteilt wird')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(passwordInput);
            modal.addComponents(firstActionRow);

            await interaction.showModal(modal);
            return;
        } else if (action === 'reject') {
            // Entferne die Bewerbung aus den ausstehenden Bewerbungen
            if (serverConfig.pendingWorkerApplications) {
                serverConfig.pendingWorkerApplications = serverConfig.pendingWorkerApplications.filter(
                    app => app.workerId !== worker.id
                );
                saveDatabase(database);
            }

            // Logge die Ablehnung
            if (serverConfig.roleAssignmentLogChannelId) {
                const logChannel = guild.channels.cache.get(serverConfig.roleAssignmentLogChannelId) as TextChannel;
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('❌ Arbeiter abgelehnt')
                        .setDescription(`${worker.user.tag} wurde als Arbeiter abgelehnt`)
                        .addFields(
                            { name: 'Bewerber', value: worker.user.tag },
                            { name: 'Chef', value: employer?.user.tag || 'Unbekannt' },
                            { name: 'Abgelehnt von', value: interaction.user.tag },
                            { name: 'Zeitpunkt', value: new Date().toLocaleString('de-DE') }
                        )
                        .setColor('#ff0000')
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] });
                }
            }

            // Benachrichtige den Bewerber
            await worker.send(`Deine Bewerbung als Arbeiter bei ${employer?.user.tag || 'einem Administrator'} wurde abgelehnt.`).catch(() => {});

            await interaction.reply({
                content: `${worker.user.tag} wurde als Arbeiter abgelehnt.`,
                flags: 64
            });
        } else if (action === 'remove') {
            // Prüfe nur noch auf allgemeine Berechtigungen
            if (!hasPermission) {
                await interaction.reply({
                    content: 'Du hast keine Berechtigung für diese Aktion!',
                    flags: 64
                });
                return;
            }

            // Entferne die Rolle
            await worker.roles.remove(role);
            
            // Entferne die Rolle aus der Datenbank
            serverConfig.userRoles = serverConfig.userRoles.filter(ur => ur.userId !== worker.id);
            saveDatabase(database);

            // Aktualisiere den Passwort-Kanal
            await updatePasswordChannel(guild, serverConfig);

            // Erstelle die neue Informationsnachricht
            const removedEmbed = createWorkerRemovedEmbed(worker, employer, interaction.member as GuildMember);

            // Bearbeite die ursprüngliche Nachricht
            if (interaction.message) {
                await interaction.message.edit({
                    embeds: [removedEmbed],
                    components: [] // Entferne die Buttons
                });
            }

            // Logge das Entfernen der Rolle
            if (serverConfig.roleAssignmentLogChannelId) {
                const logChannel = guild.channels.cache.get(serverConfig.roleAssignmentLogChannelId) as TextChannel;
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle('👋 Arbeiter entlassen')
                        .setDescription(`${worker.user.tag} wurde als Arbeiter entlassen`)
                        .addFields(
                            { name: 'Arbeiter', value: worker.user.tag },
                            { name: 'Chef', value: employer?.user.tag || 'Unbekannt' },
                            { name: 'Entlassen von', value: interaction.user.tag },
                            { name: 'Zeitpunkt', value: new Date().toLocaleString('de-DE') }
                        )
                        .setColor('#ff9900')
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] });
                }
            }

            // Benachrichtige den Arbeiter
            await worker.send(`Du wurdest von ${interaction.user.tag} als Arbeiter entlassen.`).catch(() => {});

            // Benachrichtige den ursprünglichen Chef (falls es nicht der Chef selbst war)
            if (employer && employer.id !== member.id) {
                await employer.send(`${worker.user.tag} wurde von ${interaction.user.tag} als dein Arbeiter entlassen.`).catch(() => {});
            }

            await interaction.reply({
                content: `${worker.user.tag} wurde als Arbeiter entlassen.`,
                flags: 64
            });
        }

        // Deaktiviere die Buttons nach der Aktion
        const message = interaction.message;
        const firstRow = message.components[0];
        if (firstRow && 'components' in firstRow) {
            const newRow = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    firstRow.components.map((button: any) => 
                        ButtonBuilder.from(button.data)
                            .setDisabled(true)
                    )
                );

            await message.edit({ components: [newRow] });
        }
    } catch (error) {
        console.error('Fehler bei der Arbeiter-Aktion:', error);
        await interaction.reply({
            content: 'Es ist ein Fehler bei der Aktion aufgetreten!',
            flags: 64
        });
    }
});

// Füge einen neuen Modal Submit Handler für das Passwort hinzu
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    const customId = interaction.customId;
    if (!customId.startsWith('worker_password_modal_')) return;

    const guild = interaction.guild;
    if (!guild) return;

    // Sofortige Antwort auf die Interaktion
    await interaction.deferReply({ ephemeral: true });

    const serverConfig = getServerConfig(guild.id);
    const [_, __, ___, workerId, roleId, employerId] = customId.split('_');
    const worker = await guild.members.fetch(workerId).catch(() => null);
    const role = guild.roles.cache.get(roleId);
    const employer = employerId ? await guild.members.fetch(employerId).catch(() => null) : null;

    if (!worker || !role) {
        await interaction.editReply({
            content: 'Der Arbeiter oder die Rolle wurde nicht gefunden!'
        });
        return;
    }

    try {
        const password = interaction.fields.getTextInputValue('password');

        // Füge die Rolle hinzu
        await worker.roles.add(role);
        
        // Speichere die Rolle und das Passwort in der Datenbank
        serverConfig.userRoles.push({
            userId: worker.id,
            roleId: role.id,
            assignedAt: new Date().toISOString(),
            employerId: employerId,
            password: password // Speichere das Passwort
        });
        saveDatabase(database);

        // Entferne die Bewerbung aus den ausstehenden Bewerbungen
        if (serverConfig.pendingWorkerApplications) {
            serverConfig.pendingWorkerApplications = serverConfig.pendingWorkerApplications.filter(
                app => app.workerId !== worker.id
            );
            saveDatabase(database);
        }

        // Erstelle die neue Informationsnachricht
        const infoEmbed = new EmbedBuilder()
            .setTitle('👷 Arbeiter-Informationen')
            .setDescription(`<@${worker.id}> ist jetzt ein Arbeiter`)
            .addFields(
                { name: 'Chef', value: employer ? `<@${employer.id}>` : 'Unbekannt' },
                { name: 'Angenommen von', value: `<@${interaction.user.id}>` },
                { name: 'Angenommen am', value: new Date().toLocaleString('de-DE') }
            )
            .setColor('#00ff00')
            .setTimestamp();

        const removeButton = new ButtonBuilder()
            .setCustomId(`remove_worker_${workerId}_${roleId}_${employerId}`)
            .setLabel('Arbeiter entlassen')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('👋');

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(removeButton);

        // Bearbeite die ursprüngliche Nachricht
        if (interaction.message) {
            await interaction.message.edit({
                embeds: [infoEmbed],
                components: [row]
            });
        }

        // Logge die erfolgreiche Rollenvergabe
        if (serverConfig.roleAssignmentLogChannelId) {
            const logChannel = guild.channels.cache.get(serverConfig.roleAssignmentLogChannelId) as TextChannel;
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setTitle('✅ Arbeiter angenommen')
                    .setDescription(`<@${worker.id}> wurde als Arbeiter angenommen`)
                    .addFields(
                        { name: 'Arbeiter', value: `<@${worker.id}>` },
                        { name: 'Chef', value: employer ? `<@${employer.id}>` : 'Unbekannt' },
                        { name: 'Angenommen von', value: `<@${interaction.user.id}>` },
                        { name: 'Zeitpunkt', value: new Date().toLocaleString('de-DE') }
                    )
                    .setColor('#00ff00')
                    .setTimestamp();

                await logChannel.send({ embeds: [logEmbed] });
            }
        }

        // Benachrichtige den Arbeiter mit dem Passwort
        await worker.send(`Du wurdest als Arbeiter von ${employer?.user.tag || 'einem Administrator'} angenommen!\nDein Passwort lautet: ${password}`).catch(() => {});

        // Benachrichtige den ursprünglichen Chef
        if (employer) {
            await employer.send(`${worker.user.tag} wurde als dein Arbeiter angenommen.`).catch(() => {});
        }

        // Aktualisiere den Passwort-Kanal
        if (serverConfig.workerPasswordChannelId) {
            const passwordChannel = guild.channels.cache.get(serverConfig.workerPasswordChannelId) as TextChannel;
            if (passwordChannel) {
                // Hole alle Arbeiter mit Passwörtern
                const workersWithPasswords = serverConfig.userRoles
                    .filter(ur => ur.roleId === role.id && ur.employerId)
                    .map(async ur => {
                        const workerMember = await guild.members.fetch(ur.userId).catch(() => null);
                        const employerMember = await guild.members.fetch(ur.employerId!).catch(() => null);
                        return {
                            worker: workerMember,
                            employer: employerMember,
                            assignedAt: ur.assignedAt
                        };
                    });

                const workers = await Promise.all(workersWithPasswords);

                const passwordEmbed = new EmbedBuilder()
                    .setTitle('🔑 Arbeiter-Passwörter')
                    .setDescription('Hier sind alle Arbeiter und ihre Passwörter:')
                    .addFields(
                        {
                            name: 'Arbeiter',
                            value: workers.map((w, index) => {
                                const workerRole = serverConfig.userRoles.find(ur => ur.userId === w.worker?.id);
                                return `${w.worker?.displayName || 'Unbekannt'}: ${workerRole?.password || 'Kein Passwort gesetzt'}`;
                            }).join('\n'),
                            inline: false
                        }
                    )
                    .setColor('#FFA500')
                    .setTimestamp();

                    // Lösche alte Nachrichten
                    const messages = await passwordChannel.messages.fetch({ limit: 10 });
                    await Promise.all(messages.map(msg => msg.delete()));

                    await passwordChannel.send({ embeds: [passwordEmbed] });
            }
        }

        await interaction.editReply({
            content: `${worker.user.tag} wurde als Arbeiter angenommen!`
        });
    } catch (error) {
        console.error('Fehler bei der Arbeiter-Aktion:', error);
        await interaction.editReply({
            content: 'Es ist ein Fehler bei der Aktion aufgetreten!'
        });
    }
});

// Im Button Interaction Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    const guild = interaction.guild;
    if (!guild) return;

    const serverConfig = getServerConfig(guild.id);

    // Routen-Kontrolle Button
    if (customId.startsWith('route_control_')) {
        const roleId = customId.replace('route_control_', '');
        const { createControlModal } = await import('./routeControl');
        
        const modal = createControlModal(roleId);
        await interaction.showModal(modal);
        return;
    }

    // Allgemeine Routen-Kontrolle Button
    if (customId === 'route_control_all') {
        const { createControlModal } = await import('./routeControl');
        
        const modal = createControlModal('all');
        await interaction.showModal(modal);
        return;
    }

    // Routen-Wache Buttons
    if (customId === 'route_watch_start') {
        const channel = interaction.channel as TextChannel;
        const { createPartnerModal } = await import('./routeControl');
        
        const modal = createPartnerModal();
        await interaction.showModal(modal);
        return;
    }

    if (customId === 'route_watch_stop') {
        const channel = interaction.channel as TextChannel;
        const { stopRouteWatch } = await import('./routeControl');
        
        await stopRouteWatch(channel, serverConfig);
        await interaction.reply({
            content: 'Die Routen-Wache wurde gestoppt!',
            ephemeral: true
        });
        return;
    }
});

// Modal Submit Handler für die Routen-Kontrolle
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    const customId = interaction.customId;
    const guild = interaction.guild;
    if (!guild) return;

    const serverConfig = getServerConfig(guild.id);

    if (customId === 'route_watch_partner_modal') {
        const channel = interaction.channel as TextChannel;
        const { startRouteWatch, findPartners } = await import('./routeControl');
        
        const partnerInput = interaction.fields.getTextInputValue('partner');
        const { found, notFound } = findPartners(channel.guild, partnerInput);
        
        let responseMessage = 'Die Routen-Wache wurde gestartet!';
        if (found.length > 0) {
            responseMessage += `\nGefundene Partner: ${found.map(m => m.user.tag).join(', ')}`;
        }
        if (notFound.length > 0) {
            responseMessage += `\nNicht gefundene Partner: ${notFound.join(', ')}`;
        }
        
        await startRouteWatch(channel, serverConfig, partnerInput);
        await interaction.reply({
            content: responseMessage,
            ephemeral: true
        });
        return;
    }

    if (!customId.startsWith('route_control_modal_')) return;

    const roleId = customId.replace('route_control_modal_', '');
    
    // Spezialfall für die allgemeine Routen-Kontrolle ("all")
    if (roleId !== 'all') {
        const familyData = serverConfig.familyChannels[roleId];
        if (!familyData) {
            await interaction.reply({
                content: 'Diese Familie wurde nicht gefunden!',
                ephemeral: true
            });
            return;
        }
    }

    const partnerInput = interaction.fields.getTextInputValue('partner');
    const controlPoints = interaction.fields.getTextInputValue('control_points');
    const notes = interaction.fields.getTextInputValue('notes');

    const { findPartners, logRouteControl } = await import('./routeControl');
    const { found, notFound } = findPartners(guild, partnerInput);

    // Erstelle die Log-Details
    let details = `Kontrolleur: ${interaction.user.tag}\n`;
    
    if (found.length > 0) {
        details += `Kontrollpartner: ${found.map(m => m.user.tag).join(', ')}\n`;
    }
    if (notFound.length > 0) {
        details += `Nicht gefundene Partner: ${notFound.join(', ')}\n`;
    }

    details += `Kontrollpunkte: ${controlPoints}\n`;
    
    if (notes) {
        details += `Auffälligkeiten: ${notes}`;
    }

    // Logge die Kontrolle
    await logRouteControl(
        guild,
        serverConfig,
        interaction.member as GuildMember,
        roleId === 'all' ? 'Allgemein' : roleId, // Verwende 'Allgemein' für die allgemeine Routen-Kontrolle
        '✅ Routen-Kontrolle durchgeführt',
        details
    );

    await interaction.reply({
        content: '✅ Die Routen-Kontrolle wurde erfolgreich protokolliert!',
        ephemeral: true
    });
});

// Neuer Handler für das StringSelectMenu (Checkboxen)
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;

    const customId = interaction.customId;
    if (!customId.startsWith('control_points_select_')) return;

    const guild = interaction.guild;
    if (!guild) return;

    const serverConfig = getServerConfig(guild.id);
    const roleId = customId.replace('control_points_select_', '');
    const selectedOptions = interaction.values;
    
    // Hole die versteckten Daten aus dem Interaction State
    // Da wir die Daten nicht direkt im Select-Menü speichern können,
    // müssen wir sie temporär speichern und hier wieder abrufen
    // Das geht in Discord.js nicht direkt, deswegen fordern wir die Daten erneut an

    await interaction.deferReply({ ephemeral: true });

    // Finde die Original-Nachricht und extrahiere die Daten
    const message = interaction.message;
    const channel = interaction.channel as TextChannel;

    // Fordern wir den Benutzer auf, weitere Informationen einzugeben
    const modal = new ModalBuilder()
        .setCustomId(`control_points_details_${roleId}_${selectedOptions.join('_')}`)
        .setTitle('Routenkontrolle - Details');

    const partnerInput = new TextInputBuilder()
        .setCustomId('partner')
        .setLabel('Mit wem wurde kontrolliert?')
        .setPlaceholder('Gib die Namen deiner Kontrollpartner ein (durch Komma getrennt)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const notesInput = new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('Auffälligkeiten')
        .setPlaceholder('Füge hier Auffälligkeiten oder Notizen zur Kontrolle hinzu (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

    const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(partnerInput);
    const secondActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput);
    
    modal.addComponents(firstActionRow, secondActionRow);

    await interaction.showModal(modal);
});

// Handler für den Modal-Submit für die Kontrollpunkte-Details
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    const customId = interaction.customId;
    if (!customId.startsWith('control_points_details_')) return;

    const guild = interaction.guild;
    if (!guild) return;

    const serverConfig = getServerConfig(guild.id);
    
    // Extrahiere Informationen aus der Custom ID
    const parts = customId.replace('control_points_details_', '').split('_');
    const roleId = parts[0];
    const selectedOptions = parts.slice(1);
    
    const partnerInput = interaction.fields.getTextInputValue('partner');
    const notes = interaction.fields.getTextInputValue('notes');

    const { findPartners, logRouteControl } = await import('./routeControl');
    const { found, notFound } = findPartners(guild, partnerInput);

    // Erstelle die Log-Details
    let details = `Passwort: Eingegeben\n`; // Nicht mehr überprüfen, ob korrekt
    details += `Kontrolleur: ${interaction.user.tag}\n`;
    
    if (found.length > 0) {
        details += `Kontrollpartner: ${found.map(m => m.user.tag).join(', ')}\n`;
    }
    if (notFound.length > 0) {
        details += `Nicht gefundene Partner: ${notFound.join(', ')}\n`;
    }

    // Formatiere die ausgewählten Kontrollpunkte
    const controlPointsFormatted = selectedOptions.map(option => {
        switch (option) {
            case 'sammler': return '🔨 Sammler';
            case 'verarbeiter': return '⚒️ Verarbeiter';
            case 'verkäufer': return '💰 Verkäufer';
            default: return option;
        }
    }).join(', ');

    details += `Kontrollpunkte: ${controlPointsFormatted}\n`;
    
    if (notes) {
        details += `Auffälligkeiten: ${notes}`;
    }

    // Logge die Kontrolle
    await logRouteControl(
        guild,
        serverConfig,
        interaction.member as GuildMember,
        roleId,
        '✅ Routen-Kontrolle durchgeführt',
        details
    );

    await interaction.reply({
        content: `✅ Die Routen-Kontrolle wurde erfolgreich protokolliert!\nKontrollierte Punkte: ${controlPointsFormatted}`,
        ephemeral: true
    });
});

client.login(process.env.TOKEN); 