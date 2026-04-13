import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DateTime } from 'luxon';

@Injectable()
export class IcsService {
  private readonly logger = new Logger(IcsService.name);

  constructor(private config: ConfigService) {}

  generate(event: any, participants: string[]): string {
    const organizerEmail = this.config.get('DEFAULT_FROM_EMAIL', 'meetings@meetingbutler.de');
    const now = DateTime.utc();
    const dtstamp = this.formatUtcDate(now);

    const tz = event.timezone || 'Europe/Berlin';
    const startDt = DateTime.fromJSDate(new Date(event.startDatetime)).setZone(tz);
    const endDt = DateTime.fromJSDate(new Date(event.endDatetime)).setZone(tz);

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Meetingbutler//Meetingbutler.de//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
    ];

    // VTIMEZONE block
    lines.push(...this.buildVTimezone(tz, startDt));

    // VEVENT
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.uid}`);
    lines.push(`SEQUENCE:${event.sequence}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;TZID=${tz}:${this.formatLocalDate(startDt)}`);
    lines.push(`DTEND;TZID=${tz}:${this.formatLocalDate(endDt)}`);
    lines.push(this.fold(`SUMMARY:${this.escapeText(event.title)}`));

    if (event.description) {
      lines.push(this.fold(`DESCRIPTION:${this.escapeText(event.description)}`));
    }

    if (event.location) {
      lines.push(this.fold(`LOCATION:${this.escapeText(event.location)}`));
    }

    lines.push(this.fold(`ORGANIZER;CN=Meetingbutler:mailto:${organizerEmail}`));

    for (const participant of participants) {
      const email = participant.includes('@') ? participant : null;
      if (email) {
        lines.push(this.fold(`ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${email}`));
      }
    }

    lines.push('STATUS:CONFIRMED');
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
    lines.push('END:VCALENDAR');

    // Join with CRLF as per RFC5545
    return lines.join('\r\n') + '\r\n';
  }

  private buildVTimezone(tz: string, refDate: DateTime): string[] {
    // Build a minimal but valid VTIMEZONE block
    // We use the offset from the reference date for standard/daylight
    const offsetStr = refDate.toFormat('ZZZ').replace(':', '');
    const offsetHours = refDate.offset / 60;
    const tzOffsetFormatted = (offsetHours >= 0 ? '+' : '') + String(Math.floor(Math.abs(offsetHours))).padStart(2, '0') + '00';

    return [
      'BEGIN:VTIMEZONE',
      `TZID:${tz}`,
      'BEGIN:STANDARD',
      'DTSTART:19701025T030000',
      `TZOFFSETFROM:${tzOffsetFormatted}`,
      `TZOFFSETTO:${tzOffsetFormatted}`,
      `TZNAME:${tz}`,
      'END:STANDARD',
      'END:VTIMEZONE',
    ];
  }

  private formatUtcDate(dt: DateTime): string {
    return dt.toFormat("yyyyMMdd'T'HHmmss'Z'");
  }

  private formatLocalDate(dt: DateTime): string {
    return dt.toFormat("yyyyMMdd'T'HHmmss");
  }

  private escapeText(text: string): string {
    if (!text) return '';
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '');
  }

  private fold(line: string): string {
    // RFC5545: fold lines at 75 octets
    if (Buffer.byteLength(line, 'utf8') <= 75) return line;
    const result: string[] = [];
    let current = '';
    let byteLen = 0;

    for (const char of line) {
      const charBytes = Buffer.byteLength(char, 'utf8');
      if (byteLen + charBytes > (result.length === 0 ? 75 : 74)) {
        result.push(current);
        current = ' ' + char;
        byteLen = 1 + charBytes;
      } else {
        current += char;
        byteLen += charBytes;
      }
    }
    if (current) result.push(current);
    return result.join('\r\n');
  }

  validateIcs(ics: string): boolean {
    const required = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:',
      'SEQUENCE:',
      'DTSTAMP:',
      'DTSTART',
      'DTEND',
      'SUMMARY:',
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    const valid = required.every((r) => ics.includes(r));
    if (!valid) {
      const missing = required.filter((r) => !ics.includes(r));
      this.logger.warn(`ICS validation failed, missing: ${missing.join(', ')}`);
    }
    return valid;
  }
}
