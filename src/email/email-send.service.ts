import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
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
  threadId?: string;
  isCancellation?: boolean;
}

@Injectable()
export class EmailSendService {
  private readonly logger = new Logger(EmailSendService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    const smtpUser = this.config.get<string>('SMTP_MEETINGS_USER');
    const smtpPass = this.config.get<string>('SMTP_MEETINGS_PASSWORD');
    const smtpAdminUser = this.config.get<string>('SMTP_ADMIN_USER');
    const smtpAdminPass = this.config.get<string>('SMTP_ADMIN_PASSWORD');

    this.transporter = this.createTransporter(smtpUser || smtpAdminUser, smtpPass || smtpAdminPass);

    this.initTransporter(smtpUser, smtpPass, smtpAdminUser, smtpAdminPass).catch((err) =>
      this.logger.error(`SMTP initialization failed: ${err.message}`, err.stack),
    );
  }

  private createTransporter(user: string, pass: string, port?: number, secure?: boolean): nodemailer.Transporter {
    const smtpPort = port ?? parseInt(this.config.get<string>('SMTP_PORT', '465'), 10);
    const smtpSecure = secure ?? (this.config.get<string>('SMTP_SECURE', 'true') === 'true');
    return nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: smtpPort,
      secure: smtpSecure,
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }

  private async initTransporter(
    smtpUser: string,
    smtpPass: string,
    smtpAdminUser: string,
    smtpAdminPass: string,
  ): Promise<void> {
    const configuredPort = parseInt(this.config.get<string>('SMTP_PORT', '587'), 10);
    const configuredSecure = this.config.get<string>('SMTP_SECURE', 'false') === 'true';
    // Try configured port first, then fallback alternatives
    const altPort = configuredPort === 587 ? 465 : 587;
    const altSecure = altPort === 465;
    const candidates = [
      { user: smtpUser, pass: smtpPass, port: configuredPort, secure: configuredSecure },
      { user: smtpUser, pass: smtpPass, port: altPort, secure: altSecure },
      { user: smtpAdminUser, pass: smtpAdminPass, port: configuredPort, secure: configuredSecure },
      { user: smtpAdminUser, pass: smtpAdminPass, port: altPort, secure: altSecure },
    ].filter((c) => c.user && c.pass);

    for (const { user, pass, port, secure } of candidates) {
      try {
        const t = this.createTransporter(user, pass, port, secure);
        await t.verify();
        this.transporter = t;
        this.logger.log(`SMTP authenticated as ${user} on port ${port}`);
        return;
      } catch (err) {
        this.logger.warn(`SMTP ${user}:${port} failed: ${err.message}`);
      }
    }

    this.logger.error('SMTP verification failed for all candidates — emails will not be sent');
  }

  private buildEmailBody(event: any, isUpdate: boolean, isCancellation: boolean, details: any): string {
    const tz = event.timezone || 'Europe/Berlin';
    const startDt = DateTime.fromJSDate(new Date(event.startDatetime)).setZone(tz);
    const endDt = DateTime.fromJSDate(new Date(event.endDatetime)).setZone(tz);

    const sameDay = startDt.toISODate() === endDt.toISODate();
    const dateStr = sameDay
      ? `${startDt.toFormat('dd. LLLL yyyy')} · ${startDt.toFormat('HH:mm')}–${endDt.toFormat('HH:mm')}`
      : `${startDt.toFormat('dd. LLLL yyyy')} – ${endDt.toFormat('dd. LLLL yyyy')}`;

    const action = isCancellation
      ? '❌ Termin abgesagt'
      : isUpdate
        ? '📅 Termin aktualisiert'
        : '📅 Neuer Termin';

    const managementUrl = `https://meetingbutler.de/termin/${event.uid}`;

    const lines: string[] = [];
    lines.push(`${action}: ${event.title}`);
    lines.push('');
    lines.push(`🗓  ${dateStr}`);
    if (event.location) lines.push(`📍 ${event.location}`);

    if (!isCancellation && details) {
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

    if (event.description && !isCancellation) {
      lines.push('');
      lines.push(event.description);
    }

    lines.push('');
    if (isCancellation) {
      lines.push('Der Termin wurde abgesagt. Dein Kalender wird entsprechend aktualisiert.');
    } else {
      lines.push('Alle Details im beigefügten PDF. .ics-Datei öffnen um Termin zu importieren.');
      lines.push('');
      lines.push(`🔗 Termin verwalten: ${managementUrl}`);
      lines.push('💬 Oder antworte einfach auf diese E-Mail mit Änderungswünschen.');
    }
    lines.push('— Meetingbutler.de');

    return lines.join('\n');
  }

  private static readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** Returns the outgoing Message-ID for thread tracking */
  async sendEventEmail(options: SendEventEmailOptions): Promise<string> {
    const { to, isUpdate, event, icsContent, attachmentIds, eventDetails, pdfBuffer, threadId, isCancellation = false } = options;

    if (!EmailSendService.EMAIL_REGEX.test(to)) {
      throw new BadRequestException(`Invalid recipient email address: ${to}`);
    }

    const label = isCancellation ? 'Termin abgesagt' : isUpdate ? 'Event updated' : 'Event created';
    const subject = isCancellation
      ? `❌ Abgesagt: ${event.title}`
      : `📅 ${isUpdate ? 'Aktualisiert' : 'Neuer Termin'}: ${event.title}`;

    let details = eventDetails;
    if (!details && event.id) {
      details = await this.prisma.eventDetail.findUnique({ where: { eventId: event.id } }).catch(() => null);
    }

    const body = this.buildEmailBody(event, isUpdate, isCancellation, details);

    // Stable Message-ID for threading — same UID = same conversation thread
    const outgoingMessageId = `<${event.uid}@meetingbutler.de>`;

    const fileAttachments: any[] = [];

    if (pdfBuffer && !isCancellation) {
      fileAttachments.push({
        filename: `${event.title.replace(/[^a-z0-9äöüÄÖÜ]/gi, '_')}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      });
    }

    const icsMethod = isCancellation ? 'CANCEL' : isUpdate ? 'REQUEST' : 'REQUEST';
    fileAttachments.push({
      filename: `${event.title.replace(/[^a-z0-9äöüÄÖÜ]/gi, '_')}.ics`,
      content: Buffer.from(icsContent),
      contentType: `text/calendar; charset=utf-8; method=${icsMethod}`,
    });

    if (!isCancellation && attachmentIds && attachmentIds.length > 0) {
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
      messageId: outgoingMessageId,
      // For updates: set In-Reply-To so user's client threads correctly
      ...(isUpdate ? { inReplyTo: outgoingMessageId, references: outgoingMessageId } : {}),
    });

    // Update thread so next reply is recognized via In-Reply-To
    if (threadId) {
      await this.prisma.emailThread.update({
        where: { id: threadId },
        data: { latestMessageId: outgoingMessageId },
      }).catch(() => null); // non-critical
    }

    this.logger.log(`Sent "${subject}" to ${to} (${fileAttachments.length} attachments, msgId=${outgoingMessageId})`);
    return outgoingMessageId;
  }

  async sendSimpleMail(to: string, subject: string, text: string): Promise<void> {
    const fromEmail = this.config.get<string>('DEFAULT_FROM_EMAIL', 'meetings@meetingbutler.de');
    const fromName  = this.config.get<string>('DEFAULT_FROM_NAME', 'Meetingbutler');
    await this.transporter.sendMail({ from: `"${fromName}" <${fromEmail}>`, to, subject, text });
  }

  async sendCounterNotification(event: any, proposal: any): Promise<void> {
    const tz = event.timezone || 'Europe/Berlin';
    const origStart = DateTime.fromJSDate(new Date(event.startDatetime)).setZone(tz);
    const newStart  = DateTime.fromJSDate(new Date(proposal.proposedStart)).setZone(tz);
    const newEnd    = DateTime.fromJSDate(new Date(proposal.proposedEnd)).setZone(tz);
    const baseUrl   = this.config.get<string>('APP_BASE_URL', 'https://meetingbutler.de');
    const acceptUrl  = `${baseUrl}/api/events/counter/${proposal.token}/accept`;
    const declineUrl = `${baseUrl}/api/events/counter/${proposal.token}/decline`;

    const body = [
      `${proposal.proposerEmail} schlägt einen neuen Termin vor:`,
      ``,
      `Vorher: ${origStart.toFormat('dd. LLLL yyyy · HH:mm')}`,
      `Neu:    ${newStart.toFormat('dd. LLLL yyyy · HH:mm')}–${newEnd.toFormat('HH:mm')}`,
      ``,
      `Termin annehmen:  ${acceptUrl}`,
      `Ablehnen:         ${declineUrl}`,
      ``,
      `Oder antworten Sie einfach auf diese Email.`,
      `— Meetingbutler.de`,
    ].join('\n');

    await this.sendSimpleMail(
      event.organizerEmail,
      `[Meetingbutler] Neuer Terminvorschlag: ${event.title}`,
      body,
    );
  }

  async sendCounterDeclineNotification(event: any, proposal: any): Promise<void> {
    await this.sendSimpleMail(
      proposal.proposerEmail,
      `[Meetingbutler] Terminvorschlag abgelehnt: ${event.title}`,
      `Ihr Terminvorschlag für "${event.title}" wurde abgelehnt.\n— Meetingbutler.de`,
    );
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
