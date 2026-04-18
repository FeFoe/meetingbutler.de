import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ImapFlow } from 'imapflow';
import { QUEUE_EMAIL_INGEST } from '../queue/queue.module';

const FOLDER_PROCESSED = 'Meetingbutler/Bearbeitet';
const FOLDER_FAILED = 'Meetingbutler/Fehlgeschlagen';
const MAX_PROCESSED_MESSAGES = 500;

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
    this.logger.log('Starting IMAP poller (30s interval) on meetings account');
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

  private createClient(): ImapFlow {
    return new ImapFlow({
      host: this.config.get<string>('IMAP_HOST'),
      port: parseInt(this.config.get<string>('IMAP_PORT', '993'), 10),
      secure: this.config.get<string>('IMAP_SECURE', 'true') === 'true',
      auth: {
        user: this.config.get<string>('IMAP_MEETINGS_USER'),
        pass: this.config.get<string>('IMAP_MEETINGS_PASSWORD'),
      },
      logger: false,
    });
  }

  private async ensureFolder(client: ImapFlow, folderName: string): Promise<void> {
    try {
      await client.mailboxCreate(folderName);
      this.logger.log(`Created IMAP folder: ${folderName}`);
    } catch {
      // Folder already exists — ignore
    }
  }

  private async rotateFolder(client: ImapFlow, folderName: string): Promise<void> {
    try {
      const status = await client.status(folderName, { messages: true });
      if (!status || status.messages <= MAX_PROCESSED_MESSAGES) return;

      const toDelete = status.messages - MAX_PROCESSED_MESSAGES;
      this.logger.log(`Rotating ${folderName}: deleting ${toDelete} oldest message(s)`);

      const lock = await client.getMailboxLock(folderName);
      try {
        await client.messageDelete(`1:${toDelete}`, { uid: false });
      } finally {
        lock.release();
      }
    } catch (err) {
      this.logger.warn(`Folder rotation failed for ${folderName}: ${err.message}`);
    }
  }

  private async fetchUnseen() {
    const client = this.createClient();
    await client.connect();

    try {
      await this.ensureFolder(client, FOLDER_PROCESSED);
      await this.ensureFolder(client, FOLDER_FAILED);

      const lock = await client.getMailboxLock('INBOX');
      try {
        const messages: Array<{ uid: number; source: Buffer }> = [];
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
          // Move to processed folder (also marks as seen implicitly)
          await client.messageMove({ uid: msg.uid }, FOLDER_PROCESSED, { uid: true });
        }
      } finally {
        lock.release();
      }

      // Rotate old messages if folder is too full
      await this.rotateFolder(client, FOLDER_PROCESSED);
    } finally {
      await client.logout();
    }
  }

  /**
   * Move a message to the failed folder. Called by the ingest processor on error.
   * Uses a fresh IMAP connection and searches by message source/UID.
   */
  async moveToFailed(uid: number): Promise<void> {
    const client = this.createClient();
    try {
      await client.connect();
      await this.ensureFolder(client, FOLDER_FAILED);

      const lock = await client.getMailboxLock(FOLDER_PROCESSED);
      try {
        await client.messageMove({ uid }, FOLDER_FAILED, { uid: true });
        this.logger.log(`Moved uid=${uid} to ${FOLDER_FAILED}`);
      } catch (err) {
        this.logger.warn(`Could not move uid=${uid} to failed folder: ${err.message}`);
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (err) {
      this.logger.warn(`moveToFailed connection error: ${err.message}`);
    }
  }
}
