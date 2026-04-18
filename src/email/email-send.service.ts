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
  pdfBuffer?: Buffer;
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

  private buildEmailBody(event: any, isUpdate: boolean, details: any): string {
    const tz = event.timezone || 'Europe/Berlin';
    const startDt = DateTime.fromJSDate(new Date(event.startDatetime)).setZone(tz);
    const endDt = DateTime.fromJSDate(new Date(event.endDatetime)).setZone(tz);

    const sameDay = startDt.toISODate() === endDt.toISODate();
    const dateStr = sameDay
      ? `${startDt.toFormat('dd. LLLL yyyy')} · ${startDt.toFormat('HH:mm')}–${endDt.toFormat('HH:mm')}`
      : `${startDt.toFormat('dd. LLLL yyyy')} – ${endDt.toFormat('dd. LLLL yyyy')}`;

    const action = isUpdate ? '📅 Termin aktualisiert' : '📅 Neuer Termin';

    const lines: string[] = [];
    lines.push(`${action}: ${event.title}`);
    lines.push('');
    lines.push(`🗓  ${dateStr}`);
    if (event.location) lines.push(`📍 ${event.location}`);

    if (details) {
      const d = details;
      if (d.checkIn || d.checkOut) {
        const parts = [d.checkIn && `Check-in: ${d.checkIn}`, d.checkOut && `Check-out: ${d.checkOut}`].filter(Boolean);
        lines.push(`⏰ ${parts.join('   ·   ')}`);
      }
      if (d.bookingCode) lines.push(`🔖 ${d.bookingCode}`);
      if (d.price)       lines.push(`💶 ${d.price}`);
      if (d.accessCodes) lines.push(`🔑 ${d.accessCodes}`);
      if (d.flightNumber) lines.push(`✈️  ${d.flightNumber}${d.seat ? `  · Sitz: ${d.seat}` : ''}${d.gate ? `  · Gate: ${d.gate}` : ''}`);
      if (d.cancellationPolicy) lines.push(`⚠️  ${d.cancellationPolicy}`);
    }

    if (event.description) {
      lines.push('');
      lines.push(event.description);
    }

    lines.push('');
    lines.push('Alle Details im beigefügten PDF. .ics-Datei öffnen um Termin zu importieren.');
    lines.push('— Meetingbutler.de');

    return lines.join('\n');
  }

  private static readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async sendEventEmail(options: SendEventEmailOptions): Promise<void> {
    const { to, isUpdate, event, icsContent, attachmentIds, eventDetails, pdfBuffer } = options;

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

    // PDF summary
    if (pdfBuffer) {
      fileAttachments.push({
        filename: `${event.title.replace(/[^a-z0-9äöüÄÖÜ]/gi, '_')}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      });
    }

    // ICS file
    fileAttachments.push({
      filename: `${event.title.replace(/[^a-z0-9äöüÄÖÜ]/gi, '_')}.ics`,
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
