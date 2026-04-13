#!/usr/bin/env node
/**
 * Test ICS generation independently
 */
require('dotenv').config();
const { DateTime } = require('luxon');

// Inline ICS generator (same logic as ics.service.ts)
function escapeText(text) {
  if (!text) return '';
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n').replace(/\r/g, '');
}

function formatUtcDate(dt) {
  return dt.toFormat("yyyyMMdd'T'HHmmss'Z'");
}

function formatLocalDate(dt) {
  return dt.toFormat("yyyyMMdd'T'HHmmss");
}

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

function generateIcs(event, participants = []) {
  const tz = event.timezone || 'Europe/Berlin';
  const now = DateTime.utc();
  const dtstamp = formatUtcDate(now);
  const startDt = DateTime.fromJSDate(new Date(event.startDatetime)).setZone(tz);
  const endDt = DateTime.fromJSDate(new Date(event.endDatetime)).setZone(tz);
  const organizerEmail = 'meetings@meetingbutler.de';
  const offsetHours = startDt.offset / 60;
  const tzOffsetFormatted = (offsetHours >= 0 ? '+' : '') + String(Math.floor(Math.abs(offsetHours))).padStart(2, '0') + '00';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meetingbutler//Meetingbutler.de//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VTIMEZONE',
    `TZID:${tz}`,
    'BEGIN:STANDARD',
    'DTSTART:19701025T030000',
    `TZOFFSETFROM:${tzOffsetFormatted}`,
    `TZOFFSETTO:${tzOffsetFormatted}`,
    `TZNAME:${tz}`,
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;TZID=${tz}:${formatLocalDate(startDt)}`,
    `DTEND;TZID=${tz}:${formatLocalDate(endDt)}`,
    fold(`SUMMARY:${escapeText(event.title)}`),
    fold(`DESCRIPTION:${escapeText(event.description || '')}`),
    fold(`LOCATION:${escapeText(event.location || '')}`),
    fold(`ORGANIZER;CN=Meetingbutler:mailto:${organizerEmail}`),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n') + '\r\n';
}

// Test event
const testEvent = {
  uid: 'test-hotel-bavaria-2026-001',
  sequence: 0,
  title: 'Hotel Stay: Hotel Bavaria Munich',
  startDatetime: new Date('2026-04-16T13:00:00Z'), // 15:00 CEST
  endDatetime: new Date('2026-04-19T09:00:00Z'),   // 11:00 CEST
  timezone: 'Europe/Berlin',
  location: 'Maximilianstrasse 17, 80538 Munich, Germany',
  description: 'Hotel Bavaria Munich stay. Booking code: HB-2026-4892. Parking code: P-7741. Wifi: HotelBavaria2026',
};

const ics = generateIcs(testEvent, ['max@example.com']);

// Validate
const required = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:', 'METHOD:REQUEST',
  'BEGIN:VTIMEZONE', 'TZID:', 'END:VTIMEZONE',
  'BEGIN:VEVENT', 'UID:', 'SEQUENCE:', 'DTSTAMP:', 'DTSTART', 'DTEND',
  'SUMMARY:', 'ORGANIZER:', 'END:VEVENT', 'END:VCALENDAR',
];
const missing = required.filter(r => !ics.includes(r));

console.log('=== ICS OUTPUT ===');
console.log(ics);
console.log('=== VALIDATION ===');
if (missing.length === 0) {
  console.log('✓ All required ICS fields present');
} else {
  console.log('✗ Missing fields:', missing);
}

// Check CRLF
const hasCRLF = ics.includes('\r\n');
console.log(hasCRLF ? '✓ CRLF line endings' : '✗ Missing CRLF line endings');

// Check line folding
const longLines = ics.split('\r\n').filter(l => Buffer.byteLength(l, 'utf8') > 75);
console.log(longLines.length === 0 ? '✓ All lines <= 75 octets' : `✗ ${longLines.length} line(s) exceed 75 octets: ${longLines[0]?.slice(0,50)}`);

// Save to file
const fs = require('fs');
fs.writeFileSync('/tmp/test-meetingbutler.ics', ics);
console.log('\n✓ ICS saved to /tmp/test-meetingbutler.ics');
