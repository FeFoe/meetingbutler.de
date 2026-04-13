#!/usr/bin/env node
require('dotenv').config();
const nodemailer = require('nodemailer');

async function trySmtp(label, user, pass) {
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });
  try {
    await t.verify();
    console.log(`✓ ${label} (${user}): SMTP OK`);
    return t;
  } catch (e) {
    console.log(`✗ ${label} (${user}): ${e.message}`);
    return null;
  }
}

async function main() {
  console.log('SMTP Host:', process.env.SMTP_HOST, 'Port:', process.env.SMTP_PORT);
  const t1 = await trySmtp('admin', process.env.SMTP_ADMIN_USER, process.env.SMTP_ADMIN_PASSWORD);
  const t2 = await trySmtp('meetings', process.env.SMTP_MEETINGS_USER, process.env.SMTP_MEETINGS_PASSWORD);

  // If either works, try sending from meetings to admin
  const transporter = t1 || t2;
  if (transporter) {
    const info = await transporter.sendMail({
      from: `"Meetingbutler Test" <${t1 ? process.env.SMTP_ADMIN_USER : process.env.SMTP_MEETINGS_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: '📅 Test: ICS email from Meetingbutler',
      text: 'SMTP test successful from Meetingbutler pipeline.',
    });
    console.log('✓ Test email sent:', info.messageId);
  }
}

main().catch(console.error);
