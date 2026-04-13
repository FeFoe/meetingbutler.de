import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Controller('admin')
export class AdminController {
  constructor(private prisma: PrismaService) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'meetingbutler',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }

  @Get('raw-emails')
  async rawEmails() {
    return this.prisma.rawEmail.findMany({
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
  }

  @Get('queues')
  queues() {
    return {
      note: 'Queue dashboard available if @bull-board is configured',
      queues: ['email-ingest', 'llm-extract', 'event-match', 'ics-generate', 'email-send'],
    };
  }
}
