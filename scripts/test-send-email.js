#!/usr/bin/env node
/**
 * Test script: sends a test forwarded email to admin@meetingbutler.de
 * This simulates a user forwarding a booking confirmation email.
 */
const nodemailer = require('nodemailer');
require('dotenv').config();

async function main() {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_ADMIN_USER,
      pass: process.env.SMTP_ADMIN_PASSWORD,
    },
  });

  const testEmailBody = `
---------- Forwarded message ----------
From: Hotel Bavaria <reservations@hotel-bavaria.example.com>
To: Max Mustermann <max@example.com>
Date: Monday, 12 April 2026
Subject: Booking Confirmation - Reservation #HB-2026-4892

Dear Max Mustermann,

Thank you for choosing Hotel Bavaria. Your reservation has been confirmed.

BOOKING DETAILS:
================
Hotel: Hotel Bavaria Munich
Address: Maximilianstrasse 17, 80538 Munich, Germany
Check-in: Thursday, 16 April 2026 at 15:00
Check-out: Sunday, 19 April 2026 at 11:00

Room Type: Superior Double Room
Booking Code: HB-2026-4892
Confirmation Number: CONF-98765

Special Notes:
- Early check-in available from 12:00 on request
- Parking garage code: P-7741
- Wifi password: HotelBavaria2026
- Breakfast included (served 07:00-10:30)

Total Price: EUR 345.00 (including taxes)

Check-in instructions:
Please bring this confirmation and a valid ID.
The reception is staffed 24/7.

If you need to cancel or modify your reservation, please do so at least 48 hours before check-in.

Looking forward to welcoming you!

Best regards,
Hotel Bavaria Reception Team
reservations@hotel-bavaria.example.com
+49 89 123 4567
`;

  console.log('Sending test email to admin@meetingbutler.de...');

  const info = await transporter.sendMail({
    from: `"Max Mustermann" <${process.env.SMTP_ADMIN_USER}>`,
    to: process.env.ADMIN_EMAIL,
    subject: 'Fwd: Booking Confirmation - Reservation #HB-2026-4892',
    text: testEmailBody,
  });

  console.log('Email sent! Message-ID:', info.messageId);
  console.log('Now wait ~35 seconds for the IMAP poller to pick it up...');
  console.log('Then check: curl http://localhost:3000/api/events');
  console.log('And check: curl http://localhost:3000/api/admin/raw-emails');
}

main().catch(console.error);
