import { ActivityLogDto, SubscriptionDto } from '../dto/admin-responses.dto';

export interface IAdminSystemRepository {
    // Activity Logs
    findActivityLogs(params: {
        skip?: number;
        take?: number;
        where?: any;
        orderBy?: any;
    }): Promise<ActivityLogDto[]>;
    countActivityLogs(where?: any): Promise<number>;

    // Subscriptions
    findSubscriptions(params: {
        where?: any;
        orderBy?: any;
    }): Promise<SubscriptionDto[]>;

    // Support Tickets
    findSupportTickets(params: {
        skip?: number;
        take?: number;
        where?: any;
        orderBy?: any;
    }): Promise<any[]>;
    countSupportTickets(where?: any): Promise<number>;
    findSupportTicketById(id: string): Promise<any>;
    updateSupportTicket(id: string, status: string): Promise<any>;
}

export const ADMIN_SYSTEM_REPOSITORY = Symbol('ADMIN_SYSTEM_REPOSITORY');
