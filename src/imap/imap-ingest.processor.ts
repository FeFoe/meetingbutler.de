import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import * as path from 'path';
import * as fs from 'fs';
import sanitize from 'sanitize-filename';
import { PrismaService } from '../common/prisma.service';
import { ImapPollerService } from './imap-poller.service';
import { IcsService } from '../ics/ics.service';
import { AuthService } from '../auth/auth.service';
import { QUEUE_EMAIL_INGEST, QUEUE_EVENT_MATCH, QUEUE_COUNTER_PROPOSAL } from '../queue/queue.module';

const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads');

@Processor(QUEUE_EMAIL_INGEST)
export class ImapIngestProcessor {
  private readonly logger = new Logger(ImapIngestProcessor.name);

  constructor(
    private prisma: PrismaService,
    private imapPoller: ImapPollerService,
    private icsService: IcsService,
    private authService: AuthService,
    @InjectQueue(QUEUE_EVENT_MATCH) private matchQueue: Queue,
    @InjectQueue(QUEUE_COUNTER_PROPOSAL) private counterQueue: Queue,
  ) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  @OnQueueFailed()
  async onFailed(job: Job<{ uid: number; source: string }>, err: Error) {
    this.logger.error(`Ingest job ${job.id} failed (uid=${job.data.uid}): ${err.message}`);
    await this.imapPoller.moveToFailed(job.data.uid);
  }

  @Process('process-email')
  async handle(job: Job<{ uid: number; source: string }>) {
    const { uid, source } = job.data;
    this.logger.log(`Processing email uid=${uid}`);

    const rawBuffer = Buffer.from(source, 'base64');
    const parsed: ParsedMail = await simpleParser(rawBuffer);

    const messageId = parsed.messageId || `generated-${uid}-${Date.now()}`;
    const inReplyTo = parsed.inReplyTo || null;
    const references = Array.isArray(parsed.references)
      ? parsed.references.join(' ')
      : (parsed.references as string) || null;

    const fromAddr = this.extractAddress(parsed.from).toLowerCase();
    const toAddr = this.extractAddress(parsed.to).toLowerCase();

    // Check if already stored
    const existing = await this.prisma.rawEmail.findUnique({ where: { messageId } });
    if (existing) {
      // Pending emails are stored with processed=false + pendingSource; allow them to continue
      if (existing.processed || !existing.pendingSource) {
        this.logger.warn(`Email ${messageId} already processed, skipping`);
        return;
      }
      this.logger.log(`Re-processing pending email ${messageId} for now-verified sender`);
    }

    // Domain-block: silently drop emails from blocked regions
    if (this.authService.isDomainBlocked(fromAddr)) {
      this.logger.log(`Blocked email from geo-restricted domain: ${fromAddr}`);
      return;
    }

    // Whitelist gate: only verified users can use the service.
    // Unregistered senders: store the raw email with pendingSource so it can be
    // retroactively processed after the sender verifies their account.
    const sender = await this.prisma.user.findUnique({
      where: { email: fromAddr, verified: true },
    });

    if (!sender) {
      this.logger.log(`Storing pending email from unregistered sender: ${fromAddr}`);
      await this.prisma.rawEmail.upsert({
        where: { messageId },
        update: { pendingSource: source },
        create: {
          messageId,
          inReplyTo,
          references,
          fromAddress: fromAddr,
          toAddress: toAddr,
          subject: parsed.subject || '(no subject)',
          bodyText: parsed.text || null,
          bodyHtml: parsed.html || null,
          receivedAt: parsed.date || new Date(),
          processed: false,
          pendingSource: source,
        },
      });
      return;
    }

    // Store or promote the raw email record
    let rawEmail: { id: string };
    if (existing) {
      // Pending → full record: clear pendingSource, keep existing id
      rawEmail = await this.prisma.rawEmail.update({
        where: { id: existing.id },
        data: { pendingSource: null },
      });
    } else {
      rawEmail = await this.prisma.rawEmail.create({
        data: {
          messageId,
          inReplyTo,
          references,
          fromAddress: fromAddr,
          toAddress: toAddr,
          subject: parsed.subject || '(no subject)',
          bodyText: parsed.text || null,
          bodyHtml: parsed.html || null,
          receivedAt: parsed.date || new Date(),
        },
      });
    }

    this.logger.log(`Stored raw email id=${rawEmail.id} messageId=${messageId}`);

    // Save attachments
    const savedAttachments: { id: string; filename: string; path: string }[] = [];
    if (parsed.attachments && parsed.attachments.length > 0) {
      for (const att of parsed.attachments) {
        const saved = await this.saveAttachment(att, rawEmail.id);
        if (saved) savedAttachments.push(saved);
      }
      this.logger.log(`Saved ${savedAttachments.length} attachment(s) for email ${rawEmail.id}`);
    }

    // Mark processed
    await this.prisma.rawEmail.update({
      where: { id: rawEmail.id },
      data: { processed: true },
    });

    // Detect iTIP COUNTER — route to dedicated processor, skip event-match
    const calAtt = parsed.attachments?.find(
      (a) => a.contentType?.includes('text/calendar') || a.filename?.endsWith('.ics'),
    );
    if (calAtt) {
      const counter = this.icsService.parseCounter(calAtt.content.toString('utf8'));
      if (counter) {
        await this.counterQueue.add('process-counter', {
          uid: counter.uid,
          proposedStart: counter.proposedStart.toISOString(),
          proposedEnd: counter.proposedEnd.toISOString(),
          senderEmail: fromAddr,
          rawEmailId: rawEmail.id,
        });
        this.logger.log(`Routed COUNTER for uid=${counter.uid} from ${fromAddr} to counter-proposal queue`);
        return;
      }
    }

    // Enqueue for event matching
    await this.matchQueue.add('match-or-create', {
      rawEmailId: rawEmail.id,
      messageId,
      inReplyTo,
      references,
      fromAddress: fromAddr,
      subject: parsed.subject || '',
      bodyText: parsed.text || '',
      attachmentIds: savedAttachments.map((a) => a.id),
    });

    this.logger.log(`Enqueued email ${rawEmail.id} for event matching`);
  }

  private extractAddress(addr: any): string {
    if (!addr) return '';
    if (typeof addr === 'string') return addr;
    if (addr.value && addr.value.length > 0) {
      return addr.value[0].address || '';
    }
    if (addr.text) return addr.text;
    return '';
  }

  private async saveAttachment(
    att: Attachment,
    rawEmailId: string,
  ): Promise<{ id: string; filename: string; path: string } | null> {
    try {
      const safeName = sanitize(att.filename || `attachment-${Date.now()}`);
      if (!safeName || safeName === '.') {
        this.logger.warn(`Rejected unsafe attachment filename: ${att.filename}`);
        return null;
      }
      const dir = path.join(UPLOADS_DIR, rawEmailId);
      fs.mkdirSync(dir, { recursive: true });
      const filePath = path.resolve(dir, safeName);
      // Guard against path traversal
      if (!filePath.startsWith(path.resolve(dir) + path.sep)) {
        this.logger.warn(`Path traversal attempt detected for attachment: ${att.filename}`);
        return null;
      }

      fs.writeFileSync(filePath, att.content);

      const record = await this.prisma.attachment.create({
        data: {
          filename: safeName,
          contentType: att.contentType || 'application/octet-stream',
          size: att.content.length,
          storagePath: filePath,
          rawEmailId,
        },
      });

      return { id: record.id, filename: safeName, path: filePath };
    } catch (err) {
      this.logger.error(`Failed to save attachment: ${err.message}`);
      return null;
    }
  }
}
