import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ImapPollerService } from './imap-poller.service';
import { ImapIngestProcessor } from './imap-ingest.processor';
import { QUEUE_EMAIL_INGEST, QUEUE_EVENT_MATCH } from '../queue/queue.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_EMAIL_INGEST },
      { name: QUEUE_EVENT_MATCH },
    ),
  ],
  providers: [ImapPollerService, ImapIngestProcessor],
  exports: [ImapPollerService],
})
export class ImapModule {}
