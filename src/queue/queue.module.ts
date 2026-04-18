import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

export const QUEUE_EMAIL_INGEST = 'email-ingest';
export const QUEUE_LLM_EXTRACT = 'llm-extract';
export const QUEUE_EVENT_MATCH = 'event-match';
export const QUEUE_ICS_GENERATE = 'ics-generate';
export const QUEUE_EMAIL_SEND = 'email-send';
export const QUEUE_COUNTER_PROPOSAL = 'counter-proposal';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_EMAIL_INGEST },
      { name: QUEUE_LLM_EXTRACT },
      { name: QUEUE_EVENT_MATCH },
      { name: QUEUE_ICS_GENERATE },
      { name: QUEUE_EMAIL_SEND },
      { name: QUEUE_COUNTER_PROPOSAL },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
