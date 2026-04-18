import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import * as path from 'path';
import * as fs from 'fs';
import sanitize from 'sanitize-filename';
import { PrismaService } from '../common/prisma.service';
import { QUEUE_EMAIL_INGEST, QUEUE_EVENT_MATCH } from '../queue/queue.module';

const UPLOADS_DIR = path.join(process.cwd(), 'data', 'uploads');

@Processor(QUEUE_EMAIL_INGEST)
export class ImapIngestProcessor {
  private readonly logger = new Logger(ImapIngestProcessor.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue(QUEUE_EVENT_MATCH) private matchQueue: Queue,
  ) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
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

    const fromAddr = this.extractAddress(parsed.from);
    const toAddr = this.extractAddress(parsed.to);

    // Check if already stored
    const existing = await this.prisma.rawEmail.findUnique({ where: { messageId } });
    if (existing) {
      this.logger.warn(`Email ${messageId} already processed, skipping`);
      return;
    }

    // Store raw email
    const rawEmail = await this.prisma.rawEmail.create({
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
