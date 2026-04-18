import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EventMatchProcessor } from './event-match.processor';
import { EventsController } from './events.controller';
import { ManageController } from './manage.controller';
import { EventsService } from './events.service';
import { LlmModule } from '../llm/llm.module';
import { IcsModule } from '../ics/ics.module';
import { EmailModule } from '../email/email.module';
import { PdfModule } from '../pdf/pdf.module';
import {
  QUEUE_EVENT_MATCH,
  QUEUE_LLM_EXTRACT,
  QUEUE_ICS_GENERATE,
  QUEUE_EMAIL_SEND,
} from '../queue/queue.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_EVENT_MATCH },
      { name: QUEUE_LLM_EXTRACT },
      { name: QUEUE_ICS_GENERATE },
      { name: QUEUE_EMAIL_SEND },
    ),
    LlmModule,
    IcsModule,
    EmailModule,
    PdfModule,
  ],
  providers: [EventMatchProcessor, EventsService],
  controllers: [EventsController, ManageController],
  exports: [EventsService],
})
export class EventsModule {}
