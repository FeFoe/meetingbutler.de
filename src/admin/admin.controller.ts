import { Controller, Get, Headers, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import { AdminApiKeyGuard } from './admin-api-key.guard';

// OpenAI bills in USD; displayed as approximate EUR equivalent
const GPT_NANO_COST_PER_TOKEN_USD = 0.000003; // gpt-5.4-nano ~$0.15/1M input tokens

@Controller('admin')
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'meetingbutler',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }

  @Get('stats')
  async stats(@Headers('x-admin-password') password: string) {
    const expected = this.config.get<string>('ADMIN_DASHBOARD_PASSWORD');
    if (!expected || password !== expected) {
      throw new UnauthorizedException('Falsches Passwort');
    }

    const users = await this.prisma.user.findMany({
      where: { verified: true },
      include: { events: { select: { tokensUsed: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const rows = users.map((u) => ({
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      eventCount: u.events.length,
      tokensUsed: u.events.reduce((sum, e) => sum + e.tokensUsed, 0),
    }));

    const totalTokens = rows.reduce((sum, r) => sum + r.tokensUsed, 0);
    const totalEvents = rows.reduce((sum, r) => sum + r.eventCount, 0);

    return {
      summary: {
        totalUsers: users.length,
        totalEvents,
        totalTokens,
        estimatedCostEur: +(totalTokens * GPT_NANO_COST_PER_TOKEN_USD).toFixed(4),
      },
      users: rows,
    };
  }

  @UseGuards(AdminApiKeyGuard)
  @Get('raw-emails')
  async rawEmails() {
    return this.prisma.rawEmail.findMany({
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
  }

  @UseGuards(AdminApiKeyGuard)
  @Get('queues')
  queues() {
    return {
      note: 'Queue dashboard available if @bull-board is configured',
      queues: ['email-ingest', 'llm-extract', 'event-match', 'ics-generate', 'email-send'],
    };
  }
}
