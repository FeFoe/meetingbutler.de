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

  private buildDateStr(event: any): string {
    const tz = event.timezone || 'Europe/Berlin';
    const startDt = DateTime.fromJSDate(new Date(event.startDatetime)).setZone(tz);
    const endDt = DateTime.fromJSDate(new Date(event.endDatetime)).setZone(tz);
    const sameDay = startDt.toISODate() === endDt.toISODate();
    return sameDay
      ? `${startDt.toFormat('dd. LLLL yyyy')} · ${startDt.toFormat('HH:mm')}–${endDt.toFormat('HH:mm')} Uhr`
      : `${startDt.toFormat('dd. LLLL yyyy')} – ${endDt.toFormat('dd. LLLL yyyy')}`;
  }

  private buildEmailBody(event: any, isUpdate: boolean, isCancellation: boolean, details: any): string {
    const dateStr = this.buildDateStr(event);
    const managementUrl = `https://meetingbutler.de/termin/${event.uid}`;
    const actionLabel = isCancellation ? 'Termin abgesagt' : isUpdate ? 'Termin aktualisiert' : 'Neuer Termin';

    const lines: string[] = [];
    lines.push(`${actionLabel}: ${event.title}`);
    lines.push(`Datum: ${dateStr}`);
    if (event.location) lines.push(`Ort: ${event.location}`);

    if (!isCancellation && details) {
      const d = details;
      if (d.checkIn || d.checkOut) {
        const parts = [d.checkIn && `Check-in: ${d.checkIn}`, d.checkOut && `Check-out: ${d.checkOut}`].filter(Boolean);
        lines.push(parts.join('   ·   '));
      }
      if (d.bookingCode) lines.push(`Buchungscode: ${d.bookingCode}`);
      if (d.price) lines.push(`Preis: ${d.price}`);
      if (d.accessCodes) lines.push(`Zugangscodes: ${d.accessCodes}`);
      if (d.flightNumber) lines.push(`Flug/Verbindung: ${d.flightNumber}${d.seat ? ` · Sitz: ${d.seat}` : ''}${d.gate ? ` · Gate: ${d.gate}` : ''}`);
      if (d.cancellationPolicy) lines.push(`Stornierung: ${d.cancellationPolicy}`);
    }

    if (event.description && !isCancellation) {
      lines.push('');
      lines.push(event.description);
    }

    lines.push('');
    if (isCancellation) {
      lines.push('Der Termin wurde abgesagt. Dein Kalender wird entsprechend aktualisiert.');
    } else {
      lines.push('Alle Details im beigefügten PDF. Die .ics-Datei öffnen, um den Termin zu importieren.');
      lines.push('');
      lines.push(`Termin verwalten: ${managementUrl}`);
      lines.push('Oder antworte einfach auf diese E-Mail mit Änderungswünschen.');
    }
    lines.push('');
    lines.push('— Meetingbutler.de');

    return lines.join('\n');
  }

  private escapeHtml(str: string): string {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private buildEmailHtml(event: any, isUpdate: boolean, isCancellation: boolean, details: any): string {
    const dateStr = this.buildDateStr(event);
    const managementUrl = `https://meetingbutler.de/termin/${event.uid}`;
    const headerColor = isCancellation ? '#b91c1c' : '#1a1a2e';
    const actionLabel = isCancellation ? 'Termin abgesagt' : isUpdate ? 'Termin aktualisiert' : 'Neuer Termin';

    const row = (label: string, value: string, even: boolean) =>
      `<tr style="background:${even ? '#f9f9fc' : '#fff'}">` +
      `<td style="padding:7px 14px;font-size:13px;color:#555;font-weight:700;white-space:nowrap;width:150px">${label}</td>` +
      `<td style="padding:7px 14px;font-size:13px;color:#222">${this.escapeHtml(value)}</td></tr>`;

    const detailRows: string[] = [];
    let idx = 0;
    detailRows.push(row('Datum', dateStr, idx++ % 2 === 0));
    if (event.location) detailRows.push(row('Ort', event.location, idx++ % 2 === 0));

    if (!isCancellation && details) {
      const d = details;
      if (d.checkIn) detailRows.push(row('Check-in', d.checkIn, idx++ % 2 === 0));
      if (d.checkOut) detailRows.push(row('Check-out', d.checkOut, idx++ % 2 === 0));
      if (d.bookingCode) detailRows.push(row('Buchungscode', d.bookingCode, idx++ % 2 === 0));
      if (d.hotelName) detailRows.push(row('Hotel / Anbieter', d.hotelName, idx++ % 2 === 0));
      if (d.address && d.address !== event.location) detailRows.push(row('Adresse', d.address, idx++ % 2 === 0));
      if (d.price) detailRows.push(row('Preis', d.price, idx++ % 2 === 0));
      if (d.cancellationPolicy) detailRows.push(row('Stornierung', d.cancellationPolicy, idx++ % 2 === 0));
      if (d.accessCodes) detailRows.push(row('Zugangscodes', d.accessCodes, idx++ % 2 === 0));
      if (d.parking) detailRows.push(row('Parken', d.parking, idx++ % 2 === 0));
      if (d.flightNumber) detailRows.push(row('Flug / Verbindung', d.flightNumber, idx++ % 2 === 0));
      if (d.seat) detailRows.push(row('Sitz / Klasse', d.seat, idx++ % 2 === 0));
      if (d.gate) detailRows.push(row('Gate / Gleis', d.gate, idx++ % 2 === 0));
      if (d.contact) detailRows.push(row('Kontakt', d.contact, idx++ % 2 === 0));
      if (d.organizer) detailRows.push(row('Organisator', d.organizer, idx++ % 2 === 0));
      if (d.dressCode) detailRows.push(row('Dress Code', d.dressCode, idx++ % 2 === 0));
      if (d.dietary) detailRows.push(row('Verpflegung', d.dietary, idx++ % 2 === 0));
      if (d.agenda) detailRows.push(row('Agenda', d.agenda, idx++ % 2 === 0));
      if (d.notes) detailRows.push(row('Hinweise', d.notes, idx++ % 2 === 0));
      if (d.extra) detailRows.push(row('Weitere Infos', d.extra, idx++ % 2 === 0));
    }

    const descriptionBlock = event.description && !isCancellation
      ? `<p style="font-size:14px;color:#333;line-height:1.7;margin:20px 0 0">${this.escapeHtml(event.description).replace(/\n/g, '<br>')}</p>`
      : '';

    const footerAction = isCancellation
      ? `<p style="font-size:14px;color:#555;margin:20px 0 0">Der Termin wurde abgesagt. Dein Kalender wird entsprechend aktualisiert.</p>`
      : `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:28px">
          <tr><td style="background:#1a1a2e;border-radius:6px">
            <a href="${managementUrl}" style="display:inline-block;padding:13px 30px;color:#fff;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px">Termin verwalten</a>
          </td></tr>
        </table>
        <p style="font-size:12px;color:#999;margin:12px 0 0">
          Oder antworte einfach auf diese E-Mail mit Änderungswünschen.<br>
          Alle Details im beigefügten PDF &middot; .ics-Datei zum Kalender-Import im Anhang.
        </p>`;

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f0f5;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#f0f0f5">
<tr><td align="center" style="padding:32px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.09)">
  <tr><td style="background:${headerColor};padding:28px 32px">
    <p style="margin:0 0 6px;font-size:11px;color:#aab;text-transform:uppercase;letter-spacing:1.5px;font-weight:700">${actionLabel}</p>
    <h1 style="margin:0;font-size:22px;color:#fff;font-weight:700;line-height:1.3">${this.escapeHtml(event.title)}</h1>
  </td></tr>
  <tr><td style="padding:28px 32px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e8e8f0;border-radius:6px;overflow:hidden">
      ${detailRows.join('\n')}
    </table>
    ${descriptionBlock}
    ${footerAction}
  </td></tr>
  <tr><td style="padding:16px 32px;border-top:1px solid #eee">
    <p style="margin:0;font-size:11px;color:#bbb;text-align:center">Meetingbutler.de &middot; Automatische Terminverwaltung per E-Mail</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
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
      ? `Abgesagt: ${event.title}`
      : `${isUpdate ? 'Aktualisiert' : 'Neuer Termin'}: ${event.title}`;

    let details = eventDetails;
    if (!details && event.id) {
      details = await this.prisma.eventDetail.findUnique({ where: { eventId: event.id } }).catch(() => null);
    }

    const body = this.buildEmailBody(event, isUpdate, isCancellation, details);
    const html = this.buildEmailHtml(event, isUpdate, isCancellation, details);

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
      html,
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
