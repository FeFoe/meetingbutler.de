import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../common/prisma.service';
import { DateTime } from 'luxon';

export interface SendEventEmailOptions {
  to: string;
  isUpdate: boolean;
  event: any;
  icsContent: string;
  attachmentIds: string[];
}

@Injectable()
export class EmailSendService {
  private readonly logger = new Logger(EmailSendService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: parseInt(this.config.get<string>('SMTP_PORT', '465')),
      secure: this.config.get<string>('SMTP_SECURE', 'true') === 'true',
      auth: {
        user: this.config.get<string>('SMTP_ADMIN_USER'),
        pass: this.config.get<string>('SMTP_ADMIN_PASSWORD'),
      },
    });
  }

  async sendEventEmail(options: SendEventEmailOptions): Promise<void> {
    const { to, isUpdate, event, icsContent, attachmentIds } = options;

    const label = isUpdate ? 'Event updated' : 'Event created';
    const emoji = '📅';
    const subject = `${emoji} ${label}: ${event.title}`;

    const tz = event.timezone || 'Europe/Berlin';
    const startStr = DateTime.fromJSDate(new Date(event.startDatetime))
      .setZone(tz)
      .toFormat("cccc, dd. LLLL yyyy 'at' HH:mm ZZZZ");
    const endStr = DateTime.fromJSDate(new Date(event.endDatetime))
      .setZone(tz)
      .toFormat('HH:mm ZZZZ');

    const statusNote = isUpdate
      ? 'This event has been updated. Please update your calendar.'
      : 'A new calendar event has been created for you.';

    const body = `${statusNote}

Event: ${event.title}
When: ${startStr} – ${endStr}
${event.location ? `Where: ${event.location}` : ''}
${event.description ? `\nDetails:\n${event.description}` : ''}

The calendar invite is attached as a .ics file.
Open it to add the event to your calendar.

---
Powered by Meetingbutler.de
`;

    // Load file attachments
    const fileAttachments: any[] = [];

    // ICS file
    fileAttachments.push({
      filename: `${event.title.replace(/[^a-z0-9]/gi, '_')}.ics`,
      content: Buffer.from(icsContent),
      contentType: 'text/calendar; charset=utf-8; method=REQUEST',
    });

    // Original attachments
    if (attachmentIds && attachmentIds.length > 0) {
      const attachments = await this.prisma.attachment.findMany({
        where: { id: { in: attachmentIds } },
      });

      for (const att of attachments) {
        try {
          if (fs.existsSync(att.storagePath)) {
            fileAttachments.push({
              filename: att.filename,
              content: fs.readFileSync(att.storagePath),
              contentType: att.contentType,
            });
          }
        } catch (err) {
          this.logger.warn(`Could not load attachment ${att.id}: ${err.message}`);
        }
      }
    }

    const fromName = this.config.get<string>('DEFAULT_FROM_NAME', 'Meetingbutler');
    const fromEmail = this.config.get<string>('DEFAULT_FROM_EMAIL', 'meetings@meetingbutler.de');

    await this.transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      text: body,
      attachments: fileAttachments,
    });

    this.logger.log(`Sent email "${subject}" to ${to} with ${fileAttachments.length} attachment(s)`);
  }

  async verifySmtp(): Promise<boolean> {
    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified');
      return true;
    } catch (err) {
      this.logger.error(`SMTP verification failed: ${err.message}`);
      return false;
    }
  }
}
