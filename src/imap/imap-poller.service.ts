import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ImapFlow } from 'imapflow';
import { QUEUE_EMAIL_INGEST } from '../queue/queue.module';

@Injectable()
export class ImapPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImapPollerService.name);
  private pollInterval: NodeJS.Timeout;
  private isPolling = false;

  constructor(
    private config: ConfigService,
    @InjectQueue(QUEUE_EMAIL_INGEST) private ingestQueue: Queue,
  ) {}

  async onModuleInit() {
    this.logger.log('Starting IMAP poller (30s interval)');
    await this.poll();
    this.pollInterval = setInterval(() => {
      this.poll().catch((err) =>
        this.logger.error(`Uncaught error in IMAP poll interval: ${err.message}`, err.stack),
      );
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }

  private async poll() {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      await this.fetchUnseen();
    } catch (err) {
      this.logger.error(`IMAP poll error: ${err.message}`, err.stack);
    } finally {
      this.isPolling = false;
    }
  }

  private async fetchUnseen() {
    const client = new ImapFlow({
      host: this.config.get<string>('IMAP_HOST'),
      port: parseInt(this.config.get<string>('IMAP_PORT', '993'), 10),
      secure: this.config.get<string>('IMAP_SECURE', 'true') === 'true',
      auth: {
        user: this.config.get<string>('IMAP_ADMIN_USER'),
        pass: this.config.get<string>('IMAP_ADMIN_PASSWORD'),
      },
      logger: false,
    });

    await client.connect();

    try {
      const lock = await client.getMailboxLock('INBOX');
      try {
        const messages: any[] = [];
        for await (const msg of client.fetch({ seen: false }, {
          uid: true,
          flags: true,
          envelope: true,
          bodyStructure: true,
          source: true,
        })) {
          messages.push({ uid: msg.uid, source: msg.source });
        }

        if (messages.length === 0) {
          this.logger.debug('No unseen messages');
          return;
        }

        this.logger.log(`Found ${messages.length} unseen message(s)`);

        for (const msg of messages) {
          await this.ingestQueue.add(
            'process-email',
            { uid: msg.uid, source: msg.source.toString('base64') },
            { jobId: `email-${msg.uid}-${Date.now()}` },
          );
          // Mark as seen
          await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }
}
