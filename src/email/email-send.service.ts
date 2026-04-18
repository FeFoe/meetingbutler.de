import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
  eventDetails?: any;
}

@Injectable()
export class EmailSendService {
  private readonly logger = new Logger(EmailSendService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    // Use meetings account if available, fallback to admin
    const smtpUser = this.config.get<string>('SMTP_MEETINGS_USER');
    const smtpPass = this.config.get<string>('SMTP_MEETINGS_PASSWORD');
    const smtpAdminUser = this.config.get<string>('SMTP_ADMIN_USER');
    const smtpAdminPass = this.config.get<string>('SMTP_ADMIN_PASSWORD');

    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: parseInt(this.config.get<string>('SMTP_PORT', '465'), 10),
      secure: this.config.get<string>('SMTP_SECURE', 'true') === 'true',
      auth: {
        user: smtpUser || smtpAdminUser,
        pass: smtpPass || smtpAdminPass,
      },
    });

    // Verify and fall back to admin if meetings fails
    this.initTransporter(smtpUser, smtpAdminUser, smtpAdminPass).catch((err) =>
      this.logger.error(`SMTP initialization failed: ${err.message}`, err.stack),
    );
  }

  private async initTransporter(
    smtpUser: string,
    smtpAdminUser: string,
    smtpAdminPass: string,
  ): Promise<void> {
    try {
      await this.transporter.verify();
      this.logger.log(`SMTP authenticated as ${smtpUser || smtpAdminUser}`);
    } catch {
      this.logger.warn(`Meetings SMTP failed, falling back to admin account`);
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port: parseInt(this.config.get<string>('SMTP_PORT', '465'), 10),
        secure: this.config.get<string>('SMTP_SECURE', 'true') === 'true',
        auth: { user: smtpAdminUser, pass: smtpAdminPass },
      });
      try {
        await this.transporter.verify();
        this.logger.log(`SMTP fallback authenticated as ${smtpAdminUser}`);
      } catch (fallbackErr) {
        this.logger.error(`SMTP verification failed for both accounts: ${fallbackErr.message}`);
      }
    }
  }

  private formatDetailLine(label: string, value: string | null | undefined): string {
    return value && value.trim() ? `${label}: ${value.trim()}` : '';
  }

  private buildEmailBody(event: any, isUpdate: boolean, details: any): string {
    const tz = event.timezone || 'Europe/Berlin';
    const startDt = DateTime.fromJSDate(new Date(event.startDatetime)).setZone(tz);
    const endDt = DateTime.fromJSDate(new Date(event.endDatetime)).setZone(tz);

    const startStr = startDt.toFormat("cccc, dd. LLLL yyyy 'at' HH:mm ZZZZ");
    const endStr = endDt.toFormat('HH:mm ZZZZ');

    const statusNote = isUpdate
      ? 'This event has been updated. Your calendar invite is attached.'
      : 'A new calendar event has been created. The invite is attached.';

    const lines: string[] = [];
    lines.push(statusNote);
    lines.push('');
    lines.push('─────────────────────────────────');
    lines.push(`${event.title}`);
    lines.push('─────────────────────────────────');
    lines.push('');
    lines.push(`📅 When:  ${startStr} – ${endStr}`);
    if (event.location) lines.push(`📍 Where: ${event.location}`);
    lines.push('');

    if (event.description) {
      lines.push('About this event:');
      lines.push(event.description);
      lines.push('');
    }

    if (details) {
      const sections: string[] = [];

      const booking = [
        this.formatDetailLine('Booking code', details.bookingCode),
        this.formatDetailLine('Organizer', details.organizer),
        this.formatDetailLine('Contact', details.contact),
        this.formatDetailLine('Price', details.price),
        this.formatDetailLine('Cancellation policy', details.cancellationPolicy),
      ].filter(Boolean);
      if (booking.length) sections.push(...['--- Booking ---', ...booking]);

      const access = [
        this.formatDetailLine('Check-in', details.checkIn),
        this.formatDetailLine('Check-out', details.checkOut),
        this.formatDetailLine('Address', details.address),
        this.formatDetailLine('Parking', details.parking),
        this.formatDetailLine('Access codes', details.accessCodes),
      ].filter(Boolean);
      if (access.length) sections.push(...['--- Access & Location ---', ...access]);

      const onsite = [
        this.formatDetailLine('Dietary / Meals', details.dietary),
        this.formatDetailLine('Dress code', details.dressCode),
        this.formatDetailLine('Agenda', details.agenda),
      ].filter(Boolean);
      if (onsite.length) sections.push(...['--- On-site ---', ...onsite]);

      const travel = [
        this.formatDetailLine('Flight / Train', details.flightNumber),
        this.formatDetailLine('Seat', details.seat),
        this.formatDetailLine('Gate / Platform', details.gate),
      ].filter(Boolean);
      if (travel.length) sections.push(...['--- Travel ---', ...travel]);

      if (details.notes) sections.push(...['--- Notes ---', details.notes]);
      if (details.extra) sections.push(...['--- Additional info ---', details.extra]);

      if (sections.length) {
        lines.push('');
        lines.push(...sections);
      }
    }

    lines.push('');
    lines.push('─────────────────────────────────');
    lines.push('Open the attached .ics file to add this to your calendar.');
    lines.push('Powered by Meetingbutler.de');

    return lines.join('\n');
  }

  private static readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async sendEventEmail(options: SendEventEmailOptions): Promise<void> {
    const { to, isUpdate, event, icsContent, attachmentIds, eventDetails } = options;

    if (!EmailSendService.EMAIL_REGEX.test(to)) {
      throw new BadRequestException(`Invalid recipient email address: ${to}`);
    }

    const label = isUpdate ? 'Event updated' : 'Event created';
    const subject = `📅 ${label}: ${event.title}`;

    // Load details from DB if not provided
    let details = eventDetails;
    if (!details && event.id) {
      details = await this.prisma.eventDetail.findUnique({ where: { eventId: event.id } }).catch(() => null);
    }

    const body = this.buildEmailBody(event, isUpdate, details);

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
