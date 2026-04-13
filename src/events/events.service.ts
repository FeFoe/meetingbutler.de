import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.event.findMany({
      include: { eventDetails: true, attachments: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  findOne(id: string) {
    return this.prisma.event.findUnique({
      where: { id },
      include: { eventDetails: true, attachments: true, auditLogs: true },
    });
  }
}
