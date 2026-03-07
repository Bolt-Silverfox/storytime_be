import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Subject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AdminService } from '../admin.service';

export interface SseEvent {
  type: 'dashboard.activity' | 'dashboard.stats' | 'dashboard.health';
  data: unknown;
}

@Injectable()
export class AdminSseService implements OnModuleInit, OnModuleDestroy {
  private readonly events$ = new Subject<SseEvent>();
  private healthInterval: NodeJS.Timeout | null = null;

  constructor(private readonly adminService: AdminService) {}

  onModuleInit() {
    this.healthInterval = setInterval(async () => {
      try {
        const health = await this.adminService.getSystemHealth();
        this.push({ type: 'dashboard.health', data: health });
      } catch {}
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.healthInterval) clearInterval(this.healthInterval);
    this.events$.complete();
  }

  getEventStream(): Observable<MessageEvent> {
    return this.events$.asObservable().pipe(
      map(
        (event) =>
          ({
            data: JSON.stringify(event),
          }) as MessageEvent,
      ),
    );
  }

  push(event: SseEvent) {
    this.events$.next(event);
  }

  @OnEvent('admin.sse.activity')
  handleActivity(payload: unknown) {
    this.push({ type: 'dashboard.activity', data: payload });
  }

  @OnEvent('admin.sse.stats')
  async handleStats() {
    try {
      const stats = await this.adminService.getDashboardStats();
      this.push({ type: 'dashboard.stats', data: stats });
    } catch {}
  }

  @OnEvent('admin.sse.health')
  handleHealth(payload: unknown) {
    this.push({ type: 'dashboard.health', data: payload });
  }
}
