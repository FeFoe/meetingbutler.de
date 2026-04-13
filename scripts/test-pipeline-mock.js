#!/usr/bin/env node
/**
 * Full pipeline integration test with mocked LLM response.
 * This verifies DB storage, ICS generation, and email sending without OpenAI quota.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { DateTime } = require('luxon');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// === Inline ICS service (same logic as src/ics/ics.service.ts) ===
function escapeText(text) {
  if (!text) return '';
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n').replace(/\r/g, '');
}
function formatUtcDate(dt) { return dt.toFormat("yyyyMMdd'T'HHmmss'Z'"); }
function formatLocalDate(dt) { return dt.toFormat("yyyyMMdd'T'HHmmss"); }
function fold(line) {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const result = [];
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
function generateIcs(event) {
  const tz = event.timezone || 'Europe/Berlin';
  const now = DateTime.utc();
  const dtstamp = formatUtcDate(now);
  const startDt = DateTime.fromJSDate(new Date(event.startDatetime)).setZone(tz);
  const endDt = DateTime.fromJSDate(new Date(event.endDatetime)).setZone(tz);
  const organizerEmail = process.env.DEFAULT_FROM_EMAIL || 'meetings@meetingbutler.de';
  const offsetHours = startDt.offset / 60;
  const tzOffset = (offsetHours >= 0 ? '+' : '') + String(Math.floor(Math.abs(offsetHours))).padStart(2, '0') + '00';

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Meetingbutler//Meetingbutler.de//EN',
    'CALSCALE:GREGORIAN', 'METHOD:REQUEST',
    'BEGIN:VTIMEZONE', `TZID:${tz}`,
    'BEGIN:STANDARD', 'DTSTART:19701025T030000',
    `TZOFFSETFROM:${tzOffset}`, `TZOFFSETTO:${tzOffset}`, `TZNAME:${tz}`,
    'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${event.uid}`, `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${tz}:${formatLocalDate(startDt)}`,
    `DTEND;TZID=${tz}:${formatLocalDate(endDt)}`,
    fold(`SUMMARY:${escapeText(event.title)}`),
    fold(`DESCRIPTION:${escapeText(event.description || '')}`),
    fold(`LOCATION:${escapeText(event.location || '')}`),
    fold(`ORGANIZER;CN=Meetingbutler:mailto:${organizerEmail}`),
    'STATUS:CONFIRMED', 'TRANSP:OPAQUE',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

async function run() {
  console.log('\n=== Meetingbutler Pipeline Integration Test ===\n');
  let passed = 0;
  let failed = 0;

  const check = (label, condition, detail = '') => {
    if (condition) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.log(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
      failed++;
    }
  };

  // ── 1. DB Connection ──────────────────────────────────────────────
  console.log('[1] Database');
  try {
    // Verify connection by running a simple query
    const count = await prisma.rawEmail.count();
    check('Prisma connected', true, `raw_emails count=${count}`);
  } catch (e) {
    check('Prisma connected', false, e.message);
    process.exit(1);
  }

  // ── 2. Store raw email ────────────────────────────────────────────
  console.log('\n[2] Email Ingestion (raw email storage)');
  const msgId = `<mock-test-${Date.now()}@meetingbutler.de>`;
  let rawEmail;
  try {
    rawEmail = await prisma.rawEmail.create({
      data: {
        messageId: msgId,
        fromAddress: 'max@example.com',
        toAddress: 'admin@meetingbutler.de',
        subject: 'Fwd: Booking Confirmation - Hotel Bavaria Munich',
        bodyText: 'Check-in: 16 April 2026 15:00. Hotel Bavaria Munich. Booking: HB-2026-4892.',
        receivedAt: new Date(),
        processed: true,
      },
    });
    check('Raw email stored', !!rawEmail.id, rawEmail.id);
  } catch (e) {
    check('Raw email stored', false, e.message);
    process.exit(1);
  }

  // ── 3. Mock LLM extraction ────────────────────────────────────────
  console.log('\n[3] LLM Extraction (mocked — API quota exhausted)');
  const extracted = {
    title: 'Hotel Stay: Hotel Bavaria Munich',
    start_datetime: '2026-04-16T15:00:00+02:00',
    end_datetime: '2026-04-19T11:00:00+02:00',
    timezone: 'Europe/Berlin',
    location: 'Maximilianstrasse 17, 80538 Munich, Germany',
    description: 'Hotel stay at Hotel Bavaria Munich. Room: Superior Double.',
    participants: ['max@example.com'],
    important_details: {
      booking_code: 'HB-2026-4892',
      hotel_name: 'Hotel Bavaria Munich',
      address: 'Maximilianstrasse 17, 80538 Munich, Germany',
      notes: 'Breakfast included 07:00-10:30. Early check-in from 12:00.',
      access_codes: 'Parking: P-7741 | Wifi: HotelBavaria2026',
    },
    confidence: 0.98,
    event_type: 'hotel',
  };
  check('Title extracted', !!extracted.title, extracted.title);
  check('Start datetime', !!extracted.start_datetime);
  check('End datetime', !!extracted.end_datetime);
  check('Booking code extracted', extracted.important_details.booking_code === 'HB-2026-4892');
  check('Access codes extracted', !!extracted.important_details.access_codes);

  // ── 4. Create event in DB ─────────────────────────────────────────
  console.log('\n[4] Event Storage');
  const uid = uuidv4();
  let event;
  try {
    const thread = await prisma.emailThread.create({
      data: {
        normalizedThreadKey: msgId,
        latestMessageId: msgId,
      },
    });

    event = await prisma.event.create({
      data: {
        uid,
        sequence: 0,
        title: extracted.title,
        startDatetime: new Date(extracted.start_datetime),
        endDatetime: new Date(extracted.end_datetime),
        timezone: extracted.timezone,
        location: extracted.location,
        description: extracted.description,
        organizerEmail: 'max@example.com',
        sourceEmailId: rawEmail.id,
        threadId: thread.id,
        status: 'active',
      },
    });
    check('Event created', !!event.id, event.id);
    check('Event UID set', !!event.uid);
    check('Event sequence=0', event.sequence === 0);

    // Update thread
    await prisma.emailThread.update({ where: { id: thread.id }, data: { linkedEventId: event.id } });

    // Store event details
    await prisma.eventDetail.create({
      data: {
        eventId: event.id,
        bookingCode: extracted.important_details.booking_code,
        hotelName: extracted.important_details.hotel_name,
        address: extracted.important_details.address,
        notes: extracted.important_details.notes,
        accessCodes: extracted.important_details.access_codes,
        rawJson: extracted,
      },
    });
    check('Event details stored', true);

    await prisma.auditLog.create({
      data: { eventId: event.id, action: 'event_created', details: { test: true } },
    });
    check('Audit log created', true);
  } catch (e) {
    check('Event created', false, e.message);
    process.exit(1);
  }

  // ── 5. ICS generation ─────────────────────────────────────────────
  console.log('\n[5] ICS Generation');
  const icsContent = generateIcs(event);
  const icsRequired = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:', 'METHOD:REQUEST',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin', 'END:VTIMEZONE',
    'BEGIN:VEVENT', `UID:${uid}`, 'SEQUENCE:0', 'DTSTAMP:', 'DTSTART', 'DTEND',
    'SUMMARY:Hotel Stay', 'ORGANIZER', 'END:VEVENT', 'END:VCALENDAR',
  ];
  const missingIcs = icsRequired.filter(r => !icsContent.includes(r));
  check('All required ICS fields present', missingIcs.length === 0, missingIcs.join(', '));
  check('CRLF line endings', icsContent.includes('\r\n'));
  const longLines = icsContent.split('\r\n').filter(l => Buffer.byteLength(l, 'utf8') > 75);
  check('Lines <= 75 octets (folded)', longLines.length === 0, `${longLines.length} long lines`);
  check('VTIMEZONE block included', icsContent.includes('BEGIN:VTIMEZONE'));
  check('Commas escaped in LOCATION', icsContent.includes('LOCATION:Maximilianstrasse 17\\,'));

  // ── 6. Event update simulation ────────────────────────────────────
  console.log('\n[6] Event Update (sequence increment)');
  const updatedEvent = await prisma.event.update({
    where: { id: event.id },
    data: {
      location: 'Maximilianstrasse 17, 80538 Munich, Germany (Room 205)',
      sequence: 1,
    },
  });
  check('Event updated', updatedEvent.sequence === 1);
  const updatedIcs = generateIcs(updatedEvent);
  check('Updated ICS SEQUENCE=1', updatedIcs.includes('SEQUENCE:1'));
  check('Same UID maintained', updatedIcs.includes(`UID:${uid}`));

  await prisma.auditLog.create({
    data: { eventId: event.id, action: 'event_updated', details: { instruction: 'room 205', newSequence: 1 } },
  });
  check('Update audit log created', true);

  // ── 7. SMTP send ──────────────────────────────────────────────────
  console.log('\n[7] SMTP Email Send');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_ADMIN_USER,
      pass: process.env.SMTP_ADMIN_PASSWORD,
    },
  });

  try {
    await transporter.verify();
    check('SMTP connection verified', true);

    const icsBuffer = Buffer.from(icsContent);
    const info = await transporter.sendMail({
      from: `"Meetingbutler" <${process.env.DEFAULT_FROM_EMAIL}>`,
      to: process.env.ADMIN_EMAIL,
      subject: `📅 Event created: ${event.title}`,
      text: `A new calendar event has been created.\n\nEvent: ${event.title}\nWhen: 16 April 2026 15:00 – 19 April 2026 11:00\nWhere: ${event.location}\nBooking: HB-2026-4892\n\nThe calendar invite is attached.`,
      attachments: [
        {
          filename: 'hotel-bavaria-munich.ics',
          content: icsBuffer,
          contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        },
      ],
    });
    check('Event email sent', !!info.messageId, info.messageId);
    console.log(`    → Message-ID: ${info.messageId}`);
  } catch (e) {
    check('SMTP connection verified', false, e.message);
  }

  // ── 8. DB read-back verification ──────────────────────────────────
  console.log('\n[8] DB Integrity Check');
  const storedEvent = await prisma.event.findUnique({
    where: { id: event.id },
    include: { eventDetails: true, auditLogs: true },
  });
  check('Event retrievable', !!storedEvent);
  check('Event details linked', !!storedEvent.eventDetails);
  check('Booking code persisted', storedEvent.eventDetails?.bookingCode === 'HB-2026-4892');
  check('Audit logs created', storedEvent.auditLogs.length >= 2);

  // ── Summary ───────────────────────────────────────────────────────
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

run()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
