import { Controller, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiTags } from '@nestjs/swagger';
import { AdminSseService } from './admin-sse.service';
import { SseAuthGuard } from './sse-auth.guard';

@Controller('admin/sse')
@UseGuards(SseAuthGuard)
@ApiTags('admin-sse')
export class AdminSseController {
  constructor(private readonly sseService: AdminSseService) {}

  @Sse('events')
  events(): Observable<MessageEvent> {
    return this.sseService.getEventStream();
  }
}
