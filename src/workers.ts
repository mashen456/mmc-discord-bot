import { 
    GuildMember, 
    TextChannel, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
    Role,
    Guild
} from 'discord.js';
import { ServerConfig } from './types';

// Konstanten für die Arbeiter-Rolle
export const WORKER_ROLE_NAME = 'Arbeiter';
export const WORKER_EMOJI = '👷';

// Funktion zum Erstellen der Arbeiter-Rolle
export async function createWorkerRole(guild: Guild): Promise<Role | null> {
    try {
        let workerRole = guild.roles.cache.find((role) => role.name === WORKER_ROLE_NAME);
        
        if (!workerRole) {
            workerRole = await guild.roles.create({
                name: WORKER_ROLE_NAME,
                color: '#FFA500',
                reason: 'Automatische Erstellung der Arbeiter-Rolle'
            });
            console.log(`Arbeiter-Rolle wurde erstellt: ${workerRole.name}`);
        }

        return workerRole;
    } catch (error) {
        console.error('Fehler beim Erstellen der Arbeiter-Rolle:', error);
        return null;
    }
}

// Funktion zum Aktualisieren des Passwort-Kanals
export async function updatePasswordChannel(guild: Guild, serverConfig: ServerConfig) {
    if (!serverConfig.workerPasswordChannelId) return;

    const passwordChannel = guild.channels.cache.get(serverConfig.workerPasswordChannelId) as TextChannel;
    if (!passwordChannel) return;

    // Hole alle Arbeiter mit Passwörtern
    const workersWithPasswords = serverConfig.userRoles
        .filter(ur => ur.employerId)
        .map(async ur => {
            const workerMember = await guild.members.fetch(ur.userId).catch(() => null);
            return {
                worker: workerMember,
                password: ur.password
            };
        });

    const workers = await Promise.all(workersWithPasswords);

    const passwordEmbed = new EmbedBuilder()
        .setTitle('🔑 Arbeiter-Passwörter')
        .setDescription('Hier sind alle Arbeiter und ihre Passwörter:')
        .addFields({
            name: 'Arbeiter',
            value: workers.map(w => {
                return `${w.worker?.displayName || 'Unbekannt'}: ${w.password || 'Kein Passwort gesetzt'}`;
            }).join('\n'),
            inline: false
        })
        .setColor('#FFA500')
        .setTimestamp();

    // Lösche alte Nachrichten
    const messages = await passwordChannel.messages.fetch({ limit: 10 });
    await Promise.all(messages.map(msg => msg.delete()));

    await passwordChannel.send({ embeds: [passwordEmbed] });
}

// Funktion zum Erstellen des Arbeiter-Modals
export function createWorkerModal(roleId: string): ModalBuilder {
    const modal = new ModalBuilder()
        .setCustomId(`worker_modal_${roleId}`)
        .setTitle('Arbeiter-Anmeldung');

    const employerInput = new TextInputBuilder()
        .setCustomId('employer')
        .setLabel('Wessen Arbeiter möchtest du sein?')
        .setPlaceholder('Gib den Namen deines zukünftigen Chefs ein')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

    const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(employerInput);
    modal.addComponents(firstActionRow);

    return modal;
}

// Funktion zum Erstellen der Info-Nachricht für einen neuen Arbeiter
export function createWorkerInfoEmbed(worker: GuildMember, employer: GuildMember | null, acceptedBy: GuildMember): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle('👷 Arbeiter-Informationen')
        .setDescription(`<@${worker.id}> ist jetzt ein Arbeiter`)
        .addFields(
            { name: 'Chef', value: employer ? `<@${employer.id}>` : 'Unbekannt' },
            { name: 'Angenommen von', value: `<@${acceptedBy.id}>` },
            { name: 'Angenommen am', value: new Date().toLocaleString('de-DE') }
        )
        .setColor('#00ff00')
        .setTimestamp();
}

// Funktion zum Erstellen der Info-Nachricht für einen entlassenen Arbeiter
export function createWorkerRemovedEmbed(worker: GuildMember, employer: GuildMember | null, removedBy: GuildMember): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle('👋 Arbeiter entlassen')
        .setDescription(`<@${worker.id}> wurde als Arbeiter entlassen`)
        .addFields(
            { name: 'Arbeiter', value: `<@${worker.id}>` },
            { name: 'Chef', value: employer ? `<@${employer.id}>` : 'Unbekannt' },
            { name: 'Entlassen von', value: `<@${removedBy.id}>` },
            { name: 'Entlassen am', value: new Date().toLocaleString('de-DE') }
        )
        .setColor('#ff9900')
        .setTimestamp();
}

// Funktion zum Erstellen der Buttons für die Arbeiter-Verwaltung
export function createWorkerManagementButtons(workerId: string, roleId: string, employerId: string): ActionRowBuilder<ButtonBuilder> {
    const removeButton = new ButtonBuilder()
        .setCustomId(`remove_worker_${workerId}_${roleId}_${employerId}`)
        .setLabel('Arbeiter entlassen')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('👋');

    return new ActionRowBuilder<ButtonBuilder>()
        .addComponents(removeButton);
}

// Funktion zum Überprüfen der Berechtigungen
export function hasWorkerManagementPermission(member: GuildMember, serverConfig: ServerConfig): boolean {
    return member.permissions.has(PermissionFlagsBits.Administrator) ||
        (serverConfig.commandRoles?.some(roleId => member.roles.cache.has(roleId)) ?? false);
} 