import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EventMatchProcessor } from './event-match.processor';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { LlmModule } from '../llm/llm.module';
import { IcsModule } from '../ics/ics.module';
import { EmailModule } from '../email/email.module';
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
  ],
  providers: [EventMatchProcessor, EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}
