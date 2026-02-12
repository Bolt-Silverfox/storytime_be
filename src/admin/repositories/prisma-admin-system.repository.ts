import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IAdminSystemRepository } from './admin-system.repository.interface';
import { ActivityLogDto, SubscriptionDto } from '../dto/admin-responses.dto';

@Injectable()
export class PrismaAdminSystemRepository implements IAdminSystemRepository {
    constructor(private readonly prisma: PrismaService) { }

    async findActivityLogs(params: {
        skip?: number;
        take?: number;
        where?: any;
        orderBy?: any;
    }): Promise<ActivityLogDto[]> {
        const activities = await this.prisma.activityLog.findMany({
            ...params,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        role: true,
                    },
                },
                kid: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });

        return activities.map((activity) => ({
            id: activity.id,
            userId: activity.userId || undefined,
            kidId: activity.kidId || undefined,
            action: activity.action,
            status: activity.status,
            deviceName: activity.deviceName || undefined,
            deviceModel: activity.deviceModel || undefined,
            os: activity.os || undefined,
            ipAddress: activity.ipAddress || undefined,
            details: activity.details || undefined,
            createdAt: activity.createdAt,
            isDeleted: activity.isDeleted,
            deletedAt: activity.deletedAt || undefined,
            user: activity.user || undefined,
            kid: activity.kid || undefined,
        }));
    }

    async countActivityLogs(where?: any): Promise<number> {
        return this.prisma.activityLog.count({ where });
    }

    async findSubscriptions(params: {
        where?: any;
        orderBy?: any;
    }): Promise<SubscriptionDto[]> {
        const subscriptions = await this.prisma.subscription.findMany({
            ...params,
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                    },
                },
            },
        });

        return subscriptions.map((sub) => ({
            id: sub.id,
            plan: sub.plan,
            status: sub.status,
            startedAt: sub.startedAt,
            endsAt: sub.endsAt || undefined,
            isDeleted: sub.isDeleted,
            deletedAt: sub.deletedAt || undefined,
            user: sub.user,
        }));
    }

    async findSupportTickets(params: {
        skip?: number;
        take?: number;
        where?: any;
        orderBy?: any;
    }): Promise<any[]> {
        return this.prisma.supportTicket.findMany({
            ...params,
            include: {
                user: {
                    select: { id: true, name: true, email: true },
                },
            },
        });
    }

    async countSupportTickets(where?: any): Promise<number> {
        return this.prisma.supportTicket.count({ where });
    }

    async findSupportTicketById(id: string): Promise<any> {
        return this.prisma.supportTicket.findUnique({
            where: { id },
            include: {
                user: {
                    select: { id: true, name: true, email: true },
                },
            },
        });
    }

    async updateSupportTicket(id: string, status: string): Promise<any> {
        return this.prisma.supportTicket.update({
            where: { id },
            data: { status },
        });
    }
}
