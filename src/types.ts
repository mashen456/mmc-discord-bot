// Interface für die Datenbank-Struktur
export interface UserRole {
    userId: string;
    roleId: string;
    assignedAt: string;
    employerId?: string;
    password?: string;
}

export interface ServerConfig {
    guildId: string;
    rejoinLogChannelId?: string;
    roleSelectionChannelId?: string;
    roleSelectionMessageId?: string;
    roleAssignmentLogChannelId?: string;
    roleErrorLogChannelId?: string;
    workerInfoChannelId?: string;
    workerPasswordChannelId?: string;
    routeControlChannelId?: string; // Kanal für das Routen-Kontroll-Menü
    routeControlLogChannelId?: string; // Kanal für die Routen-Kontroll-Logs
    routeControlMessageId?: string; // ID der Routen-Kontroll-Menü-Nachricht
    reactionRoles: Map<string, string>;
    userRoles: UserRole[];
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
    commandRoles?: string[];
    infoChannels?: string[];
    pendingWorkerApplications?: {
        workerId: string;
        employerId: string;
        roleId: string;
        appliedAt: string;
    }[];
} 