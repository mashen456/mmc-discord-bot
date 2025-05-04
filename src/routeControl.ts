import { 
    TextChannel, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Guild,
    GuildMember,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} from 'discord.js';
import { ServerConfig } from './types';

// Funktion zum Erstellen des Routen-Kontroll-Menüs
export async function createRouteControlMenu(channel: TextChannel, serverConfig: ServerConfig) {
    const embed = new EmbedBuilder()
        .setTitle('🚦 Routen-Kontrolle')
        .setDescription('Hier kannst du die Routen der verschiedenen Familien überwachen und kontrollieren.')
        .setColor('#0099ff')
        .setTimestamp();

    // Erstelle Buttons für jede Familie
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let currentRow = new ActionRowBuilder<ButtonBuilder>();
    let buttonCount = 0;

    for (const [roleId, familyData] of Object.entries(serverConfig.familyChannels)) {
        const role = channel.guild.roles.cache.get(roleId);
        if (!role) continue;

        if (buttonCount === 5) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder<ButtonBuilder>();
            buttonCount = 0;
        }

        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`route_control_${roleId}`)
                .setLabel(role.name)
                .setStyle(ButtonStyle.Primary)
        );
        buttonCount++;
    }

    if (buttonCount > 0) {
        rows.push(currentRow);
    }

    // Füge den Routen-Kontrolle-Button hinzu
    const controlRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('route_control_all')
                .setLabel('Routen-Kontrolle durchführen')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔍')
        );
    rows.push(controlRow);

    // Füge den Routen-Wache-Button hinzu
    const watchRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('route_watch_start')
                .setLabel('Routen-Wache starten')
                .setStyle(ButtonStyle.Success)
                .setEmoji('👮'),
            new ButtonBuilder()
                .setCustomId('route_watch_stop')
                .setLabel('Routen-Wache stoppen')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🛑')
                .setDisabled(true)
        );
    rows.push(watchRow);

    // Sende die Nachricht
    const message = await channel.send({
        embeds: [embed],
        components: rows
    });

    // Speichere die Message-ID in der Konfiguration
    serverConfig.routeControlMessageId = message.id;
    return message;
}

// Funktion zum Erstellen des Kontroll-Modals
export function createControlModal(roleId: string): ModalBuilder {
    const modal = new ModalBuilder()
        .setCustomId(`route_control_modal_${roleId}`)
        .setTitle('Routen-Kontrolle');

    const partnerInput = new TextInputBuilder()
        .setCustomId('partner')
        .setLabel('Mit wem wurde kontrolliert?')
        .setPlaceholder('Namen der Kontrollpartner (z.B. Max, Anna, Tom)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const controlPointsInput = new TextInputBuilder()
        .setCustomId('control_points')
        .setLabel('Was wurde kontrolliert?')
        .setPlaceholder('Sammler, Verarbeiter, Verkäufer (durch Komma getrennt)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const notesInput = new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('Auffälligkeiten')
        .setPlaceholder('Füge hier Auffälligkeiten oder Notizen zur Kontrolle hinzu (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

    const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(partnerInput);
    const secondActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(controlPointsInput);
    const thirdActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(notesInput);
    
    modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);

    return modal;
}

// Funktion zum Erstellen des Partner-Modals
export function createPartnerModal(): ModalBuilder {
    const modal = new ModalBuilder()
        .setCustomId('route_watch_partner_modal')
        .setTitle('Routen-Wache Partner');

    const partnerInput = new TextInputBuilder()
        .setCustomId('partner')
        .setLabel('Mit wem führst du die Routen-Wache durch?')
        .setPlaceholder('Gib die Namen deiner Partner ein (durch Komma getrennt)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

    const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(partnerInput);
    modal.addComponents(firstActionRow);

    return modal;
}

// Funktion zum Überprüfen der Partner
export function findPartners(guild: Guild, partnerNames: string): { found: GuildMember[], notFound: string[] } {
    const names = partnerNames.split(',').map(name => name.trim()).filter(name => name.length > 0);
    const found: GuildMember[] = [];
    const notFound: string[] = [];

    for (const name of names) {
        // Überspringe leere Namen
        if (!name || name.length === 0) continue;
        
        // Erstelle einen Case-insensitive Vergleichsstring
        const searchName = name.toLowerCase();
        
        // Suche nach Mitgliedern, deren Name den Suchstring enthält
        const matchingMembers = guild.members.cache.filter(member => 
            // Suche in username
            member.user.username.toLowerCase().includes(searchName) ||
            // Suche in Nickname/DisplayName
            (member.nickname && member.nickname.toLowerCase().includes(searchName)) ||
            // Suche in globalName (falls verfügbar)
            (member.user.globalName && member.user.globalName.toLowerCase().includes(searchName)) ||
            // Suche im Display Name
            member.displayName.toLowerCase().includes(searchName) ||
            // Suche in Tag (Username#Discriminator, falls noch verwendet)
            member.user.tag.toLowerCase().includes(searchName)
        );

        if (matchingMembers.size > 0) {
            // Wenn mehrere Mitglieder gefunden wurden, verwende das erste
            found.push(matchingMembers.first()!);
        } else {
            notFound.push(name);
        }
    }

    return { found, notFound };
}

// Interface für die Wache-Informationen
interface WatchInfo {
    startTime: Date;
    partners: GuildMember[];
    controller: GuildMember;
}

// Map zum Speichern der aktiven Wachen
const activeWatches = new Map<string, WatchInfo>();

// Funktion zum Starten der Routen-Wache
export async function startRouteWatch(channel: TextChannel, serverConfig: ServerConfig, partner?: string) {
    try {
        // Versuche die alte Nachricht zu finden
        const message = await channel.messages.fetch(serverConfig.routeControlMessageId!).catch(() => null);
        
        // Erstelle die Buttons
        const watchRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('route_watch_start')
                    .setLabel('Routen-Wache läuft')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('👮')
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId('route_watch_stop')
                    .setLabel('Routen-Wache stoppen')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🛑')
            );

        if (message) {
            // Wenn die Nachricht existiert, aktualisiere sie
            const components = message.components;
            const newComponents = [...components.slice(0, -1), watchRow];
            await message.edit({ components: newComponents });
        } else {
            // Wenn die Nachricht nicht existiert, erstelle eine neue
            const embed = new EmbedBuilder()
                .setTitle('🚦 Routen-Kontrolle')
                .setDescription('Hier kannst du die Routen der verschiedenen Familien überwachen und kontrollieren.')
                .setColor('#0099ff')
                .setTimestamp();

            // Erstelle Buttons für jede Familie
            const rows: ActionRowBuilder<ButtonBuilder>[] = [];
            let currentRow = new ActionRowBuilder<ButtonBuilder>();
            let buttonCount = 0;

            for (const [roleId, familyData] of Object.entries(serverConfig.familyChannels)) {
                const role = channel.guild.roles.cache.get(roleId);
                if (!role) continue;

                if (buttonCount === 5) {
                    rows.push(currentRow);
                    currentRow = new ActionRowBuilder<ButtonBuilder>();
                    buttonCount = 0;
                }

                currentRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`route_control_${roleId}`)
                        .setLabel(role.name)
                        .setStyle(ButtonStyle.Primary)
                );
                buttonCount++;
            }

            if (buttonCount > 0) {
                rows.push(currentRow);
            }

            // Füge die Watch-Row hinzu
            rows.push(watchRow);

            // Sende die neue Nachricht
            const newMessage = await channel.send({
                embeds: [embed],
                components: rows
            });

            // Aktualisiere die Message-ID in der Konfiguration
            serverConfig.routeControlMessageId = newMessage.id;
        }

        // Finde die Partner
        const { found, notFound } = findPartners(channel.guild, partner || '');
        const controller = channel.guild.members.cache.get(channel.client.user!.id)!;

        // Speichere die Wache-Informationen
        activeWatches.set(channel.guild.id, {
            startTime: new Date(),
            partners: found,
            controller: controller
        });

        // Erstelle eine Log-Nachricht
        let details = 'Die Routen-Wache wurde aktiviert\n';
        details += `Kontrolleur: ${controller.user.tag}\n`;
        if (found.length > 0) {
            details += `Partner: ${found.map(m => m.user.tag).join(', ')}\n`;
        }
        if (notFound.length > 0) {
            details += `Nicht gefundene Partner: ${notFound.join(', ')}\n`;
        }
        details += `Startzeit: ${new Date().toLocaleString('de-DE')}`;

        await logRouteControl(
            channel.guild,
            serverConfig,
            controller,
            'system',
            'Routen-Wache gestartet',
            details
        );
    } catch (error) {
        console.error('Fehler beim Starten der Routen-Wache:', error);
        throw error;
    }
}

// Funktion zum Stoppen der Routen-Wache
export async function stopRouteWatch(channel: TextChannel, serverConfig: ServerConfig) {
    const message = await channel.messages.fetch(serverConfig.routeControlMessageId!);
    const components = message.components;
    
    // Aktualisiere die Buttons
    const watchRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('route_watch_start')
                .setLabel('Routen-Wache starten')
                .setStyle(ButtonStyle.Success)
                .setEmoji('👮'),
            new ButtonBuilder()
                .setCustomId('route_watch_stop')
                .setLabel('Routen-Wache stoppen')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🛑')
                .setDisabled(true)
        );

    // Ersetze die letzte Zeile mit den aktualisierten Buttons
    const newComponents = [...components.slice(0, -1), watchRow];
    
    await message.edit({ components: newComponents });

    // Hole die Wache-Informationen
    const watchInfo = activeWatches.get(channel.guild.id);
    if (watchInfo) {
        const endTime = new Date();
        const duration = Math.floor((endTime.getTime() - watchInfo.startTime.getTime()) / 1000 / 60); // Dauer in Minuten

        // Erstelle eine Log-Nachricht
        let details = 'Die Routen-Wache wurde beendet\n';
        details += `Kontrolleur: ${watchInfo.controller.user.tag}\n`;
        if (watchInfo.partners.length > 0) {
            details += `Partner: ${watchInfo.partners.map(m => m.user.tag).join(', ')}\n`;
        }
        details += `Startzeit: ${watchInfo.startTime.toLocaleString('de-DE')}\n`;
        details += `Endzeit: ${endTime.toLocaleString('de-DE')}\n`;
        details += `Dauer: ${duration} Minuten`;

        await logRouteControl(
            channel.guild,
            serverConfig,
            watchInfo.controller,
            'system',
            'Routen-Wache beendet',
            details
        );

        // Entferne die Wache-Informationen
        activeWatches.delete(channel.guild.id);
    }
}

// Funktion zum Überprüfen des Routen-Passworts
export function verifyRoutePassword(familyData: any, password: string): boolean {
    if (!familyData.routeTimes || familyData.routeTimes.length === 0) return false;
    
    return familyData.routeTimes.some((time: any) => time.password === password);
}

// Funktion zum Loggen einer Routen-Kontrolle
export async function logRouteControl(
    guild: Guild,
    serverConfig: ServerConfig,
    controller: GuildMember,
    familyRoleId: string,
    action: string,
    details: string
) {
    if (!serverConfig.routeControlLogChannelId) return;

    const logChannel = guild.channels.cache.get(serverConfig.routeControlLogChannelId) as TextChannel;
    if (!logChannel) return;

    const familyRole = guild.roles.cache.get(familyRoleId);
    const familyName = familyRole ? familyRole.name : 'System';

    const logEmbed = new EmbedBuilder()
        .setTitle('🚦 Routen-Kontrolle')
        .setDescription(`**${action}**`)
        .addFields(
            { name: 'Familie', value: familyName },
            { name: 'Kontrolleur', value: controller.user.tag },
            { name: 'Details', value: details }
        )
        .setColor('#0099ff')
        .setTimestamp();

    await logChannel.send({ embeds: [logEmbed] });
}

// Funktion zum Erstellen eines Select-Menüs für Kontrollpunkte
export function createControlPointsSelectMenu(roleId: string, modalData: {
    password: string;
    partner: string;
    notes: string;
}): {
    content: string;
    components: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`control_points_select_${roleId}`)
        .setPlaceholder('Wähle die kontrollierten Punkte aus')
        .setMinValues(1)
        .setMaxValues(3)
        .addOptions([
            new StringSelectMenuOptionBuilder()
                .setLabel('Sammler')
                .setValue('sammler')
                .setDescription('Sammler wurden kontrolliert')
                .setEmoji('🔨'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Verarbeiter')
                .setValue('verarbeiter')
                .setDescription('Verarbeiter wurden kontrolliert')
                .setEmoji('⚒️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Verkäufer')
                .setValue('verkäufer')
                .setDescription('Verkäufer wurden kontrolliert')
                .setEmoji('💰')
        ]);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>()
        .addComponents(selectMenu);

    return {
        content: 'Wähle die Punkte aus, die du kontrolliert hast:',
        components: [row]
    };
} 