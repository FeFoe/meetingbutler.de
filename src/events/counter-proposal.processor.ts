import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../common/prisma.service';
import { EmailSendService } from '../email/email-send.service';
import { QUEUE_COUNTER_PROPOSAL } from '../queue/queue.module';

interface CounterJobData {
  uid: string;
  proposedStart: string;
  proposedEnd: string;
  senderEmail: string;
  rawEmailId: string;
}

@Processor(QUEUE_COUNTER_PROPOSAL)
export class CounterProposalProcessor {
  private readonly logger = new Logger(CounterProposalProcessor.name);

  constructor(
    private prisma: PrismaService,
    private emailSend: EmailSendService,
  ) {}

  @OnQueueFailed()
  onFailed(job: Job<CounterJobData>, err: Error) {
    this.logger.error(`Counter-proposal job ${job.id} failed: ${err.message}`);
  }

  @Process('process-counter')
  async handle(job: Job<CounterJobData>) {
    const { uid, proposedStart, proposedEnd, senderEmail } = job.data;

    const event = await this.prisma.event.findUnique({ where: { uid } });
    if (!event) {
      this.logger.warn(`COUNTER for unknown UID=${uid}, ignoring`);
      return;
    }

    const proposal = await this.prisma.counterProposal.create({
      data: {
        eventId: event.id,
        proposerEmail: senderEmail,
        proposedStart: new Date(proposedStart),
        proposedEnd: new Date(proposedEnd),
      },
    });

    this.logger.log(`Created CounterProposal id=${proposal.id} for event uid=${uid}`);
    await this.emailSend.sendCounterNotification(event, proposal);
  }
}
