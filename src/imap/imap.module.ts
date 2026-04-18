import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ImapPollerService } from './imap-poller.service';
import { ImapIngestProcessor } from './imap-ingest.processor';
import { IcsModule } from '../ics/ics.module';
import { AuthModule } from '../auth/auth.module';
import { QUEUE_EMAIL_INGEST, QUEUE_EVENT_MATCH, QUEUE_COUNTER_PROPOSAL } from '../queue/queue.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_EMAIL_INGEST },
      { name: QUEUE_EVENT_MATCH },
      { name: QUEUE_COUNTER_PROPOSAL },
    ),
    IcsModule,
    AuthModule,
  ],
  providers: [ImapPollerService, ImapIngestProcessor],
  exports: [ImapPollerService],
})
export class ImapModule {}
