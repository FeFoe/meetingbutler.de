import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from './common/prisma.module';
import { ImapModule } from './imap/imap.module';
import { LlmModule } from './llm/llm.module';
import { IcsModule } from './ics/ics.module';
import { EmailModule } from './email/email.module';
import { EventsModule } from './events/events.module';
import { QueueModule } from './queue/queue.module';
import { AdminModule } from './admin/admin.module';
import { PdfModule } from './pdf/pdf.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: parseInt(config.get('REDIS_PORT', '6379'), 10),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      }),
    }),
    PrismaModule,
    QueueModule,
    ImapModule,
    LlmModule,
    IcsModule,
    EmailModule,
    EventsModule,
    AdminModule,
    PdfModule,
  ],
})
export class AppModule {}
